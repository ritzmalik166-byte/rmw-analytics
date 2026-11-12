import { CHANNELS, EVENT_LABELS } from '@rmw-analytics/shared';
import { col } from '../config/db.js';
import { escapeRegex } from '../utils/http.js';
import { DAY_MS, daysBetween, dayKey, startOfHourInTz } from '../utils/dates.js';
import { activeVisitors, recentFeed, ACTIVE_WINDOW_MS } from './realtime.js';
import { hasFilters, matchingSessionIds, sessionClause } from './filters.js';
import { SESSION_DIMS, sessionDimFacet } from './rollupService.js';

const EXACT_OVERVIEW_MAX_DAYS = 92;
/** Tap-to-contact links (tel:, mailto:, WhatsApp) recorded by the tracker as their own events. */
export const CONTACT_EVENTS = ['phone_click', 'email_click', 'whatsapp_click', 'contact_click'];
/** Every kind of click the tracker records. "Clicks" = unique people who clicked at least once (1 person = 1 click). */
export const CLICK_EVENTS = ['click', 'rage_click', 'dead_click', 'outbound_click', 'file_download', ...CONTACT_EVENTS];

/** Session match for a period, narrowed to the active filters (see services/filters.js). */
async function sessionsIn(scope, from, to) {
  const m = { websiteId: { $in: scope.websiteIds }, startedAt: { $gte: from, $lte: to } };
  const ids = await matchingSessionIds(scope, from, to);
  if (ids) m.sessionId = { $in: ids };
  return m;
}

/** Same scope, different period (used for "previous period" comparisons). */
export function withRange(scope, from, to) {
  return { ...scope, range: { ...scope.range, from, to, fromDay: dayKey(from, scope.range.tz), toDay: dayKey(to, scope.range.tz) } };
}
export const previousScope = (scope) => withRange(scope, scope.range.prevFrom, scope.range.prevTo);

/** Unique clickers per bucket. `bucket` is a Mongo expression on $ts, or null for a single total. */
function uniqueClickers(websiteIds, from, to, bucket = null, extra = {}) {
  return col('events').aggregate([
    { $match: { websiteId: { $in: websiteIds }, name: { $in: CLICK_EVENTS }, ts: { $gte: from, $lte: to }, ...extra } },
    { $group: { _id: { t: bucket, w: '$websiteId', v: '$visitorId' } } },
    { $group: { _id: '$_id.t', n: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();
}
const ratio = (a, b) => (b ? a / b : 0);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Google Analytics-style "engaged" session: 10s+ active, or 2+ page views, or a conversion
 * (i.e. not bounced; see ingestService). GA reports people from engaged sessions, so a quick
 * open-and-leave doesn't inflate the visitor count. 1 for engaged, else 0.
 */
const ENGAGED = { $cond: [{ $eq: ['$bounced', false] }, 1, 0] };

// ─── Overview ──────────────────────────────────────────────────────────────
async function sessionTotals(match) {
  const [t] = await col('sessions').aggregate([
    { $match: match },
    { $group: { _id: { w: '$websiteId', v: '$visitorId' }, s: { $sum: 1 }, pv: { $sum: '$pageviews' }, b: { $sum: { $cond: ['$bounced', 1, 0] } }, d: { $sum: '$durationMs' }, a: { $sum: '$activeMs' }, isNew: { $max: '$isNew' }, returned: { $max: { $cond: ['$isNew', 0, 1] } }, engaged: { $max: ENGAGED } } },
    { $group: { _id: null, visitors: { $sum: 1 }, engagedVisitors: { $sum: '$engaged' }, newVisitors: { $sum: { $cond: ['$isNew', 1, 0] } }, returningVisitors: { $sum: '$returned' }, sessions: { $sum: '$s' }, pageviews: { $sum: '$pv' }, bounces: { $sum: '$b' }, durationMs: { $sum: '$d' }, activeMs: { $sum: '$a' } } },
  ], { allowDiskUse: true }).toArray();
  return t || { visitors: 0, newVisitors: 0, sessions: 0, pageviews: 0, bounces: 0, durationMs: 0, activeMs: 0 };
}

async function rollupTotals(websiteIds, fromDay, toDay) {
  const [t] = await col('aggDaily').aggregate([
    { $match: { websiteId: { $in: websiteIds }, day: { $gte: fromDay, $lte: toDay } } },
    { $group: { _id: null, visitors: { $sum: '$visitors' }, newVisitors: { $sum: '$newVisitors' }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: '$bounces' }, durationMs: { $sum: '$durationMs' }, activeMs: { $sum: '$activeMs' } } },
  ]).toArray();
  if (!t) return { visitors: 0, engagedVisitors: 0, newVisitors: 0, sessions: 0, pageviews: 0, bounces: 0, durationMs: 0, activeMs: 0 };
  // Rollups have no per-visitor engagement; approximate with the engaged-session share (ranges > 92 days only).
  return { ...t, engagedVisitors: Math.round(t.visitors * (1 - ratio(t.bounces, t.sessions))) };
}

async function periodMetrics(scope, from, to, { exact, fromDay, toDay }) {
  const { websiteIds } = scope;
  const range = { $gte: from, $lte: to };
  const extra = await sessionClause(scope, from, to);
  const [s, leads, conv, searches, clickers, convSessions] = await Promise.all([
    exact || hasFilters(scope.filters) ? sessionTotals(await sessionsIn(scope, from, to)) : rollupTotals(websiteIds, fromDay, toDay),
    col('leads').countDocuments({ websiteId: { $in: websiteIds }, ts: range, ...extra }),
    col('conversions').aggregate([{ $match: { websiteId: { $in: websiteIds }, ts: range, ...extra } }, { $group: { _id: null, n: { $sum: 1 }, value: { $sum: '$value' } } }]).toArray(),
    col('searches').countDocuments({ websiteId: { $in: websiteIds }, ts: range, ...extra }),
    uniqueClickers(websiteIds, from, to, null, extra),
    // Sessions with at least one conversion: the basis of the conversion rate (GA4 "session key event rate").
    col('conversions').aggregate([{ $match: { websiteId: { $in: websiteIds }, ts: range, ...extra } }, { $group: { _id: { w: '$websiteId', s: '$sessionId' } } }, { $count: 'n' }]).toArray(),
  ]);
  return {
    // "Visitors" matches Google Analytics: people with at least one engaged session. allVisitors = every visitor.
    visitors: s.engagedVisitors ?? 0,
    allVisitors: s.visitors,
    newVisitors: s.newVisitors,
    // Visitors with at least one returning session in the period (may overlap with new visitors, like GA).
    returningVisitors: s.returningVisitors ?? Math.max(0, s.visitors - s.newVisitors),
    sessions: s.sessions,
    pageviews: s.pageviews,
    pagesPerSession: round(ratio(s.pageviews, s.sessions), 2),
    bounceRate: round(ratio(s.bounces, s.sessions) * 100),
    engagementRate: s.sessions ? round(100 - ratio(s.bounces, s.sessions) * 100) : 0,
    avgSessionMs: Math.round(ratio(s.durationMs, s.sessions)),
    // Average *active* time per visitor (tab visible + interacting), like GA4's "average engagement time".
    avgEngagementMs: Math.round(ratio(s.activeMs || 0, s.visitors)),
    engagedSessions: Math.max(0, s.sessions - s.bounces),
    conversions: conv[0]?.n || 0,
    conversionValue: conv[0]?.value || 0,
    convertedSessions: convSessions[0]?.n || 0,
    // Share of sessions with at least one conversion (a session with 3 conversions counts once).
    conversionRate: round(ratio(convSessions[0]?.n || 0, s.sessions) * 100, 2),
    leads,
    searches,
    clicks: clickers[0]?.n || 0,
  };
}

export async function overview(scope) {
  const { range } = scope;
  const days = daysBetween(range.fromDay, range.toDay).length;
  const exact = days <= EXACT_OVERVIEW_MAX_DAYS || hasFilters(scope.filters);
  const span = range.to - range.from;
  const prevDays = { fromDay: dayKey(range.prevFrom, range.tz), toDay: dayKey(range.prevTo, range.tz) };
  const [current, previous] = await Promise.all([
    periodMetrics(scope, range.from, range.to, { exact, fromDay: range.fromDay, toDay: range.toDay }),
    periodMetrics(scope, range.prevFrom, range.prevTo, { exact: exact || span <= EXACT_OVERVIEW_MAX_DAYS * DAY_MS, ...prevDays }),
  ]);
  return { current, previous, approximateVisitors: !exact, previousRange: prevDays };
}

// ─── Time series ───────────────────────────────────────────────────────────
export async function timeseries(scope) {
  const { websiteIds, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  if (range.interval === 'hour') {
    const unit = { $dateTrunc: { date: '$startedAt', unit: 'hour', timezone: range.tz } };
    const [sess, pvs, leads, conv, clickers] = await Promise.all([
      col('sessions').aggregate([
        { $match: { websiteId: { $in: websiteIds }, startedAt: { $gte: range.from, $lte: range.to }, ...extra } },
        { $group: { _id: { t: unit, v: '$visitorId', w: '$websiteId' }, s: { $sum: 1 }, e: { $max: ENGAGED } } },
        { $group: { _id: '$_id.t', visitors: { $sum: '$e' }, sessions: { $sum: '$s' } } },
      ]).toArray(),
      col('pageViews').aggregate([
        { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
        { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'hour', timezone: range.tz } }, n: { $sum: 1 } } },
      ]).toArray(),
      col('leads').aggregate([
        { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
        { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'hour', timezone: range.tz } }, n: { $sum: 1 } } },
      ]).toArray(),
      col('conversions').aggregate([
        { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
        { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'hour', timezone: range.tz } }, n: { $sum: 1 } } },
      ]).toArray(),
      uniqueClickers(websiteIds, range.from, range.to, { $dateTrunc: { date: '$ts', unit: 'hour', timezone: range.tz } }, extra),
    ]);
    // Buckets must start on local (tz) hours, exactly like $dateTrunc above. Using UTC hours here made every
    // lookup miss in IST (+5:30), so the 24h chart showed a flat zero line even though totals had data.
    const map = new Map();
    const start = startOfHourInTz(range.from.getTime(), range.tz);
    for (let t = start; t <= range.to.getTime(); t += 3600_000) map.set(t, { t: new Date(t).toISOString(), visitors: 0, sessions: 0, pageviews: 0, leads: 0, conversions: 0, clicks: 0 });
    const at = (d) => map.get(new Date(d).getTime());
    sess.forEach((r) => { const p = at(r._id); if (p) { p.visitors = r.visitors; p.sessions = r.sessions; } });
    pvs.forEach((r) => { const p = at(r._id); if (p) p.pageviews = r.n; });
    leads.forEach((r) => { const p = at(r._id); if (p) p.leads = r.n; });
    conv.forEach((r) => { const p = at(r._id); if (p) p.conversions = r.n; });
    clickers.forEach((r) => { const p = at(r._id); if (p) p.clicks = r.n; });
    return { interval: 'hour', points: [...map.values()] };
  }
  const dayKeyExpr = { $dateToString: { date: '$startedAt', format: '%Y-%m-%d', timezone: range.tz } };
  const dayEngaged = await col('sessions').aggregate([
    { $match: { websiteId: { $in: websiteIds }, startedAt: { $gte: range.from, $lte: range.to }, ...extra } },
    { $group: { _id: { t: dayKeyExpr, v: '$visitorId', w: '$websiteId' }, e: { $max: ENGAGED } } },
    { $group: { _id: '$_id.t', n: { $sum: '$e' } } },
  ], { allowDiskUse: true }).toArray();
  const engagedByDay = Object.fromEntries(dayEngaged.map((r) => [r._id, r.n]));
  const dayClicks = await uniqueClickers(websiteIds, range.from, range.to, { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, extra);
  const clicksByDay = Object.fromEntries(dayClicks.map((r) => [r._id, r.n]));
  if (hasFilters(scope.filters)) return { interval: 'day', points: await filteredDays(scope, extra, engagedByDay, clicksByDay) };
  const rows = await col('aggDaily').aggregate([
    { $match: { websiteId: { $in: websiteIds }, day: { $gte: range.fromDay, $lte: range.toDay } } },
    { $group: { _id: '$day', visitors: { $sum: '$visitors' }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, leads: { $sum: '$leads' }, conversions: { $sum: '$conversions' }, bounces: { $sum: '$bounces' }, searches: { $sum: '$searches' } } },
  ]).toArray();
  const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
  const points = daysBetween(range.fromDay, range.toDay).map((d) => {
    const r = byDay[d] || {};
    return { t: d, visitors: engagedByDay[d] ?? Math.round((r.visitors || 0) * (1 - ratio(r.bounces || 0, r.sessions || 0))), sessions: r.sessions || 0, pageviews: r.pageviews || 0, leads: r.leads || 0, conversions: r.conversions || 0, clicks: clicksByDay[d] || 0, searches: r.searches || 0, bounceRate: r.sessions ? round((r.bounces / r.sessions) * 100) : 0 };
  });
  return { interval: 'day', points };
}

/** Daily points computed from raw sessions (rollups are not segmented, so filtered charts can't use them). */
async function filteredDays({ websiteIds, range }, extra, engagedByDay, clicksByDay) {
  const day = (field) => ({ $dateToString: { date: field, format: '%Y-%m-%d', timezone: range.tz } });
  const byDay = (collection, field = '$ts') => col(collection).aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
    { $group: { _id: day(field), n: { $sum: 1 } } },
  ]).toArray().then((rows) => Object.fromEntries(rows.map((r) => [r._id, r.n])));
  const [sess, leads, conv, searches] = await Promise.all([
    col('sessions').aggregate([
      { $match: { websiteId: { $in: websiteIds }, startedAt: { $gte: range.from, $lte: range.to }, ...extra } },
      { $group: { _id: day('$startedAt'), sessions: { $sum: 1 }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: { $cond: ['$bounced', 1, 0] } } } },
    ], { allowDiskUse: true }).toArray().then((rows) => Object.fromEntries(rows.map((r) => [r._id, r]))),
    byDay('leads'), byDay('conversions'), byDay('searches'),
  ]);
  return daysBetween(range.fromDay, range.toDay).map((d) => {
    const s = sess[d] || {};
    return { t: d, visitors: engagedByDay[d] || 0, sessions: s.sessions || 0, pageviews: s.pageviews || 0, leads: leads[d] || 0, conversions: conv[d] || 0, clicks: clicksByDay[d] || 0, searches: searches[d] || 0, bounceRate: s.sessions ? round((s.bounces / s.sessions) * 100) : 0 };
  });
}

// ─── Pages ─────────────────────────────────────────────────────────────────
export async function pages(scope, { q, limit = 100, sort = 'pageviews', order = 'desc' } = {}) {
  const { websiteIds, range } = scope;
  const sortKey = ['pageviews', 'visitors', 'entries', 'exits', 'avgTimeMs'].includes(sort) ? sort : 'pageviews';
  const dir = order === 'asc' ? 1 : -1;
  const cap = Math.min(500, limit);
  const rows = hasFilters(scope.filters)
    ? await filteredPages(scope, { q, sortKey, dir, cap })
    : await col('aggDailyPages').aggregate([
      { $match: { websiteId: { $in: websiteIds }, day: { $gte: range.fromDay, $lte: range.toDay }, ...(q ? { path: { $regex: escapeRegex(q), $options: 'i' } } : {}) } },
      { $group: { _id: '$path', title: { $last: '$title' }, pageviews: { $sum: '$pageviews' }, visitors: { $sum: '$visitors' }, entries: { $sum: '$entries' }, exits: { $sum: '$exits' }, engagedMs: { $sum: '$engagedMs' }, scrollSum: { $sum: '$scrollSum' } } },
      { $addFields: { avgTimeMs: { $cond: [{ $gt: ['$pageviews', 0] }, { $divide: ['$engagedMs', '$pageviews'] }, 0] } } },
      // Ascending ("least visited") skips pages nobody entered/exited from when sorting by those columns.
      ...(dir === 1 && sortKey !== 'pageviews' && sortKey !== 'visitors' ? [{ $match: { [sortKey]: { $gt: 0 } } }] : []),
      { $sort: { [sortKey]: dir, _id: 1 } },
      { $limit: cap },
    ]).toArray();
  return rows.map((r) => ({
    path: r._id, title: r.title, pageviews: r.pageviews, visitors: r.visitors, entries: r.entries, exits: r.exits,
    exitRate: round(ratio(r.exits, r.pageviews) * 100), avgTimeMs: Math.round(r.avgTimeMs), avgScroll: Math.round(ratio(r.scrollSum, r.pageviews)),
  }));
}

/** Page table from raw page views of the filtered sessions. */
async function filteredPages(scope, { q, sortKey, dir, cap }) {
  const { websiteIds, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const [views, entryExit] = await Promise.all([
    col('pageViews').aggregate([
      { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra, ...(q ? { path: { $regex: escapeRegex(q), $options: 'i' } } : {}) } },
      { $group: { _id: { p: '$path', v: '$visitorId' }, pv: { $sum: 1 }, engagedMs: { $sum: '$engagedMs' }, scroll: { $sum: '$maxScroll' }, title: { $last: '$title' } } },
      { $group: { _id: '$_id.p', pageviews: { $sum: '$pv' }, visitors: { $sum: 1 }, engagedMs: { $sum: '$engagedMs' }, scrollSum: { $sum: '$scroll' }, title: { $last: '$title' } } },
    ], { allowDiskUse: true }).toArray(),
    col('sessions').aggregate([
      { $match: await sessionsIn(scope, range.from, range.to) },
      { $facet: { entries: [{ $group: { _id: '$entryPath', n: { $sum: 1 } } }], exits: [{ $group: { _id: '$exitPath', n: { $sum: 1 } } }] } },
    ]).toArray(),
  ]);
  const entries = Object.fromEntries((entryExit[0]?.entries || []).map((r) => [r._id, r.n]));
  const exits = Object.fromEntries((entryExit[0]?.exits || []).map((r) => [r._id, r.n]));
  return views
    .map((r) => ({ ...r, entries: entries[r._id] || 0, exits: exits[r._id] || 0, avgTimeMs: ratio(r.engagedMs, r.pageviews) }))
    .filter((r) => dir === -1 || sortKey === 'pageviews' || sortKey === 'visitors' || r[sortKey] > 0)
    .sort((a, b) => dir * (a[sortKey] - b[sortKey]) || String(a._id).localeCompare(String(b._id)))
    .slice(0, cap);
}

// ─── Dimension breakdowns (sources, geo, devices, campaigns…) ─────────────
export async function dimension(scope, dim, { limit = 50 } = {}) {
  const { websiteIds, range } = scope;
  const rows = hasFilters(scope.filters) ? await filteredDimension(scope, dim, Math.min(500, limit)) : await col('aggDailyDims').aggregate([
    { $match: { websiteId: { $in: websiteIds }, dim, day: { $gte: range.fromDay, $lte: range.toDay } } },
    { $group: { _id: '$value', visitors: { $sum: '$visitors' }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: '$bounces' }, conversions: { $sum: '$conversions' }, durationMs: { $sum: '$durationMs' }, count: { $sum: '$count' } } },
    { $sort: { sessions: -1, count: -1 } },
    { $limit: Math.min(500, limit) },
  ]).toArray();
  const total = rows.reduce((s, r) => s + (r.sessions || r.count), 0);
  return rows.map((r) => ({
    value: r._id,
    label: dim === 'channel' ? CHANNELS[r._id] || r._id : dim === 'event' ? EVENT_LABELS[r._id] || r._id : r._id,
    visitors: r.visitors, sessions: r.sessions, pageviews: r.pageviews, count: r.count,
    share: round(ratio(r.sessions || r.count, total) * 100),
    bounceRate: round(ratio(r.bounces, r.sessions) * 100),
    conversions: r.conversions,
    conversionRate: round(ratio(r.conversions, r.sessions) * 100, 2),
    avgSessionMs: Math.round(ratio(r.durationMs, r.sessions)),
  }));
}

/** Breakdown of the filtered sessions (same shape as the rollup rows). */
async function filteredDimension(scope, dim, limit) {
  const { websiteIds, range } = scope;
  if (dim === 'event') {
    const extra = await sessionClause(scope, range.from, range.to);
    return col('events').aggregate([
      { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
      { $group: { _id: { n: '$name', v: '$visitorId' }, c: { $sum: 1 } } },
      { $group: { _id: '$_id.n', count: { $sum: '$c' }, visitors: { $sum: 1 } } },
      { $addFields: { sessions: 0, pageviews: 0, bounces: 0, conversions: 0, durationMs: 0 } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ], { allowDiskUse: true }).toArray();
  }
  const expr = SESSION_DIMS[dim];
  if (!expr) return [];
  return col('sessions').aggregate([
    { $match: await sessionsIn(scope, range.from, range.to) },
    ...sessionDimFacet(expr).filter((s) => !s.$limit),
    { $limit: limit },
  ], { allowDiskUse: true }).toArray().then((rows) => rows.map((r) => ({ ...r, count: r.sessions })));
}

/** Campaign table: sessions/conversions from rollups + leads from the lead attribution. */
export async function campaigns(scope) {
  const rows = await dimension(scope, 'campaign', { limit: 200 });
  const extra = await sessionClause(scope, scope.range.from, scope.range.to);
  const leads = await col('leads').aggregate([
    { $match: { websiteId: { $in: scope.websiteIds }, ts: { $gte: scope.range.from, $lte: scope.range.to }, 'attribution.utm.campaign': { $ne: null }, ...extra } },
    { $group: { _id: { $concat: [{ $ifNull: ['$attribution.utm.source', '(none)'] }, '|', { $ifNull: ['$attribution.utm.medium', '(none)'] }, '|', '$attribution.utm.campaign'] }, n: { $sum: 1 } } },
  ]).toArray();
  const leadMap = Object.fromEntries(leads.map((l) => [l._id, l.n]));
  return rows.map((r) => {
    const [source, medium, campaign] = String(r.value).split('|');
    return { ...r, source, medium, campaign, leads: leadMap[r.value] || 0 };
  });
}

// ─── Events ────────────────────────────────────────────────────────────────
export async function eventDetail(scope, name) {
  const { websiteIds, range } = scope;
  const match = { websiteId: { $in: websiteIds }, name, ts: { $gte: range.from, $lte: range.to }, ...(await sessionClause(scope, range.from, range.to)) };
  const [facets] = await col('events').aggregate([
    { $match: match },
    { $facet: {
      totals: [{ $group: { _id: null, count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } }, { $project: { count: 1, visitors: { $size: '$visitors' } } }],
      byPath: [{ $group: { _id: '$page.path', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }],
      byDay: [{ $group: { _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      props: [{ $limit: 5000 }, { $project: { kv: { $objectToArray: { $ifNull: ['$props', {}] } } } }, { $unwind: '$kv' }, { $match: { 'kv.v': { $type: ['string', 'number', 'bool'] } } }, { $group: { _id: { k: '$kv.k', v: '$kv.v' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 60 }],
      recent: [{ $sort: { ts: -1 } }, { $limit: 25 }, { $project: { _id: 0, ts: 1, visitorId: 1, 'page.path': 1, props: 1 } }],
    } },
  ]).toArray();
  const t = facets.totals[0] || { count: 0, visitors: 0 };
  return {
    name,
    label: EVENT_LABELS[name] || name,
    count: t.count,
    visitors: t.visitors,
    perVisitor: round(ratio(t.count, t.visitors), 2),
    byPath: facets.byPath.map((r) => ({ path: r._id, count: r.n })),
    byDay: facets.byDay.map((r) => ({ t: r._id, count: r.n })),
    props: facets.props.map((r) => ({ key: r._id.k, value: r._id.v, count: r.n })),
    recent: facets.recent,
  };
}

// ─── Searches ──────────────────────────────────────────────────────────────
export async function searches(scope) {
  const { websiteIds, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const [f] = await col('searches').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, normalized: { $ne: '' }, ...extra } },
    { $facet: {
      top: [
        { $group: { _id: { q: '$normalized', v: '$visitorId' }, n: { $sum: 1 }, sample: { $last: '$query' }, results: { $avg: '$resultsCount' }, zero: { $sum: { $cond: [{ $eq: ['$resultsCount', 0] }, 1, 0] } }, last: { $max: '$ts' } } },
        { $group: { _id: '$_id.q', count: { $sum: '$n' }, visitors: { $sum: 1 }, sample: { $last: '$sample' }, avgResults: { $avg: '$results' }, zeroResults: { $sum: '$zero' }, lastSearched: { $max: '$last' } } },
        { $sort: { count: -1 } }, { $limit: 100 },
      ],
      zero: [{ $match: { resultsCount: 0 } }, { $group: { _id: '$normalized', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 25 }],
      categories: [{ $match: { category: { $ne: null } } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 25 }],
      pages: [{ $group: { _id: '$path', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
      byDay: [{ $group: { _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      totals: [{ $group: { _id: null, searches: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } }, { $project: { searches: 1, visitors: { $size: '$visitors' } } }],
    } },
  ], { allowDiskUse: true }).toArray();
  return {
    totals: { searches: f.totals[0]?.searches || 0, searchers: f.totals[0]?.visitors || 0, unique: f.top.length },
    top: f.top.map((r) => ({ query: r.sample || r._id, normalized: r._id, count: r.count, visitors: r.visitors, avgResults: r.avgResults == null ? null : round(r.avgResults), zeroResults: r.zeroResults, lastSearched: r.lastSearched })),
    zeroResults: f.zero.map((r) => ({ query: r._id, count: r.count })),
    categories: f.categories.map((r) => ({ category: r._id, count: r.count })),
    pages: f.pages.map((r) => ({ path: r._id, count: r.count })),
    byDay: f.byDay.map((r) => ({ t: r._id, count: r.count })),
  };
}

// ─── Forms ─────────────────────────────────────────────────────────────────
export async function forms(scope) {
  const { websiteIds, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const rows = await col('events').aggregate([
    { $match: { websiteId: { $in: websiteIds }, name: { $in: ['form_view', 'form_start', 'form_submit', 'form_error'] }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
    { $group: { _id: { w: '$websiteId', f: '$props.form', n: '$name' }, count: { $sum: 1 }, name: { $last: '$props.formName' }, path: { $last: '$page.path' }, dur: { $avg: '$props.dur' } } },
  ]).toArray();
  const map = new Map();
  for (const r of rows) {
    const key = `${r._id.w}|${r._id.f}`;
    const cur = map.get(key) || { websiteId: String(r._id.w), formKey: r._id.f, name: r.name || r._id.f, path: r.path, views: 0, starts: 0, submits: 0, errors: 0, avgCompletionMs: null };
    cur[{ form_view: 'views', form_start: 'starts', form_submit: 'submits', form_error: 'errors' }[r._id.n]] = r.count;
    if (r._id.n === 'form_submit' && r.dur) cur.avgCompletionMs = Math.round(r.dur);
    map.set(key, cur);
  }
  const leads = await col('leads').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
    { $group: { _id: { w: '$websiteId', f: '$formKey' }, n: { $sum: 1 } } },
  ]).toArray();
  for (const l of leads) {
    const cur = map.get(`${l._id.w}|${l._id.f}`);
    if (cur) cur.leads = l.n;
  }
  return [...map.values()].map((f) => ({
    ...f, leads: f.leads || 0,
    startRate: round(ratio(f.starts, f.views) * 100),
    completionRate: round(ratio(f.submits, f.starts) * 100),
    // Submitted ÷ viewed: the share of people who saw the form and sent it.
    conversionRate: round(ratio(f.submits, f.views) * 100),
    abandonment: Math.max(0, f.starts - f.submits),
    // Validation errors shown to visitors (browser "invalid" events), one per field per page view.
    failed: f.errors,
  })).sort((a, b) => b.views + b.starts - (a.views + a.starts));
}

// ─── Journeys ──────────────────────────────────────────────────────────────
export async function journeys(scope, { depth = 5, from: startPath } = {}) {
  const { websiteIds, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const seqs = await col('pageViews').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra } },
    { $sort: { ts: 1 } },
    { $group: { _id: { w: '$websiteId', s: '$sessionId' }, paths: { $push: '$path' } } },
    { $limit: 50_000 },
  ], { allowDiskUse: true }).toArray();
  const pathCounts = new Map();
  const transitions = new Map();
  const entryNext = new Map();
  for (const s of seqs) {
    const p = s.paths.filter((x, i) => i === 0 || x !== s.paths[i - 1]);
    let seq = p;
    if (startPath) {
      const i = p.indexOf(startPath);
      if (i === -1) continue;
      seq = p.slice(i);
    }
    const key = seq.slice(0, depth).join(' → ') + (seq.length > depth ? ' → …' : '');
    pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
    for (let i = 0; i < Math.min(seq.length - 1, depth); i += 1) {
      const t = `${i}|${seq[i]}|${seq[i + 1]}`;
      transitions.set(t, (transitions.get(t) || 0) + 1);
    }
    if (seq.length === 1) entryNext.set(seq[0], (entryNext.get(seq[0]) || 0) + 1);
  }
  const paths = [...pathCounts].map(([k, n]) => ({ steps: k.split(' → '), sessions: n })).sort((a, b) => b.sessions - a.sessions).slice(0, 50);
  const flows = [...transitions].map(([k, n]) => { const [step, from, to] = k.split('|'); return { step: Number(step), from, to, sessions: n }; }).sort((a, b) => b.sessions - a.sessions).slice(0, 150);
  const dropOffs = [...entryNext].map(([path, n]) => ({ path, sessions: n })).sort((a, b) => b.sessions - a.sessions).slice(0, 15);
  return { sessionsAnalysed: seqs.length, paths, flows, singlePageSessions: dropOffs };
}

// ─── Plain-language action labels ─────────────────────────────────────────
const fileName = (href) => { const s = String(href || '').split(/[?#]/)[0]; return decodeSafe(s.slice(s.lastIndexOf('/') + 1)) || s; };
function decodeSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** "click" + "Contact us" → 'Clicked “Contact us”'. Used for page "top actions" and the clicks report. */
export function actionLabel(name, detail) {
  const d = detail == null || detail === '' ? null : String(detail);
  switch (name) {
    case 'click': return d ? `Clicked “${d}”` : 'Clicked an unlabelled element';
    case 'rage_click': return d ? `Clicked “${d}” repeatedly (frustration)` : 'Clicked repeatedly (frustration)';
    case 'dead_click': return d ? `Clicked “${d}” but nothing happened` : 'Clicked something that did nothing';
    case 'scroll': return d ? `Scrolled ${d}% down the page` : 'Scrolled';
    case 'form_view': return `Saw ${d || 'a form'}`;
    case 'form_start': return `Started filling ${d || 'a form'}`;
    case 'form_submit': return `Submitted ${d || 'a form'}`;
    case 'form_error': return `Hit an error in ${d || 'a form'}`;
    case 'outbound_click': return d ? `Left for ${d}` : 'Clicked a link to another website';
    case 'file_download': return d ? `Downloaded ${fileName(d)}` : 'Downloaded a file';
    case 'phone_click': return 'Tapped the phone number';
    case 'email_click': return 'Tapped the email address';
    case 'whatsapp_click': return 'Opened WhatsApp chat';
    case 'contact_click': return 'Clicked a contact link';
    case 'video_play': return 'Played a video';
    case 'video_complete': return 'Watched a video to the end';
    case 'search': return 'Used site search';
    case 'js_error': return 'Saw a JavaScript error';
    case 'lead': return 'Became a lead';
    case 'conversion': return d ? `Converted: ${d}` : 'Converted';
    default: return d ? `${EVENT_LABELS[name] || name} · ${d}` : EVENT_LABELS[name] || name;
  }
}

/** Mongo expression picking the most descriptive detail of an event for grouping. */
const DETAIL_EXPR = {
  $switch: {
    branches: [
      { case: { $in: ['$name', ['search', 'video_play', 'video_pause', 'video_complete', 'js_error', 'phone_click', 'email_click', 'whatsapp_click', 'contact_click']] }, then: null },
      { case: { $eq: ['$name', 'scroll'] }, then: { $toString: '$props.depth' } },
      { case: { $regexMatch: { input: '$name', regex: /^form_/ } }, then: { $ifNull: ['$props.formName', '$props.form'] } },
      { case: { $eq: ['$name', 'outbound_click'] }, then: '$props.domain' },
      { case: { $eq: ['$name', 'file_download'] }, then: '$props.href' },
      { case: { $eq: ['$name', 'conversion'] }, then: '$props.goal' },
    ],
    default: { $ifNull: ['$props.text', null] },
  },
};
const NOT_ACTIONS = ['page_view', 'session_start', 'page_leave', 'route_change', 'visibility_hidden', 'identify'];

// ─── Page detail ───────────────────────────────────────────────────────────
export async function pageDetail(scope, path) {
  const { websiteIds, range } = scope;
  const prev = previousScope(scope);
  const [extra, prevExtra] = await Promise.all([sessionClause(scope, range.from, range.to), sessionClause(prev, range.prevFrom, range.prevTo)]);
  const ws = { $in: websiteIds };
  const pvTotals = (from, to, x) => col('pageViews').aggregate([
    { $match: { websiteId: ws, path, ts: { $gte: from, $lte: to }, ...x } },
    { $group: { _id: { w: '$websiteId', v: '$visitorId' }, views: { $sum: 1 }, engagedMs: { $sum: '$engagedMs' }, scroll: { $sum: '$maxScroll' }, title: { $last: '$title' } } },
    { $group: { _id: null, views: { $sum: '$views' }, visitors: { $sum: 1 }, engagedMs: { $sum: '$engagedMs' }, scrollSum: { $sum: '$scroll' }, title: { $last: '$title' } } },
  ], { allowDiskUse: true }).toArray().then((r) => r[0] || { views: 0, visitors: 0, engagedMs: 0, scrollSum: 0, title: null });
  const sessIn = (from, to, x, field) => col('sessions').countDocuments({ websiteId: ws, startedAt: { $gte: from, $lte: to }, [field]: path, ...x });

  const [cur, before, entries, exits, prevExits, byDay, sessionIds] = await Promise.all([
    pvTotals(range.from, range.to, extra),
    pvTotals(range.prevFrom, range.prevTo, prevExtra),
    sessIn(range.from, range.to, extra, 'entryPath'),
    sessIn(range.from, range.to, extra, 'exitPath'),
    sessIn(range.prevFrom, range.prevTo, prevExtra, 'exitPath'),
    col('pageViews').aggregate([
      { $match: { websiteId: ws, path, ts: { $gte: range.from, $lte: range.to }, ...extra } },
      { $group: { _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    col('pageViews').distinct('sessionId', { websiteId: ws, path, ts: { $gte: range.from, $lte: range.to }, ...extra }),
  ]);
  const ids = sessionIds.slice(0, 150_000);
  const [sources, convertedSessions, conversionsOnPage, actions] = await Promise.all([
    col('sessions').aggregate([
      { $match: { websiteId: ws, sessionId: { $in: ids } } },
      { $group: { _id: '$channel', sessions: { $sum: 1 } } },
      { $sort: { sessions: -1 } },
    ]).toArray(),
    col('sessions').countDocuments({ websiteId: ws, sessionId: { $in: ids }, converted: true }),
    col('conversions').countDocuments({ websiteId: ws, path, ts: { $gte: range.from, $lte: range.to }, ...extra }),
    col('events').aggregate([
      { $match: { websiteId: ws, 'page.path': path, ts: { $gte: range.from, $lte: range.to }, name: { $nin: NOT_ACTIONS }, ...extra } },
      { $group: { _id: { n: '$name', d: DETAIL_EXPR }, count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
      { $project: { count: 1, visitors: { $size: '$visitors' } } },
      { $sort: { visitors: -1, count: -1 } },
      { $limit: 15 },
    ], { allowDiskUse: true }).toArray(),
  ]);
  const totalSessions = sources.reduce((s, r) => s + r.sessions, 0);
  return {
    path,
    title: cur.title || before.title || null,
    current: {
      views: cur.views, visitors: cur.visitors, entries, exits,
      exitRate: round(ratio(exits, cur.views) * 100),
      avgEngagementMs: Math.round(ratio(cur.engagedMs, cur.views)),
      avgScroll: Math.round(ratio(cur.scrollSum, cur.views)),
      sessions: sessionIds.length,
      convertedSessions,
      conversionsOnPage,
      conversionRate: round(ratio(convertedSessions, sessionIds.length) * 100, 2),
    },
    previous: {
      views: before.views, visitors: before.visitors, exits: prevExits,
      exitRate: round(ratio(prevExits, before.views) * 100),
      avgEngagementMs: Math.round(ratio(before.engagedMs, before.views)),
    },
    sources: sources.map((r) => ({ value: r._id, label: CHANNELS[r._id] || r._id || 'Unknown', sessions: r.sessions, share: round(ratio(r.sessions, totalSessions) * 100) })),
    actions: actions.map((r) => ({ name: r._id.n, detail: r._id.d, label: actionLabel(r._id.n, r._id.d), count: r.count, visitors: r.visitors })),
    byDay: byDay.map((r) => ({ t: r._id, views: r.n })),
  };
}

// ─── Clicks & downloads ────────────────────────────────────────────────────
const CLICK_KINDS = {
  all: ['click', 'outbound_click', 'file_download', ...CONTACT_EVENTS],
  download: ['file_download'],
  outbound: ['outbound_click'],
  contact: CONTACT_EVENTS,
  frustration: ['rage_click', 'dead_click'],
};

export async function clicks(scope, { kind = 'all' } = {}) {
  const { websiteIds, range } = scope;
  const names = CLICK_KINDS[kind] || CLICK_KINDS.all;
  const extra = await sessionClause(scope, range.from, range.to);
  // Heat-map-only clicks (hm: 1) are clicks on non-interactive elements, which aren't "actions".
  const match = { websiteId: { $in: websiteIds }, name: { $in: names }, ts: { $gte: range.from, $lte: range.to }, 'props.hm': { $ne: 1 }, ...extra };
  const [f] = await col('events').aggregate([
    { $match: match },
    { $facet: {
      rows: [
        { $group: { _id: { n: '$name', d: DETAIL_EXPR, h: { $cond: [{ $in: ['$name', ['click', 'file_download']] }, '$props.href', null] } }, count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' }, pages: { $addToSet: '$page.path' }, last: { $max: '$ts' } } },
        { $project: { count: 1, last: 1, visitors: { $size: '$visitors' }, pageCount: { $size: '$pages' }, topPages: { $slice: ['$pages', 3] } } },
        { $sort: { visitors: -1, count: -1 } },
        { $limit: 200 },
      ],
      byType: [{ $group: { _id: '$name', count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } }, { $project: { count: 1, visitors: { $size: '$visitors' } } }, { $sort: { count: -1 } }],
      byDay: [{ $group: { _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      totals: [{ $group: { _id: null, count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } }, { $project: { count: 1, visitors: { $size: '$visitors' } } }],
    } },
  ], { allowDiskUse: true }).toArray();
  return {
    kind,
    totals: { count: f.totals[0]?.count || 0, visitors: f.totals[0]?.visitors || 0 },
    byType: f.byType.map((r) => ({ name: r._id, label: EVENT_LABELS[r._id] || r._id, count: r.count, visitors: r.visitors })),
    byDay: f.byDay.map((r) => ({ t: r._id, count: r.n })),
    rows: f.rows.map((r) => ({
      name: r._id.n, type: EVENT_LABELS[r._id.n] || r._id.n, detail: r._id.d, href: r._id.h || null,
      label: actionLabel(r._id.n, r._id.d), count: r.count, visitors: r.visitors, pages: r.pageCount, topPages: r.topPages, lastAt: r.last,
    })),
  };
}

// ─── Conversions ───────────────────────────────────────────────────────────
export async function conversionsReport(scope) {
  const { websiteIds, range } = scope;
  const prev = previousScope(scope);
  const [extra, prevExtra] = await Promise.all([sessionClause(scope, range.from, range.to), sessionClause(prev, range.prevFrom, range.prevTo)]);
  const match = { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...extra };
  const [[f], previous, sources] = await Promise.all([
    col('conversions').aggregate([
      { $match: match },
      { $facet: {
        byGoal: [{ $group: { _id: '$goal', count: { $sum: 1 }, value: { $sum: '$value' }, visitors: { $addToSet: '$visitorId' }, currency: { $last: '$currency' } } }, { $project: { count: 1, value: 1, currency: 1, visitors: { $size: '$visitors' } } }, { $sort: { count: -1 } }],
        byPage: [{ $group: { _id: '$path', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 15 }],
        byDay: [{ $group: { _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      } },
    ], { allowDiskUse: true }).toArray(),
    col('conversions').aggregate([
      { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.prevFrom, $lte: range.prevTo }, ...prevExtra } },
      { $group: { _id: '$goal', count: { $sum: 1 } } },
    ]).toArray(),
    // Attribute each converting session to how it arrived (its channel and source).
    col('conversions').aggregate([
      { $match: match },
      { $group: { _id: { w: '$websiteId', s: '$sessionId' }, n: { $sum: 1 } } },
      { $limit: 50_000 },
      { $lookup: { from: 'sessions', let: { w: '$_id.w', s: '$_id.s' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$websiteId', '$$w'] }, { $eq: ['$sessionId', '$$s'] }] } } }, { $project: { channel: 1, source: 1, entryPath: 1 } }], as: 'sess' } },
      { $unwind: '$sess' },
      { $facet: {
        channels: [{ $group: { _id: '$sess.channel', conversions: { $sum: '$n' }, sessions: { $sum: 1 } } }, { $sort: { conversions: -1 } }],
        sources: [{ $group: { _id: '$sess.source', conversions: { $sum: '$n' }, sessions: { $sum: 1 } } }, { $sort: { conversions: -1 } }, { $limit: 15 }],
        landing: [{ $group: { _id: '$sess.entryPath', conversions: { $sum: '$n' }, sessions: { $sum: 1 } } }, { $sort: { conversions: -1 } }, { $limit: 15 }],
      } },
    ], { allowDiskUse: true }).toArray(),
  ]);
  const prevByGoal = Object.fromEntries(previous.map((r) => [r._id, r.count]));
  const s = sources[0] || { channels: [], sources: [], landing: [] };
  return {
    total: f.byGoal.reduce((n, r) => n + r.count, 0),
    previousTotal: previous.reduce((n, r) => n + r.count, 0),
    value: f.byGoal.reduce((n, r) => n + (r.value || 0), 0),
    byGoal: f.byGoal.map((r) => ({ goal: r._id, count: r.count, previous: prevByGoal[r._id] || 0, visitors: r.visitors, value: r.value || 0, currency: r.currency || null })),
    byPage: f.byPage.map((r) => ({ path: r._id, count: r.count })),
    byDay: f.byDay.map((r) => ({ t: r._id, count: r.n })),
    byChannel: s.channels.map((r) => ({ value: r._id, label: CHANNELS[r._id] || r._id || 'Unknown', conversions: r.conversions, sessions: r.sessions })),
    bySource: s.sources.map((r) => ({ value: r._id, conversions: r.conversions, sessions: r.sessions })),
    byLandingPage: s.landing.map((r) => ({ path: r._id, conversions: r.conversions, sessions: r.sessions })),
  };
}

// ─── Realtime ──────────────────────────────────────────────────────────────
function countBy(list, fn, limit = 10) {
  const m = new Map();
  list.forEach((x) => { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); });
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function realtime({ websiteIds }) {
  let visitors = await activeVisitors(websiteIds);
  if (!visitors.length) {
    // Presence is empty after a restart (or on another instance without Redis): fall back to sessions.
    const recent = await col('sessions').find({ websiteId: { $in: websiteIds }, lastSeenAt: { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) } }, { sort: { lastSeenAt: -1 }, limit: 500 }).toArray();
    visitors = recent.map((s) => ({ visitorId: s.visitorId, websiteId: String(s.websiteId), sessionId: s.sessionId, path: s.exitPath || s.entryPath, action: `Viewing ${s.exitPath || s.entryPath}`, device: s.device?.type, browser: s.device?.browser, geo: s.geo, channel: s.channel, lastSeen: s.lastSeenAt.getTime() }));
  }
  let feed = await recentFeed(websiteIds, 60);
  if (!feed.length) {
    const evs = await col('events').find({ websiteId: { $in: websiteIds }, ts: { $gte: new Date(Date.now() - 30 * 60_000) }, name: { $nin: ['scroll', 'page_leave', 'visibility_hidden', 'route_change', 'click'] } }, { sort: { ts: -1 }, limit: 60 }).toArray();
    feed = evs.map((e) => ({ ts: e.ts.getTime(), name: e.name, label: EVENT_LABELS[e.name] || e.name, detail: e.props?.query || e.props?.formName || null, path: e.page?.path, visitorId: e.visitorId, websiteId: String(e.websiteId), geo: e.geo, device: e.device?.type }));
  }
  const since30 = new Date(Date.now() - 30 * 60_000);
  const perMinute = await col('pageViews').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: since30 } } },
    { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'minute' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  const minutes = [];
  const base = Math.floor(since30.getTime() / 60_000) * 60_000;
  const pm = Object.fromEntries(perMinute.map((r) => [r._id.getTime(), r.n]));
  for (let t = base + 60_000; t <= Date.now(); t += 60_000) minutes.push({ t: new Date(t).toISOString(), pageviews: pm[t] || 0 });
  return {
    active: visitors.length,
    visitors: visitors.slice(0, 100),
    byPage: countBy(visitors, (v) => v.path),
    byCountry: countBy(visitors, (v) => v.geo?.country),
    byDevice: countBy(visitors, (v) => v.device),
    bySource: countBy(visitors, (v) => v.channel),
    feed,
    perMinute: minutes,
  };
}
