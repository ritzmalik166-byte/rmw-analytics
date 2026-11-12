import { col } from '../config/db.js';
import { badRequest } from '../utils/errors.js';

/**
 * Report filters ("segments"): every report can be narrowed to the sessions that match.
 *
 * Query params use an `f_` prefix so they never collide with pagination or route params:
 *   f_device=mobile  f_country=IN  f_channel=organic_search  f_source=Google  f_medium=cpc
 *   f_campaign=diwali  f_page=/contact  f_event=form_submit
 *
 * Semantics: a filter selects *sessions*. Session attributes (device, country, channel, source, medium,
 * campaign) match the session directly; `page` keeps sessions that viewed that page and `event` keeps
 * sessions in which that event happened. Every metric is then computed from those sessions only.
 * Filtered reports read raw collections (rollups are not segmented).
 */
export const FILTER_KEYS = ['device', 'country', 'channel', 'source', 'medium', 'campaign', 'page', 'event'];

const SESSION_FIELD = {
  device: 'device.type',
  country: 'geo.country',
  channel: 'channel',
  source: 'source',
  medium: 'utm.medium',
  campaign: 'utm.campaign',
};

/** Above this many matching sessions a filtered report would be too slow: ask for a shorter range. */
const MAX_SESSIONS = 150_000;

/** Parse `f_*` query params into a clean filters object ({} when none). */
export function parseFilters(query = {}) {
  const out = {};
  for (const k of FILTER_KEYS) {
    const v = query[`f_${k}`];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 300);
  }
  return out;
}

export const hasFilters = (filters) => Boolean(filters && Object.keys(filters).length);

/** "(none)" in a filter means the attribute is missing (e.g. sessions without a utm_medium). */
const valueOrMissing = (v) => (v === '(none)' || v === '(not set)' ? null : v);

/** Session-level match for [from, to] with the session-attribute filters applied (page/event excluded). */
export function sessionMatch(websiteIds, from, to, filters = {}) {
  const m = { websiteId: { $in: websiteIds }, startedAt: { $gte: from, $lte: to } };
  for (const [k, field] of Object.entries(SESSION_FIELD)) {
    if (filters[k] != null) m[field] = valueOrMissing(filters[k]);
  }
  return m;
}

const cache = new WeakMap();

/**
 * Session ids that match the filters in [from, to], or null when no filter is active (= everything).
 * Memoised per request scope, so one report that runs several queries resolves the segment once.
 */
export async function matchingSessionIds(scope, from, to) {
  const filters = scope.filters || {};
  if (!hasFilters(filters)) return null;
  let perScope = cache.get(scope);
  if (!perScope) cache.set(scope, (perScope = new Map()));
  const key = `${from.getTime()}-${to.getTime()}`;
  if (!perScope.has(key)) perScope.set(key, resolveIds(scope.websiteIds, from, to, filters));
  return perScope.get(key);
}

async function resolveIds(websiteIds, from, to, filters) {
  const m = sessionMatch(websiteIds, from, to, filters);
  const restrict = [];
  if (filters.page) {
    restrict.push(col('pageViews').distinct('sessionId', { websiteId: { $in: websiteIds }, path: filters.page, ts: { $gte: from, $lte: to } }));
  }
  if (filters.event) {
    restrict.push(col('events').distinct('sessionId', { websiteId: { $in: websiteIds }, name: filters.event.toLowerCase(), ts: { $gte: from, $lte: to } }));
  }
  if (restrict.length) {
    const lists = await Promise.all(restrict);
    let ids = lists[0];
    for (const l of lists.slice(1)) { const s = new Set(l); ids = ids.filter((x) => s.has(x)); }
    if (ids.length > MAX_SESSIONS) throw tooBig();
    m.sessionId = { $in: ids };
  }
  const ids = await col('sessions').distinct('sessionId', m);
  if (ids.length > MAX_SESSIONS) throw tooBig();
  return ids;
}

const tooBig = () => badRequest('Too many sessions match this filter for the selected dates. Choose a shorter date range.', 'FILTER_TOO_BROAD');

/** Extra match for collections keyed by sessionId (events, page views, leads, conversions…). */
export async function sessionClause(scope, from, to) {
  const ids = await matchingSessionIds(scope, from, to);
  return ids ? { sessionId: { $in: ids } } : {};
}
