import { col } from '../config/db.js';
import { logger } from '../config/logger.js';
import { globToRegex } from '../utils/http.js';
import { dayKey, DEFAULT_TZ } from '../utils/dates.js';
import { rollupDay } from './rollupService.js';

/** How far back a new conversion goal is applied to existing data. */
export const BACKFILL_DAYS = 90;
const MAX_BACKFILL = 200_000;

/**
 * Apply a newly created goal to past data, so marking "whatsapp_click" as a conversion shows last month's
 * WhatsApp clicks as conversions instead of starting from zero. Inserts conversion records for matching
 * events / page views of the last BACKFILL_DAYS (skipping ones already recorded for this goal), marks those
 * sessions as converted, then re-runs the daily rollups of the affected days in the background.
 * Returns the number of conversions added.
 */
export async function backfillGoal(goal, website) {
  const since = new Date(Date.now() - BACKFILL_DAYS * 86_400_000);
  const wid = goal.websiteId;
  const source = goal.type === 'event'
    ? col('events').find({ websiteId: wid, name: goal.match.toLowerCase(), ts: { $gte: since } }, { projection: { eventId: 1, ts: 1, visitorId: 1, sessionId: 1, 'page.path': 1, expireAt: 1 }, limit: MAX_BACKFILL })
    : col('pageViews').find({ websiteId: wid, ts: { $gte: since }, path: { $regex: globToRegex(goal.match) } }, { projection: { pageviewId: 1, ts: 1, visitorId: 1, sessionId: 1, path: 1, expireAt: 1 }, limit: MAX_BACKFILL });
  const rows = await source.toArray();
  if (!rows.length) return 0;

  const existing = new Set(await col('conversions').distinct('eventId', { websiteId: wid, goal: goal.name, ts: { $gte: since } }));
  const docs = rows
    .map((r) => ({ websiteId: wid, ts: r.ts, visitorId: r.visitorId, sessionId: r.sessionId, goal: goal.name, value: Number(goal.value) || 0, currency: goal.currency || null, path: r.page?.path || r.path, eventId: r.eventId || r.pageviewId, expireAt: r.expireAt, backfilled: true }))
    .filter((d) => !existing.has(d.eventId));
  if (!docs.length) return 0;
  await col('conversions').insertMany(docs, { ordered: false });
  const sessionIds = [...new Set(docs.map((d) => d.sessionId))];
  await col('sessions').updateMany({ websiteId: wid, sessionId: { $in: sessionIds } }, [{ $set: { converted: true, bounced: false } }]);

  // Rollups (daily totals) are refreshed for every affected day without blocking the request.
  const org = await col('organizations').findOne({ _id: website.orgId }, { projection: { settings: 1 } });
  const tz = org?.settings?.timezone || DEFAULT_TZ;
  const days = [...new Set(docs.map((d) => dayKey(d.ts, tz)))].sort();
  (async () => {
    for (const d of days) await rollupDay(website, d, tz);
  })().catch((err) => logger.error({ err: err.message, goal: goal.name }, 'Goal backfill rollup failed'));
  return docs.length;
}
