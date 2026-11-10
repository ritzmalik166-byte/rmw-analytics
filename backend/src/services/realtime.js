import { EventEmitter } from 'node:events';
import { getRedis, getRedisSubscriber } from '../config/redis.js';
import { logger } from '../config/logger.js';

/**
 * Realtime presence + live activity feed.
 * - Redis mode (REDIS_URL): presence in a hash + sorted set per website, feed in a capped list,
 *   fan-out over pub/sub so every API instance's SSE clients receive every event.
 * - Memory mode: same semantics inside one process (development / single instance).
 */
export const ACTIVE_WINDOW_MS = 5 * 60_000;
const FEED_SIZE = 200;
const bus = new EventEmitter();
bus.setMaxListeners(0);

const mem = { presence: new Map(), feed: new Map() };
let redisSubscribed = false;

async function ensureRedisSubscription() {
  if (redisSubscribed) return;
  const sub = await getRedisSubscriber();
  if (!sub) return;
  redisSubscribed = true;
  await sub.psubscribe('rt:c:*');
  sub.on('pmessage', (_p, channel, message) => {
    try { bus.emit(channel.slice(5), JSON.parse(message)); } catch (err) { logger.warn({ err: err.message }, 'Bad realtime message'); }
  });
}

/** Record that a visitor is active and what they are doing right now. */
export async function touchPresence(websiteId, visitorId, info) {
  const wid = String(websiteId);
  const now = Date.now();
  const entry = { ...info, visitorId, websiteId: wid, lastSeen: now };
  const r = await getRedis();
  if (r) {
    await r.multi()
      .hset(`rt:p:${wid}`, visitorId, JSON.stringify(entry))
      .zadd(`rt:a:${wid}`, now, visitorId)
      .expire(`rt:p:${wid}`, 3600)
      .expire(`rt:a:${wid}`, 3600)
      .exec();
    return;
  }
  let m = mem.presence.get(wid);
  if (!m) mem.presence.set(wid, (m = new Map()));
  m.set(visitorId, entry);
}

/** Append to the live feed and fan out to subscribers. */
export async function publish(websiteId, item) {
  const wid = String(websiteId);
  const payload = { ...item, websiteId: wid };
  const r = await getRedis();
  if (r) {
    await ensureRedisSubscription();
    const s = JSON.stringify(payload);
    await r.multi().lpush(`rt:f:${wid}`, s).ltrim(`rt:f:${wid}`, 0, FEED_SIZE - 1).expire(`rt:f:${wid}`, 86400).publish(`rt:c:${wid}`, s).exec();
    return;
  }
  let f = mem.feed.get(wid);
  if (!f) mem.feed.set(wid, (f = []));
  f.unshift(payload);
  if (f.length > FEED_SIZE) f.length = FEED_SIZE;
  bus.emit(wid, payload);
}

/** Active visitors (last 5 minutes) across websites, most recent first. */
export async function activeVisitors(websiteIds) {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const r = await getRedis();
  const out = [];
  for (const id of websiteIds.map(String)) {
    if (r) {
      await r.zremrangebyscore(`rt:a:${id}`, 0, cutoff);
      const ids = await r.zrevrangebyscore(`rt:a:${id}`, '+inf', cutoff, 'LIMIT', 0, 1000);
      if (ids.length) {
        const vals = await r.hmget(`rt:p:${id}`, ...ids);
        vals.forEach((v) => { if (v) out.push(JSON.parse(v)); });
      }
    } else {
      const m = mem.presence.get(id);
      if (!m) continue;
      for (const [vid, v] of m) {
        if (v.lastSeen < cutoff) m.delete(vid);
        else out.push(v);
      }
    }
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen);
}

export async function recentFeed(websiteIds, limit = 50) {
  const r = await getRedis();
  let items = [];
  for (const id of websiteIds.map(String)) {
    if (r) items = items.concat((await r.lrange(`rt:f:${id}`, 0, limit - 1)).map((s) => JSON.parse(s)));
    else items = items.concat((mem.feed.get(id) || []).slice(0, limit));
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** Subscribe to live items for a set of websites. Returns an unsubscribe function. */
export async function subscribe(websiteIds, listener) {
  await ensureRedisSubscription();
  const ids = websiteIds.map(String);
  ids.forEach((id) => bus.on(id, listener));
  return () => ids.forEach((id) => bus.off(id, listener));
}

/** Test helper. */
export function _resetMemory() {
  mem.presence.clear();
  mem.feed.clear();
}
