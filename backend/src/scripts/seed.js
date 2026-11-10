#!/usr/bin/env node
/**
 * DEMO DATA ONLY. Creates a demo organisation with MPF / RMW / CT websites and generates synthetic
 * traffic by running it through the real ingestion pipeline (so sessions, visitors, leads, searches,
 * forms and rollups are all exercised). Refuses to run when NODE_ENV=production unless --force.
 *
 *   npm run seed            # 30 days, ~45 sessions/day/site
 *   SEED_DAYS=7 SEED_SESSIONS=20 npm run seed
 */
import { env, isProd } from '../config/env.js';
import { connectDb, closeDb, col } from '../config/db.js';
import { createUser, createOrganization, addMembership } from '../services/authService.js';
import { createWebsite } from '../services/websiteService.js';
import { ingestBatch } from '../services/ingest/ingestService.js';
import { rollupRange } from '../services/rollupService.js';
import { dayKey, addDays, DEFAULT_TZ } from '../utils/dates.js';

if (isProd && !process.argv.includes('--force')) {
  console.error('Refusing to seed demo data in production (pass --force to override).');
  process.exit(1);
}

const DAYS = Number(process.env.SEED_DAYS || 30);
const PER_DAY = Number(process.env.SEED_SESSIONS || 45);
const EMAIL = process.env.SEED_EMAIL || 'demo@rmw.local';
const PASSWORD = process.env.SEED_PASSWORD || 'DemoPass12345';

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const weighted = (pairs) => { const t = pairs.reduce((s, [, w]) => s + w, 0); let r = Math.random() * t; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
const id = (p, n = 14) => `${p}_${Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rnd(36)]).join('')}`;

const UAS = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 1920, 1080, 30],
  ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 412, 915, 34],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', 390, 844, 18],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', 1440, 900, 8],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 1366, 768, 6],
  ['Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', 820, 1180, 4],
];
const GEO = [[['IN', 'Uttar Pradesh', 'Noida'], 26], [['IN', 'Delhi', 'New Delhi'], 20], [['IN', 'Haryana', 'Gurugram'], 16], [['IN', 'Maharashtra', 'Mumbai'], 9], [['IN', 'Karnataka', 'Bengaluru'], 7], [['IN', 'Uttar Pradesh', 'Ghaziabad'], 6], [['AE', 'Dubai', 'Dubai'], 6], [['US', 'California', 'San Jose'], 3], [['GB', 'England', 'London'], 3], [['SG', null, 'Singapore'], 2]];
const SOURCES = [
  [{ ref: 'https://www.google.com/' }, 34],
  [{ ref: 'https://www.google.com/', q: 'utm_source=google&utm_medium=cpc&utm_campaign=noida_launch_q4&gclid=x' }, 14],
  [{ ref: null }, 18],
  [{ ref: 'https://l.facebook.com/', q: 'utm_source=facebook&utm_medium=paid_social&utm_campaign=diwali_offers' }, 10],
  [{ ref: 'https://l.instagram.com/' }, 6],
  [{ ref: 'https://chatgpt.com/' }, 4],
  [{ ref: 'https://www.bing.com/' }, 3],
  [{ ref: null, q: 'utm_source=newsletter&utm_medium=email&utm_campaign=nov_digest' }, 5],
  [{ ref: 'https://www.linkedin.com/' }, 3],
  [{ ref: 'https://www.99acres.com/' }, 3],
];
const FIRST = ['Rahul', 'Priya', 'Amit', 'Neha', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Rohan', 'Ananya', 'Karan', 'Isha'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Mehta', 'Kapoor', 'Agarwal', 'Jain', 'Malhotra', 'Bansal'];

const SITES = [
  {
    name: 'My Property Fact', code: 'MPF', domain: 'mypropertyfact.in', weight: 1.3,
    home: ['/', 'Home · My Property Fact'],
    pages: [['/properties', 'Properties'], ['/project/godrej-tropical-isle', 'Godrej Tropical Isle'], ['/project/ats-pious-orchards', 'ATS Pious Orchards'], ['/project/m3m-the-cullinan', 'M3M The Cullinan'], ['/project/prestige-city-indirapuram', 'Prestige City'], ['/builder/godrej-properties', 'Godrej Properties'], ['/blog/noida-real-estate-2026', 'Noida real estate 2026'], ['/emi-calculator', 'EMI calculator'], ['/contact', 'Contact']],
    searches: [['3 BHK Noida', 30], ['2 BHK Noida', 22], ['Sector 150', 17], ['Ready to Move', 12], ['Godrej Noida', 9], ['villa gurgaon', 6], ['commercial space sector 132', 4], ['4 BHK penthouse', 3]],
    custom: 'property_view',
  },
  {
    name: 'Ritz Media World', code: 'RMW', domain: 'ritzmediaworld.com', weight: 1,
    home: ['/', 'Ritz Media World · Advertising Agency'],
    pages: [['/services/seo', 'SEO services'], ['/services/ppc', 'PPC management'], ['/services/social-media', 'Social media marketing'], ['/portfolio', 'Portfolio'], ['/blog/aeo-vs-seo', 'AEO vs SEO'], ['/about-us', 'About us'], ['/careers', 'Careers'], ['/contact-us', 'Contact us']],
    searches: [['seo packages', 10], ['google ads agency', 8], ['radio advertising', 6], ['case studies', 4]],
    custom: 'service_enquiry_click',
  },
  {
    name: 'Creative Thinks Media', code: 'CT', domain: 'creativethinks.in', weight: 0.7,
    home: ['/', 'Creative Thinks · Branding & Design'],
    pages: [['/work', 'Our work'], ['/services/branding', 'Branding'], ['/services/website-design', 'Website design'], ['/blog/brand-identity-guide', 'Brand identity guide'], ['/contact', 'Contact']],
    searches: [['logo design', 8], ['brand guidelines', 5], ['website redesign', 4]],
    custom: 'portfolio_open',
  },
];

function fakeReq(geo, ua) {
  const headers = { 'cf-ipcountry': geo[0], 'cf-region': geo[1] || '', 'cf-ipcity': geo[2] || '', 'user-agent': ua };
  return { get: (h) => headers[String(h).toLowerCase()] || undefined };
}

function sessionEvents(site, start, { vid, isNew }) {
  const src = weighted(SOURCES);
  const ev = [];
  let t = start;
  const page = ([path, title], extra = '') => ({ u: `https://${site.domain}${path}${extra}`, pa: path, ti: title });
  const push = (n, p, pr) => { ev.push({ id: id('e', 16), n, t, p, ...(pr ? { pr } : {}) }); };
  const landingPage = Math.random() < 0.55 ? site.home : pick(site.pages);
  const landing = page(landingPage, src.q ? `?${src.q}` : '');
  if (src.ref) landing.r = src.ref;
  push('session_start', landing, { isNew });
  push('page_view', landing, { nav: 'load' });
  let pvId = ev.at(-1).id;
  let current = landing;
  const leave = (short) => { const engaged = short ? 1500 + rnd(7000) : 4000 + rnd(70_000); push('page_leave', current, { pvid: pvId, engaged, delta: engaged, scroll: [25, 50, 75, 90, 100][rnd(5)] }); };
  const depth = weighted([[1, 38], [2, 22], [3, 16], [4, 11], [6, 8], [9, 5]]);
  let searched = null;
  for (let i = 1; i < depth; i += 1) {
    t += 8_000 + rnd(90_000);
    if (Math.random() < 0.35) {
      push('click', current, { tag: 'a', text: 'View details', sel: 'a.card-link', x: 200 + rnd(600), y: 300 + rnd(1400) });
    }
    if (!searched && Math.random() < (site.code === 'MPF' ? 0.45 : 0.15)) {
      searched = weighted(site.searches);
      t += 3000;
      push('search', current, { query: searched, auto: true, results: Math.random() < 0.08 ? 0 : 3 + rnd(40), ...(site.code === 'MPF' ? { category: pick(['residential', 'residential', 'commercial']) } : {}) });
    }
    leave();
    t += 2000;
    const next = page(pick(site.pages));
    next.r = current.u;
    push('page_view', next, { nav: 'spa' });
    pvId = ev.at(-1).id;
    current = next;
    if (current.pa.startsWith('/project/') || current.pa.startsWith('/services/') || current.pa === '/work') push(site.custom, current, { slug: current.pa.split('/').pop() });
    if (Math.random() < 0.12) push('scroll', current, { depth: 75 });
  }
  if (Math.random() < 0.25) {
    t += 4000;
    push('click', current, { tag: 'button', text: 'Enquire now', sel: 'button.enquire', x: 760 + rnd(120), y: 520 + rnd(60) });
    if (Math.random() < 0.15) push('rage_click', current, { tag: 'button', text: 'Enquire now', sel: 'button.enquire', x: 800, y: 540 });
    push('contact_click', current, {});
    const form = { form: 'enquiry-form', formName: 'Enquiry form' };
    push('form_view', current, form);
    if (Math.random() < 0.6) {
      t += 5000;
      push('form_start', current, form);
      if (Math.random() < 0.12) push('form_error', current, { ...form, field: 'phone' });
      if (Math.random() < 0.45) {
        t += 25_000 + rnd(60_000);
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        push('form_submit', current, { ...form, dur: 30_000 + rnd(60_000), fieldCount: 4, fields: { name, email: `${name.toLowerCase().replace(' ', '.')}${rnd(99)}@example.com`, phone: `98${String(10_000_000 + rnd(89_999_999))}`, city: pick(['Noida', 'Delhi', 'Gurugram', 'Ghaziabad', 'Mumbai']), message: searched ? `Interested in ${searched}` : 'Please call me back' } });
      }
    }
  }
  if (Math.random() < 0.06) push('file_download', current, { href: `https://${site.domain}/brochure.pdf`, ext: 'pdf' });
  if (Math.random() < 0.05) push('outbound_click', current, { href: 'https://wa.me/91XXXXXXXXXX', domain: 'wa.me' });
  if (Math.random() < 0.03) push('js_error', current, { msg: "TypeError: Cannot read properties of undefined (reading 'price')", src: `https://${site.domain}/static/app.js`, line: 1, col: 4211 });
  t += 5000;
  leave(depth === 1 && ev.length <= 3 && Math.random() < 0.65);
  return ev;
}

async function main() {
  await connectDb();
  let user = await col('users').findOne({ email: EMAIL });
  let org;
  if (!user) {
    user = await createUser({ email: EMAIL, password: PASSWORD, fullName: 'Demo Owner' });
    org = await createOrganization('RMW Group (demo)');
    await addMembership(org._id, user._id, 'owner');
    console.log(`Created demo owner ${EMAIL} / ${PASSWORD}`);
  } else {
    const m = await col('memberships').findOne({ userId: user._id });
    org = await col('organizations').findOne({ _id: m.orgId });
  }
  const tz = org.settings?.timezone || DEFAULT_TZ;

  const websites = [];
  for (const s of SITES) {
    let w = await col('websites').findOne({ orgId: org._id, code: s.code, deletedAt: null });
    if (!w) w = await createWebsite(org._id, { name: s.name, code: s.code, domain: s.domain, settings: { leadCapture: true, heatmaps: true, identify: true } });
    websites.push({ ...s, w });
  }

  const now = Date.now();
  let sessions = 0;
  let events = 0;
  for (const s of websites) {
    const returning = [];
    for (let d = DAYS - 1; d >= 0; d -= 1) {
      const dayStart = now - d * 86400_000 - (now % 86400_000);
      const weekday = new Date(dayStart).getUTCDay();
      const count = Math.round(PER_DAY * s.weight * (weekday === 0 || weekday === 6 ? 0.7 : 1) * (0.8 + Math.random() * 0.4) * (1 + (DAYS - d) / (DAYS * 3)));
      for (let i = 0; i < count; i += 1) {
        const hour = weighted([[2, 1], [6, 2], [9, 6], [11, 9], [13, 8], [15, 8], [17, 7], [19, 8], [21, 7], [23, 3]]);
        const start = dayStart + hour * 3600_000 + rnd(3600_000) - 5.5 * 3600_000;
        if (start > now - 60_000) continue;
        const back = returning.length > 5 && Math.random() < 0.28;
        const visitor = back ? pick(returning) : { vid: id('v'), ua: weighted(UAS.map((u) => [u, u[3]])), geo: weighted(GEO) };
        if (!back) returning.push(visitor);
        const evs = sessionEvents(s, start, { vid: visitor.vid, isNew: !back });
        const sid = id('s');
        const [ua, sw, sh] = visitor.ua;
        // Split into batches like the real tracker (≤ 50 events, one session per batch).
        for (let k = 0; k < evs.length; k += 20) {
          const chunk = evs.slice(k, k + 20);
          const batch = { siteId: s.w.siteId, v: 1, ctx: { vid: visitor.vid, sid, lang: 'en-IN', tz: 'Asia/Kolkata', sw, sh, vw: Math.min(sw, 1440), vh: sh - 120 }, events: chunk };
          const at = Math.min(now, chunk.at(-1).t + 1000);
          await ingestBatch({ website: s.w, batch, req: fakeReq(visitor.geo, ua), ip: null, ua, now: at });
          events += chunk.length;
        }
        sessions += 1;
      }
      process.stdout.write(`\r${s.code}: day ${DAYS - d}/${DAYS} · ${sessions} sessions · ${events} events   `);
    }
    process.stdout.write('\n');
  }

  console.log('Rolling up…');
  const today = dayKey(new Date(), tz);
  for (const s of websites) await rollupRange(s.w, addDays(today, -DAYS), today, tz);

  const mpf = websites[0].w;
  if (!(await col('funnels').findOne({ orgId: org._id }))) {
    await col('funnels').insertOne({ orgId: org._id, websiteId: mpf._id, name: 'Property lead funnel', windowHours: 72, createdBy: user._id, createdAt: new Date(), steps: [
      { type: 'path', match: '*', label: 'Landing page' }, { type: 'search', match: '', label: 'Search' }, { type: 'path', match: '/project/*', label: 'Property view' },
      { type: 'event', match: 'contact_click', label: 'Contact click' }, { type: 'form', match: 'start', label: 'Form start' }, { type: 'form', match: 'submit', label: 'Form submit' },
    ] });
    await col('goals').insertOne({ websiteId: mpf._id, name: 'Brochure download', type: 'event', match: 'file_download', value: 0, createdAt: new Date() });
    await col('alerts').insertMany([
      { orgId: org._id, websiteId: null, name: 'New lead', type: 'new_lead', threshold: null, windowMinutes: 60, cooldownMinutes: 0, channels: { inApp: true, emails: [], webhookUrl: null }, enabled: true, createdBy: user._id, createdAt: new Date(), lastTriggeredAt: null },
      { orgId: org._id, websiteId: null, name: 'Traffic spike', type: 'traffic_spike', threshold: 100, windowMinutes: 60, cooldownMinutes: 60, channels: { inApp: true, emails: [], webhookUrl: null }, enabled: true, createdBy: user._id, createdAt: new Date(), lastTriggeredAt: null },
    ]);
  }
  console.log(`Done: ${sessions} sessions, ${events} events across ${websites.length} websites. Sign in as ${EMAIL}.`);
  console.log(`API: ${env.PUBLIC_API_URL}  ·  Dashboard: ${env.APP_URL}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => closeDb());
