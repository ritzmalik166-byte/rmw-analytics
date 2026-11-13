/**
 * Per-page activity lists for the page detail screen: who visited one page, when, and what they did there.
 * All lists respect the selected website(s), date range and report filters (sessionClause).
 *
 *   visits   – every view of the page (newest first) with the visit's source, device, location, engagement,
 *              whether it converted and whether a recording exists.
 *   visitors – one row per person who viewed the page: views, first/last time, time spent.
 *   clicks   – every click / tap / form action on the page with its exact time and the visitor.
 */
import { CHANNELS } from '@rmw-analytics/shared';
import { col } from '../config/db.js';
import { sessionClause } from './filters.js';
import { actionLabel } from './statsService.js';

const key = (w, s) => `${w}:${s}`;
const websiteOf = (websites, id) => websites.find((w) => w._id.equals(id));

/** Session context (source, device, location, outcome) and recording availability for a set of rows. */
async function contextFor(rows) {
  if (!rows.length) return { sessions: new Map(), replays: new Set() };
  const or = [...new Map(rows.map((r) => [key(r.websiteId, r.sessionId), { websiteId: r.websiteId, sessionId: r.sessionId }])).values()];
  const [ss, rs] = await Promise.all([
    col('sessions').find({ $or: or })
      .project({ websiteId: 1, sessionId: 1, channel: 1, source: 1, utm: 1, device: 1, geo: 1, entryPath: 1, exitPath: 1, converted: 1, isNew: 1, pageviews: 1, startedAt: 1 }).toArray(),
    col('replays').find({ $or: or }).project({ websiteId: 1, sessionId: 1 }).toArray(),
  ]);
  return {
    sessions: new Map(ss.map((s) => [key(s.websiteId, s.sessionId), s])),
    replays: new Set(rs.map((r) => key(r.websiteId, r.sessionId))),
  };
}

const sessionSummary = (s) => (s ? {
  channel: s.channel, channelLabel: CHANNELS[s.channel] || s.channel || null, source: s.source || null, campaign: s.utm?.campaign || null,
  device: s.device?.type || null, browser: s.device?.browser || null, os: s.device?.os || null,
  country: s.geo?.country || null, city: s.geo?.city || null,
  entryPath: s.entryPath || null, exitPath: s.exitPath || null, pageviews: s.pageviews || 0,
  converted: Boolean(s.converted), isNew: Boolean(s.isNew),
} : null);

export async function pageVisits(scope, path, { page, limit, skip }) {
  const { websiteIds, websites, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const filter = { websiteId: { $in: websiteIds }, path, ts: { $gte: range.from, $lte: range.to }, ...extra };
  const [rows, total] = await Promise.all([
    col('pageViews').find(filter).sort({ ts: -1 }).skip(skip).limit(limit).toArray(),
    col('pageViews').countDocuments(filter),
  ]);
  const ctx = await contextFor(rows);
  return {
    rows: rows.map((r) => {
      const k = key(r.websiteId, r.sessionId);
      return {
        at: r.ts, websiteId: String(r.websiteId), website: websiteOf(websites, r.websiteId)?.code || null,
        visitorId: r.visitorId, sessionId: r.sessionId, engagedMs: r.engagedMs || 0, scroll: r.maxScroll || 0,
        referrer: r.referrer || null, session: sessionSummary(ctx.sessions.get(k)), hasRecording: ctx.replays.has(k),
      };
    }),
    total, page, limit,
  };
}

export async function pageVisitors(scope, path, { page, limit, skip }) {
  const { websiteIds, websites, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const [out] = await col('pageViews').aggregate([
    { $match: { websiteId: { $in: websiteIds }, path, ts: { $gte: range.from, $lte: range.to }, ...extra } },
    { $sort: { ts: 1 } },
    { $group: {
      _id: { w: '$websiteId', v: '$visitorId' }, views: { $sum: 1 }, firstAt: { $first: '$ts' }, lastAt: { $last: '$ts' },
      engagedMs: { $sum: '$engagedMs' }, maxScroll: { $max: '$maxScroll' }, sessions: { $addToSet: '$sessionId' }, lastSession: { $last: '$sessionId' },
    } },
    { $sort: { lastAt: -1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ], { allowDiskUse: true }).toArray();
  const rows = out?.rows || [];
  const ctx = await contextFor(rows.map((r) => ({ websiteId: r._id.w, sessionId: r.lastSession })));
  const visitors = rows.length
    ? await col('visitors').find({ $or: rows.map((r) => ({ websiteId: r._id.w, visitorId: r._id.v })) }).project({ websiteId: 1, visitorId: 1, counts: 1, identityId: 1, firstSeen: 1 }).toArray()
    : [];
  const vmap = new Map(visitors.map((v) => [key(v.websiteId, v.visitorId), v]));
  return {
    rows: rows.map((r) => {
      const v = vmap.get(key(r._id.w, r._id.v));
      const k = key(r._id.w, r.lastSession);
      return {
        websiteId: String(r._id.w), website: websiteOf(websites, r._id.w)?.code || null, visitorId: r._id.v,
        views: r.views, visits: r.sessions.length, firstAt: r.firstAt, lastAt: r.lastAt, engagedMs: r.engagedMs, maxScroll: r.maxScroll,
        isLead: (v?.counts?.leads || 0) > 0, identified: Boolean(v?.identityId), totalVisits: v?.counts?.sessions || null,
        lastSessionId: r.lastSession, session: sessionSummary(ctx.sessions.get(k)), hasRecording: ctx.replays.has(k),
      };
    }),
    total: out?.total?.[0]?.n || 0, page, limit,
  };
}

const CLICK_EVENTS = ['click', 'rage_click', 'dead_click', 'outbound_click', 'file_download', 'phone_click', 'email_click', 'whatsapp_click',
  'contact_click', 'form_start', 'form_submit', 'form_error', 'video_play', 'video_complete', 'lead', 'conversion'];

/** Same choice of "detail" as the page report's top actions (statsService DETAIL_EXPR), in JS. */
function detailOf(e) {
  const p = e.props || {};
  if (['video_play', 'video_complete', 'phone_click', 'email_click', 'whatsapp_click', 'contact_click'].includes(e.name)) return null;
  if (e.name.startsWith('form_')) return p.formName || p.form || null;
  if (e.name === 'outbound_click') return p.domain || null;
  if (e.name === 'file_download') return p.href || null;
  if (e.name === 'conversion') return p.goal || null;
  return p.text || null;
}

export async function pageClicks(scope, path, { kind, page, limit, skip }) {
  const { websiteIds, websites, range } = scope;
  const extra = await sessionClause(scope, range.from, range.to);
  const names = kind === 'frustration' ? ['rage_click', 'dead_click'] : kind === 'contact' ? ['phone_click', 'email_click', 'whatsapp_click', 'contact_click'] : kind === 'forms' ? ['form_start', 'form_submit', 'form_error', 'lead'] : CLICK_EVENTS;
  const filter = { websiteId: { $in: websiteIds }, 'page.path': path, ts: { $gte: range.from, $lte: range.to }, name: { $in: names }, ...extra };
  const [rows, total] = await Promise.all([
    col('events').find(filter).sort({ ts: -1 }).skip(skip).limit(limit).project({ websiteId: 1, ts: 1, name: 1, props: 1, visitorId: 1, sessionId: 1 }).toArray(),
    col('events').countDocuments(filter),
  ]);
  const ctx = await contextFor(rows);
  return {
    rows: rows.map((e) => {
      const k = key(e.websiteId, e.sessionId);
      const s = ctx.sessions.get(k);
      return {
        at: e.ts, websiteId: String(e.websiteId), website: websiteOf(websites, e.websiteId)?.code || null, name: e.name,
        label: actionLabel(e.name, detailOf(e)), selector: e.props?.selector || e.props?.tag || null, href: e.props?.href || null,
        visitorId: e.visitorId, sessionId: e.sessionId, device: s?.device?.type || null, city: s?.geo?.city || null, country: s?.geo?.country || null,
        hasRecording: ctx.replays.has(k),
      };
    }),
    total, page, limit,
  };
}
