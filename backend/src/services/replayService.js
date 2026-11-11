/**
 * Session recordings. Chunks of rrweb events are stored gzip-compressed on disk
 * (REPLAY_DIR/<websiteId>/<sessionId>/<seq>.json.gz); MongoDB keeps one small index document per recording.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from '@rmw-analytics/shared';
import { col, oid } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { notFound } from '../utils/errors.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const here = path.dirname(fileURLToPath(import.meta.url));
export const replayRoot = () => path.resolve(env.REPLAY_DIR || path.join(here, '../../data/replays'));
const dirFor = (websiteId, sessionId) => path.join(replayRoot(), String(websiteId), sessionId);
const LIVE_MS = 60_000;

/** rrweb event types: 2 = full snapshot, 4 = meta (href, viewport). */
const META = 4;

export async function saveChunk({ website, sessionId, visitorId, seq, events }) {
  const dir = dirFor(website._id, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const raw = Buffer.from(JSON.stringify(events));
  const gz = await gzip(raw);
  await fs.writeFile(path.join(dir, `${seq}.json.gz`), gz);

  const first = events[0].timestamp;
  const last = events[events.length - 1].timestamp;
  const metas = events.filter((e) => e.type === META && e.data?.href);
  const update = {
    $setOnInsert: { websiteId: website._id, sessionId, createdAt: new Date() },
    $set: { visitorId, updatedAt: new Date() },
    $min: { firstAt: new Date(first) },
    $max: { lastAt: new Date(last), lastSeq: seq },
    $inc: { chunks: 1, events: events.length, bytes: gz.length },
  };
  if (metas.length) {
    const pages = metas.map((m) => { try { const u = new URL(m.data.href); return u.pathname + u.search; } catch { return null; } }).filter(Boolean).slice(0, 20);
    if (pages.length) update.$addToSet = { pages: { $each: pages } };
    const vp = metas[metas.length - 1].data;
    if (vp.width && vp.height) update.$set.viewport = { w: vp.width, h: vp.height };
  }
  await col('replays').updateOne({ websiteId: website._id, sessionId }, update, { upsert: true });
}

function present(r, websites, session) {
  const w = websites.find((x) => x._id.equals(r.websiteId));
  return {
    websiteId: String(r.websiteId), website: w ? { name: w.name, code: w.code } : null, sessionId: r.sessionId, visitorId: r.visitorId,
    visitorLabel: `#${String(r.visitorId || '').replace(/^v_/, '').slice(0, 6).toUpperCase()}`,
    firstAt: r.firstAt, lastAt: r.lastAt, durationMs: Math.max(0, new Date(r.lastAt) - new Date(r.firstAt)),
    pages: r.pages || [], chunks: r.chunks, events: r.events, bytes: r.bytes, viewport: r.viewport || null,
    live: Date.now() - new Date(r.lastAt).getTime() < LIVE_MS,
    device: session?.device || null, geo: session?.geo || null,
    channel: session?.channel || null, channelLabel: session ? CHANNELS[session.channel] || session.channel : null, source: session?.source || null,
    entryPath: session?.entryPath || r.pages?.[0] || null, converted: Boolean(session?.converted),
  };
}

async function sessionsFor(rows) {
  if (!rows.length) return new Map();
  const ss = await col('sessions').find({ $or: rows.map((r) => ({ websiteId: r.websiteId, sessionId: r.sessionId })) })
    .project({ websiteId: 1, sessionId: 1, device: 1, geo: 1, channel: 1, source: 1, entryPath: 1, converted: 1 }).toArray();
  return new Map(ss.map((s) => [`${s.websiteId}:${s.sessionId}`, s]));
}

export async function listReplays({ websiteIds, websites, range }, { live, minSeconds, visitorId, page, limit, skip }) {
  // A recording belongs to the period when it overlaps it (an in-progress recording's lastAt is ~now).
  const filter = { websiteId: { $in: websiteIds }, firstAt: { $lte: range.to }, lastAt: { $gte: live ? new Date(Date.now() - LIVE_MS) : range.from } };
  if (visitorId) filter.visitorId = String(visitorId);
  if (minSeconds) filter.$expr = { $gte: [{ $subtract: ['$lastAt', '$firstAt'] }, Number(minSeconds) * 1000] };
  const [rows, total] = await Promise.all([
    col('replays').find(filter).sort({ lastAt: -1 }).skip(skip).limit(limit).toArray(),
    col('replays').countDocuments(filter),
  ]);
  const sess = await sessionsFor(rows);
  return { rows: rows.map((r) => present(r, websites, sess.get(`${r.websiteId}:${r.sessionId}`))), total, page, limit };
}

/** Which of these sessions have a recording (for "Watch recording" links). */
export async function replayIndex(websiteId, sessionIds) {
  if (!sessionIds.length) return new Set();
  const rows = await col('replays').find({ websiteId, sessionId: { $in: sessionIds } }).project({ sessionId: 1 }).toArray();
  return new Set(rows.map((r) => r.sessionId));
}

/** Recording metadata plus every chunk with seq > after (all chunks when after is -1). */
export async function getReplay(scope, websiteId, sessionId, { after = -1 } = {}) {
  const wid = oid(websiteId);
  if (!wid || !scope.allWebsiteIds.some((id) => id.equals(wid))) throw notFound('Recording not found');
  const r = await col('replays').findOne({ websiteId: wid, sessionId: String(sessionId) });
  if (!r) throw notFound('Recording not found');
  const dir = dirFor(wid, r.sessionId);
  let files = [];
  try { files = await fs.readdir(dir); } catch { /* chunks expired */ }
  const seqs = files.map((f) => parseInt(f, 10)).filter((n) => Number.isInteger(n) && n > after).sort((a, b) => a - b);
  const chunks = [];
  for (const seq of seqs) {
    try { chunks.push({ seq, events: JSON.parse((await gunzip(await fs.readFile(path.join(dir, `${seq}.json.gz`)))).toString('utf8')) }); } catch { /* skip unreadable chunk */ }
  }
  const sess = await sessionsFor([r]);
  return { replay: present(r, scope.allWebsites, sess.get(`${r.websiteId}:${r.sessionId}`)), chunks, lastSeq: seqs.length ? seqs[seqs.length - 1] : after };
}

export async function deleteReplay(scope, websiteId, sessionId) {
  const wid = oid(websiteId);
  if (!wid || !scope.allWebsiteIds.some((id) => id.equals(wid))) throw notFound('Recording not found');
  await fs.rm(dirFor(wid, String(sessionId)), { recursive: true, force: true });
  await col('replays').deleteOne({ websiteId: wid, sessionId: String(sessionId) });
}

/** Delete recordings older than each website's replayRetentionDays (files + index). */
export async function purgeExpiredReplays() {
  const websites = await col('websites').find({}).project({ settings: 1, deletedAt: 1 }).toArray();
  let removed = 0;
  for (const w of websites) {
    const days = w.deletedAt ? 0 : (w.settings?.replayRetentionDays || 30);
    const cutoff = new Date(Date.now() - days * 86400_000);
    const old = await col('replays').find({ websiteId: w._id, lastAt: { $lt: cutoff } }).project({ sessionId: 1 }).limit(2000).toArray();
    for (const r of old) {
      await fs.rm(dirFor(w._id, r.sessionId), { recursive: true, force: true }).catch(() => {});
      await col('replays').deleteOne({ _id: r._id });
      removed += 1;
    }
  }
  if (removed) logger.info({ removed }, 'Expired session recordings deleted');
  return removed;
}
