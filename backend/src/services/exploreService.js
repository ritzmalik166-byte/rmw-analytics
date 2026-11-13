import { col } from '../config/db.js';
import { badRequest } from '../utils/errors.js';
import { sessionClause } from './filters.js';
import { previousScope } from './statsService.js';

/**
 * Free-form exploration (GA4 "Explore"): any combination of up to 2 dimensions and up to 8 metrics,
 * computed from raw data for the selected dates and filters.
 *
 * Two engines, picked from what was asked for:
 *  - sessions: visit-level dimensions (source, device, landing page…) and visit metrics (users, sessions…)
 *  - events:   action-level dimensions (event name, page) and action metrics (event count, views…)
 * Device, location, browser and date exist in both. Mixing a visit-only and an action-only field is
 * refused with a plain explanation (GA4 has the same "incompatible" rule).
 */

const day = (field, tz) => ({ $dateToString: { date: field, format: '%Y-%m-%d', timezone: tz } });
const unknown = (expr, label = '(unknown)') => ({ $ifNull: [expr, label] });

export const DIMENSIONS = {
  date: { label: 'Date', engines: ['sessions', 'events'] },
  channel: { label: 'Traffic type', engines: ['sessions'] },
  source: { label: 'Source', engines: ['sessions'] },
  medium: { label: 'Medium', engines: ['sessions'] },
  campaign: { label: 'Campaign', engines: ['sessions'] },
  referrer: { label: 'Referring website', engines: ['sessions'] },
  landingPage: { label: 'Landing page', engines: ['sessions'] },
  exitPage: { label: 'Exit page', engines: ['sessions'] },
  userType: { label: 'New / returning', engines: ['sessions'] },
  language: { label: 'Language', engines: ['sessions'] },
  screen: { label: 'Screen size', engines: ['sessions'] },
  country: { label: 'Country', engines: ['sessions', 'events'] },
  region: { label: 'State / region', engines: ['sessions', 'events'] },
  city: { label: 'City', engines: ['sessions', 'events'] },
  locality: { label: 'Locality', engines: ['sessions', 'events'] },
  device: { label: 'Device', engines: ['sessions', 'events'] },
  browser: { label: 'Browser', engines: ['sessions', 'events'] },
  os: { label: 'Operating system', engines: ['sessions', 'events'] },
  pagePath: { label: 'Page', engines: ['events'] },
  pageTitle: { label: 'Page title', engines: ['events'] },
  eventName: { label: 'Event (action)', engines: ['events'] },
};

export const METRICS = {
  users: { label: 'Users', engine: 'sessions', format: 'number' },
  activeUsers: { label: 'Active users', engine: 'sessions', format: 'number' },
  newUsers: { label: 'New users', engine: 'sessions', format: 'number' },
  sessions: { label: 'Sessions', engine: 'sessions', format: 'number' },
  engagedSessions: { label: 'Engaged sessions', engine: 'sessions', format: 'number' },
  engagementRate: { label: 'Engagement rate', engine: 'sessions', format: 'percent' },
  bounceRate: { label: 'Bounce rate', engine: 'sessions', format: 'percent', lowerIsBetter: true },
  pageviews: { label: 'Page views', engine: 'sessions', format: 'number' },
  pagesPerSession: { label: 'Pages per session', engine: 'sessions', format: 'decimal' },
  avgSessionDuration: { label: 'Avg. session duration', engine: 'sessions', format: 'duration' },
  avgEngagementTime: { label: 'Avg. engagement time', engine: 'sessions', format: 'duration' },
  conversions: { label: 'Converting sessions', engine: 'sessions', format: 'number' },
  conversionRate: { label: 'Conversion rate', engine: 'sessions', format: 'percent' },
  eventCount: { label: 'Event count', engine: 'events', format: 'number' },
  eventUsers: { label: 'Users (who did it)', engine: 'events', format: 'number' },
  eventsPerUser: { label: 'Events per user', engine: 'events', format: 'decimal' },
  views: { label: 'Views', engine: 'events', format: 'number' },
  viewers: { label: 'Viewers', engine: 'events', format: 'number' },
};

function sessionDimExpr(d, tz) {
  switch (d) {
    case 'date': return day('$startedAt', tz);
    case 'channel': return unknown('$channel');
    case 'source': return unknown('$source', '(direct)');
    case 'medium': return unknown('$utm.medium', '(none)');
    case 'campaign': return unknown('$utm.campaign', '(not set)');
    case 'referrer': return unknown('$referrerHost', '(direct)');
    case 'landingPage': return unknown('$entryPath');
    case 'exitPage': return { $ifNull: ['$exitPath', unknown('$entryPath')] };
    case 'userType': return { $cond: ['$isNew', 'New', 'Returning'] };
    case 'language': return { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$lang', ''] } }, 0] }, { $substrCP: ['$lang', 0, 2] }, '(unknown)'] };
    case 'screen': return unknown('$device.screen');
    case 'country': return unknown('$geo.country');
    case 'region': return unknown('$geo.region');
    case 'city': return unknown('$geo.city');
    case 'locality': return unknown('$geo.locality');
    case 'device': return unknown('$device.type');
    case 'browser': return unknown('$device.browser');
    case 'os': return unknown('$device.os');
    default: return null;
  }
}

function eventDimExpr(d, tz) {
  switch (d) {
    case 'date': return day('$ts', tz);
    case 'pagePath': return unknown('$page.path');
    case 'pageTitle': return unknown('$page.title', '(no title)');
    case 'eventName': return '$name';
    case 'country': return unknown('$geo.country');
    case 'region': return unknown('$geo.region');
    case 'city': return unknown('$geo.city');
    case 'locality': return unknown('$geo.locality');
    case 'device': return unknown('$device.type');
    case 'browser': return unknown('$device.browser');
    case 'os': return unknown('$device.os');
    default: return null;
  }
}

const NOISE = ['page_leave', 'visibility_hidden', 'route_change'];
const r2 = (n) => Math.round(n * 100) / 100;
const div = (a, b) => (b ? a / b : 0);

/** Validate the request and pick the engine. Throws a readable 400 for impossible combinations. */
export function planExplore({ dimensions = [], metrics = [] }) {
  const dims = [...new Set(dimensions)].filter(Boolean);
  const mets = [...new Set(metrics)].filter(Boolean);
  if (dims.length > 2) throw badRequest('Choose at most 2 dimensions', 'EXPLORE_DIMS');
  if (!mets.length) throw badRequest('Choose at least one metric', 'EXPLORE_METRICS');
  if (mets.length > 8) throw badRequest('Choose at most 8 metrics', 'EXPLORE_METRICS');
  for (const d of dims) if (!DIMENSIONS[d]) throw badRequest(`Unknown dimension "${d}"`, 'EXPLORE_DIMS');
  for (const m of mets) if (!METRICS[m]) throw badRequest(`Unknown metric "${m}"`, 'EXPLORE_METRICS');
  const engines = new Set(mets.map((m) => METRICS[m].engine));
  if (engines.size > 1) {
    const s = mets.filter((m) => METRICS[m].engine === 'sessions').map((m) => METRICS[m].label);
    const e = mets.filter((m) => METRICS[m].engine === 'events').map((m) => METRICS[m].label);
    throw badRequest(`${e.join(', ')} (counted per action) can't be shown next to ${s.join(', ')} (counted per visit). Remove one group.`, 'EXPLORE_INCOMPATIBLE');
  }
  const engine = [...engines][0];
  const bad = dims.filter((d) => !DIMENSIONS[d].engines.includes(engine));
  if (bad.length) {
    const what = engine === 'sessions' ? 'visit metrics (users, sessions…)' : 'action metrics (event count, views…)';
    throw badRequest(`${bad.map((d) => DIMENSIONS[d].label).join(', ')} can't be used with ${what}.`, 'EXPLORE_INCOMPATIBLE');
  }
  return { dims, mets, engine };
}

async function runSessions(scope, from, to, dims, mets) {
  const tz = scope.range.tz;
  const extra = await sessionClause(scope, from, to);
  const keys = Object.fromEntries(dims.map((d, i) => [`d${i}`, sessionDimExpr(d, tz)]));
  const outer = Object.fromEntries(dims.map((_, i) => [`d${i}`, `$_id.d${i}`]));
  const rows = await col('sessions').aggregate([
    { $match: { websiteId: { $in: scope.websiteIds }, startedAt: { $gte: from, $lte: to }, ...extra } },
    { $group: {
      _id: { ...keys, w: '$websiteId', v: '$visitorId' },
      s: { $sum: 1 }, eng: { $sum: { $cond: ['$bounced', 0, 1] } }, pv: { $sum: '$pageviews' }, dur: { $sum: '$durationMs' }, act: { $sum: '$activeMs' },
      conv: { $sum: { $cond: ['$converted', 1, 0] } }, isNew: { $max: { $cond: ['$isNew', 1, 0] } }, active: { $max: { $cond: ['$bounced', 0, 1] } },
    } },
    { $group: {
      _id: outer, users: { $sum: 1 }, activeUsers: { $sum: '$active' }, newUsers: { $sum: '$isNew' }, sessions: { $sum: '$s' }, engaged: { $sum: '$eng' },
      pv: { $sum: '$pv' }, dur: { $sum: '$dur' }, act: { $sum: '$act' }, conv: { $sum: '$conv' },
    } },
    { $limit: 5000 },
  ], { allowDiskUse: true }).toArray();
  return rows.map((r) => {
    const all = {
      users: r.users, activeUsers: r.activeUsers, newUsers: r.newUsers, sessions: r.sessions, engagedSessions: r.engaged,
      engagementRate: r2(div(r.engaged, r.sessions) * 100), bounceRate: r2(div(r.sessions - r.engaged, r.sessions) * 100),
      pageviews: r.pv, pagesPerSession: r2(div(r.pv, r.sessions)), avgSessionDuration: Math.round(div(r.dur, r.sessions)),
      avgEngagementTime: Math.round(div(r.act, r.users)), conversions: r.conv, conversionRate: r2(div(r.conv, r.sessions) * 100),
    };
    return { dims: dims.map((_, i) => (r._id?.[`d${i}`] ?? '(unknown)')), metrics: Object.fromEntries(mets.map((m) => [m, all[m]])) };
  });
}

async function runEvents(scope, from, to, dims, mets) {
  const tz = scope.range.tz;
  const extra = await sessionClause(scope, from, to);
  const onlyViews = mets.every((m) => m === 'views' || m === 'viewers');
  const keys = Object.fromEntries(dims.map((d, i) => [`d${i}`, eventDimExpr(d, tz)]));
  const outer = Object.fromEntries(dims.map((_, i) => [`d${i}`, `$_id.d${i}`]));
  const isView = { $cond: [{ $eq: ['$name', 'page_view'] }, 1, 0] };
  const rows = await col('events').aggregate([
    { $match: { websiteId: { $in: scope.websiteIds }, ts: { $gte: from, $lte: to }, name: onlyViews ? 'page_view' : { $nin: NOISE }, ...extra } },
    { $group: { _id: { ...keys, w: '$websiteId', v: '$visitorId' }, c: { $sum: 1 }, views: { $sum: isView } } },
    { $group: { _id: outer, users: { $sum: 1 }, c: { $sum: '$c' }, views: { $sum: '$views' }, viewers: { $sum: { $cond: [{ $gt: ['$views', 0] }, 1, 0] } } } },
    { $limit: 5000 },
  ], { allowDiskUse: true }).toArray();
  return rows.map((r) => {
    const all = { eventCount: r.c, eventUsers: r.users, eventsPerUser: r2(div(r.c, r.users)), views: r.views, viewers: r.viewers };
    return { dims: dims.map((_, i) => (r._id?.[`d${i}`] ?? '(unknown)')), metrics: Object.fromEntries(mets.map((m) => [m, all[m]])) };
  });
}

/**
 * Run an exploration. Options: dimensions[], metrics[], sort (metric key or "dim0"), order, limit, compare.
 * Returns rows, the grand total (unique users counted once, not summed) and, with compare, the previous
 * period's value for each row.
 */
export async function explore(scope, { dimensions, metrics, sort, order = 'desc', limit = 250, compare = false }) {
  const { dims, mets, engine } = planExplore({ dimensions, metrics });
  const run = engine === 'sessions' ? runSessions : runEvents;
  const { range } = scope;
  const prev = compare ? previousScope(scope) : null;
  const [rows, [total], prevRows, [prevTotal]] = await Promise.all([
    run(scope, range.from, range.to, dims, mets),
    run(scope, range.from, range.to, [], mets),
    prev ? run(prev, range.prevFrom, range.prevTo, dims, mets) : Promise.resolve([]),
    prev ? run(prev, range.prevFrom, range.prevTo, [], mets) : Promise.resolve([]),
  ]);
  const dir = order === 'asc' ? 1 : -1;
  const byDate = dims[0] === 'date' && !sort;
  const sortKey = sort === 'dim0' || byDate ? 'dim0' : mets.includes(sort) ? sort : mets[0];
  rows.sort((a, b) => (sortKey === 'dim0'
    ? (byDate ? 1 : dir) * String(a.dims[0]).localeCompare(String(b.dims[0]))
    : dir * ((a.metrics[sortKey] || 0) - (b.metrics[sortKey] || 0))) || String(a.dims.join()).localeCompare(String(b.dims.join())));
  const prevMap = new Map(prevRows.map((r) => [JSON.stringify(r.dims), r.metrics]));
  const cap = Math.min(1000, Math.max(1, Number(limit) || 250));
  // Previous-period rows are matched by dimension value; a date dimension can't line up, so it's skipped.
  const matchPrev = compare && !dims.includes('date');
  return {
    engine,
    dimensions: dims.map((d) => ({ key: d, label: DIMENSIONS[d].label })),
    metrics: mets.map((m) => ({ key: m, ...METRICS[m] })),
    rows: rows.slice(0, cap).map((r) => (matchPrev ? { ...r, previous: prevMap.get(JSON.stringify(r.dims)) || null } : r)),
    rowCount: rows.length,
    truncated: rows.length > cap,
    total: total?.metrics || Object.fromEntries(mets.map((m) => [m, 0])),
    previousTotal: compare ? prevTotal?.metrics || Object.fromEntries(mets.map((m) => [m, 0])) : null,
  };
}

// ─── Path exploration ──────────────────────────────────────────────────────
const PATH_NOISE = [...NOISE, 'scroll', 'session_start', 'identify'];
const MAX_PATH_SESSIONS = 50_000;
const MAX_NODES = 40;
export const PATH_END = '(exit)';

/**
 * Path exploration (GA4 "Path"): what visitors did step by step.
 * nodeType: 'event' (action names) or 'page' (page paths). start: optional starting node; each visit's path
 * then begins at its first occurrence. chain: nodes the user expanded, one per step. unique: collapse
 * repeats of the same node in a row. Returns one column per step: column 0 counts the starting nodes,
 * column j counts the next node among visits whose first j nodes equal the chain. Counts are visits.
 */
export async function pathExplore(scope, { nodeType = 'event', start, chain = [], unique = true, limit = 8 }) {
  const { websiteIds, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const isPage = nodeType === 'page';
  const steps = Math.min(chain.length + 1, 10);
  const seqs = await col(isPage ? 'pageViews' : 'events').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, ...(isPage ? {} : { name: { $nin: PATH_NOISE } }), ...extra } },
    // _id breaks ties between events recorded in the same millisecond (they were inserted in order).
    { $sort: { ts: 1, _id: 1 } },
    { $group: { _id: { w: '$websiteId', s: '$sessionId' }, nodes: { $push: isPage ? '$path' : '$name' } } },
    { $project: { nodes: { $slice: ['$nodes', 200] } } },
    { $limit: MAX_PATH_SESSIONS },
  ], { allowDiskUse: true }).toArray();

  const paths = [];
  for (const s of seqs) {
    let n = unique ? s.nodes.filter((x, i) => i === 0 || x !== s.nodes[i - 1]) : s.nodes;
    if (start) { const i = n.indexOf(start); if (i === -1) continue; n = n.slice(i); }
    paths.push(n.slice(0, MAX_NODES));
  }
  const columns = [];
  let alive = paths;
  for (let j = 0; j < steps; j += 1) {
    const counts = new Map();
    for (const p of alive) { const v = p[j] ?? PATH_END; counts.set(v, (counts.get(v) || 0) + 1); }
    const all = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    const top = all.slice(0, limit);
    const rest = all.slice(limit);
    columns.push({
      step: j, total: alive.length, nodes: top,
      more: rest.length ? { nodes: rest.length, count: rest.reduce((s, r) => s + r.count, 0) } : null,
      selected: chain[j] ?? null,
    });
    if (j === steps - 1 || chain[j] == null || chain[j] === PATH_END) break;
    alive = alive.filter((p) => p[j] === chain[j]);
  }
  return { nodeType, start: start || null, unique, sessions: paths.length, sampled: seqs.length >= MAX_PATH_SESSIONS, columns };
}

export const catalog = () => ({
  dimensions: Object.entries(DIMENSIONS).map(([key, d]) => ({ key, ...d })),
  metrics: Object.entries(METRICS).map(([key, m]) => ({ key, ...m })),
});
