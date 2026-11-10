import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { setup, client, batch, sendBatch, id } from './helpers.js';

let ctx;
let owner;
let site; // created website (API shape)
let col;

before(async () => {
  ctx = await setup();
  col = ctx.db.col;
  owner = client(ctx.base);
  const reg = await owner.post('/auth/register', { fullName: 'Owner One', email: 'owner@example.com', password: 'Sup3rSecretPass', organization: 'RMW Group' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const w = await owner.post('/websites', { name: 'My Property Fact', code: 'MPF', domain: 'https://www.example.com', settings: { leadCapture: true, heatmaps: true, identify: true } });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  site = w.data;
});

after(async () => { await ctx?.teardown(); });

test('auth: first user registers, second public signup is refused, me returns org + role', async () => {
  const me = await owner.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'owner');
  assert.equal(me.data.org.name, 'RMW Group');
  const other = client(ctx.base);
  const r = await other.post('/auth/register', { fullName: 'Second', email: 'second@example.com', password: 'AnotherPass123' });
  assert.equal(r.status, 403);
  assert.equal(r.json.errorCode, 'SIGNUP_DISABLED');
});

test('auth: wrong password rejected; writes without allowed Origin rejected (CSRF)', async () => {
  const anon = client(ctx.base);
  const bad = await anon.post('/auth/login', { email: 'owner@example.com', password: 'wrong-password1' });
  assert.equal(bad.status, 401);
  const evil = client(ctx.base, 'https://evil.test');
  const r = await evil.post('/auth/login', { email: 'owner@example.com', password: 'Sup3rSecretPass' });
  assert.equal(r.status, 403);
  assert.equal(r.json.errorCode, 'CSRF_REJECTED');
});

test('website: snippet, siteId format, public config', async () => {
  assert.match(site.siteId, /^site_[a-z0-9]{12}$/);
  assert.equal(site.domain, 'example.com');
  assert.match(site.snippet, /data-site-id="site_/);
  const res = await fetch(`${ctx.base}/api/v1/sites/${site.siteId}/config`);
  const j = await res.json();
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(j.data.heatmaps, true);
  assert.equal(j.data.retentionDays, undefined, 'internal settings are not exposed');
});

test('ingest: page view creates event, session, visitor; retry is deduplicated', async () => {
  const b = batch(site.siteId, [
    { n: 'session_start', pr: { isNew: true } },
    { n: 'page_view', p: { u: 'https://example.com/properties?utm_source=google&utm_medium=cpc&utm_campaign=noida_launch&token=secret123', pa: '/properties', ti: 'Properties', r: 'https://www.google.com/' } },
  ], { vid: 'v_dedupe0001', sid: 's_dedupe0001' });
  const r1 = await sendBatch(ctx.base, b);
  assert.equal(r1.status, 202, JSON.stringify(r1.json));
  assert.equal(r1.json.data.accepted, 2);
  const r2 = await sendBatch(ctx.base, b);
  assert.equal(r2.json.data.accepted, 0);
  assert.equal(r2.json.data.duplicates, 2);

  const wid = new (await import('mongodb')).ObjectId(site.id);
  const ev = await col('events').findOne({ websiteId: wid, name: 'page_view', sessionId: 's_dedupe0001' });
  assert.equal(ev.page.path, '/properties');
  assert.doesNotMatch(ev.page.url, /secret123/, 'sensitive URL params are redacted');
  assert.equal(ev.device.browser, 'Chrome');
  const s = await col('sessions').findOne({ websiteId: wid, sessionId: 's_dedupe0001' });
  assert.equal(s.pageviews, 1);
  assert.equal(s.events, 2);
  assert.equal(s.channel, 'paid_search');
  assert.equal(s.utm.campaign, 'noida_launch');
  assert.equal(s.entryPath, '/properties');
  const v = await col('visitors').findOne({ websiteId: wid, visitorId: 'v_dedupe0001' });
  assert.equal(v.counts.sessions, 1);
  assert.equal(v.counts.pageviews, 1);
});

test('ingest: page_leave in the same batch as its page_view updates engagement (no race)', async () => {
  const pv = id('e');
  const b = batch(site.siteId, [
    { id: pv, n: 'page_view', p: { u: 'https://example.com/pricing', pa: '/pricing', ti: 'Pricing' } },
    { n: 'page_leave', p: { u: 'https://example.com/pricing', pa: '/pricing' }, pr: { pvid: pv, engaged: 42_000, delta: 42_000, scroll: 80 } },
  ], { vid: 'v_race000001', sid: 's_race000001' });
  assert.equal((await sendBatch(ctx.base, b)).status, 202);
  const wid = new (await import('mongodb')).ObjectId(site.id);
  const doc = await col('pageViews').findOne({ websiteId: wid, pageviewId: pv });
  assert.equal(doc.engagedMs, 42_000);
  assert.equal(doc.maxScroll, 80);
  const s = await col('sessions').findOne({ websiteId: wid, sessionId: 's_race000001' });
  assert.equal(s.activeMs, 42_000);
  assert.equal(s.bounced, false, 'a long single-page visit is engaged, not a bounce');
});

test('ingest: rejects foreign origins, invalid batches, unknown sites; drops bots and DNT silently', async () => {
  const b = batch(site.siteId, [{ n: 'page_view' }]);
  assert.equal((await sendBatch(ctx.base, b, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await sendBatch(ctx.base, b, { origin: 'https://shop.example.com' })).status, 202, 'subdomains are allowed');
  assert.equal((await sendBatch(ctx.base, b, { origin: null })).status, 403, 'missing origin rejected when configured');
  assert.equal((await sendBatch(ctx.base, { ...b, events: [{ id: 'e_bad', n: 'x y', t: 1 }] })).status, 400);
  assert.equal((await sendBatch(ctx.base, { ...b, siteId: 'site_doesnotexist1' })).status, 404);
  assert.equal((await sendBatch(ctx.base, { ...b, ctx: { ...b.ctx, evil: true } })).status, 400, 'unknown keys rejected');
  const bot = await sendBatch(ctx.base, batch(site.siteId, [{ n: 'page_view' }]), { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
  assert.equal(bot.status, 202);
  assert.equal(bot.json.data.accepted, 0);
  const dnt = await sendBatch(ctx.base, batch(site.siteId, [{ n: 'page_view' }]), { headers: { DNT: '1' } });
  assert.equal(dnt.json.data.accepted, 0);
});

test('ingest: gzip-compressed bodies (?z=1) and too-old events', async () => {
  const b = batch(site.siteId, [{ n: 'page_view' }, { n: 'page_view', t: Date.now() - 3 * 86400_000 }], { vid: 'v_gzip000001', sid: 's_gzip000001' });
  const res = await fetch(`${ctx.base}/api/v1/events?z=1`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://example.com', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }, body: zlib.gzipSync(JSON.stringify(b)) });
  const j = await res.json();
  assert.equal(res.status, 202, JSON.stringify(j));
  assert.equal(j.data.accepted, 1);
  assert.equal(j.data.dropped, 1, 'events older than 24h are dropped');
});

test('ingest: sensitive props stripped, free text redacted, search stored', async () => {
  const b = batch(site.siteId, [
    { n: 'custom_thing', pr: { password: 'hunter2', otp: '123456', note: 'mail me at a@b.com', plan: 'gold' } },
    { n: 'search', pr: { query: '3 BHK Noida', category: 'residential', results: 12 } },
  ], { vid: 'v_props00001', sid: 's_props00001' });
  assert.equal((await sendBatch(ctx.base, b)).status, 202);
  const wid = new (await import('mongodb')).ObjectId(site.id);
  const ev = await col('events').findOne({ websiteId: wid, name: 'custom_thing' });
  assert.equal(ev.props.password, undefined);
  assert.equal(ev.props.otp, undefined);
  assert.equal(ev.props.note, 'mail me at [email]');
  assert.equal(ev.props.plan, 'gold');
  const s = await col('searches').findOne({ websiteId: wid, visitorId: 'v_props00001' });
  assert.equal(s.normalized, '3 bhk noida');
  assert.equal(s.resultsCount, 12);
});

test('leads: allowlisted fields captured + encrypted; sensitive/unlisted dropped; masking by role', async () => {
  const b = batch(site.siteId, [
    { n: 'page_view', p: { u: 'https://example.com/project/sky?utm_source=facebook&utm_medium=paid_social&utm_campaign=diwali', pa: '/project/sky', ti: 'Sky' } },
    { n: 'form_submit', p: { u: 'https://example.com/contact', pa: '/contact' }, pr: { form: 'enquiry', formName: 'Enquiry', fields: { name: 'Rahul Sharma', email: 'rahul@example.com', phone: '9876543221', city: 'Noida', password: 'nope', secret_field: 'x', company: 'not allowlisted' } } },
  ], { vid: 'v_lead000001', sid: 's_lead000001' });
  const r = await sendBatch(ctx.base, b);
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const wid = new (await import('mongodb')).ObjectId(site.id);
  const raw = await col('leads').findOne({ websiteId: wid, visitorId: 'v_lead000001' });
  assert.ok(raw, 'lead created');
  assert.doesNotMatch(raw.pii, /rahul/i, 'PII is encrypted at rest');
  assert.equal(raw.attribution.utm.campaign, 'diwali');
  assert.equal(raw.attribution.channel, 'paid_social');

  const list = await owner.get('/leads?range=7d');
  const lead = list.data.rows.find((l) => l.visitorId === 'v_lead000001');
  assert.deepEqual(Object.keys(lead.fields).sort(), ['city', 'email', 'name', 'phone']);
  assert.equal(lead.fields.email, 'rahul@example.com', 'owners see PII');

  // A double submit within 10 minutes does not create a second lead.
  await sendBatch(ctx.base, batch(site.siteId, [{ n: 'form_submit', pr: { form: 'enquiry', fields: { email: 'rahul@example.com' } } }], { vid: 'v_lead000001', sid: 's_lead000001' }));
  assert.equal(await col('leads').countDocuments({ websiteId: wid, visitorId: 'v_lead000001' }), 1);

  // Analysts see masked values.
  const inv = await owner.post('/org/invites', { email: 'analyst@example.com', role: 'analyst' });
  assert.equal(inv.status, 201);
  const analyst = client(ctx.base);
  const acc = await analyst.post('/auth/accept-invite', { token: new URL(inv.data.url).searchParams.get('token'), fullName: 'Ana Lyst', password: 'AnalystPass123' });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const masked = (await analyst.get('/leads?range=7d')).data.rows.find((l) => l.visitorId === 'v_lead000001');
  assert.equal(masked.fields.phone, '********21');
  assert.equal(masked.fields.email, 'r****@example.com');
  assert.equal(masked.masked, true);
  // …and cannot manage websites or export leads.
  assert.equal((await analyst.post('/websites', { name: 'X', domain: 'x.com' })).status, 403);
  assert.equal((await analyst.get('/reports/leads?range=7d')).status, 400);
});

test('server-side ingestion with secret key and HMAC signature', async () => {
  const k = await owner.post(`/websites/${site.id}/keys`);
  assert.equal(k.status, 201);
  const b = batch(site.siteId, [{ n: 'order_paid', pr: { amount: 4999 } }], { vid: 'v_server00001', sid: 's_server00001', ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36' });
  const viaKey = await sendBatch(ctx.base, b, { origin: null, headers: { Authorization: `Bearer ${k.data.key}` } });
  assert.equal(viaKey.status, 202, JSON.stringify(viaKey.json));
  assert.equal((await sendBatch(ctx.base, b, { origin: null, headers: { Authorization: 'Bearer sk_wrong' } })).status, 401);

  const b2 = batch(site.siteId, [{ n: 'order_paid' }], { vid: 'v_server00002', sid: 's_server00002', ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36' });
  const body = JSON.stringify(b2);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', k.data.key).update(`${t}.${body}`).digest('hex');
  const viaSig = await sendBatch(ctx.base, null, { origin: null, raw: body, headers: { 'X-Signature': `t=${t},v1=${sig}` } });
  assert.equal(viaSig.status, 202, JSON.stringify(viaSig.json));
  const bad = await sendBatch(ctx.base, null, { origin: null, raw: body, headers: { 'X-Signature': `t=${t},v1=${'0'.repeat(64)}` } });
  assert.equal(bad.status, 401);
});

test('stats: rollup then overview, pages, sources, searches, realtime, visitor profile', async () => {
  const { rollupRecent } = await import('../src/services/rollupService.js');
  await rollupRecent();
  const ov = await owner.get(`/stats/overview?site=${site.id}&range=today`);
  assert.equal(ov.status, 200, JSON.stringify(ov.json));
  assert.ok(ov.data.current.visitors >= 4, `visitors ${ov.data.current.visitors}`);
  assert.ok(ov.data.current.pageviews >= 2);
  assert.equal(ov.data.current.leads, 1);
  const pages = await owner.get('/stats/pages?site=all&range=today');
  assert.ok(pages.data.some((p) => p.path === '/properties'));
  const ch = await owner.get('/stats/dimension/channel?range=today');
  assert.ok(ch.data.some((c) => c.value === 'paid_search'));
  const ts = await owner.get('/stats/timeseries?range=7d');
  assert.equal(ts.data.points.length, 7);
  const se = await owner.get('/stats/searches?range=today');
  assert.equal(se.data.top[0].normalized, '3 bhk noida');
  const rt = await owner.get('/realtime');
  assert.ok(rt.data.active >= 1);
  assert.ok(rt.data.feed.length >= 1);
  const prof = await owner.get(`/visitors/${site.id}/v_lead000001`);
  assert.equal(prof.status, 200);
  assert.ok(prof.data.journey.some((e) => e.name === 'form_submit'));
  assert.equal(prof.data.leads.length, 1);
  const csv = await fetch(`${ctx.base}/api/v1/reports/pages?range=today&format=csv`, { headers: { Cookie: owner.cookie() } });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text.split('\r\n')[0], /Path,Title,Page views/);
  assert.match(text, /\/properties/);
  const xlsx = await fetch(`${ctx.base}/api/v1/reports/traffic?range=7d&format=xlsx`, { headers: { Cookie: owner.cookie() } });
  assert.equal(xlsx.status, 200);
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK', 'xlsx is a zip container');
});

test('funnels: ordered steps per visitor', async () => {
  const steps = [{ n: 'page_view', p: { u: 'https://example.com/', pa: '/' } }, { n: 'search', pr: { query: 'villa' } }, { n: 'page_view', p: { u: 'https://example.com/project/a', pa: '/project/a' } }];
  await sendBatch(ctx.base, batch(site.siteId, steps, { vid: 'v_funnel0001', sid: 's_funnel0001' }));
  await sendBatch(ctx.base, batch(site.siteId, steps.slice(0, 2), { vid: 'v_funnel0002', sid: 's_funnel0002' }));
  const f = await owner.post('/funnels', { name: 'Search to project', websiteId: site.id, steps: [{ type: 'path', match: '*', label: 'Landing' }, { type: 'search', match: 'villa', label: 'Search' }, { type: 'path', match: '/project/*', label: 'Project' }] });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const rep = await owner.get(`/funnels/${f.data.id}/report?range=today`);
  assert.equal(rep.status, 200);
  assert.equal(rep.data.steps[1].count, 2);
  assert.equal(rep.data.steps[2].count, 1);
  assert.equal(rep.data.steps[2].conversionFromPrevious, 50);
});

test('privacy: visitor export and erasure', async () => {
  const exp = await owner.get(`/visitors/${site.id}/v_lead000001/export`);
  assert.equal(exp.status, 200);
  assert.equal(exp.json.leads[0].fields.email, 'rahul@example.com');
  const del = await owner.del(`/visitors/${site.id}/v_lead000001`);
  assert.equal(del.status, 200);
  assert.ok(del.data.events >= 2);
  assert.equal((await owner.get(`/visitors/${site.id}/v_lead000001`)).status, 404);
  const logs = await owner.get('/org/audit-logs');
  assert.ok(logs.data.rows.some((r) => r.action === 'visitor.deleted'));
});

test('alerts: new_lead rule fires on lead ingestion', async () => {
  const a = await owner.post('/alerts', { type: 'new_lead', websiteId: site.id });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  await sendBatch(ctx.base, batch(site.siteId, [{ n: 'lead', pr: { fields: { name: 'Priya', email: `priya${id('x')}@example.com` } } }], { vid: 'v_alert00001', sid: 's_alert00001' }));
  await new Promise((r) => setTimeout(r, 200));
  const ev = await owner.get('/alerts/events');
  assert.ok(ev.data.rows.some((e) => e.type === 'new_lead'), JSON.stringify(ev.data));
});
