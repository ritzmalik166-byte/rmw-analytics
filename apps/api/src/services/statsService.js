import { CHANNELS, EVENT_LABELS } from '@rmw-analytics/shared';
import { col } from '../config/db.js';
import { escapeRegex } from '../utils/http.js';
import { DAY_MS, daysBetween, dayKey } from '../utils/dates.js';
import { activeVisitors, recentFeed, ACTIVE_WINDOW_MS } from './realtime.js';

const EXACT_OVERVIEW_MAX_DAYS = 92;
const ratio = (a, b) => (b ? a / b : 0);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ─── Overview ──────────────────────────────────────────────────────────────
async function sessionTotals(websiteIds, from, to) {
  const [t] = await col('sessions').aggregate([
    { $match: { websiteId: { $in: websiteIds }, startedAt: { $gte: from, $lte: to } } },
    { $group: { _id: { w: '$websiteId', v: '$visitorId' }, s: { $sum: 1 }, pv: { $sum: '$pageviews' }, b: { $sum: { $cond: ['$bounced', 1, 0] } }, d: { $sum: '$durationMs' }, isNew: { $max: '$isNew' }, returned: { $max: { $cond: ['$isNew', 0, 1] } } } },
    { $group: { _id: null, visitors: { $sum: 1 }, newVisitors: { $sum: { $cond: ['$isNew', 1, 0] } }, returningVisitors: { $sum: '$returned' }, sessions: { $sum: '$s' }, pageviews: { $sum: '$pv' }, bounces: { $sum: '$b' }, durationMs: { $sum: '$d' } } },
  ], { allowDiskUse: true }).toArray();
  return t || { visitors: 0, newVisitors: 0, sessions: 0, pageviews: 0, bounces: 0, durationMs: 0 };
}

async function rollupTotals(websiteIds, fromDay, toDay) {
  const [t] = await col('aggDaily').aggregate([
    { $match: { websiteId: { $in: websiteIds }, day: { $gte: fromDay, $lte: toDay } } },
    { $group: { _id: null, visitors: { $sum: '$visitors' }, newVisitors: { $sum: '$newVisitors' }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, bounces: { $sum: '$bounces' }, durationMs: { $sum: '$durationMs' } } },
  ]).toArray();
  return t || { visitors: 0, newVisitors: 0, sessions: 0, pageviews: 0, bounces: 0, durationMs: 0 };
}

async function periodMetrics(websiteIds, from, to, { exact, fromDay, toDay }) {
  const range = { $gte: from, $lte: to };
  const [s, leads, conv, searches] = await Promise.all([
    exact ? sessionTotals(websiteIds, from, to) : rollupTotals(websiteIds, fromDay, toDay),
    col('leads').countDocuments({ websiteId: { $in: websiteIds }, ts: range }),
    col('conversions').aggregate([{ $match: { websiteId: { $in: websiteIds }, ts: range } }, { $group: { _id: null, n: { $sum: 1 }, value: { $sum: '$value' } } }]).toArray(),
    col('searches').countDocuments({ websiteId: { $in: websiteIds }, ts: range }),
  ]);
  return {
    visitors: s.visitors,
    newVisitors: s.newVisitors,
    // Visitors with at least one returning session in the period (may overlap with new visitors, like GA).
    returningVisitors: s.returningVisitors ?? Math.max(0, s.visitors - s.newVisitors),
    sessions: s.sessions,
    pageviews: s.pageviews,
    pagesPerSession: round(ratio(s.pageviews, s.sessions), 2),
    bounceRate: round(ratio(s.bounces, s.sessions) * 100),
    engagementRate: s.sessions ? round(100 - ratio(s.bounces, s.sessions) * 100) : 0,
    avgSessionMs: Math.round(ratio(s.durationMs, s.sessions)),
    conversions: conv[0]?.n || 0,
    conversionValue: conv[0]?.value || 0,
    conversionRate: round(ratio(conv[0]?.n || 0, s.sessions) * 100, 2),
    leads,
    searches,
  };
}

export async function overview({ websiteIds, range }) {
  const days = daysBetween(range.fromDay, range.toDay).length;
  const exact = days <= EXACT_OVERVIEW_MAX_DAYS;
  const span = range.to - range.from;
  const prevDays = { fromDay: dayKey(range.prevFrom, range.tz), toDay: dayKey(range.prevTo, range.tz) };
  const [current, previous] = await Promise.all([
    periodMetrics(websiteIds, range.from, range.to, { exact, fromDay: range.fromDay, toDay: range.toDay }),
    periodMetrics(websiteIds, range.prevFrom, range.prevTo, { exact: span <= EXACT_OVERVIEW_MAX_DAYS * DAY_MS, ...prevDays }),
  ]);
  return { current, previous, approximateVisitors: !exact };
}

// ─── Time series ───────────────────────────────────────────────────────────
export async function timeseries({ websiteIds, range }) {
  if (range.interval === 'hour') {
    const unit = { $dateTrunc: { date: '$startedAt', unit: 'hour', timezone: range.tz } };
    const [sess, pvs, leads] = await Promise.all([
      col('sessions').aggregate([
        { $match: { websiteId: { $in: websiteIds }, startedAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: { t: unit, v: '$visitorId', w: '$websiteId' }, s: { $sum: 1 } } },
        { $group: { _id: '$_id.t', visitors: { $sum: 1 }, sessions: { $sum: '$s' } } },
      ]).toArray(),
      col('pageViews').aggregate([
        { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'hour', timezone: range.tz } }, n: { $sum: 1 } } },
      ]).toArray(),
      col('leads').aggregate([
        { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'hour', timezone: range.tz } }, n: { $sum: 1 } } },
      ]).toArray(),
    ]);
    const map = new Map();
    const start = Math.floor(range.from.getTime() / 3600_000) * 3600_000;
    for (let t = start; t <= range.to.getTime(); t += 3600_000) map.set(t, { t: new Date(t).toISOString(), visitors: 0, sessions: 0, pageviews: 0, leads: 0, conversions: 0 });
    const at = (d) => map.get(new Date(d).getTime());
    sess.forEach((r) => { const p = at(r._id); if (p) { p.visitors = r.visitors; p.sessions = r.sessions; } });
    pvs.forEach((r) => { const p = at(r._id); if (p) p.pageviews = r.n; });
    leads.forEach((r) => { const p = at(r._id); if (p) p.leads = r.n; });
    return { interval: 'hour', points: [...map.values()] };
  }
  const rows = await col('aggDaily').aggregate([
    { $match: { websiteId: { $in: websiteIds }, day: { $gte: range.fromDay, $lte: range.toDay } } },
    { $group: { _id: '$day', visitors: { $sum: '$visitors' }, sessions: { $sum: '$sessions' }, pageviews: { $sum: '$pageviews' }, leads: { $sum: '$leads' }, conversions: { $sum: '$conversions' }, bounces: { $sum: '$bounces' }, searches: { $sum: '$searches' } } },
  ]).toArray();
  const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
  const points = daysBetween(range.fromDay, range.toDay).map((d) => {
    const r = byDay[d] || {};
    return { t: d, visitors: r.visitors || 0, sessions: r.sessions || 0, pageviews: r.pageviews || 0, leads: r.leads || 0, conversions: r.conversions || 0, searches: r.searches || 0, bounceRate: r.sessions ? round((r.bounces / r.sessions) * 100) : 0 };
  });
  return { interval: 'day', points };
}

// ─── Pages ─────────────────────────────────────────────────────────────────
export async function pages({ websiteIds, range }, { q, limit = 100, sort = 'pageviews' } = {}) {
  const match = { websiteId: { $in: websiteIds }, day: { $gte: range.fromDay, $lte: range.toDay } };
  if (q) match.path = { $regex: escapeRegex(q), $options: 'i' };
  const sortKey = ['pageviews', 'visitors', 'entries', 'exits', 'avgTimeMs'].includes(sort) ? sort : 'pageviews';
  const rows = await col('aggDailyPages').aggregate([
    { $match: match },
    { $group: { _id: '$path', title: { $last: '$title' }, pageviews: { $sum: '$pageviews' }, visitors: { $sum: '$visitors' }, entries: { $sum: '$entries' }, exits: { $sum: '$exits' }, engagedMs: { $sum: '$engagedMs' }, scrollSum: { $sum: '$scrollSum' } } },
    { $addFields: { avgTimeMs: { $cond: [{ $gt: ['$pageviews', 0] }, { $divide: ['$engagedMs', '$pageviews'] }, 0] } } },
    { $sort: { [sortKey]: -1 } },
    { $limit: Math.min(500, limit) },
  ]).toArray();
  return rows.map((r) => ({
    path: r._id, title: r.title, pageviews: r.pageviews, visitors: r.visitors, entries: r.entries, exits: r.exits,
    exitRate: round(ratio(r.exits, r.pageviews) * 100), avgTimeMs: Math.round(r.avgTimeMs), avgScroll: Math.round(ratio(r.scrollSum, r.pageviews)),
  }));
}

// ─── Dimension breakdowns (sources, geo, devices, campaigns…) ─────────────
export async function dimension({ websiteIds, range }, dim, { limit = 50 } = {}) {
  const rows = await col('aggDailyDims').aggregate([
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

/** Campaign table: sessions/conversions from rollups + leads from the lead attribution. */
export async function campaigns(scope) {
  const rows = await dimension(scope, 'campaign', { limit: 200 });
  const leads = await col('leads').aggregate([
    { $match: { websiteId: { $in: scope.websiteIds }, ts: { $gte: scope.range.from, $lte: scope.range.to }, 'attribution.utm.campaign': { $ne: null } } },
    { $group: { _id: { $concat: [{ $ifNull: ['$attribution.utm.source', '(none)'] }, '|', { $ifNull: ['$attribution.utm.medium', '(none)'] }, '|', '$attribution.utm.campaign'] }, n: { $sum: 1 } } },
  ]).toArray();
  const leadMap = Object.fromEntries(leads.map((l) => [l._id, l.n]));
  return rows.map((r) => {
    const [source, medium, campaign] = String(r.value).split('|');
    return { ...r, source, medium, campaign, leads: leadMap[r.value] || 0 };
  });
}

// ─── Events ────────────────────────────────────────────────────────────────
export async function eventDetail({ websiteIds, range }, name) {
  const match = { websiteId: { $in: websiteIds }, name, ts: { $gte: range.from, $lte: range.to } };
  const [facets] = await col('events').aggregate([
    { $match: match },
    { $facet: {
      byPath: [{ $group: { _id: '$page.path', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }],
      byDay: [{ $group: { _id: { $dateToString: { date: '$ts', format: '%Y-%m-%d', timezone: range.tz } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      props: [{ $limit: 5000 }, { $project: { kv: { $objectToArray: { $ifNull: ['$props', {}] } } } }, { $unwind: '$kv' }, { $match: { 'kv.v': { $type: ['string', 'number', 'bool'] } } }, { $group: { _id: { k: '$kv.k', v: '$kv.v' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 60 }],
      recent: [{ $sort: { ts: -1 } }, { $limit: 25 }, { $project: { _id: 0, ts: 1, visitorId: 1, 'page.path': 1, props: 1 } }],
    } },
  ]).toArray();
  return {
    name,
    label: EVENT_LABELS[name] || name,
    byPath: facets.byPath.map((r) => ({ path: r._id, count: r.n })),
    byDay: facets.byDay.map((r) => ({ t: r._id, count: r.n })),
    props: facets.props.map((r) => ({ key: r._id.k, value: r._id.v, count: r.n })),
    recent: facets.recent,
  };
}

// ─── Searches ──────────────────────────────────────────────────────────────
export async function searches({ websiteIds, range }) {
  const [f] = await col('searches').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to }, normalized: { $ne: '' } } },
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
export async function forms({ websiteIds, range }) {
  const rows = await col('events').aggregate([
    { $match: { websiteId: { $in: websiteIds }, name: { $in: ['form_view', 'form_start', 'form_submit', 'form_error'] }, ts: { $gte: range.from, $lte: range.to } } },
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
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to } } },
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
    abandonment: Math.max(0, f.starts - f.submits),
  })).sort((a, b) => b.views + b.starts - (a.views + a.starts));
}

// ─── Journeys ──────────────────────────────────────────────────────────────
export async function journeys({ websiteIds, range }, { depth = 5, from: startPath } = {}) {
  const seqs = await col('pageViews').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to } } },
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
