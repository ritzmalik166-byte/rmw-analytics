import { DEFAULT_WEBSITE_SETTINGS, EVENT_LABELS, NOISY_EVENTS, normalizeQuery, redactText, LIMITS } from '@rmw-analytics/shared';
import { col } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { parseDevice } from '../../utils/ua.js';
import { lookupGeo } from '../../utils/geo.js';
import { encryptJson, lookupHash, encrypt } from '../../utils/crypto.js';
import { globToRegex } from '../../utils/http.js';
import { DAY_MS } from '../../utils/dates.js';
import { toStoredEvent, stripRaw, deriveAttribution } from './normalize.js';
import { createLead, filterLeadFields } from '../leadService.js';
import { touchPresence, publish } from '../realtime.js';
import { onLead, onConversion } from '../alertService.js';

const GOALS_TTL_MS = 60_000;
const goalsCache = new Map();
const lastEventTouch = new Map();
const MAX_FEED_ITEMS_PER_BATCH = 8;

async function goalsFor(websiteId) {
  const k = String(websiteId);
  const hit = goalsCache.get(k);
  if (hit && hit.exp > Date.now()) return hit.goals;
  const goals = (await col('goals').find({ websiteId }).toArray()).map((g) => ({ ...g, re: g.type === 'path' ? new RegExp(globToRegex(g.match)) : null }));
  goalsCache.set(k, { goals, exp: Date.now() + GOALS_TTL_MS });
  return goals;
}
export const invalidateGoals = (websiteId) => goalsCache.delete(String(websiteId));

function excluded(path, patterns) {
  return patterns?.some((p) => (p.includes('*') ? new RegExp(globToRegex(p)).test(path) : path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`)));
}

/** Bulk insert-if-absent keyed on eventId: returns only the events that were new (idempotent retries). */
async function insertFreshEvents(docs) {
  const ops = docs.map((d) => ({ updateOne: { filter: { websiteId: d.websiteId, eventId: d.eventId }, update: { $setOnInsert: stripRaw(d) }, upsert: true } }));
  let result;
  try {
    result = await col('events').bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Concurrent retries can race on the unique index; the rest of the batch still applied.
    if (err.code !== 11000 && !err.writeErrors) throw err;
    result = err.result;
  }
  const upserted = result?.upsertedIds || result?.getUpsertedIds?.() || {};
  const idx = Object.keys(upserted).map(Number);
  return idx.sort((a, b) => a - b).map((i) => docs[i]);
}

function feedItem(e, website) {
  const p = e.props || {};
  let detail = null;
  if (e.name === 'search') detail = p.query;
  else if (e.name.startsWith('form_')) detail = p.formName || p.form;
  else if (e.name === 'click' || e.name === 'rage_click') detail = p.text || p.sel;
  else if (e.name === 'outbound_click' || e.name === 'file_download') detail = p.href;
  else if (e.name === 'js_error') detail = p.msg;
  else if (!EVENT_LABELS[e.name]) detail = e.name;
  return {
    ts: e.ts.getTime(), name: e.name, label: EVENT_LABELS[e.name] || 'Custom event', detail: detail ? String(detail).slice(0, 120) : null,
    path: e.page.path, title: e.page.title, visitorId: e.visitorId, sessionId: e.sessionId,
    site: { code: website.code, name: website.name }, geo: e.geo, device: e.device.type,
  };
}

function presenceAction(e) {
  const p = e.props || {};
  if (e.name === 'search') return `Searching "${String(p.query || '').slice(0, 60)}"`;
  if (e.name === 'form_submit' || e.name === 'lead') return 'Submitted enquiry';
  if (e.name === 'form_start') return `Filling ${p.formName || 'a form'}`;
  if (e.name === 'page_view') return `Viewing ${e.page.path}`;
  if (NOISY_EVENTS.includes(e.name)) return null;
  return EVENT_LABELS[e.name] || e.name;
}

/**
 * Process one validated batch from a single visitor session.
 * @param {{ website: object, batch: object, req: import('express').Request, ip: string|null, ua: string, now?: number }} input
 * @returns {Promise<{accepted: number, duplicates: number, dropped: number}>}
 */
export async function ingestBatch({ website, batch, req, ip, ua, now = Date.now() }) {
  const settings = { ...DEFAULT_WEBSITE_SETTINGS, ...website.settings };
  const ctx = batch.ctx;
  // Correct client clock skew using the batch send time (offline-queued events keep their relative order).
  const offsetMs = batch.sentAt && Math.abs(now - batch.sentAt) > 2000 ? now - batch.sentAt : 0;
  const device = parseDevice(ua, { screenWidth: ctx.sw });
  const geo = await lookupGeo(req, ip);
  const expireAt = new Date(now + settings.retentionDays * DAY_MS);
  const wid = website._id;

  const docs = batch.events
    .map((e) => toStoredEvent(e, { website, ctx, device, geo, now, offsetMs, expireAt }))
    .filter((d) => d && !excluded(d.page.path, settings.excludePaths))
    .sort((a, b) => a.ts - b.ts);
  const dropped = batch.events.length - docs.length;
  if (!docs.length) return { accepted: 0, duplicates: 0, dropped };

  const fresh = await insertFreshEvents(docs);
  const duplicates = docs.length - fresh.length;
  if (!fresh.length) return { accepted: 0, duplicates, dropped };

  const first = fresh[0];
  const last = fresh[fresh.length - 1];
  const byName = (n) => fresh.filter((e) => e.name === n);
  const pageViews = byName('page_view');
  const leaves = byName('page_leave');
  const searches = byName('search');
  // `delta` = active time since the previous page_leave of the same view (a view can "leave" several times
  // when the tab is hidden/shown); `engaged` is the running total and is only used for page-level max.
  const activeMs = Math.min(leaves.reduce((s, e) => s + (Number(e.props.delta ?? e.props.engaged) || 0), 0), 6 * 3600_000);
  const landing = pageViews[0] || first;
  const attribution = deriveAttribution(landing._raw.pageUrl || landing.page.url, landing._raw.referrer || landing.page.referrer, website.domain);
  const deviceFull = { ...device, screen: ctx.sw ? `${ctx.sw}x${ctx.sh || 0}` : null, viewport: ctx.vw ? `${ctx.vw}x${ctx.vh || 0}` : null };

  // ── Visitor ──
  const vRes = await col('visitors').updateOne(
    { websiteId: wid, visitorId: ctx.vid },
    {
      $setOnInsert: { websiteId: wid, visitorId: ctx.vid, first: { channel: attribution.channel, source: attribution.source, referrerHost: attribution.referrerHost, utm: attribution.utm, landingPath: landing.page.path } },
      $min: { firstSeen: first.ts },
      $max: { lastSeen: last.ts },
      $set: { last: { device: deviceFull, geo, path: (pageViews.at(-1) || last).page.path, lang: ctx.lang || null, tz: ctx.tz || null }, expireAt, cookieless: Boolean(ctx.cookieless) },
      $inc: { 'counts.events': fresh.length, 'counts.pageviews': pageViews.length, 'counts.searches': searches.length },
    },
    { upsert: true },
  );
  const newVisitor = vRes.upsertedCount === 1;

  // ── Session ──
  const sRes = await col('sessions').updateOne(
    { websiteId: wid, sessionId: ctx.sid },
    {
      $setOnInsert: {
        websiteId: wid, sessionId: ctx.sid, visitorId: ctx.vid, entryPath: landing.page.path, entryTitle: landing.page.title,
        ...attribution, device: deviceFull, geo, lang: ctx.lang || null, tz: ctx.tz || null, isNew: newVisitor || Boolean(byName('session_start')[0]?.props?.isNew), converted: false,
      },
      $min: { startedAt: first.ts },
      $max: { lastSeenAt: last.ts },
      $inc: { pageviews: pageViews.length, events: fresh.length, activeMs, searches: searches.length },
      $set: { expireAt, ...(pageViews.length ? { exitPath: pageViews.at(-1).page.path } : {}) },
    },
    { upsert: true },
  );
  const newSession = sRes.upsertedCount === 1;
  const sessionWrites = [];
  if (newSession) {
    sessionWrites.push(col('visitors').updateOne({ websiteId: wid, visitorId: ctx.vid }, { $inc: { 'counts.sessions': 1 } }));
    if (attribution.utm.campaign || attribution.utm.source) {
      sessionWrites.push(col('campaigns').updateOne(
        { websiteId: wid, source: attribution.utm.source || attribution.source, medium: attribution.utm.medium || null, campaign: attribution.utm.campaign || null },
        { $setOnInsert: { firstSeen: first.ts }, $max: { lastSeen: last.ts }, $inc: { sessions: 1 } },
        { upsert: true },
      ));
    }
  }

  // ── Page views + engagement ──
  // Page views must exist before page_leave updates in the same batch are applied (no race).
  if (pageViews.length) {
    await (col('pageViews').insertMany(pageViews.map((e) => ({
      websiteId: wid, pageviewId: e.eventId, ts: e.ts, sessionId: ctx.sid, visitorId: ctx.vid, path: e.page.path, title: e.page.title,
      referrer: e.page.referrer, engagedMs: 0, maxScroll: 0, nav: e.props.nav || 'load', expireAt,
    })), { ordered: false }).catch((err) => { if (err.code !== 11000) throw err; }));
  }
  for (const e of leaves) {
    if (!e.props.pvid) continue;
    sessionWrites.push(col('pageViews').updateOne(
      { websiteId: wid, pageviewId: String(e.props.pvid) },
      { $max: { engagedMs: Math.min(Number(e.props.engaged) || 0, 6 * 3600_000), maxScroll: Math.min(Number(e.props.scroll) || 0, 100) } },
    ));
  }

  // ── Searches ──
  if (searches.length) {
    sessionWrites.push(col('searches').insertMany(searches.filter((e) => e.props.query).map((e) => ({
      websiteId: wid, ts: e.ts, visitorId: ctx.vid, sessionId: ctx.sid, path: e.page.path,
      query: String(e.props.query).slice(0, LIMITS.MAX_SEARCH_QUERY), normalized: normalizeQuery(e.props.query),
      category: e.props.category ? String(e.props.category).slice(0, 80) : null, filters: e.props.filters || null,
      resultsCount: Number.isFinite(e.props.results) ? e.props.results : null, auto: Boolean(e.props.auto), expireAt,
    }))));
  }

  // ── Forms ──
  const formEvents = fresh.filter((e) => e.name.startsWith('form_') && e.props.form);
  if (formEvents.length) {
    const inc = new Map();
    for (const e of formEvents) {
      const key = String(e.props.form).slice(0, 120);
      const cur = inc.get(key) || { name: e.props.formName || key, path: e.page.path, views: 0, starts: 0, submits: 0, errors: 0 };
      const field = { form_view: 'views', form_start: 'starts', form_submit: 'submits', form_error: 'errors' }[e.name];
      if (field) cur[field] += 1;
      inc.set(key, cur);
    }
    sessionWrites.push(col('forms').bulkWrite([...inc].map(([formKey, c]) => ({
      updateOne: {
        filter: { websiteId: wid, formKey },
        update: { $setOnInsert: { websiteId: wid, formKey, firstSeen: first.ts }, $set: { name: String(c.name).slice(0, 120), path: c.path, lastSeen: last.ts }, $inc: { 'counts.views': c.views, 'counts.starts': c.starts, 'counts.submits': c.submits, 'counts.errors': c.errors } },
        upsert: true,
      },
    })), { ordered: false }));
  }

  // ── Heatmap points (opt-in per website) ──
  if (settings.heatmaps) {
    const pts = fresh.filter((e) => ['click', 'rage_click', 'dead_click'].includes(e.name) && Number.isFinite(e.props.x) && Number.isFinite(e.props.y));
    if (pts.length) {
      sessionWrites.push(col('heatmapPoints').insertMany(pts.map((e) => ({
        websiteId: wid, path: e.page.path, ts: e.ts, kind: e.name === 'click' ? 'click' : e.name === 'rage_click' ? 'rage' : 'dead',
        x: Math.max(0, Math.min(1000, Math.round(e.props.x))), y: Math.max(0, Math.min(100_000, Math.round(e.props.y))),
        vw: ctx.vw ? (ctx.vw < 768 ? 'mobile' : ctx.vw < 1100 ? 'tablet' : 'desktop') : device.type, sel: e.props.sel ? String(e.props.sel).slice(0, 200) : null, expireAt,
      }))));
    }
  }

  // ── Identity (explicit identify() on sites that enabled it) ──
  if (settings.identify) {
    const idEv = byName('identify').find((e) => e._raw.customerId);
    if (idEv) {
      const ext = String(idEv._raw.customerId).slice(0, 200);
      const traits = filterLeadFields(idEv._raw.traits || {}, ['name', 'email', 'phone', 'plan', 'company', 'city', 'segment']);
      const r = await col('identities').findOneAndUpdate(
        { orgId: website.orgId, externalHash: lookupHash(ext) },
        {
          $setOnInsert: { orgId: website.orgId, externalHash: lookupHash(ext), externalEnc: encrypt(ext), createdAt: new Date() },
          $set: { lastSeen: idEv.ts, ...(Object.keys(traits).length ? { traitsEnc: encryptJson(traits) } : {}) },
          $addToSet: { links: { websiteId: wid, visitorId: ctx.vid } },
        },
        { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
      );
      const identityId = r?._id || r?.value?._id;
      if (identityId) sessionWrites.push(col('visitors').updateOne({ websiteId: wid, visitorId: ctx.vid }, { $set: { identityId } }));
    }
  }
  await Promise.all(sessionWrites);

  // ── Leads & conversions ──
  const conversions = [];
  let converted = false;
  if (settings.leadCapture) {
    for (const e of fresh.filter((x) => (x.name === 'form_submit' || x.name === 'lead') && x._raw.fields)) {
      const fields = filterLeadFields(e._raw.fields, settings.leadFields);
      if (!Object.keys(fields).length) continue;
      const { lead } = await createLead({ website, event: e, fields, formKey: e.props.form || null });
      await col('formSubmissions').insertOne({ websiteId: wid, formKey: e.props.form || null, ts: e.ts, visitorId: ctx.vid, sessionId: ctx.sid, path: e.page.path, fieldNames: Object.keys(fields), fieldsEnc: encryptJson(fields), leadId: lead?._id || null, duplicate: !lead, expireAt });
      if (!lead) continue;
      converted = true;
      conversions.push({ goal: 'lead', value: 0, e });
      await col('visitors').updateOne({ websiteId: wid, visitorId: ctx.vid }, { $inc: { 'counts.leads': 1 } });
      publish(wid, { ...feedItem(e, website), name: 'lead', label: 'Lead submitted', detail: lead.city || lead.attribution.source }).catch(() => {});
      onLead(website, lead);
    }
  }
  for (const e of byName('conversion')) conversions.push({ goal: String(e.props.goal || 'conversion').slice(0, 80), value: Number(e.props.value) || 0, currency: e.props.currency || null, e });
  const goals = await goalsFor(wid);
  for (const g of goals) {
    for (const e of fresh) {
      const hit = g.type === 'event' ? e.name === g.match : g.type === 'path' && e.name === 'page_view' && g.re.test(e.page.path);
      if (hit) conversions.push({ goal: g.name, value: Number(g.value) || 0, currency: g.currency || null, e });
    }
  }
  if (conversions.length) {
    converted = true;
    await col('conversions').insertMany(conversions.map((c) => ({ websiteId: wid, ts: c.e.ts, visitorId: ctx.vid, sessionId: ctx.sid, goal: c.goal, value: c.value, currency: c.currency || null, path: c.e.page.path, eventId: c.e.eventId, expireAt })));
    await col('visitors').updateOne({ websiteId: wid, visitorId: ctx.vid }, { $inc: { 'counts.conversions': conversions.length } });
    conversions.forEach((c) => onConversion(website, { goal: c.goal, value: c.value, currency: c.currency }));
  }

  // Derived session fields (duration, bounce) recomputed from stored values.
  await col('sessions').updateOne({ websiteId: wid, sessionId: ctx.sid }, [{
    $set: {
      converted: converted ? true : { $ifNull: ['$converted', false] },
      durationMs: { $max: [0, { $subtract: ['$lastSeenAt', '$startedAt'] }] },
    },
  }, {
    $set: { bounced: { $and: [{ $lte: ['$pageviews', 1] }, { $lt: ['$activeMs', 10_000] }, { $not: ['$converted'] }] } },
  }]);

  // ── Website heartbeat (throttled) + realtime ──
  const k = String(wid);
  if (!lastEventTouch.get(k) || now - lastEventTouch.get(k) > 10_000) {
    lastEventTouch.set(k, now);
    col('websites').updateOne({ _id: wid }, { $max: { lastEventAt: last.ts } }).catch(() => {});
  }
  const action = [...fresh].reverse().map(presenceAction).find(Boolean);
  const lastPv = pageViews.at(-1);
  touchPresence(wid, ctx.vid, {
    sessionId: ctx.sid, path: (lastPv || last).page.path, title: (lastPv || last).page.title, action: action || `Viewing ${last.page.path}`,
    device: device.type, browser: device.browser, geo, channel: newSession ? attribution.channel : undefined, site: website.code,
  }).catch((err) => logger.warn({ err: err.message }, 'presence update failed'));
  const feed = fresh.filter((e) => !NOISY_EVENTS.includes(e.name) && e.name !== 'click' && e.name !== 'session_start').slice(-MAX_FEED_ITEMS_PER_BATCH);
  if (newSession) feed.unshift({ ...first, name: 'session_start', props: {} });
  for (const e of feed) {
    const item = feedItem(e, website);
    if (e.name === 'session_start') { item.label = newVisitor ? 'New visitor' : 'Returning visitor'; item.detail = attribution.source; }
    publish(wid, item).catch(() => {});
  }

  return { accepted: fresh.length, duplicates, dropped };
}

/** Scrub free text for error messages before they are stored (exported for tests). */
export const scrub = (s) => redactText(s);
