import { websiteSettingsSchema, DEFAULT_WEBSITE_SETTINGS, PUBLIC_SETTING_KEYS } from '@rmw-analytics/shared';
import { col, oid } from '../config/db.js';
import { env } from '../config/env.js';
import { randomId, randomToken, sha256, encrypt, decrypt } from '../utils/crypto.js';
import { notFound, badRequest } from '../utils/errors.js';
import { DEFAULT_TZ, dayKey, startOfDayInTz } from '../utils/dates.js';

const CACHE_TTL_MS = 30_000;
const bySiteId = new Map();

/** Normalise "https://www.example.com/path" → "example.com". */
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normalizeOrigins(list = []) {
  return [...new Set(list.map((o) => {
    try { const u = new URL(/^https?:\/\//.test(o) ? o : `https://${o}`); return u.origin.toLowerCase(); } catch { return null; }
  }).filter(Boolean))];
}

/** Public, cache-safe view of a website (no secrets). */
export function presentWebsite(w) {
  if (!w) return null;
  return {
    id: String(w._id), siteId: w.siteId, name: w.name, code: w.code, domain: w.domain, color: w.color || null,
    allowedOrigins: w.allowedOrigins || [], timezone: w.timezone, settings: { ...DEFAULT_WEBSITE_SETTINGS, ...w.settings },
    lastEventAt: w.lastEventAt || null, createdAt: w.createdAt, hasSecretKey: Boolean(w.hasSecretKey),
  };
}

export function snippetFor(w) {
  return `<script defer src="${env.PUBLIC_API_URL.replace(/\/$/, '')}/tracker.js" data-site-id="${w.siteId}"></script>`;
}

export async function createWebsite(orgId, input) {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw badRequest('Enter a valid domain, e.g. example.com', 'BAD_DOMAIN');
  const settings = websiteSettingsSchema.parse(input.settings || {});
  const doc = {
    siteId: `site_${randomId(12)}`,
    orgId,
    name: input.name.trim(),
    code: (input.code || input.name).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SITE',
    domain,
    color: input.color || null,
    allowedOrigins: normalizeOrigins(input.allowedOrigins),
    timezone: input.timezone || DEFAULT_TZ,
    settings,
    lastEventAt: null,
    createdAt: new Date(),
    deletedAt: null,
  };
  const { insertedId } = await col('websites').insertOne(doc);
  return { _id: insertedId, ...doc };
}

export const listWebsites = (orgId) => col('websites').find({ orgId, deletedAt: null }).sort({ createdAt: 1 }).toArray();

export async function getWebsiteForOrg(orgId, id) {
  const _id = oid(id);
  const w = _id && (await col('websites').findOne({ _id, orgId, deletedAt: null }));
  if (!w) throw notFound('Website not found');
  return w;
}

export async function updateWebsite(orgId, id, patch) {
  const w = await getWebsiteForOrg(orgId, id);
  const $set = { updatedAt: new Date() };
  if (patch.name !== undefined) $set.name = patch.name.trim();
  if (patch.code !== undefined) $set.code = patch.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (patch.color !== undefined) $set.color = patch.color;
  if (patch.timezone !== undefined) $set.timezone = patch.timezone;
  if (patch.domain !== undefined) {
    const d = normalizeDomain(patch.domain);
    if (!d) throw badRequest('Enter a valid domain', 'BAD_DOMAIN');
    $set.domain = d;
  }
  if (patch.allowedOrigins !== undefined) $set.allowedOrigins = normalizeOrigins(patch.allowedOrigins);
  if (patch.settings !== undefined) $set.settings = websiteSettingsSchema.parse({ ...DEFAULT_WEBSITE_SETTINGS, ...w.settings, ...patch.settings });
  await col('websites').updateOne({ _id: w._id }, { $set });
  bySiteId.delete(w.siteId);
  return col('websites').findOne({ _id: w._id });
}

export async function deleteWebsite(orgId, id) {
  const w = await getWebsiteForOrg(orgId, id);
  await col('websites').updateOne({ _id: w._id }, { $set: { deletedAt: new Date() } });
  await col('trackingKeys').updateMany({ websiteId: w._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  bySiteId.delete(w.siteId);
  return w;
}

/** Issue a new server-side secret key (shown once) and revoke the previous ones. */
export async function rotateSecretKey(orgId, id) {
  const w = await getWebsiteForOrg(orgId, id);
  const key = `sk_${randomToken(32)}`;
  await col('trackingKeys').updateMany({ websiteId: w._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await col('trackingKeys').insertOne({ websiteId: w._id, kind: 'secret', prefix: key.slice(0, 10), hash: sha256(key), secretEnc: encrypt(key), createdAt: new Date(), revokedAt: null, lastUsedAt: null });
  await col('websites').updateOne({ _id: w._id }, { $set: { hasSecretKey: true } });
  return { key, prefix: key.slice(0, 10) };
}

/** Cached lookup used by the ingestion hot path. */
export async function getActiveWebsiteBySiteId(siteId) {
  const hit = bySiteId.get(siteId);
  if (hit && hit.exp > Date.now()) return hit.w;
  const w = await col('websites').findOne({ siteId, deletedAt: null });
  bySiteId.set(siteId, { w, exp: Date.now() + CACHE_TTL_MS });
  if (bySiteId.size > 10_000) bySiteId.delete(bySiteId.keys().next().value);
  return w;
}

export async function verifySecretKey(website, key) {
  if (!key?.startsWith('sk_')) return false;
  const k = await col('trackingKeys').findOne({ hash: sha256(key), websiteId: website._id, revokedAt: null });
  if (!k) return false;
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) col('trackingKeys').updateOne({ _id: k._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return true;
}

/** The active secret key (decrypted) for verifying `X-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`. */
export async function secretForSignature(website) {
  const k = await col('trackingKeys').findOne({ websiteId: website._id, revokedAt: null }, { sort: { createdAt: -1 } });
  if (!k?.secretEnc) return null;
  try { return decrypt(k.secretEnc); } catch { return null; }
}

/** Browser requests must come from the website's domain (or a subdomain) or an explicitly allowed origin. */
export function isOriginAllowed(website, origin) {
  if (!origin) return false;
  let u;
  try { u = new URL(origin); } catch { return false; }
  const o = u.origin.toLowerCase();
  if ((website.allowedOrigins || []).includes(o)) return true;
  const host = u.hostname.replace(/^www\./, '');
  return host === website.domain || host.endsWith(`.${website.domain}`);
}

export function publicConfig(w) {
  const s = { ...DEFAULT_WEBSITE_SETTINGS, ...w.settings };
  return Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, s[k]]));
}

/** Installation check shown on the Websites page. */
export async function installationStatus(w, tz = DEFAULT_TZ) {
  const startToday = startOfDayInTz(dayKey(new Date(), tz), tz);
  const [eventsToday, lastEvent] = await Promise.all([
    col('events').countDocuments({ websiteId: w._id, ts: { $gte: startToday } }),
    col('events').findOne({ websiteId: w._id }, { sort: { ts: -1 }, projection: { ts: 1, name: 1, 'page.path': 1 } }),
  ]);
  const last = lastEvent?.ts || w.lastEventAt || null;
  const ageMs = last ? Date.now() - new Date(last).getTime() : null;
  const state = !last ? 'waiting' : ageMs < 24 * 3600_000 ? 'active' : 'stale';
  return { state, lastEventAt: last, lastEventName: lastEvent?.name || null, lastEventPath: lastEvent?.page?.path || null, eventsToday };
}
