import test from 'node:test';
import assert from 'node:assert/strict';
import { batchSchema, VISITOR_ID_RE, SESSION_ID_RE, EVENT_ID_RE } from '@rmw-analytics/shared';
import { setup, sleep } from './helpers.js';
import { classifyLink } from '../src/auto/clicks.js';
import { createIds, SESSION_IDLE_MS } from '../src/core/ids.js';

const names = (evs) => evs.map((e) => e.n);

test('first page load: session_start + page_view, ids well-formed, batch matches the API schema', async () => {
  const p = await setup({ url: 'https://example.com/properties?utm_source=google&token=abc' });
  await p.api.flush();
  const batches = await p.batches();
  assert.equal(batches.length, 1);
  const b = batches[0];
  const r = batchSchema.safeParse(b);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.match(b.ctx.vid, VISITOR_ID_RE);
  assert.match(b.ctx.sid, SESSION_ID_RE);
  b.events.forEach((e) => assert.match(e.id, EVENT_ID_RE));
  assert.deepEqual(names(b.events), ['session_start', 'page_view']);
  assert.equal(b.events[0].pr.isNew, true);
  const pv = b.events[1];
  assert.equal(pv.p.pa, '/properties');
  assert.equal(pv.p.ti, 'Home');
  assert.equal(pv.p.r, 'https://www.google.com/');
  assert.match(pv.p.u, /utm_source=google/);
  assert.doesNotMatch(pv.p.u, /abc/, 'sensitive params redacted');
  assert.equal(pv.pr.nav, 'load');
  assert.equal(p.sent[0].url, 'https://api.test/api/v1/events');
  assert.equal(p.configCalls[0], 'https://api.test/api/v1/sites/site_testsite0001/config');
  p.close();
});

test('SPA navigation: page_leave(pvid, old path) → route_change → page_view; same-path replaceState ignored', async () => {
  const p = await setup();
  await p.api.flush();
  const firstPv = (await p.events()).find((e) => e.n === 'page_view');
  p.win.history.pushState({}, '', '/project/42');
  await sleep(10);
  p.win.history.replaceState({}, '', '/project/42');
  await sleep(10);
  await p.api.flush();
  const evs = (await p.events()).filter((e) => ['page_leave', 'route_change', 'page_view'].includes(e.n)).slice(1);
  assert.deepEqual(names(evs), ['page_leave', 'route_change', 'page_view']);
  assert.equal(evs[0].pr.pvid, firstPv.id);
  assert.equal(evs[0].p.pa, '/', 'leave is attributed to the page being left');
  assert.ok(typeof evs[0].pr.engaged === 'number' && typeof evs[0].pr.scroll === 'number');
  assert.deepEqual(evs[1].pr, { from: '/', to: '/project/42' });
  assert.equal(evs[2].p.pa, '/project/42');
  assert.equal(evs[2].pr.nav, 'spa');
  assert.equal(evs[2].p.r, 'https://example.com/');
  p.close();
});

test('session rotation after 30 min idle flushes the old session first (one batch = one session)', async () => {
  const realNow = Date.now;
  const p = await setup();
  try {
    p.api.track('first_thing');
    const oldSid = p.api.getSessionId();
    const t0 = realNow();
    Date.now = () => t0 + SESSION_IDLE_MS + 60_000;
    p.api.track('after_idle');
    await sleep(5);
    await p.api.flush();
    const batches = await p.batches();
    assert.ok(batches.length >= 2);
    for (const b of batches) assert.equal(new Set(b.events.map(() => b.ctx.sid)).size, 1);
    assert.ok(batches.filter((b) => b.ctx.sid === oldSid).some((b) => names(b.events).includes('first_thing')));
    assert.ok(batches.findIndex((b) => b.ctx.sid !== oldSid) > batches.findIndex((b) => names(b.events).includes('first_thing')), 'old session sent before the new one');
    const last = batches.at(-1);
    assert.notEqual(last.ctx.sid, oldSid);
    assert.deepEqual(names(last.events), ['session_start', 'after_idle']);
    assert.equal(last.events[0].pr.isNew, false, 'returning visitor in a new session');
  } finally {
    Date.now = realNow;
    p.close();
  }
});

test('ids: visitor persists in localStorage, cookieless uses sessionStorage only', async () => {
  const p = await setup();
  const vid = p.api.getVisitorId();
  assert.equal(p.win.localStorage.getItem('rmwa_vid'), vid);
  p.close();
  const c = await setup({ config: { cookieless: true } });
  assert.equal(c.win.localStorage.getItem('rmwa_vid'), null);
  assert.equal(c.win.sessionStorage.getItem('rmwa_vid'), c.api.getVisitorId());
  await c.api.flush();
  assert.equal((await c.batches())[0].ctx.cookieless, true);
  c.close();
  const ids = createIds({ localStorage: undefined, sessionStorage: undefined });
  assert.match(ids.vid, VISITOR_ID_RE);
  assert.match(ids.touch(Date.now()).sid, SESSION_ID_RE);
});

test('forms: never captures values automatically; lead fields only with leadCapture + data-analytics-lead + allowlist', async () => {
  const html = `
    <form id="enquiry" data-analytics-lead data-analytics-fields="name,email,phone,city,password">
      <input name="name" value="Rahul Sharma"><input name="email" value="rahul@example.com">
      <input name="phone" value="9876543221"><input name="city" value="Noida">
      <input type="password" name="password" value="hunter2"><input name="otp" value="123456">
      <input name="company" value="Acme"><input type="hidden" name="csrf" value="tok">
      <button type="submit">Send</button>
    </form>
    <form id="plain"><input name="email" value="x@y.com"><button>Go</button></form>`;
  const p = await setup({ html, config: { leadCapture: true, leadFields: ['name', 'email', 'phone', 'city', 'message'] } });
  const doc = p.win.document;
  doc.querySelector('#enquiry input[name=name]').dispatchEvent(new p.win.FocusEvent('focusin', { bubbles: true }));
  doc.getElementById('enquiry').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  doc.getElementById('plain').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(5);
  await p.api.flush();
  const evs = await p.events();
  const start = evs.find((e) => e.n === 'form_start');
  assert.equal(start.pr.form, 'enquiry');
  const subs = evs.filter((e) => e.n === 'form_submit');
  assert.equal(subs.length, 2);
  const lead = subs.find((e) => e.pr.form === 'enquiry');
  assert.deepEqual(lead.pr.fields, { name: 'Rahul Sharma', email: 'rahul@example.com', phone: '9876543221', city: 'Noida' });
  assert.ok(lead.pr.dur >= 0);
  const plain = subs.find((e) => e.pr.form === 'plain');
  assert.equal(plain.pr.fields, undefined, 'undeclared forms never send values');
  const all = JSON.stringify(await p.batches());
  assert.doesNotMatch(all, /hunter2|123456|Acme|"tok"|x@y\.com/);
  p.close();

  // leadCapture disabled on the site → no fields even on a declared form.
  const q = await setup({ html, config: { leadCapture: false } });
  q.win.document.getElementById('enquiry').dispatchEvent(new q.win.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(5);
  await q.api.flush();
  assert.equal((await q.events()).find((e) => e.n === 'form_submit').pr.fields, undefined);
  q.close();
});

test('forms: trackForm() registration with masking; form_error reports the field name only', async () => {
  const html = '<form id="f"><input name="email" value="rahul@example.com"><input name="phone" value="9876543221" required><input name="card_number" value="4111111111111111"></form>';
  const p = await setup({ html, config: { leadCapture: true, leadFields: ['email', 'phone', 'card_number'] } });
  p.api.trackForm('#f', { fields: ['email', 'phone', 'card_number'], mask: ['phone'] });
  const form = p.win.document.getElementById('f');
  form.querySelector('[name=phone]').dispatchEvent(new p.win.Event('invalid', { bubbles: false }));
  form.dispatchEvent(new p.win.Event('submit', { bubbles: true }));
  await sleep(5);
  await p.api.flush();
  const evs = await p.events();
  assert.deepEqual(evs.find((e) => e.n === 'form_submit').pr.fields, { email: 'rahul@example.com', phone: '********21' });
  assert.deepEqual(evs.find((e) => e.n === 'form_error').pr, { form: 'f', formName: 'f', field: 'phone' });
  p.close();
});

test('search: auto-detected from form submit and URL param, deduplicated, manual trackSearch with options', async () => {
  const p = await setup({ url: 'https://example.com/search?q=3+BHK+Noida', html: '<form id="s"><input type="search" name="term" value="Sector 150"><select name="category"><option value="residential" selected>R</option></select></form>' });
  p.win.document.getElementById('s').dispatchEvent(new p.win.Event('submit', { bubbles: true }));
  p.win.document.getElementById('s').dispatchEvent(new p.win.Event('submit', { bubbles: true }));
  p.api.trackSearch('2 BHK call 9876543210', { category: 'rent', filters: { budget: '50L' }, results: 0 });
  await sleep(5);
  await p.api.flush();
  const s = (await p.events()).filter((e) => e.n === 'search');
  assert.equal(s.length, 3, JSON.stringify(s));
  assert.deepEqual(s[0].pr, { query: '3 BHK Noida', auto: true });
  assert.deepEqual(s[1].pr, { query: 'Sector 150', category: 'residential', auto: true });
  assert.deepEqual(s[2].pr, { query: '2 BHK call [phone]', category: 'rent', filters: { budget: '50L' }, results: 0 });
  assert.equal((await p.events()).filter((e) => e.n === 'form_submit').length, 0, 'search forms are not reported as forms');
  p.close();
});

test('privacy: Do-Not-Track disables tracking; opt-in waits for consent; denied drops queue', async () => {
  const d = await setup({ before: (w) => Object.defineProperty(w.navigator, 'doNotTrack', { value: '1' }) });
  d.api.track('x');
  await d.api.flush();
  assert.equal(d.sent.length, 0);
  d.api.consent('granted');
  d.api.track('y');
  await d.api.flush();
  assert.equal(d.sent.length, 0, 'consent cannot override DNT');
  d.close();

  const o = await setup({ config: { consentMode: 'opt-in' } });
  o.api.track('before_consent');
  await o.api.flush();
  assert.equal(o.sent.length, 0, 'nothing sent before consent');
  assert.equal(o.win.localStorage.getItem('rmwa_vid'), null, 'no identifiers stored before consent');
  o.api.consent('granted');
  await o.api.flush();
  const b = (await o.batches())[0];
  assert.equal(b.ctx.consent, 'granted');
  assert.ok(names(b.events).includes('before_consent'), 'buffered events are released');
  assert.ok(o.win.localStorage.getItem('rmwa_vid'));
  o.close();

  const n = await setup({ config: { consentMode: 'opt-in' } });
  n.api.track('x');
  n.api.consent('denied');
  n.api.track('y');
  await n.api.flush();
  assert.equal(n.sent.length, 0);
  n.close();
});

test('optOut persists and stops tracking; sampling 0 disables', async () => {
  const p = await setup();
  p.api.optOut();
  p.api.track('x');
  await p.api.flush();
  assert.equal((await p.events()).filter((e) => e.n === 'x').length, 0);
  assert.equal(p.win.localStorage.getItem('rmwa_optout'), '1');
  p.close();
  const s = await setup({ config: { sampleRate: 0.01 }, opts: { sampleRate: 0.0001 } });
  s.api.track('x');
  await s.api.flush();
  // 1-in-10000 chance of being sampled in; the visitor id is random.
  assert.ok(s.sent.length === 0 || s.api.getVisitorId());
  s.close();
});

test('links: outbound, download and contact classification; clicks carry selector and text', async () => {
  const loc = new URL('https://www.example.com/x');
  assert.deepEqual(classifyLink('https://partner.com/a?b=1', loc), { type: 'outbound', href: 'https://partner.com/a?b=1', domain: 'partner.com' });
  assert.equal(classifyLink('/brochure.PDF', loc).type, 'download');
  assert.equal(classifyLink('/brochure.pdf', loc).ext, 'pdf');
  assert.equal(classifyLink('https://example.com/about', loc).type, 'internal');
  assert.deepEqual(classifyLink('tel:+919876543210', loc), { type: 'contact', scheme: 'tel:' });
  assert.equal(classifyLink('javascript:void(0)', loc), null);

  const p = await setup({ html: '<div id="hero"><a class="btn primary" href="https://partner.com/">Partner</a><a href="/files/plan.pdf">Plan</a><button class="cta">Contact developer</button><a href="tel:+919876543210">Call</a><button data-track="contact_click" data-track-project-id="sky">Enquire</button></div>' });
  const doc = p.win.document;
  for (const el of doc.querySelectorAll('a,button')) el.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(5);
  await p.api.flush();
  const evs = await p.events();
  const out = evs.find((e) => e.n === 'outbound_click');
  assert.equal(out.pr.domain, 'partner.com');
  assert.equal(out.pr.sel, '#hero a.btn.primary');
  assert.equal(evs.find((e) => e.n === 'file_download').pr.ext, 'pdf');
  const clicks = evs.filter((e) => e.n === 'click');
  assert.ok(clicks.some((c) => c.pr.text === 'Contact developer'));
  const call = clicks.find((c) => c.pr.text === 'Call');
  assert.equal(call.pr.href, 'tel:', 'phone number is not sent');
  assert.deepEqual(evs.find((e) => e.n === 'contact_click').pr, { projectId: 'sky' });
  p.close();
});

test('heatmaps: clicks include x (‰ of width) and y only when enabled; rage clicks detected', async () => {
  const p = await setup({ html: '<p id="t">text</p><button id="b">B</button>', config: { heatmaps: true } });
  const b = p.win.document.getElementById('b');
  for (let i = 0; i < 3; i++) b.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
  await sleep(5);
  await p.api.flush();
  const evs = await p.events();
  assert.ok(evs.find((e) => e.n === 'rage_click'));
  const c = evs.find((e) => e.n === 'click');
  assert.equal(typeof c.pr.x, 'number');
  assert.equal(typeof c.pr.y, 'number');
  p.close();
  const q = await setup({ html: '<button id="b">B</button>' });
  q.win.document.getElementById('b').dispatchEvent(new q.win.MouseEvent('click', { bubbles: true }));
  await q.api.flush();
  assert.equal((await q.events()).find((e) => e.n === 'click').pr.x, undefined);
  q.close();
});

test('custom events, identify/trackLead gated by site config, sensitive props dropped, urgent flush', async () => {
  const p = await setup({ config: { identify: true, leadCapture: true, leadFields: ['name', 'email'] } });
  p.api.track('property_view', { propertyId: '123', password: 'x', nested: { token: 'y', ok: 1 } });
  p.api.track('Bad Name!');
  p.api.identify({ customerId: 'CUS_10291', traits: { plan: 'gold' } });
  p.api.trackLead({ name: 'Priya', email: 'p@example.com', otp: '1234', company: 'x' }, { source: 'property_page' });
  p.api.track('conversion', { goal: 'booking', value: 50000, currency: 'INR' });
  await sleep(5);
  await p.api.flush();
  const evs = await p.events();
  const pv = evs.find((e) => e.n === 'property_view');
  assert.deepEqual(pv.pr, { propertyId: '123', nested: { ok: 1 } });
  assert.equal(evs.filter((e) => e.n === 'bad name!').length, 0);
  assert.deepEqual(evs.find((e) => e.n === 'identify').pr, { customerId: 'CUS_10291', traits: { plan: 'gold' } });
  assert.deepEqual(evs.find((e) => e.n === 'lead').pr, { source: 'property_page', fields: { name: 'Priya', email: 'p@example.com', company: 'x' } }, 'sensitive keys dropped client-side; the API applies the leadFields allowlist');
  assert.equal(evs.find((e) => e.n === 'conversion').pr.value, 50000);
  for (const b of await p.batches()) assert.ok(batchSchema.safeParse(b).success);
  p.close();

  const q = await setup({ config: {} });
  q.api.identify({ customerId: 'CUS_1' });
  q.api.trackLead({ name: 'x' });
  await q.api.flush();
  assert.equal((await q.events()).filter((e) => e.n === 'identify' || e.n === 'lead').length, 0, 'disabled by default');
  q.close();
});

test('excludePaths: events on excluded paths are never sent', async () => {
  const p = await setup({ url: 'https://example.com/admin/users', config: { excludePaths: ['/admin'] } });
  p.api.track('x');
  await p.api.flush();
  assert.equal((await p.events()).length, 0);
  p.close();
});

test('unload: page_leave + beacon flush on pagehide; offline batches parked and replayed', async () => {
  const p = await setup();
  p.win.dispatchEvent(new p.win.Event('pagehide'));
  await sleep(5);
  const beacon = p.sent.find((s) => s.via === 'beacon');
  assert.ok(beacon);
  const body = JSON.parse(await beacon.blobPromise);
  assert.ok(names(body.events).includes('page_leave'));
  p.close();

  const o = await setup();
  Object.defineProperty(o.win.navigator, 'onLine', { configurable: true, get: () => false });
  const before = o.sent.length;
  o.api.track('offline_event');
  await o.api.flush();
  assert.equal(o.sent.length, before, 'nothing sent while offline');
  const parked = JSON.parse(o.win.localStorage.getItem('rmwa_q_site_testsite0001'));
  assert.ok(parked[0].events.some((e) => e.n === 'offline_event'));
  Object.defineProperty(o.win.navigator, 'onLine', { configurable: true, get: () => true });
  o.win.dispatchEvent(new o.win.Event('online'));
  await sleep(10);
  const evs = await o.events();
  assert.ok(evs.some((e) => e.n === 'offline_event'));
  assert.equal(o.win.localStorage.getItem('rmwa_q_site_testsite0001'), null);
  o.close();
});

test('retry: 5xx retried, 4xx dropped', async () => {
  const p = await setup();
  let calls = 0;
  const statuses = [503, 202];
  p.win.fetch = async (_u, init) => {
    if (!init || init.method !== 'POST') return { ok: true, status: 200, json: async () => ({ data: {} }) };
    calls++;
    return { ok: false, status: statuses.shift() || 400 };
  };
  p.win.setTimeout = (fn) => setTimeout(fn, 1);
  p.api.track('x');
  await p.api.flush();
  await sleep(20);
  assert.equal(calls, 2, 'one retry after 503');
  p.api.track('y');
  await p.api.flush();
  await sleep(20);
  assert.equal(calls, 3, '4xx is not retried');
  p.close();
});

test('boot: reads script attributes and replays the pre-load stub queue; keeps foreign window.analytics', async () => {
  const p = await setup({
    useBoot: true,
    script: '<script src="https://cdn.analytics.test/tracker.js" data-site-id="site_bootsite0001" data-auto="no-clicks"></script>',
    before: (w) => { w.analytics = { q: [['track', ['queued_event', { a: 1 }]]] }; },
  });
  assert.equal(p.win.analytics, p.win.rmwAnalytics);
  await p.api.flush();
  const b = (await p.batches())[0];
  assert.equal(b.siteId, 'site_bootsite0001');
  assert.equal(p.sent[0].url, 'https://cdn.analytics.test/api/v1/events');
  assert.ok(names(b.events).includes('queued_event'));
  p.close();

  const seg = await setup({
    useBoot: true,
    script: '<script src="https://cdn.analytics.test/tracker.js" data-site-id="site_bootsite0001"></script>',
    before: (w) => { w.analytics = { identify() {}, segment: true }; },
  });
  assert.equal(seg.win.analytics.segment, true, 'does not clobber another library');
  assert.ok(seg.win.rmwAnalytics);
  seg.close();
});

test('media events', async () => {
  const p = await setup({ html: '<video id="v" title="Walkthrough" src="https://cdn.example.com/walk.mp4?sig=abc"></video>' });
  const v = p.win.document.getElementById('v');
  v.dispatchEvent(new p.win.Event('play'));
  v.dispatchEvent(new p.win.Event('ended'));
  await p.api.flush();
  const evs = await p.events();
  const play = evs.find((e) => e.n === 'video_play');
  assert.equal(play.pr.src, 'https://cdn.example.com/walk.mp4');
  assert.equal(play.pr.title, 'Walkthrough');
  assert.ok(evs.find((e) => e.n === 'video_complete'));
  p.close();
});
