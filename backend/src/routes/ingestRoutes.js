import express from 'express';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import { batchSchema, LIMITS, SITE_ID_RE, DEFAULT_WEBSITE_SETTINGS } from '@rmw-analytics/shared';
import { env, isTest } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getRedis } from '../config/redis.js';
import { asyncHandler, clientIp } from '../utils/http.js';
import { badRequest, unauthorized, forbidden, notFound, tooMany, payloadTooLarge } from '../utils/errors.js';
import { hmacSha256, safeEqual } from '../utils/crypto.js';
import { isBot } from '../utils/ua.js';
import { getActiveWebsiteBySiteId, isOriginAllowed, verifySecretKey, secretForSignature, publicConfig } from '../services/websiteService.js';
import { ingestBatch } from '../services/ingest/ingestService.js';

const router = express.Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const TRACKER_PATH = path.resolve(here, '../../tracker/dist/tracker.js');
const MAX_INFLATED_BYTES = 512 * 1024;

/** Tracker + ingestion are called cross-origin from customer websites without credentials. */
function publicCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Timing-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Signature');
    res.set('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  return next();
}

// ─── tracker.js ────────────────────────────────────────────────────────────
let trackerCache = null;
async function loadTracker() {
  if (trackerCache && !isTest && env.NODE_ENV === 'production') return trackerCache;
  try {
    const body = await fs.readFile(TRACKER_PATH);
    const stat = await fs.stat(TRACKER_PATH);
    if (!trackerCache || trackerCache.mtime !== stat.mtimeMs) {
      trackerCache = { body, gz: zlib.gzipSync(body, { level: 9 }), br: zlib.brotliCompressSync(body), etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`, mtime: stat.mtimeMs };
    }
    return trackerCache;
  } catch {
    return null;
  }
}

router.get(['/tracker.js', '/t.js'], publicCors, asyncHandler(async (req, res) => {
  const t = await loadTracker();
  if (!t) throw notFound('tracker.js has not been built. Run: npm run build:tracker');
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.set('ETag', t.etag);
  res.set('Vary', 'Accept-Encoding');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.get('if-none-match') === t.etag) return res.status(304).end();
  const ae = req.get('accept-encoding') || '';
  if (/\bbr\b/.test(ae)) { res.set('Content-Encoding', 'br'); return res.end(t.br); }
  if (/\bgzip\b/.test(ae)) { res.set('Content-Encoding', 'gzip'); return res.end(t.gz); }
  return res.end(t.body);
}));

// ─── Public site config (consent mode, features) ───────────────────────────
router.options('/api/v1/sites/:siteId/config', publicCors);
router.get('/api/v1/sites/:siteId/config', publicCors, asyncHandler(async (req, res) => {
  if (!SITE_ID_RE.test(req.params.siteId)) throw notFound('Unknown site');
  const w = await getActiveWebsiteBySiteId(req.params.siteId);
  if (!w) throw notFound('Unknown site');
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data: publicConfig(w) });
}));

// ─── Ingestion ─────────────────────────────────────────────────────────────
const ipLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1_000_000 : env.INGEST_RATE_PER_IP_PER_MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).set('Retry-After', '60').json({ success: false, message: 'Rate limit exceeded', errorCode: 'RATE_LIMITED' }),
});

const siteCounters = new Map();
/** Per-website events/minute ceiling (abuse + runaway-loop protection). Shared via Redis when available. */
async function checkSiteQuota(siteId, n) {
  const minute = Math.floor(Date.now() / 60_000);
  const r = await getRedis();
  let count;
  if (r) {
    const key = `rl:site:${siteId}:${minute}`;
    count = await r.incrby(key, n);
    if (count === n) await r.expire(key, 120);
  } else {
    const c = siteCounters.get(siteId);
    if (!c || c.minute !== minute) siteCounters.set(siteId, { minute, count: n });
    else c.count += n;
    count = siteCounters.get(siteId).count;
    if (siteCounters.size > 50_000) siteCounters.clear();
  }
  if (count > env.INGEST_RATE_PER_SITE_PER_MIN) throw tooMany('Site event quota exceeded', 'SITE_QUOTA');
}

const rawBody = express.raw({ type: () => true, limit: LIMITS.MAX_BODY_BYTES });

function decodeBody(req) {
  let buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest('Empty body', 'EMPTY_BODY');
  if (req.query.z === '1' || req.get('content-encoding') === 'gzip') {
    try { buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_INFLATED_BYTES }); } catch { throw payloadTooLarge('Invalid or oversized compressed body'); }
  }
  const text = buf.toString('utf8');
  try { return { text, json: JSON.parse(text) }; } catch { throw badRequest('Malformed JSON body', 'BAD_JSON'); }
}

function requestOrigin(req) {
  const o = req.get('origin');
  if (o && o !== 'null') return o;
  try { return new URL(req.get('referer')).origin; } catch { return null; }
}

/** Server-to-server auth: Bearer secret key, or HMAC signature over `${t}.${body}` with a 5-minute window. */
async function authenticateServer(req, website, rawText) {
  const auth = req.get('authorization');
  if (auth) {
    const key = auth.replace(/^Bearer\s+/i, '');
    if (!(await verifySecretKey(website, key))) throw unauthorized('Invalid secret key', 'BAD_KEY');
    return true;
  }
  const sig = req.get('x-signature');
  if (sig) {
    const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300) throw unauthorized('Signature expired', 'BAD_SIGNATURE');
    const secret = await secretForSignature(website);
    if (!secret || !parts.v1 || !safeEqual(hmacSha256(secret, `${t}.${rawText}`), parts.v1)) throw unauthorized('Invalid signature', 'BAD_SIGNATURE');
    return true;
  }
  return false;
}

router.options('/api/v1/events', publicCors);
router.post('/api/v1/events', publicCors, ipLimiter, rawBody, asyncHandler(async (req, res) => {
  const { text, json } = decodeBody(req);
  const parsed = batchSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`Invalid event batch: ${issue.path.join('.')} ${issue.message}`, 'VALIDATION_ERROR');
  }
  const batch = parsed.data;
  const website = await getActiveWebsiteBySiteId(batch.siteId);
  if (!website) throw notFound('Unknown site', 'UNKNOWN_SITE');

  const serverSide = await authenticateServer(req, website, text);
  let ua = req.get('user-agent') || '';
  let ip = clientIp(req);
  if (serverSide) {
    ua = batch.ctx.ua || ua;
    ip = batch.ctx.ip || null;
  } else {
    const origin = requestOrigin(req);
    if (origin ? !isOriginAllowed(website, origin) : !env.INGEST_ALLOW_MISSING_ORIGIN) {
      throw forbidden('Origin not allowed for this site', 'ORIGIN_REJECTED');
    }
    const settings = { ...DEFAULT_WEBSITE_SETTINGS, ...website.settings };
    if (settings.respectDnt && (req.get('dnt') === '1' || req.get('sec-gpc') === '1')) {
      return res.status(202).json({ success: true, data: { accepted: 0, dropped: batch.events.length, reason: 'dnt' } });
    }
    if (settings.consentMode === 'opt-in' && batch.ctx.consent !== 'granted') {
      return res.status(202).json({ success: true, data: { accepted: 0, dropped: batch.events.length, reason: 'consent' } });
    }
  }
  // Bots get a normal-looking response so they don't adapt; nothing is stored.
  if (isBot(ua)) return res.status(202).json({ success: true, data: { accepted: 0, dropped: batch.events.length } });

  await checkSiteQuota(batch.siteId, batch.events.length);
  const result = await ingestBatch({ website, batch, req, ip, ua });
  if (result.dropped) logger.debug({ siteId: batch.siteId, dropped: result.dropped }, 'Events dropped (time window / excluded path)');
  return res.status(202).json({ success: true, data: result });
}));

export default router;
