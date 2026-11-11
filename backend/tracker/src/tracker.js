import { cleanUrl, isSensitiveKey } from '@rmw-analytics/shared/privacy';
import { now, eventId, store, clip, hash, NAME_RE, pathMatch, safe } from './core/util.js';
import { createIds } from './core/ids.js';
import { createTransport } from './core/transport.js';
import { createQueue } from './core/queue.js';
import { createConsent, privacySignal } from './core/consent.js';
import { installPageviews, pathKey } from './auto/pageviews.js';
import { installEngagement } from './auto/engagement.js';
import { installClicks } from './auto/clicks.js';
import { installSearch } from './auto/search.js';
import { installForms } from './auto/forms.js';
import { installMedia } from './auto/media.js';
import { installErrors } from './auto/errors.js';

const FLUSH_MS = 5000;
const FLUSH_AT = 20;
const CONFIG_TIMEOUT_MS = 1500;
const URGENT = { form_submit: 1, lead: 1, conversion: 1 };

/** Keep only JSON-safe, bounded, non-sensitive property values. */
function cleanProps(props, depth) {
  if (!props || typeof props !== 'object') return undefined;
  const out = {};
  let n = 0;
  for (const k in props) {
    if (n >= 30 || (isSensitiveKey(k) && (depth || !/^(fields|traits|customerId)$/.test(k)))) continue;
    const v = props[k];
    let c;
    if (typeof v === 'string') c = v.slice(0, 2000);
    else if (typeof v === 'number') c = isFinite(v) ? v : undefined;
    else if (typeof v === 'boolean' || v === null) c = v;
    else if (Array.isArray(v)) c = v.slice(0, 50).filter((x) => x != null && typeof x !== 'object').map((x) => (typeof x === 'string' ? x.slice(0, 500) : x));
    else if (typeof v === 'object' && depth === 0) c = cleanProps(v, 1);
    if (c !== undefined) { out[k.slice(0, 64)] = c; n++; }
  }
  return out;
}

/**
 * Create a tracker bound to a window.
 * opts: { siteId, api, sampleRate?, cookieless?, consent?: 'none'|'opt-in'|'opt-out', disable?: string[],
 *         searchParams?: string[], debug?: boolean, navDelay?: number }
 * Returns the public API object.
 */
export function createTracker(win, opts) {
  const doc = win.document;
  const ls = store(win, 'localStorage');
  const consentStore = createConsent(ls);
  const cfg = {
    consentMode: opts.consent || 'none', respectDnt: true, cookieless: Boolean(opts.cookieless), heatmaps: false,
    sampleRate: opts.sampleRate == null ? 1 : opts.sampleRate, autoSearch: true, autoForms: true, trackErrors: true,
    trackMedia: true, excludePaths: [], searchParams: [], leadCapture: false, leadFields: [], identify: false,
    replay: false, replaySampleRate: 1, replayMaskText: false,
  };
  const disabled = {};
  (opts.disable || []).forEach((d) => { disabled[String(d).replace(/^no-/, '')] = true; });
  const ids = createIds(win);
  let debug = Boolean(opts.debug);
  let ready = false;
  let enabled = !consentStore.optedOut();
  let consent = 'unknown';
  let blocked = false; // DNT / GPC / not sampled: nothing re-enables tracking on this page
  const listeners = {};
  const whenReady = [];
  const log = (...a) => { if (debug && win.console) win.console.log('[analytics]', ...a); };

  const consentAllows = () => cfg.consentMode !== 'opt-in' || consent === 'granted';
  const endpoint = `${opts.api.replace(/\/$/, '')}/api/v1/events`;
  const queue = createQueue({
    win,
    siteId: opts.siteId,
    send: createTransport(win, endpoint),
    canSend: () => ready && enabled && consentAllows(),
    keep: (e) => !(cfg.excludePaths || []).some((p) => pathMatch((e.p && e.p.pa) || '/', p)),
    offlineStore: () => (cfg.cookieless || ids.mode !== 'local' ? null : ls),
    log,
    ctxFor: (v, s) => {
      const sc = win.screen || {};
      let tz;
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { tz = undefined; }
      const px = (n) => Math.max(0, Math.min(20000, Math.round(n || 0)));
      const ctx = { vid: v, sid: s, lang: clip(win.navigator.language || '', 35), sw: px(sc.width), sh: px(sc.height), vw: px(win.innerWidth), vh: px(win.innerHeight), online: win.navigator.onLine !== false, consent: cfg.consentMode === 'none' ? 'unknown' : consent, cookieless: ids.mode !== 'local' };
      if (tz) ctx.tz = clip(tz, 64);
      return ctx;
    },
  });

  // ─── internal context shared with auto modules ───
  const t = {
    win, cfg, disabled, timers: [], navDelay: opts.navDelay == null ? 50 : opts.navDelay, extraSearchParams: opts.searchParams || [],
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: (ev, arg) => { (listeners[ev] || []).forEach((fn) => { try { fn(arg); } catch (e) { /* isolate */ } }); },
  };

  function page(o) {
    const p = { pa: clip(o.pa || pathKey(win.location), 2000), ti: clip(doc.title || '', 300) };
    if (o.full) {
      p.u = clip(cleanUrl(win.location.href), 2000);
      const r = o.ref == null ? doc.referrer : o.ref;
      if (r) p.r = clip(cleanUrl(r), 2000);
    }
    return p;
  }

  /** Enqueue an event; returns its id. o: { full, ref, pa, urgent, beacon } */
  t.track = (name, props, o) => {
    o = o || {};
    if (!enabled || !NAME_RE.test(name)) return null;
    const ts = now();
    const s = ids.touch(ts);
    if (s.isNew) {
      // One batch = one session: send whatever belongs to the previous session first.
      if (queue.sessions().some((sid) => sid !== s.sid)) queue.flush(false);
      queue.add({ v: ids.vid, s: s.sid, e: { id: eventId(ts), n: 'session_start', t: ts, p: page({ full: true }), pr: { isNew: ids.consumeVisitorNew() } } });
    }
    const ev = { id: eventId(ts), n: String(name).toLowerCase(), t: ts, p: page(o) };
    const pr = cleanProps(props, 0);
    if (pr && Object.keys(pr).length) ev.pr = pr;
    queue.add({ v: ids.vid, s: s.sid, e: ev });
    log(ev.n, ev);
    if (o.urgent || URGENT[ev.n] || queue.size >= FLUSH_AT) queue.flush(Boolean(o.beacon));
    return ev.id;
  };

  installEngagement(t);
  installPageviews(t);
  if (!disabled.clicks || !disabled.heatmaps) installClicks(t);
  installSearch(t);
  installForms(t);
  installMedia(t);
  installErrors(t);

  // ─── lifecycle ───
  const unload = safe(() => { t.leave(false); queue.flush(true); });
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') unload(); });
  win.addEventListener('pagehide', unload);
  win.addEventListener('online', () => { queue.drainOffline(); queue.flush(false); });
  t.timers.push(win.setInterval(() => queue.flush(false), FLUSH_MS));

  // ─── session recording: replay.js is fetched only when the site enables it ───
  let replayOn = false;
  const R = () => win.__rmwaReplay;
  const stopReplay = () => { replayOn = false; if (R()) R().stop(); };
  const startReplay = safe(() => {
    if (replayOn || !cfg.replay || !enabled || !consentAllows() || hash(ids.vid + 'r') % 1e4 >= cfg.replaySampleRate * 1e4) return;
    replayOn = true;
    const go = () => replayOn && R() && R().start({ api: opts.api, siteId: opts.siteId, maskText: cfg.replayMaskText, getIds: () => ({ vid: ids.vid, sid: ids.sid }) });
    if (R()) return go();
    const sc = doc.createElement('script');
    sc.src = opts.api.replace(/\/$/, '') + '/replay.js';
    sc.onload = go;
    doc.head.appendChild(sc);
  });

  const disable = () => { enabled = false; queue.clear(); stopReplay(); };
  const block = () => { blocked = true; disable(); };

  const applyConfig = (remote) => {
    if (remote && typeof remote === 'object') {
      for (const k in remote) if (Object.prototype.hasOwnProperty.call(cfg, k) && remote[k] != null) cfg[k] = remote[k];
      // Stricter of page attribute and site setting wins.
      if (opts.cookieless) cfg.cookieless = true;
      if (opts.consent === 'opt-in') cfg.consentMode = 'opt-in';
      else if (opts.consent && cfg.consentMode === 'none') cfg.consentMode = opts.consent;
      if (opts.sampleRate != null) cfg.sampleRate = Math.min(cfg.sampleRate, opts.sampleRate);
    }
  };

  const persistMode = () => (cfg.cookieless ? 'session' : consentAllows() && consent !== 'denied' ? 'local' : 'memory');

  const becomeReady = safe(() => {
    if (ready) { ids.setMode(enabled ? persistMode() : 'memory'); startReplay(); return; }
    ready = true;
    if (cfg.respectDnt && privacySignal(win)) { block(); }
    if (enabled && cfg.sampleRate < 1 && hash(ids.vid) % 10000 >= cfg.sampleRate * 10000) { block(); }
    const stored = consentStore.stored();
    if (cfg.consentMode === 'opt-in') consent = stored === 'granted' ? 'granted' : stored === 'denied' ? 'denied' : 'unknown';
    else if (cfg.consentMode === 'opt-out') consent = stored === 'denied' ? 'denied' : 'granted';
    if (consent === 'denied') disable();
    ids.setMode(enabled ? persistMode() : 'memory');
    whenReady.splice(0).forEach((fn) => fn());
    if (enabled) { queue.drainOffline(); queue.flush(false); startReplay(); }
  });

  const configUrl = `${opts.api.replace(/\/$/, '')}/api/v1/sites/${encodeURIComponent(opts.siteId)}/config`;
  const configP = win.fetch
    ? win.fetch(configUrl, { credentials: 'omit' }).then((r) => (r && r.ok ? r.json() : null)).then((j) => j && j.data).catch(() => null)
    : Promise.resolve(null);
  const ready$ = new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; becomeReady(); resolve(); } };
    win.setTimeout(finish, CONFIG_TIMEOUT_MS);
    configP.then((remote) => {
      applyConfig(remote);
      if (done) becomeReady(); // late config: re-apply storage mode
      finish();
    });
  });

  const afterReady = (fn) => (ready ? fn() : whenReady.push(fn));

  // ─── public API ───
  const api = {
    track: safe((name, props) => t.track(name, props, URGENT[name] ? { urgent: true } : undefined)),
    page: safe((props) => t.view('manual', props)),
    trackSearch: safe((q, o) => t.trackSearch(q, Object.assign({}, o, { auto: false }))),
    trackForm: safe((form, o) => t.trackForm(form, o)),
    trackLead: safe((fields, props) => afterReady(() => {
      if (!cfg.leadCapture) return;
      // Sensitive keys are dropped here; the API additionally enforces the site's leadFields allowlist.
      const clean = {};
      for (const k in fields || {}) if (!isSensitiveKey(k) && fields[k] != null && typeof fields[k] !== 'object') clean[k] = String(fields[k]).slice(0, 2000);
      t.track('lead', Object.assign({}, props, { fields: clean }), { urgent: true });
    })),
    identify: safe((o) => afterReady(() => {
      if (!cfg.identify || !o || o.customerId == null) return;
      t.track('identify', { customerId: String(o.customerId).slice(0, 200), traits: o.traits || {} }, { urgent: true });
    })),
    consent: safe((state) => {
      if (state !== 'granted' && state !== 'denied') return;
      consent = state;
      consentStore.save(state);
      if (state === 'denied') { queue.clear(); ids.setMode('memory'); stopReplay(); return; }
      enabled = !blocked && !consentStore.optedOut();
      if (ready) { ids.setMode(persistMode()); queue.flush(false); startReplay(); }
    }),
    optOut: safe(() => { consentStore.setOptOut(true); disable(); ids.setMode('memory'); }), // disable() also stops recording
    optIn: safe(() => { consentStore.setOptOut(false); enabled = !blocked; if (ready) { ids.setMode(persistMode()); startReplay(); } }),
    reset: safe(() => { queue.flush(false); ids.reset(); }),
    getVisitorId: () => ids.vid,
    getSessionId: () => ids.sid,
    debug: (on) => { debug = on !== false; },
    flush: () => queue.flush(false),
    ready: () => ready$,
    destroy: () => { t.timers.forEach((x) => win.clearInterval(x)); enabled = false; },
  };

  // First page view (queued until config is known).
  t.view('load');
  return api;
}

/** Read the <script> tag, start the tracker and expose window.rmwAnalytics (+ window.analytics when free). */
export function boot(win) {
  if (win.__rmwa) return win.__rmwa;
  const doc = win.document;
  const script = doc.currentScript || doc.querySelector('script[data-site-id]');
  if (!script) return null;
  const attr = (n) => script.getAttribute(n);
  const siteId = attr('data-site-id');
  if (!siteId) return null;
  let api = attr('data-api');
  if (!api) { try { api = new URL(script.src, win.location.href).origin; } catch (e) { return null; } }
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rate = parseFloat(attr('data-sample-rate'));
  const tracker = createTracker(win, {
    siteId,
    api,
    sampleRate: rate > 0 && rate <= 1 ? rate : undefined,
    cookieless: attr('data-cookieless') === 'true' || attr('data-cookieless') === '',
    consent: attr('data-consent') || undefined,
    disable: list(attr('data-auto')).filter((s) => s.indexOf('no-') === 0),
    searchParams: list(attr('data-search-params')),
    debug: attr('data-debug') === 'true',
  });
  win.__rmwa = tracker;
  const stub = win.analytics;
  const queued = stub && Array.isArray(stub.q) ? stub.q : Array.isArray(stub) ? stub : [];
  win.rmwAnalytics = tracker;
  // Don't clobber another library's `window.analytics` (e.g. Segment); our pre-load stub is { q: [] }.
  if (!stub || Array.isArray(stub) || Array.isArray(stub.q)) win.analytics = tracker;
  queued.forEach((call) => {
    try {
      const [m, args] = Array.isArray(call) ? [call[0], Array.isArray(call[1]) ? call[1] : call.slice(1)] : [];
      if (typeof tracker[m] === 'function') tracker[m](...args);
    } catch (e) { /* ignore bad stub entries */ }
  });
  return tracker;
}
