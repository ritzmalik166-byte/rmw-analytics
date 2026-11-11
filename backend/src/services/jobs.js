import os from 'node:os';
import { col } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { rollupRecent } from './rollupService.js';
import { evaluateAlerts } from './alertService.js';
import { runScheduledReports } from './reportService.js';
import { purgeExpiredReplays } from './replayService.js';
import { DAY_MS } from '../utils/dates.js';

const OWNER = `${os.hostname()}:${process.pid}`;

/** Lease-based leader lock so each job runs on one instance at a time across a cluster. */
export async function withLock(name, ttlMs, fn) {
  const now = new Date();
  try {
    await col('jobLocks').updateOne(
      { _id: name, $or: [{ until: { $lt: now } }, { owner: OWNER }] },
      { $set: { owner: OWNER, until: new Date(now.getTime() + ttlMs), startedAt: now } },
      { upsert: true },
    );
  } catch (err) {
    if (err.code === 11000) return { skipped: true }; // another instance holds the lease
    throw err;
  }
  try {
    return { result: await fn() };
  } finally {
    await col('jobLocks').updateOne({ _id: name, owner: OWNER }, { $set: { until: new Date(), finishedAt: new Date() } }).catch(() => {});
  }
}

/**
 * When a website's retention period changes, recompute expireAt on its existing documents
 * (TTL then removes anything now past retention).
 */
export async function applyRetentionChanges() {
  const websites = await col('websites').find({ deletedAt: null, $expr: { $ne: ['$settings.retentionDays', '$retentionAppliedDays'] } }).toArray();
  for (const w of websites) {
    const ms = (w.settings?.retentionDays || 395) * DAY_MS;
    const plan = [['events', 'ts'], ['pageViews', 'ts'], ['searches', 'ts'], ['conversions', 'ts'], ['heatmapPoints', 'ts'], ['formSubmissions', 'ts'], ['sessions', 'lastSeenAt'], ['visitors', 'lastSeen']];
    for (const [name, field] of plan) {
      await col(name).updateMany({ websiteId: w._id }, [{ $set: { expireAt: { $add: [`$${field}`, ms] } } }]);
    }
    await col('websites').updateOne({ _id: w._id }, { $set: { retentionAppliedDays: w.settings?.retentionDays || 395 } });
    logger.info({ siteId: w.siteId, days: w.settings?.retentionDays }, 'Retention re-applied');
  }
  return websites.length;
}

const JOBS = [
  { name: 'rollups', everyMs: () => env.ROLLUP_INTERVAL_SECONDS * 1000, ttlMs: 10 * 60_000, run: rollupRecent },
  { name: 'alerts', everyMs: () => 60_000, ttlMs: 5 * 60_000, run: evaluateAlerts },
  { name: 'reports', everyMs: () => 15 * 60_000, ttlMs: 30 * 60_000, run: () => runScheduledReports() },
  { name: 'retention', everyMs: () => 30 * 60_000, ttlMs: 60 * 60_000, run: applyRetentionChanges },
  { name: 'replay-retention', everyMs: () => 60 * 60_000, ttlMs: 60 * 60_000, run: purgeExpiredReplays },
];

/** Start the job loops. Returns a stop function. */
export function startJobs() {
  const timers = [];
  const running = new Set();
  for (const job of JOBS) {
    const tick = async () => {
      if (running.has(job.name)) return;
      running.add(job.name);
      const t = Date.now();
      try {
        const r = await withLock(job.name, job.ttlMs, job.run);
        if (!r.skipped) logger.debug({ job: job.name, ms: Date.now() - t, result: r.result }, 'Job finished');
      } catch (err) {
        logger.error({ err: err.message, job: job.name }, 'Job failed');
      } finally {
        running.delete(job.name);
      }
    };
    timers.push(setTimeout(tick, 5_000), setInterval(tick, job.everyMs()));
  }
  logger.info(`Background jobs started (${JOBS.map((j) => j.name).join(', ')})`);
  return () => timers.forEach((t) => clearInterval(t));
}
