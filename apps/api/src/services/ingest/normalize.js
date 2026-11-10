import { LIMITS, redactText, cleanUrl, isSensitiveKey, classifyChannel, referrerHost, sourceName } from '@rmw-analytics/shared';

const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'];
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'];
/** Props whose free-text values are kept verbatim (already structural / non-personal). */
const STRUCTURAL_PROPS = new Set(['sel', 'tag', 'href', 'ext', 'domain', 'form', 'formName', 'field', 'pvid', 'src', 'goal', 'currency', 'category', 'nav']);

const clip = (v, n) => (v == null ? v : String(v).slice(0, n));

function cleanScalar(key, v) {
  if (typeof v === 'string') {
    const s = v.slice(0, LIMITS.MAX_PROP_STRING);
    return STRUCTURAL_PROPS.has(key) ? s : redactText(s);
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v === null) return v;
  return undefined;
}

/**
 * Sanitize custom properties: drop sensitive keys, cap counts/lengths, scrub PII-looking text.
 * `fields` (lead capture payload) and identify traits are handled separately and never stored here.
 */
export function sanitizeProps(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= LIMITS.MAX_PROPS) break;
    if (k === 'fields' || k === 'traits' || isSensitiveKey(k)) continue;
    const key = k.slice(0, LIMITS.MAX_PROP_KEY);
    if (Array.isArray(v)) {
      out[key] = v.slice(0, 50).map((x) => cleanScalar(key, x)).filter((x) => x !== undefined);
    } else if (v && typeof v === 'object') {
      const inner = {};
      for (const [ik, iv] of Object.entries(v).slice(0, LIMITS.MAX_PROPS)) {
        if (isSensitiveKey(ik)) continue;
        const c = Array.isArray(iv) ? iv.slice(0, 50).map((x) => cleanScalar(ik, x)) : cleanScalar(ik, iv);
        if (c !== undefined) inner[ik.slice(0, LIMITS.MAX_PROP_KEY)] = c;
      }
      out[key] = inner;
    } else {
      const c = cleanScalar(key, v);
      if (c !== undefined) out[key] = c;
    }
    n += 1;
  }
  return out;
}

export function parseUrl(u) {
  try { return new URL(u); } catch { return null; }
}

/** Normalise a path: strip trailing slash (except root), collapse duplicate slashes, cap length. */
export function normalizePath(p) {
  if (!p) return '/';
  let s = String(p).split('#')[0].split('?')[0].replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return (s.startsWith('/') ? s : `/${s}`).slice(0, 500);
}

/** Session attribution from the landing URL + referrer. */
export function deriveAttribution(pageUrl, referrer, domain) {
  const u = parseUrl(pageUrl);
  const utm = {};
  const clickIds = [];
  if (u) {
    for (const k of UTM_KEYS) {
      const v = u.searchParams.get(`utm_${k}`);
      if (v) utm[k] = clip(redactText(v), 150);
    }
    for (const k of CLICK_ID_PARAMS) if (u.searchParams.has(k)) clickIds.push(k);
  }
  const refHost = referrerHost(referrer);
  let channel = classifyChannel({ referrer, utm, host: domain, clickIds });
  // A session that "starts" from an internal referrer (e.g. after a 30-min idle) is treated as direct.
  const internal = channel === 'internal';
  if (internal) channel = 'direct';
  return {
    referrer: internal ? null : clip(cleanUrl(referrer), LIMITS.MAX_URL) || null,
    referrerHost: internal ? null : refHost,
    channel,
    source: sourceName(internal ? null : refHost, utm.source),
    utm,
    clickIds,
  };
}

/**
 * Convert a validated wire event into the stored document.
 * Returns null for events outside the accepted time window.
 */
export function toStoredEvent(e, { website, ctx, device, geo, now, offsetMs, expireAt }) {
  const ts = e.t + offsetMs;
  if (ts < now - LIMITS.PAST_TOLERANCE_MS || ts > now + LIMITS.FUTURE_TOLERANCE_MS) return null;
  const url = e.p?.u ? clip(cleanUrl(e.p.u), LIMITS.MAX_URL) : null;
  const parsed = url ? parseUrl(url) : null;
  return {
    websiteId: website._id,
    eventId: e.id,
    visitorId: ctx.vid,
    sessionId: ctx.sid,
    name: e.n.toLowerCase(),
    ts: new Date(ts),
    receivedAt: new Date(now),
    page: {
      url,
      path: normalizePath(e.p?.pa || parsed?.pathname || '/'),
      title: clip(e.p?.ti, LIMITS.MAX_TITLE) || null,
      referrer: e.p?.r ? clip(cleanUrl(e.p.r), LIMITS.MAX_URL) : null,
    },
    device: { type: device.type, browser: device.browser, os: device.os },
    geo,
    props: sanitizeProps(e.pr),
    expireAt,
    // Raw (unsanitised) values that some processors need; stripped before the event is written.
    _raw: { fields: e.pr?.fields, traits: e.pr?.traits, customerId: e.pr?.customerId, pageUrl: e.p?.u, referrer: e.p?.r },
  };
}

export const stripRaw = ({ _raw, ...doc }) => doc;
