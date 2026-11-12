import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, batch, sendBatch } from './helpers.js';

/**
 * GA4-style reporting: filters across reports, page detail, clicks, conversions (mark event as conversion
 * with backfill), insights and the new date presets. All numbers asserted here come from events sent below.
 */
let ctx;
let owner;
let site;
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const page = (pa, extra = {}) => ({ u: `https://example.com${pa}`, pa, ti: pa, ...extra });
const q = (o) => `?${new URLSearchParams({ site: site.id, range: '7d', ...o })}`;

before(async () => {
  ctx = await setup();
  owner = client(ctx.base);
  assert.equal((await owner.post('/auth/register', { fullName: 'Owner', email: 'reports@example.com', password: 'Sup3rSecretPass', organization: 'Reports Org' })).status, 201);
  const w = await owner.post('/websites', { name: 'Reports Site', code: 'RPT', domain: 'https://example.com' });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  site = w.data;

  // A: Google (organic) on desktop → home → contact, clicks the CTA, fills the form, opens WhatsApp.
  const a = await sendBatch(ctx.base, batch(site.siteId, [
    { n: 'session_start', pr: { isNew: true } },
    { n: 'page_view', p: page('/', { r: 'https://www.google.com/' }) },
    { n: 'page_view', p: page('/contact') },
    { n: 'click', p: page('/contact'), pr: { tag: 'a', text: 'Contact us', sel: 'a.cta', href: '/contact#form' } },
    { n: 'form_view', p: page('/contact'), pr: { form: 'contact', formName: 'Contact Form' } },
    { n: 'form_start', p: page('/contact'), pr: { form: 'contact', formName: 'Contact Form' } },
    { n: 'form_submit', p: page('/contact'), pr: { form: 'contact', formName: 'Contact Form', dur: 12000 } },
    { n: 'whatsapp_click', p: page('/contact'), pr: { tag: 'a', text: 'Chat with us', href: 'whatsapp:' } },
  ], { vid: 'v_reportsa001', sid: 's_reportsa001' }));
  assert.equal(a.status, 202, JSON.stringify(a.json));
  // B: direct on mobile → home, scrolls to 90%.
  assert.equal((await sendBatch(ctx.base, batch(site.siteId, [
    { n: 'session_start', pr: { isNew: true } },
    { n: 'page_view', p: page('/') },
    { n: 'scroll', p: page('/'), pr: { depth: 90 } },
  ], { vid: 'v_reportsb001', sid: 's_reportsb001' }), { ua: UA_IPHONE })).status, 202);
  // C: direct on desktop → about.
  assert.equal((await sendBatch(ctx.base, batch(site.siteId, [
    { n: 'session_start', pr: { isNew: true } },
    { n: 'page_view', p: page('/about') },
  ], { vid: 'v_reportsc001', sid: 's_reportsc001' }))).status, 202);
});

after(async () => { await ctx?.teardown(); });

test('filters narrow overview, timeseries and breakdowns to matching sessions', async () => {
  const all = await owner.get(`/stats/overview${q()}`);
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.data.current.sessions, 3);

  const mobile = await owner.get(`/stats/overview${q({ f_device: 'mobile' })}`);
  assert.equal(mobile.data.current.sessions, 1);
  assert.equal(mobile.data.current.pageviews, 1);

  assert.equal((await owner.get(`/stats/overview${q({ f_channel: 'organic_search' })}`)).data.current.sessions, 1);
  assert.equal((await owner.get(`/stats/overview${q({ f_page: '/contact' })}`)).data.current.sessions, 1);
  assert.equal((await owner.get(`/stats/overview${q({ f_event: 'form_submit' })}`)).data.current.sessions, 1);
  assert.equal((await owner.get(`/stats/overview${q({ f_channel: 'direct', f_device: 'desktop' })}`)).data.current.sessions, 1, 'filters combine with AND');

  const ts = await owner.get(`/stats/timeseries${q({ f_device: 'mobile' })}`);
  assert.equal(ts.data.points.reduce((s, p) => s + p.sessions, 0), 1);

  const channels = await owner.get(`/stats/dimension/channel${q({ f_device: 'desktop' })}`);
  assert.deepEqual(channels.data.map((r) => [r.value, r.sessions]).sort(), [['direct', 1], ['organic_search', 1]]);

  const pages = await owner.get(`/stats/pages${q({ f_device: 'mobile' })}`);
  assert.deepEqual(pages.data.map((r) => r.path), ['/']);
});

test('pages: least visited first with order=asc', async () => {
  const r = await owner.get(`/stats/pages${q({ f_channel: 'organic_search', order: 'asc' })}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.every((row, i, arr) => i === 0 || arr[i - 1].pageviews <= row.pageviews));
});

test('page detail: views, sources and plain-language top actions', async () => {
  const r = await owner.get(`/stats/page${q({ path: '/contact' })}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.data.current.views, 1);
  assert.equal(r.data.current.visitors, 1);
  assert.equal(r.data.current.exits, 1);
  assert.equal(r.data.sources[0].value, 'organic_search');
  const labels = r.data.actions.map((x) => x.label);
  assert.ok(labels.includes('Clicked “Contact us”'), labels.join(' | '));
  assert.ok(labels.includes('Submitted Contact Form'), labels.join(' | '));
  assert.ok(labels.includes('Opened WhatsApp chat'), labels.join(' | '));
});

test('clicks report groups contact clicks', async () => {
  const r = await owner.get(`/stats/clicks${q({ kind: 'contact' })}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.count, 1);
  assert.equal(r.data.rows[0].name, 'whatsapp_click');
});

test('forms report: views, started, submitted, conversion rate', async () => {
  const r = await owner.get(`/stats/forms${q()}`);
  const f = r.data.find((x) => x.formKey === 'contact');
  assert.deepEqual([f.views, f.starts, f.submits, f.abandonment, f.conversionRate], [1, 1, 1, 0, 100]);
});

test('marking an event as a conversion backfills past activity', async () => {
  const g = await owner.post('/goals', { websiteId: site.id, name: 'WhatsApp clicked', type: 'event', match: 'whatsapp_click' });
  assert.equal(g.status, 201, JSON.stringify(g.json));
  assert.equal(g.data.backfilled, 1);
  const dup = await owner.post('/goals', { websiteId: site.id, name: 'WhatsApp again', type: 'event', match: 'whatsapp_click' });
  assert.equal(dup.status, 400);

  const c = await owner.get(`/stats/conversions${q()}`);
  assert.equal(c.data.total, 1);
  assert.equal(c.data.byGoal[0].goal, 'WhatsApp clicked');
  assert.equal(c.data.byChannel[0].value, 'organic_search');
  assert.equal(c.data.byLandingPage[0].path, '/');

  const ov = await owner.get(`/stats/overview${q()}`);
  assert.equal(ov.data.current.convertedSessions, 1);
  assert.equal(ov.data.current.conversionRate, 33.33);
});

test('explore: free-form dimensions × metrics, totals, filters and incompatible combinations', async () => {
  const bySource = await owner.get(`/stats/explore${q({ dims: 'channel,device', metrics: 'users,sessions,pageviews' })}`);
  assert.equal(bySource.status, 200, JSON.stringify(bySource.json));
  assert.equal(bySource.data.engine, 'sessions');
  assert.equal(bySource.data.total.sessions, 3);
  const row = bySource.data.rows.find((r) => r.dims[0] === 'organic_search');
  assert.deepEqual(row.dims, ['organic_search', 'desktop']);
  assert.deepEqual(row.metrics, { users: 1, sessions: 1, pageviews: 2 });

  const pagesEv = await owner.get(`/stats/explore${q({ dims: 'pagePath', metrics: 'views,viewers' })}`);
  assert.equal(pagesEv.data.engine, 'events');
  assert.deepEqual(Object.fromEntries(pagesEv.data.rows.map((r) => [r.dims[0], r.metrics.views])), { '/': 2, '/contact': 1, '/about': 1 });

  const mobile = await owner.get(`/stats/explore${q({ dims: 'eventName', metrics: 'eventCount', f_device: 'mobile' })}`);
  assert.ok(mobile.data.rows.some((r) => r.dims[0] === 'scroll'));
  assert.ok(!mobile.data.rows.some((r) => r.dims[0] === 'form_submit'), 'filters apply to explore');

  const cmp = await owner.get(`/stats/explore${q({ dims: 'device', metrics: 'sessions', compare: '1' })}`);
  assert.equal(cmp.data.previousTotal.sessions, 0);
  assert.ok(cmp.data.rows.every((r) => 'previous' in r));

  const bad = await owner.get(`/stats/explore${q({ dims: 'pagePath', metrics: 'sessions' })}`);
  assert.equal(bad.status, 400);
  assert.match(bad.json.message, /Page can't be used/);
  const mixed = await owner.get(`/stats/explore${q({ dims: 'device', metrics: 'sessions,eventCount' })}`);
  assert.equal(mixed.status, 400);
  assert.equal((await owner.get('/stats/explore/catalog')).data.dimensions.length > 10, true);
});

test('insights never invent findings on tiny data; new date presets resolve', async () => {
  const r = await owner.get(`/stats/insights${q()}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.enoughData, false);
  assert.deepEqual(r.data.items, [], 'below minimum volumes nothing is claimed');
  assert.match(r.data.summary, /visitor/);
  for (const range of ['yesterday', '28d']) assert.equal((await owner.get(`/stats/overview${q({ range })}`)).status, 200);
  const y = await owner.get(`/stats/overview${q({ range: 'yesterday' })}`);
  assert.equal(y.data.current.sessions, 0, 'events sent today are not in yesterday');
});
