import { EVENT_LABELS, NOISY_EVENTS, CHANNELS } from '@rmw-analytics/shared';
import { C } from '@rmw-analytics/database';
import { col, oid } from '../config/db.js';
import { notFound } from '../utils/errors.js';
import { decryptJson, decrypt } from '../utils/crypto.js';
import { escapeRegex } from '../utils/http.js';
import { presentLead } from './leadService.js';

const shortId = (visitorId) => visitorId.replace(/^v_/, '').slice(0, 6).toUpperCase();

function presentVisitor(v, websites) {
  const w = websites.find((x) => x._id.equals(v.websiteId));
  return {
    websiteId: String(v.websiteId), website: w ? { name: w.name, code: w.code } : null,
    visitorId: v.visitorId, label: `Visitor #${shortId(v.visitorId)}`,
    firstSeen: v.firstSeen, lastSeen: v.lastSeen,
    counts: { sessions: 0, pageviews: 0, events: 0, searches: 0, conversions: 0, leads: 0, ...v.counts },
    device: v.last?.device || null, geo: v.last?.geo || null, lastPath: v.last?.path || null,
    first: v.first ? { ...v.first, channelLabel: CHANNELS[v.first.channel] || v.first.channel } : null,
    identified: Boolean(v.identityId), cookieless: Boolean(v.cookieless),
  };
}

export async function listVisitors({ websiteIds, websites, range }, { q, segment, page, limit, skip }) {
  const filter = { websiteId: { $in: websiteIds }, lastSeen: { $gte: range.from, $lte: range.to } };
  if (q) filter.visitorId = { $regex: `^v_${escapeRegex(String(q).replace(/^#|^v_/i, '').toLowerCase())}` };
  if (segment === 'new') filter.firstSeen = { $gte: range.from };
  if (segment === 'returning') filter['counts.sessions'] = { $gt: 1 };
  if (segment === 'leads') filter['counts.leads'] = { $gt: 0 };
  if (segment === 'identified') filter.identityId = { $exists: true };
  const [rows, total] = await Promise.all([
    col('visitors').find(filter).sort({ lastSeen: -1 }).skip(skip).limit(limit).toArray(),
    col('visitors').countDocuments(filter),
  ]);
  return { rows: rows.map((v) => presentVisitor(v, websites)), total, page, limit };
}

async function findVisitor(websiteIds, websiteId, visitorId) {
  const wid = oid(websiteId);
  if (!wid || !websiteIds.some((id) => id.equals(wid))) throw notFound('Visitor not found');
  const v = await col('visitors').findOne({ websiteId: wid, visitorId: String(visitorId) });
  if (!v) throw notFound('Visitor not found');
  return v;
}

/** Visitor profile: summary, sessions, chronological journey, searches, leads, identity. */
export async function visitorProfile(scope, websiteId, visitorId, { pii }) {
  const v = await findVisitor(scope.allWebsiteIds, websiteId, visitorId);
  const where = { websiteId: v.websiteId, visitorId: v.visitorId };
  const [sessions, events, searches, leads, identity] = await Promise.all([
    col('sessions').find(where).sort({ startedAt: -1 }).limit(100).toArray(),
    col('events').find({ ...where, name: { $nin: NOISY_EVENTS } }).sort({ ts: 1 }).limit(1000).project({ _id: 0, eventId: 1, name: 1, ts: 1, sessionId: 1, page: 1, props: 1 }).toArray(),
    col('searches').find(where).sort({ ts: -1 }).limit(50).project({ _id: 0, query: 1, ts: 1, path: 1, category: 1 }).toArray(),
    col('leads').find(where).sort({ ts: -1 }).limit(20).toArray(),
    v.identityId ? col('identities').findOne({ _id: v.identityId }) : null,
  ]);
  let identityOut = null;
  if (identity) {
    // Cross-site view only within this organisation, and only via an explicit identify() link.
    const links = (identity.links || []).filter((l) => scope.allWebsiteIds.some((id) => id.equals(l.websiteId)));
    identityOut = {
      customerId: pii ? (() => { try { return decrypt(identity.externalEnc); } catch { return null; } })() : '••••••',
      traits: pii ? decryptJson(identity.traitsEnc) || {} : {},
      linkedVisitors: links.map((l) => ({ websiteId: String(l.websiteId), visitorId: l.visitorId, website: scope.allWebsites.find((w) => w._id.equals(l.websiteId))?.code })),
    };
  }
  return {
    visitor: presentVisitor(v, scope.allWebsites),
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId, startedAt: s.startedAt, lastSeenAt: s.lastSeenAt, durationMs: s.durationMs, activeMs: s.activeMs,
      pageviews: s.pageviews, events: s.events, entryPath: s.entryPath, exitPath: s.exitPath, channel: s.channel, source: s.source,
      utm: s.utm, device: s.device, geo: s.geo, converted: s.converted, bounced: s.bounced,
    })),
    journey: events.map((e) => ({ ...e, label: EVENT_LABELS[e.name] || e.name })),
    searches,
    leads: leads.map((l) => presentLead(l, { pii, websites: scope.allWebsites })),
    identity: identityOut,
  };
}

/** GDPR/DPDP erasure: remove every record tied to this visitor ID on this website. */
export async function deleteVisitor(scope, websiteId, visitorId) {
  const v = await findVisitor(scope.allWebsiteIds, websiteId, visitorId);
  const where = { websiteId: v.websiteId, visitorId: v.visitorId };
  const names = [C.events, C.sessions, C.pageViews, C.searches, C.formSubmissions, C.leads, C.conversions, C.visitors];
  const counts = {};
  for (const name of names) counts[name] = (await col(name).deleteMany(where)).deletedCount;
  if (v.identityId) await col('identities').updateOne({ _id: v.identityId }, { $pull: { links: { websiteId: v.websiteId, visitorId: v.visitorId } } });
  return counts;
}

/** Data-subject export: everything stored for the visitor (PII decrypted; caller must hold visitors:export). */
export async function exportVisitor(scope, websiteId, visitorId) {
  const v = await findVisitor(scope.allWebsiteIds, websiteId, visitorId);
  const where = { websiteId: v.websiteId, visitorId: v.visitorId };
  const strip = { projection: { _id: 0, websiteId: 0, expireAt: 0 } };
  const [sessions, events, searches, leads] = await Promise.all([
    col('sessions').find(where, strip).toArray(),
    col('events').find(where, strip).sort({ ts: 1 }).toArray(),
    col('searches').find(where, strip).toArray(),
    col('leads').find(where).toArray(),
  ]);
  const { _id, websiteId: _w, expireAt, identityId, ...visitor } = v;
  return {
    exportedAt: new Date(), visitor, sessions, events, searches,
    leads: leads.map((l) => ({ ts: l.ts, fields: decryptJson(l.pii), attribution: l.attribution, status: l.status })),
  };
}

export async function listSessions({ websiteIds, websites, range }, { channel, device, country, converted, page, limit, skip }) {
  const filter = { websiteId: { $in: websiteIds }, startedAt: { $gte: range.from, $lte: range.to } };
  if (channel) filter.channel = channel;
  if (device) filter['device.type'] = device;
  if (country) filter['geo.country'] = country;
  if (converted === 'true') filter.converted = true;
  const [rows, total] = await Promise.all([
    col('sessions').find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).toArray(),
    col('sessions').countDocuments(filter),
  ]);
  return {
    rows: rows.map((s) => ({
      websiteId: String(s.websiteId), website: websites.find((w) => w._id.equals(s.websiteId))?.code,
      sessionId: s.sessionId, visitorId: s.visitorId, visitorLabel: `#${shortId(s.visitorId)}`,
      startedAt: s.startedAt, durationMs: s.durationMs, activeMs: s.activeMs, pageviews: s.pageviews, events: s.events,
      entryPath: s.entryPath, exitPath: s.exitPath, channel: s.channel, source: s.source, utm: s.utm,
      device: s.device, geo: s.geo, isNew: s.isNew, converted: s.converted, bounced: s.bounced,
    })),
    total, page, limit,
  };
}

export async function sessionDetail(scope, websiteId, sessionId) {
  const wid = oid(websiteId);
  if (!wid || !scope.allWebsiteIds.some((id) => id.equals(wid))) throw notFound('Session not found');
  const s = await col('sessions').findOne({ websiteId: wid, sessionId: String(sessionId) });
  if (!s) throw notFound('Session not found');
  const events = await col('events').find({ websiteId: wid, sessionId: s.sessionId }).sort({ ts: 1 }).limit(2000).project({ _id: 0, name: 1, ts: 1, page: 1, props: 1 }).toArray();
  return { session: { ...s, _id: undefined, websiteId: String(s.websiteId) }, events: events.map((e) => ({ ...e, label: EVENT_LABELS[e.name] || e.name })) };
}
