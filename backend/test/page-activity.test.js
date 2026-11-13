import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, batch, sendBatch } from './helpers.js';

let ctx;
let owner;
let site;
const LP = { u: 'https://example.com/Eldeco-terra&sol', pa: '/Eldeco-terra&sol', ti: 'Eldeco Terra & Sol' };
const HOME = { u: 'https://example.com/', pa: '/', ti: 'Home' };

before(async () => {
  ctx = await setup();
  owner = client(ctx.base);
  const reg = await owner.post('/auth/register', { fullName: 'Owner', email: 'pa@example.com', password: 'Sup3rSecretPass', organization: 'Org' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  site = (await owner.post('/websites', { name: 'My Property Fact', code: 'MPF', domain: 'https://www.example.com' })).data;

  // Visitor A: lands on the landing page, clicks the enquiry button, taps WhatsApp. Comes back later in a 2nd visit.
  const a1 = await sendBatch(ctx.base, batch(site.siteId, [
    { n: 'session_start', p: LP, pr: { isNew: true } },
    { n: 'page_view', p: LP },
    { n: 'click', p: LP, pr: { text: 'Enquire now', selector: 'button.cta' } },
    { n: 'whatsapp_click', p: LP },
  ], { vid: 'v_pagevisitora', sid: 's_pagesessa01' }));
  assert.equal(a1.status, 202, JSON.stringify(a1.json));
  await sendBatch(ctx.base, batch(site.siteId, [
    { n: 'session_start', p: LP },
    { n: 'page_view', p: LP },
  ], { vid: 'v_pagevisitora', sid: 's_pagesessa02' }));
  // Visitor B: only sees the homepage - must not appear in the landing page lists.
  await sendBatch(ctx.base, batch(site.siteId, [
    { n: 'session_start', p: HOME, pr: { isNew: true } },
    { n: 'page_view', p: HOME },
    { n: 'click', p: HOME, pr: { text: 'Menu' } },
  ], { vid: 'v_pagevisitorb', sid: 's_pagesessb01' }));
});

after(async () => { await ctx?.teardown(); });

const q = (list, extra = '') => owner.get(`/stats/page/${list}?site=${site.id}&range=7d&path=${encodeURIComponent(LP.pa)}${extra}`);

test('page activity: visits lists every view of the page with its session context', async () => {
  const r = await q('visits');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.data.meta.total, 2, 'two views of the landing page (visitor A, two visits)');
  assert.ok(r.data.rows.every((v) => v.visitorId === 'v_pagevisitora'), 'homepage-only visitor excluded');
  const v = r.data.rows[0];
  assert.ok(v.at && v.sessionId && v.session, 'has time, session and session context');
  assert.equal(v.session.entryPath, LP.pa);
  assert.equal(typeof v.hasRecording, 'boolean');
});

test('page activity: visitors groups views per person', async () => {
  const r = await q('visitors');
  assert.equal(r.status, 200);
  assert.equal(r.data.meta.total, 1);
  const p = r.data.rows[0];
  assert.equal(p.visitorId, 'v_pagevisitora');
  assert.equal(p.views, 2);
  assert.equal(p.visits, 2);
  assert.ok(new Date(p.firstAt) <= new Date(p.lastAt));
});

test('page activity: clicks lists one row per person with their actions in plain words', async () => {
  const r = await q('clicks');
  assert.equal(r.status, 200);
  const visitors = r.data.rows.map((c) => c.visitorId);
  assert.equal(new Set(visitors).size, visitors.length, 'one row per person');
  const labels = r.data.rows.flatMap((c) => c.actions);
  assert.ok(labels.includes('Clicked “Enquire now”'), labels.join(' | '));
  assert.ok(labels.includes('Opened WhatsApp chat'));
  assert.equal(r.data.rows.reduce((n, c) => n + c.clicks, 0) >= r.data.rows.length, true);
  assert.ok(!labels.some((l) => l.includes('Menu')), 'clicks on other pages excluded');
  const contact = await q('clicks', '&kind=contact');
  assert.deepEqual(contact.data.rows.map((c) => c.name), ['whatsapp_click']);
});

test('page activity: path is required and unknown lists 404', async () => {
  assert.equal((await owner.get(`/stats/page/visits?site=${site.id}`)).status, 400);
  assert.equal((await owner.get(`/stats/page/nope?site=${site.id}&path=/`)).status, 404);
});
