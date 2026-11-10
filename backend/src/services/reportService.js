import ExcelJS from 'exceljs';
import { CHANNELS } from '@rmw-analytics/shared';
import { col } from '../config/db.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { decryptJson } from '../utils/crypto.js';
import { maskLeadFields } from '@rmw-analytics/shared';
import { resolveRange, dayKey, DEFAULT_TZ } from '../utils/dates.js';
import * as stats from './statsService.js';
import { sendMail, mailEnabled } from './mailer.js';
import { badRequest } from '../utils/errors.js';

const secs = (ms) => Math.round((ms || 0) / 1000);

/** Report catalogue: each returns { title, columns: [{key, header}], rows } */
export const REPORTS = {
  traffic: {
    title: 'Traffic (daily)',
    build: async (scope) => {
      const ts = await stats.timeseries({ ...scope, range: { ...scope.range, interval: 'day' } });
      return { columns: [['t', 'Date'], ['visitors', 'Visitors'], ['sessions', 'Sessions'], ['pageviews', 'Page views'], ['bounceRate', 'Bounce rate %'], ['searches', 'Searches'], ['leads', 'Leads'], ['conversions', 'Conversions']], rows: ts.points };
    },
  },
  pages: {
    title: 'Top pages',
    build: async (scope) => ({ columns: [['path', 'Path'], ['title', 'Title'], ['pageviews', 'Page views'], ['visitors', 'Visitors'], ['entries', 'Entries'], ['exits', 'Exits'], ['exitRate', 'Exit rate %'], ['avgTimeSec', 'Avg time (s)'], ['avgScroll', 'Avg scroll %']], rows: (await stats.pages(scope, { limit: 500 })).map((p) => ({ ...p, avgTimeSec: secs(p.avgTimeMs) })) }),
  },
  sources: {
    title: 'Traffic sources',
    build: async (scope) => ({ columns: [['label', 'Channel'], ['sessions', 'Sessions'], ['visitors', 'Visitors'], ['share', 'Share %'], ['bounceRate', 'Bounce %'], ['conversions', 'Conversions'], ['conversionRate', 'Conv. rate %']], rows: await stats.dimension(scope, 'channel') }),
  },
  referrers: {
    title: 'Referrers',
    build: async (scope) => ({ columns: [['label', 'Referrer'], ['sessions', 'Sessions'], ['visitors', 'Visitors'], ['conversions', 'Conversions']], rows: await stats.dimension(scope, 'referrer', { limit: 200 }) }),
  },
  campaigns: {
    title: 'Campaigns',
    build: async (scope) => ({ columns: [['campaign', 'Campaign'], ['source', 'Source'], ['medium', 'Medium'], ['sessions', 'Sessions'], ['visitors', 'Visitors'], ['conversions', 'Conversions'], ['leads', 'Leads'], ['conversionRate', 'Conv. rate %']], rows: await stats.campaigns(scope) }),
  },
  searches: {
    title: 'Top searches',
    build: async (scope) => ({ columns: [['query', 'Query'], ['count', 'Searches'], ['visitors', 'Visitors'], ['avgResults', 'Avg results'], ['zeroResults', 'Zero-result searches']], rows: (await stats.searches(scope)).top }),
  },
  geography: {
    title: 'Geography',
    build: async (scope) => ({ columns: [['label', 'Country'], ['sessions', 'Sessions'], ['visitors', 'Visitors'], ['conversions', 'Conversions']], rows: await stats.dimension(scope, 'country', { limit: 250 }) }),
  },
  devices: {
    title: 'Devices',
    build: async (scope) => {
      const [d, b, o] = await Promise.all(['device', 'browser', 'os'].map((k) => stats.dimension(scope, k)));
      return { columns: [['dim', 'Dimension'], ['label', 'Value'], ['sessions', 'Sessions'], ['visitors', 'Visitors'], ['share', 'Share %']], rows: [...d.map((r) => ({ ...r, dim: 'Device' })), ...b.map((r) => ({ ...r, dim: 'Browser' })), ...o.map((r) => ({ ...r, dim: 'OS' }))] };
    },
  },
  conversions: {
    title: 'Conversions',
    build: async (scope) => {
      const rows = await col('conversions').aggregate([
        { $match: { websiteId: { $in: scope.websiteIds }, ts: { $gte: scope.range.from, $lte: scope.range.to } } },
        { $group: { _id: '$goal', count: { $sum: 1 }, value: { $sum: '$value' }, visitors: { $addToSet: '$visitorId' } } },
        { $project: { goal: '$_id', count: 1, value: 1, visitors: { $size: '$visitors' } } },
        { $sort: { count: -1 } },
      ]).toArray();
      return { columns: [['goal', 'Goal'], ['count', 'Conversions'], ['visitors', 'Visitors'], ['value', 'Value']], rows };
    },
  },
  leads: {
    title: 'Leads',
    pii: true,
    build: async (scope, { pii }) => {
      const leads = await col('leads').find({ websiteId: { $in: scope.websiteIds }, ts: { $gte: scope.range.from, $lte: scope.range.to } }).sort({ ts: -1 }).limit(50_000).toArray();
      const fieldSet = new Set();
      const rows = leads.map((l) => {
        const raw = decryptJson(l.pii) || {};
        const fields = pii ? raw : maskLeadFields(raw);
        Object.keys(fields).forEach((k) => fieldSet.add(k));
        const w = scope.websites.find((x) => x._id.equals(l.websiteId));
        return { ts: l.ts.toISOString(), website: w?.code, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [`f_${k}`, v])), status: l.status, channel: CHANNELS[l.attribution?.channel] || l.attribution?.channel, source: l.attribution?.source, campaign: l.attribution?.utm?.campaign || '', landingPage: l.attribution?.landingPage, lastSearch: l.attribution?.lastSearch || '', page: l.path, city: l.city || '' };
      });
      return {
        columns: [['ts', 'Time (UTC)'], ['website', 'Website'], ...[...fieldSet].map((k) => [`f_${k}`, k]), ['status', 'Status'], ['channel', 'Channel'], ['source', 'Source'], ['campaign', 'Campaign'], ['landingPage', 'Landing page'], ['lastSearch', 'Last search'], ['page', 'Form page'], ['city', 'City']],
        rows,
      };
    },
  },
};

const csvCell = (v) => {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv({ columns, rows }) {
  const head = columns.map(([, h]) => csvCell(h)).join(',');
  const body = rows.map((r) => columns.map(([k]) => csvCell(r[k])).join(',')).join('\r\n');
  return `﻿${head}\r\n${body}\r\n`;
}

export async function toXlsx(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RMW Analytics';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.title.slice(0, 31));
    ws.columns = s.columns.map(([key, header]) => ({ key, header, width: Math.min(60, Math.max(12, header.length + 2)) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF194173' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    s.rows.forEach((r) => ws.addRow(Object.fromEntries(s.columns.map(([k]) => [k, typeof r[k] === 'string' && /^[=+\-@]/.test(r[k]) ? `'${r[k]}` : r[k]]))));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildReport(type, scope, opts = {}) {
  const def = REPORTS[type];
  if (!def) throw badRequest('Unknown report type', 'BAD_REPORT');
  const built = await def.build(scope, opts);
  return { title: def.title, ...built };
}

/** Multi-sheet summary used by scheduled email reports. */
export async function summaryWorkbook(scope) {
  const types = ['traffic', 'pages', 'sources', 'campaigns', 'searches', 'conversions'];
  const sheets = [];
  for (const t of types) sheets.push(await buildReport(t, scope));
  return toXlsx(sheets);
}

// ─── Scheduled reports ─────────────────────────────────────────────────────
const FREQ = { daily: { range: 'yesterday', days: 1 }, weekly: { days: 7 }, monthly: { days: 30 } };

function isDue(s, now, tz) {
  const last = s.lastSentAt ? new Date(s.lastSentAt) : null;
  const today = dayKey(now, tz);
  if (last && dayKey(last, tz) === today) return false;
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  if (local.getHours() < 7) return false; // send from 07:00 local
  if (s.frequency === 'weekly') return local.getDay() === 1; // Mondays
  if (s.frequency === 'monthly') return local.getDate() === 1;
  return true;
}

export async function runScheduledReports(now = new Date()) {
  if (!mailEnabled()) return 0;
  const schedules = await col('reportSchedules').find({ enabled: { $ne: false } }).toArray();
  let sent = 0;
  for (const s of schedules) {
    try {
      const org = await col('organizations').findOne({ _id: s.orgId });
      const tz = org?.settings?.timezone || DEFAULT_TZ;
      if (!isDue(s, now, tz)) continue;
      const websites = await col('websites').find({ orgId: s.orgId, deletedAt: null, ...(s.websiteId ? { _id: s.websiteId } : {}) }).toArray();
      if (!websites.length) continue;
      const today = dayKey(now, tz);
      const days = FREQ[s.frequency]?.days || 1;
      const to = new Date(now.getTime() - 86400_000);
      const range = resolveRange({ from: dayKey(new Date(to.getTime() - (days - 1) * 86400_000), tz), to: dayKey(to, tz) }, tz);
      const scope = { websites, websiteIds: websites.map((w) => w._id), range, tz };
      const ov = await stats.overview(scope);
      const c = ov.current;
      const label = s.websiteId ? websites[0].name : 'All websites';
      const text = [
        `${label} — ${s.frequency} report (${range.fromDay} to ${range.toDay})`, '',
        `Visitors: ${c.visitors}`, `Sessions: ${c.sessions}`, `Page views: ${c.pageviews}`, `Engagement rate: ${c.engagementRate}%`,
        `Avg session: ${Math.round(c.avgSessionMs / 1000)}s`, `Searches: ${c.searches}`, `Leads: ${c.leads}`, `Conversions: ${c.conversions}`, '',
        `Dashboard: ${env.APP_URL}`,
      ].join('\n');
      const xlsx = await summaryWorkbook(scope);
      const okSent = await sendMail({ to: s.recipients.join(','), subject: `${label}: ${s.frequency} analytics report`, text, attachments: [{ filename: `analytics-${s.frequency}-${today}.xlsx`, content: xlsx }] });
      if (okSent) {
        await col('reportSchedules').updateOne({ _id: s._id }, { $set: { lastSentAt: now } });
        sent += 1;
      }
    } catch (err) {
      logger.error({ err: err.message, scheduleId: String(s._id) }, 'Scheduled report failed');
    }
  }
  return sent;
}
