import { col } from '../config/db.js';
import { logger } from '../config/logger.js';
import { dayKey, startOfDayInTz, addDays, daysBetween, DEFAULT_TZ } from '../utils/dates.js';

/**
 * Daily rollups (raw → agg_daily, agg_daily_pages, agg_daily_dims) per website and day, in the
 * organisation's reporting timezone. Idempotent: every run replaces the day's documents, so it can be
 * re-run for "today" every minute and for any historical day as a backfill.
 */

export const SESSION_DIMS = {
  channel: '$channel',
  source: '$source',
  referrer: { $ifNull: ['$referrerHost', '(direct)'] },
  utm_source: '$utm.source',
  utm_medium: '$utm.medium',
  utm_campaign: '$utm.campaign',
  campaign: { $cond: [{ $ifNull: ['$utm.campaign', false] }, { $concat: [{ $ifNull: ['$utm.source', '(none)'] }, '|', { $ifNull: ['$utm.medium', '(none)'] }, '|', '$utm.campaign'] }, null] },
  country: '$geo.country',
  region: { $cond: [{ $ifNull: ['$geo.region', false] }, { $concat: [{ $ifNull: ['$geo.country', '??'] }, '|', '$geo.region'] }, null] },
  city: { $cond: [{ $ifNull: ['$geo.city', false] }, { $concat: [{ $ifNull: ['$geo.country', '??'] }, '|', '$geo.city'] }, null] },
  device: '$device.type',
  browser: '$device.browser',
  os: '$device.os',
  screen: '$device.screen',
  language: { $substrCP: [{ $ifNull: ['$lang', ''] }, 0, 2] },
  entry: '$entryPath',
};

export const sessionDimFacet = (expr) => [
  { $group: { _id: { value: expr, visitorId: '$visitorId' }, sessions: { $sum: 1 }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: { $cond: ['$bounced', 1, 0] } }, conversions: { $sum: { $cond: ['$converted', 1, 0] } }, durationMs: { $sum: '$durationMs' }, isNew: { $max: '$isNew' } } },
  { $group: { _id: '$_id.value', visitors: { $sum: 1 }, newVisitors: { $sum: { $cond: ['$isNew', 1, 0] } }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: '$bounces' }, conversions: { $sum: '$conversions' }, durationMs: { $sum: '$durationMs' } } },
  { $match: { _id: { $nin: [null, ''] } } },
  { $sort: { sessions: -1 } },
  { $limit: 2000 },
];

export async function rollupDay(website, day, tz = DEFAULT_TZ) {
  const wid = website._id;
  const from = startOfDayInTz(day, tz);
  const to = startOfDayInTz(addDays(day, 1), tz);
  const range = { $gte: from, $lt: to };
  const stamp = new Date();

  const [sessionFacets] = await col('sessions').aggregate([
    { $match: { websiteId: wid, startedAt: range } },
    {
      $facet: {
        totals: [
          { $group: { _id: '$visitorId', sessions: { $sum: 1 }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: { $cond: ['$bounced', 1, 0] } }, durationMs: { $sum: '$durationMs' }, activeMs: { $sum: '$activeMs' }, converted: { $sum: { $cond: ['$converted', 1, 0] } }, isNew: { $max: '$isNew' } } },
          { $group: { _id: null, visitors: { $sum: 1 }, newVisitors: { $sum: { $cond: ['$isNew', 1, 0] } }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: '$bounces' }, durationMs: { $sum: '$durationMs' }, activeMs: { $sum: '$activeMs' }, convertedSessions: { $sum: '$converted' } } },
        ],
        ...Object.fromEntries(Object.entries(SESSION_DIMS).map(([k, expr]) => [k, sessionDimFacet(expr)])),
        entries: [{ $group: { _id: '$entryPath', n: { $sum: 1 } } }],
        exits: [{ $group: { _id: '$exitPath', n: { $sum: 1 } } }],
      },
    },
  ], { allowDiskUse: true }).toArray();

  const [eventFacets] = await col('events').aggregate([
    { $match: { websiteId: wid, ts: range } },
    { $facet: {
      byName: [{ $group: { _id: { n: '$name', v: '$visitorId' }, c: { $sum: 1 } } }, { $group: { _id: '$_id.n', count: { $sum: '$c' }, visitors: { $sum: 1 } } }],
    } },
  ], { allowDiskUse: true }).toArray();

  const pages = await col('pageViews').aggregate([
    { $match: { websiteId: wid, ts: range } },
    { $group: { _id: { p: '$path', v: '$visitorId' }, pv: { $sum: 1 }, engagedMs: { $sum: '$engagedMs' }, scroll: { $sum: '$maxScroll' }, title: { $last: '$title' } } },
    { $group: { _id: '$_id.p', pageviews: { $sum: '$pv' }, visitors: { $sum: 1 }, engagedMs: { $sum: '$engagedMs' }, scrollSum: { $sum: '$scroll' }, title: { $last: '$title' } } },
    { $sort: { pageviews: -1 } },
    { $limit: 5000 },
  ], { allowDiskUse: true }).toArray();

  const [leads, conv] = await Promise.all([
    col('leads').countDocuments({ websiteId: wid, ts: range }),
    col('conversions').aggregate([{ $match: { websiteId: wid, ts: range } }, { $group: { _id: null, n: { $sum: 1 }, value: { $sum: '$value' } } }]).toArray(),
  ]);

  const t = sessionFacets.totals[0] || {};
  const ev = Object.fromEntries((eventFacets.byName || []).map((r) => [r._id, r]));
  const evCount = (n) => ev[n]?.count || 0;
  const base = { websiteId: wid, day, updatedAt: stamp };

  await col('aggDaily').replaceOne({ websiteId: wid, day }, {
    ...base,
    visitors: t.visitors || 0, newVisitors: t.newVisitors || 0, sessions: t.sessions || 0,
    pageviews: t.pageviews || 0, bounces: t.bounces || 0, durationMs: t.durationMs || 0, activeMs: t.activeMs || 0,
    convertedSessions: t.convertedSessions || 0,
    events: Object.values(ev).reduce((s, r) => s + r.count, 0),
    searches: evCount('search'), formSubmits: evCount('form_submit'), errors: evCount('js_error'), outbound: evCount('outbound_click'), downloads: evCount('file_download'),
    leads, conversions: conv[0]?.n || 0, conversionValue: conv[0]?.value || 0,
  }, { upsert: true });

  const entries = Object.fromEntries(sessionFacets.entries.map((r) => [r._id, r.n]));
  const exits = Object.fromEntries(sessionFacets.exits.map((r) => [r._id, r.n]));
  if (pages.length) {
    await col('aggDailyPages').bulkWrite(pages.map((p) => ({
      replaceOne: { filter: { websiteId: wid, day, path: p._id }, replacement: { ...base, path: p._id, title: p.title || null, pageviews: p.pageviews, visitors: p.visitors, engagedMs: p.engagedMs, scrollSum: p.scrollSum, entries: entries[p._id] || 0, exits: exits[p._id] || 0 }, upsert: true },
    })), { ordered: false });
  }
  await col('aggDailyPages').deleteMany({ websiteId: wid, day, updatedAt: { $lt: stamp } });

  const dimDocs = [];
  for (const dim of Object.keys(SESSION_DIMS)) {
    for (const r of sessionFacets[dim] || []) {
      dimDocs.push({ ...base, dim, value: String(r._id).slice(0, 300), visitors: r.visitors, newVisitors: r.newVisitors, sessions: r.sessions, pageviews: r.pageviews, bounces: r.bounces, conversions: r.conversions, durationMs: r.durationMs, count: r.sessions });
    }
  }
  for (const r of eventFacets.byName || []) dimDocs.push({ ...base, dim: 'event', value: r._id, visitors: r.visitors, count: r.count, sessions: 0, pageviews: 0, bounces: 0, conversions: 0, durationMs: 0 });
  if (dimDocs.length) {
    await col('aggDailyDims').bulkWrite(dimDocs.map((d) => ({ replaceOne: { filter: { websiteId: wid, day, dim: d.dim, value: d.value }, replacement: d, upsert: true } })), { ordered: false });
  }
  await col('aggDailyDims').deleteMany({ websiteId: wid, day, updatedAt: { $lt: stamp } });
}

/** Roll up today (and yesterday, to settle late events) for every website active in the last 2 days. */
export async function rollupRecent() {
  const since = new Date(Date.now() - 2 * 86400_000);
  const websites = await col('websites').find({ deletedAt: null, lastEventAt: { $gte: since } }).toArray();
  const orgTz = new Map();
  let n = 0;
  for (const w of websites) {
    const k = String(w.orgId);
    if (!orgTz.has(k)) orgTz.set(k, (await col('organizations').findOne({ _id: w.orgId }, { projection: { settings: 1 } }))?.settings?.timezone || DEFAULT_TZ);
    const tz = orgTz.get(k);
    const today = dayKey(new Date(), tz);
    try {
      await rollupDay(w, today, tz);
      // Yesterday is re-settled during the first hours of the day only.
      if (Date.now() - startOfDayInTz(today, tz).getTime() < 6 * 3600_000) await rollupDay(w, addDays(today, -1), tz);
      n += 1;
    } catch (err) {
      logger.error({ err: err.message, siteId: w.siteId }, 'Rollup failed');
    }
  }
  return n;
}

/** Backfill a date range for one website (used by scripts and after imports). */
export async function rollupRange(website, fromDay, toDay, tz = DEFAULT_TZ) {
  for (const d of daysBetween(fromDay, toDay)) await rollupDay(website, d, tz);
}
