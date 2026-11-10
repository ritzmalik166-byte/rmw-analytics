import { isSensitiveKey, maskLeadFields, redactText } from '@rmw-analytics/shared';
import { col, oid } from '../config/db.js';
import { encryptJson, decryptJson, lookupHash } from '../utils/crypto.js';
import { escapeRegex } from '../utils/http.js';
import { notFound } from '../utils/errors.js';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'spam', 'closed'];
const DUPLICATE_WINDOW_MS = 10 * 60_000;

/**
 * Keep only fields the website owner allowlisted (settings.leadFields), never sensitive ones,
 * with bounded sizes. Matching is case-insensitive and ignores separators ("Full Name" ~ "full_name").
 */
export function filterLeadFields(raw, allowlist = []) {
  if (!raw || typeof raw !== 'object') return {};
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const allowed = new Set(allowlist.map(norm));
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    if (isSensitiveKey(k) || !allowed.has(norm(k))) continue;
    if (v == null || typeof v === 'object') continue;
    const s = String(v).trim().slice(0, k.toLowerCase().includes('message') ? 2000 : 200);
    if (s) out[k] = s;
  }
  return out;
}

const pick = (fields, re) => Object.entries(fields).find(([k]) => re.test(k))?.[1] || null;

/**
 * Create a lead from an allowlisted form submission or `analytics.trackLead()`.
 * PII is encrypted (AES-256-GCM); only a keyed hash of the email and the phone's last two digits are queryable.
 */
export async function createLead({ website, event, fields, formKey = null }) {
  const email = pick(fields, /mail/i);
  const phone = pick(fields, /phone|mobile|tel|whatsapp/i);
  const emailHash = email ? lookupHash(email) : null;
  const phoneHash = phone ? lookupHash(String(phone).replace(/\D/g, '').slice(-10)) : null;

  // Swallow double submits (same person, same site, within 10 minutes).
  if (emailHash || phoneHash) {
    const dup = await col('leads').findOne({
      websiteId: website._id,
      ts: { $gte: new Date(event.ts.getTime() - DUPLICATE_WINDOW_MS) },
      $or: [emailHash && { emailHash }, phoneHash && { phoneHash }].filter(Boolean),
    }, { projection: { _id: 1 } });
    if (dup) return { lead: null, duplicateOf: dup._id };
  }

  const [session, lastSearch] = await Promise.all([
    col('sessions').findOne({ websiteId: website._id, sessionId: event.sessionId }, { projection: { channel: 1, source: 1, referrer: 1, utm: 1, entryPath: 1, startedAt: 1 } }),
    col('searches').findOne({ websiteId: website._id, visitorId: event.visitorId }, { sort: { ts: -1 }, projection: { query: 1 } }),
  ]);

  const doc = {
    websiteId: website._id,
    orgId: website.orgId,
    ts: event.ts,
    visitorId: event.visitorId,
    sessionId: event.sessionId,
    formKey,
    path: event.page.path,
    pii: encryptJson(fields),
    fieldNames: Object.keys(fields),
    emailHash,
    phoneHash,
    phoneTail: phone ? String(phone).replace(/\D/g, '').slice(-2) : null,
    city: pick(fields, /city|location/i)?.slice(0, 80) || event.geo?.city || null,
    attribution: {
      channel: session?.channel || 'direct',
      source: session?.source || 'Direct',
      referrer: session?.referrer || null,
      utm: session?.utm || {},
      landingPage: session?.entryPath || event.page.path,
      lastSearch: lastSearch?.query || null,
    },
    geo: event.geo,
    device: event.device,
    status: 'new',
    notes: [],
    createdAt: new Date(),
  };
  const { insertedId } = await col('leads').insertOne(doc);
  return { lead: { _id: insertedId, ...doc }, duplicateOf: null };
}

/** Shape a lead for the API: decrypt for `leads:pii`, mask otherwise. */
export function presentLead(l, { pii, websites = [] }) {
  const fields = decryptJson(l.pii) || {};
  const w = websites.find((x) => x._id.equals(l.websiteId));
  return {
    id: String(l._id),
    websiteId: String(l.websiteId),
    website: w ? { name: w.name, code: w.code } : null,
    ts: l.ts,
    visitorId: l.visitorId,
    sessionId: l.sessionId,
    formKey: l.formKey,
    path: l.path,
    fields: pii ? fields : maskLeadFields(fields),
    masked: !pii,
    city: l.city,
    attribution: l.attribution,
    geo: l.geo,
    device: l.device,
    status: l.status,
    notes: (l.notes || []).map((n) => ({ ...n, text: n.text })),
  };
}

export async function listLeads({ websiteIds, range, status, q, page, limit, skip }) {
  const filter = { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to } };
  if (status && LEAD_STATUSES.includes(status)) filter.status = status;
  if (q) {
    const s = String(q).trim();
    if (s.includes('@')) filter.emailHash = lookupHash(s);
    else if (/^\+?[\d\s-]{6,}$/.test(s)) filter.phoneHash = lookupHash(s.replace(/\D/g, '').slice(-10));
    else filter.$or = [{ city: { $regex: escapeRegex(s), $options: 'i' } }, { 'attribution.lastSearch': { $regex: escapeRegex(redactText(s)), $options: 'i' } }, { path: { $regex: escapeRegex(s), $options: 'i' } }];
  }
  const [rows, total] = await Promise.all([
    col('leads').find(filter).sort({ ts: -1 }).skip(skip).limit(limit).toArray(),
    col('leads').countDocuments(filter),
  ]);
  return { rows, total, page, limit };
}

export async function getLead(websiteIds, id) {
  const _id = oid(id);
  const l = _id && (await col('leads').findOne({ _id, websiteId: { $in: websiteIds } }));
  if (!l) throw notFound('Lead not found');
  return l;
}

export async function updateLead(websiteIds, id, { status, note }, user) {
  const l = await getLead(websiteIds, id);
  const update = { $set: { updatedAt: new Date() } };
  if (status) update.$set.status = status;
  if (note) update.$push = { notes: { text: String(note).slice(0, 2000), by: user.fullName, at: new Date() } };
  await col('leads').updateOne({ _id: l._id }, update);
  return col('leads').findOne({ _id: l._id });
}
