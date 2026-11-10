import { col, oid } from '../config/db.js';
import { logger } from '../config/logger.js';
import { sendMail } from './mailer.js';
import { notFound, badRequest } from '../utils/errors.js';
import { env } from '../config/env.js';

export const ALERT_TYPES = {
  traffic_spike: { label: 'Traffic spike', unit: '%', default: 100, help: 'Page views in the window rise by at least this % over the trailing average' },
  traffic_drop: { label: 'Traffic drop', unit: '%', default: 50, help: 'Page views in the window fall by at least this % below the trailing average' },
  new_lead: { label: 'New lead', unit: null, default: null, help: 'Every new lead, as it arrives' },
  high_value_conversion: { label: 'High-value conversion', unit: 'value', default: 10000, help: 'A conversion whose value is at least this amount' },
  error_spike: { label: 'Error spike', unit: 'errors', default: 25, help: 'JavaScript errors in the window reach this count' },
  search_spike: { label: 'Search spike', unit: '%', default: 150, help: 'Searches in the window rise by at least this % over the trailing average' },
  unusual_activity: { label: 'Unusual activity', unit: 'σ', default: 3, help: 'Event volume deviates from normal by this many standard deviations' },
};

const MIN_VOLUME = 20; // ignore % changes on tiny numbers
const BASELINE_WINDOWS = 24;

// ─── CRUD ───────────────────────────────────────────────────────────────────
export const listAlerts = (orgId) => col('alerts').find({ orgId }).sort({ createdAt: -1 }).toArray();

export async function createAlert(orgId, input, user) {
  if (input.channels?.webhookUrl) assertSafeWebhook(input.channels.webhookUrl);
  const doc = {
    orgId,
    websiteId: input.websiteId ? oid(input.websiteId) : null,
    name: input.name || ALERT_TYPES[input.type].label,
    type: input.type,
    threshold: input.threshold ?? ALERT_TYPES[input.type].default,
    windowMinutes: input.windowMinutes || 60,
    cooldownMinutes: input.cooldownMinutes ?? 60,
    channels: { inApp: input.channels?.inApp !== false, emails: input.channels?.emails || [], webhookUrl: input.channels?.webhookUrl || null },
    enabled: input.enabled !== false,
    createdBy: user._id,
    createdAt: new Date(),
    lastTriggeredAt: null,
  };
  const { insertedId } = await col('alerts').insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function updateAlert(orgId, id, patch) {
  const _id = oid(id);
  const a = _id && (await col('alerts').findOne({ _id, orgId }));
  if (!a) throw notFound('Alert not found');
  if (patch.channels?.webhookUrl) assertSafeWebhook(patch.channels.webhookUrl);
  const $set = { updatedAt: new Date() };
  for (const k of ['name', 'threshold', 'windowMinutes', 'cooldownMinutes', 'enabled']) if (patch[k] !== undefined) $set[k] = patch[k];
  if (patch.websiteId !== undefined) $set.websiteId = patch.websiteId ? oid(patch.websiteId) : null;
  if (patch.channels) $set.channels = { ...a.channels, ...patch.channels };
  await col('alerts').updateOne({ _id }, { $set });
  return col('alerts').findOne({ _id });
}

export async function deleteAlert(orgId, id) {
  const _id = oid(id);
  const r = _id && (await col('alerts').deleteOne({ _id, orgId }));
  if (!r?.deletedCount) throw notFound('Alert not found');
}

/** Webhooks must be public HTTPS endpoints (basic SSRF guard). */
export function assertSafeWebhook(url) {
  let u;
  try { u = new URL(url); } catch { throw badRequest('Webhook URL is invalid', 'BAD_WEBHOOK'); }
  if (u.protocol !== 'https:') throw badRequest('Webhook URL must use https', 'BAD_WEBHOOK');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i.test(u.hostname) || u.hostname.endsWith('.internal') || u.hostname.endsWith('.local')) {
    throw badRequest('Webhook URL must be a public address', 'BAD_WEBHOOK');
  }
}

// ─── Delivery ───────────────────────────────────────────────────────────────
async function deliver(alert, { message, value, websiteId, meta = {} }) {
  const ev = { orgId: alert.orgId, alertId: alert._id, type: alert.type, name: alert.name, websiteId: websiteId || alert.websiteId, message, value, meta, ts: new Date(), readBy: [] };
  await col('alertEvents').insertOne(ev);
  await col('alerts').updateOne({ _id: alert._id }, { $set: { lastTriggeredAt: ev.ts } });

  const tasks = [];
  if (alert.channels?.emails?.length) {
    tasks.push(sendMail({
      to: alert.channels.emails.join(','),
      subject: `🚨 ${alert.name}: ${message}`.slice(0, 180),
      text: `${message}\n\nOpen the dashboard: ${env.APP_URL}/alerts`,
    }));
  }
  if (alert.channels?.webhookUrl) {
    tasks.push(fetch(alert.channels.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🚨 ${alert.name}: ${message}`, alert: { type: alert.type, name: alert.name }, value, meta, ts: ev.ts }),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => logger.warn({ err: err.message }, 'Alert webhook failed')));
  }
  await Promise.allSettled(tasks);
  return ev;
}

const inCooldown = (a) => a.lastTriggeredAt && Date.now() - new Date(a.lastTriggeredAt).getTime() < a.cooldownMinutes * 60_000;
const ruleMatchesSite = (a, websiteId) => !a.websiteId || a.websiteId.equals(websiteId);

// ─── Instant triggers (called from ingestion; never throw) ─────────────────
export async function onLead(website, lead) {
  try {
    const rules = await col('alerts').find({ orgId: website.orgId, type: 'new_lead', enabled: true }).toArray();
    for (const a of rules.filter((r) => ruleMatchesSite(r, website._id))) {
      const where = [lead.city, lead.attribution?.source].filter(Boolean).join(' · ');
      await deliver(a, { message: `New lead on ${website.name}${where ? ` (${where})` : ''} from ${lead.path}`, websiteId: website._id, meta: { leadId: String(lead._id) } });
    }
  } catch (err) {
    logger.error({ err: err.message }, 'new_lead alert failed');
  }
}

export async function onConversion(website, conv) {
  try {
    if (!(conv.value > 0)) return;
    const rules = await col('alerts').find({ orgId: website.orgId, type: 'high_value_conversion', enabled: true }).toArray();
    for (const a of rules.filter((r) => ruleMatchesSite(r, website._id) && conv.value >= (r.threshold || 0))) {
      await deliver(a, { message: `${conv.goal} worth ${conv.value.toLocaleString('en-IN')} ${conv.currency || ''} on ${website.name}`.trim(), value: conv.value, websiteId: website._id });
    }
  } catch (err) {
    logger.error({ err: err.message }, 'conversion alert failed');
  }
}

// ─── Scheduled evaluation ──────────────────────────────────────────────────
/** Counts for the current window and the previous BASELINE_WINDOWS windows of equal length. */
async function windowCounts(websiteIds, match, windowMs) {
  const now = Date.now();
  const start = new Date(now - windowMs * (BASELINE_WINDOWS + 1));
  const rows = await col('events').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: start }, ...match } },
    { $group: { _id: { $floor: { $divide: [{ $subtract: [{ $toLong: '$ts' }, start.getTime()] }, windowMs] } }, n: { $sum: 1 } } },
  ]).toArray();
  const buckets = Array(BASELINE_WINDOWS + 1).fill(0);
  rows.forEach((r) => { if (r._id >= 0 && r._id <= BASELINE_WINDOWS) buckets[r._id] += r.n; });
  const current = buckets[BASELINE_WINDOWS];
  const base = buckets.slice(0, BASELINE_WINDOWS);
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length);
  return { current, mean, sd };
}

const pct = (cur, mean) => (mean > 0 ? ((cur - mean) / mean) * 100 : cur > 0 ? Infinity : 0);

export async function evaluateAlerts() {
  const rules = await col('alerts').find({ enabled: true, type: { $in: ['traffic_spike', 'traffic_drop', 'error_spike', 'search_spike', 'unusual_activity'] } }).toArray();
  let fired = 0;
  for (const a of rules) {
    if (inCooldown(a)) continue;
    try {
      const websites = await col('websites').find({ orgId: a.orgId, deletedAt: null, ...(a.websiteId ? { _id: a.websiteId } : {}) }).toArray();
      if (!websites.length) continue;
      const ids = websites.map((w) => w._id);
      const scopeName = a.websiteId ? websites[0].name : 'all websites';
      const windowMs = a.windowMinutes * 60_000;
      const span = a.windowMinutes >= 60 ? `${Math.round(a.windowMinutes / 60)}h` : `${a.windowMinutes} min`;
      let msg = null;
      let value = null;
      if (a.type === 'traffic_spike' || a.type === 'traffic_drop') {
        const { current, mean } = await windowCounts(ids, { name: 'page_view' }, windowMs);
        const change = pct(current, mean);
        if (a.type === 'traffic_spike' && current >= MIN_VOLUME && change >= a.threshold) { value = Math.round(change); msg = `Traffic increased ${value}% in the last ${span} on ${scopeName} (${current} page views vs ${Math.round(mean)} typical).`; }
        if (a.type === 'traffic_drop' && mean >= MIN_VOLUME && -change >= a.threshold) { value = Math.round(-change); msg = `Traffic dropped ${value}% in the last ${span} on ${scopeName} (${current} page views vs ${Math.round(mean)} typical).`; }
      } else if (a.type === 'search_spike') {
        const { current, mean } = await windowCounts(ids, { name: 'search' }, windowMs);
        const change = pct(current, mean);
        if (current >= MIN_VOLUME && change >= a.threshold) { value = Math.round(change); msg = `Searches increased ${value}% in the last ${span} on ${scopeName}.`; }
      } else if (a.type === 'error_spike') {
        const { current } = await windowCounts(ids, { name: 'js_error' }, windowMs);
        if (current >= a.threshold) { value = current; msg = `${current} JavaScript errors in the last ${span} on ${scopeName}.`; }
      } else if (a.type === 'unusual_activity') {
        const { current, mean, sd } = await windowCounts(ids, {}, windowMs);
        const z = sd > 0 ? (current - mean) / sd : 0;
        if (Math.max(current, mean) >= MIN_VOLUME && Math.abs(z) >= a.threshold) { value = Number(z.toFixed(1)); msg = `Event volume is ${Math.abs(value)}σ ${z > 0 ? 'above' : 'below'} normal on ${scopeName} (${current} vs ~${Math.round(mean)}).`; }
      }
      if (msg) { await deliver(a, { message: msg, value }); fired += 1; }
    } catch (err) {
      logger.error({ err: err.message, alertId: String(a._id) }, 'Alert evaluation failed');
    }
  }
  return fired;
}

export async function listAlertEvents(orgId, { limit = 50, unreadFor } = {}) {
  const filter = { orgId, ...(unreadFor ? { readBy: { $ne: unreadFor } } : {}) };
  return col('alertEvents').find(filter).sort({ ts: -1 }).limit(limit).toArray();
}

export const markAlertEventsRead = (orgId, userId) => col('alertEvents').updateMany({ orgId, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });
