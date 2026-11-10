import { env } from './env.js';
import { logger } from './logger.js';

let redis = null;
let sub = null;
let loaded = false;

/** Shared Redis client, or null when REDIS_URL is not configured (single-instance mode). */
export async function getRedis() {
  if (loaded) return redis;
  loaded = true;
  if (!env.REDIS_URL) return null;
  const { default: Redis } = await import('ioredis');
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableAutoPipelining: true, lazyConnect: false });
  redis.on('error', (err) => logger.warn({ err: err.message }, 'Redis error'));
  return redis;
}

/** Dedicated subscriber connection (a subscribed client cannot run other commands). */
export async function getRedisSubscriber() {
  const r = await getRedis();
  if (!r) return null;
  if (!sub) {
    sub = r.duplicate();
    sub.on('error', (err) => logger.warn({ err: err.message }, 'Redis subscriber error'));
  }
  return sub;
}

export async function closeRedis() {
  await Promise.allSettled([redis?.quit(), sub?.quit()]);
  redis = null;
  sub = null;
  loaded = false;
}
