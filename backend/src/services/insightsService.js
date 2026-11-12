import { CHANNELS } from '@rmw-analytics/shared';
import { overview, dimension, pages, forms, previousScope } from './statsService.js';

/**
 * "What's happening?" — plain-language findings computed by comparing the selected period with the
 * previous period of the same length. Every sentence is derived from the numbers returned alongside it;
 * nothing is estimated. Findings below minimum volumes are skipped, so small sites don't get
 * "+200%!" alerts on 3 visits.
 *
 * Item: { id, tone: 'good'|'bad'|'warning'|'info', title, detail?, metric?, current?, previous?, change?, link? }
 */

const MIN = { visitors: 20, sessions: 30, leads: 5, conversions: 5, pageViews: 30, formViews: 30, device: 20 };
const pctChange = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);
const fmtPct = (v) => `${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1).replace(/\.0$/, '')}%`;
const fmtNum = (v) => new Intl.NumberFormat('en-IN').format(Math.round(v));
const fmtDur = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const updown = (v) => (v > 0 ? 'increased' : 'decreased');
const channelLabel = (v) => CHANNELS[v] || v || 'Unknown';

/** Biggest movers between two keyed lists: [{ key, cur, prev, delta }] sorted by |delta|. */
function movers(curRows, prevRows, key, metric) {
  const prev = new Map(prevRows.map((r) => [r[key], r[metric] || 0]));
  const seen = new Set();
  const out = curRows.map((r) => { seen.add(r[key]); const p = prev.get(r[key]) || 0; return { key: r[key], label: r.label, cur: r[metric] || 0, prev: p, delta: (r[metric] || 0) - p }; });
  for (const [k, p] of prev) if (!seen.has(k)) out.push({ key: k, cur: 0, prev: p, delta: -p });
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export async function insights(scope) {
  const prev = previousScope(scope);
  const [ov, chCur, chPrev, devCur, devPrev, pgCur, pgPrev, fmCur, fmPrev] = await Promise.all([
    overview(scope),
    dimension(scope, 'channel', { limit: 20 }), dimension(prev, 'channel', { limit: 20 }),
    dimension(scope, 'device', { limit: 5 }), dimension(prev, 'device', { limit: 5 }),
    pages(scope, { limit: 200 }), pages(prev, { limit: 200 }),
    forms(scope), forms(prev),
  ]);
  const c = ov.current;
  const p = ov.previous;
  const items = [];
  const add = (item) => items.push(item);

  // ── Tracking health ──
  if (!c.sessions && p.sessions >= MIN.sessions) {
    add({ id: 'no-data', tone: 'warning', weight: 1000, title: 'No visits were recorded in this period', detail: `The previous period had ${fmtNum(p.sessions)} visits. Check that the tracking code is still installed on your website.`, metric: 'sessions', current: 0, previous: p.sessions });
  }
  if (!c.sessions && !p.sessions) {
    return { summary: null, items: [], enoughData: false };
  }

  // ── Visitors, and which channel drove the change ──
  const vChange = pctChange(c.visitors, p.visitors);
  if (p.visitors >= MIN.visitors && vChange != null && Math.abs(vChange) >= 10) {
    const totalDelta = c.sessions - p.sessions;
    const top = movers(chCur, chPrev, 'value', 'sessions').find((m) => Math.sign(m.delta) === Math.sign(totalDelta) && m.delta !== 0);
    const share = top && totalDelta ? top.delta / totalDelta : 0;
    add({
      id: 'visitors', tone: vChange > 0 ? 'good' : 'bad', weight: 100 + Math.abs(vChange),
      title: `Website visitors ${updown(vChange)} ${fmtPct(vChange)}`,
      detail: [
        `${fmtNum(c.visitors)} visitors, compared with ${fmtNum(p.visitors)} in the previous period.`,
        top && share >= 0.4 ? `${share >= 0.7 ? 'Most' : 'Much'} of the ${vChange > 0 ? 'growth' : 'drop'} came from ${channelLabel(top.key)} (${top.delta > 0 ? '+' : '−'}${fmtNum(Math.abs(top.delta))} visits).` : null,
      ].filter(Boolean).join(' '),
      metric: 'visitors', current: c.visitors, previous: p.visitors, change: vChange,
    });
  }

  // ── Leads ──
  const lChange = pctChange(c.leads, p.leads);
  if (Math.max(c.leads, p.leads) >= MIN.leads && lChange != null && Math.abs(lChange) >= 15) {
    add({ id: 'leads', tone: lChange > 0 ? 'good' : 'bad', weight: 150 + Math.abs(lChange), title: `You received ${fmtPct(lChange)} ${lChange > 0 ? 'more' : 'fewer'} leads`, detail: `${fmtNum(c.leads)} leads, compared with ${fmtNum(p.leads)} in the previous period.`, metric: 'leads', current: c.leads, previous: p.leads, change: lChange, link: '/leads' });
  } else if (c.leads >= MIN.leads && !p.leads) {
    add({ id: 'leads-new', tone: 'good', weight: 140, title: `You received ${fmtNum(c.leads)} leads`, detail: 'There were none in the previous period.', metric: 'leads', current: c.leads, previous: 0, link: '/leads' });
  }

  // ── Conversion rate ──
  const crChange = pctChange(c.conversionRate, p.conversionRate);
  if (c.sessions >= 100 && p.sessions >= 100 && Math.max(c.convertedSessions, p.convertedSessions) >= MIN.conversions && crChange != null && Math.abs(crChange) >= 15) {
    add({
      id: 'conversion-rate', tone: crChange > 0 ? 'good' : 'warning', weight: crChange > 0 ? 120 + Math.abs(crChange) : 500 + Math.abs(crChange),
      title: crChange > 0 ? `Your conversion rate improved by ${fmtPct(crChange)}` : `Your conversion rate dropped by ${fmtPct(crChange)}`,
      detail: `${c.conversionRate}% of visits converted, compared with ${p.conversionRate}% in the previous period.`,
      metric: 'conversionRate', current: c.conversionRate, previous: p.conversionRate, change: crChange, link: '/conversions',
    });
  }

  // ── Engagement time ──
  const eChange = pctChange(c.avgEngagementMs, p.avgEngagementMs);
  if (p.visitors >= MIN.visitors && c.visitors >= MIN.visitors && eChange != null && Math.abs(eChange) >= 20 && Math.max(c.avgEngagementMs, p.avgEngagementMs) >= 5000) {
    add({ id: 'engagement', tone: eChange > 0 ? 'good' : 'bad', weight: 60 + Math.abs(eChange) / 2, title: `Visitors spent ${fmtPct(eChange)} ${eChange > 0 ? 'more' : 'less'} time on your website`, detail: `About ${fmtDur(c.avgEngagementMs)} per visitor, compared with ${fmtDur(p.avgEngagementMs)} before.`, metric: 'avgEngagementMs', current: c.avgEngagementMs, previous: p.avgEngagementMs, change: eChange });
  }

  // ── A channel that appeared ──
  const prevCh = new Map(chPrev.map((r) => [r.value, r.sessions]));
  for (const r of chCur) {
    if (r.sessions >= MIN.sessions && !prevCh.get(r.value)) {
      add({ id: `channel-new-${r.value}`, tone: 'info', weight: 70, title: `New traffic from ${channelLabel(r.value)}`, detail: `${fmtNum(r.sessions)} visits came from ${channelLabel(r.value)}, which sent none in the previous period.`, metric: 'sessions', current: r.sessions, previous: 0, link: '/sources' });
    }
  }

  // ── Pages that grew or dropped the most ──
  const pageMovers = movers(pgCur, pgPrev, 'path', 'pageviews')
    .filter((m) => m.prev >= MIN.pageViews && Math.abs(pctChange(m.cur, m.prev)) >= 25);
  const up = pageMovers.find((m) => m.delta > 0);
  const down = pageMovers.find((m) => m.delta < 0);
  for (const m of [up, down].filter(Boolean)) {
    const ch = pctChange(m.cur, m.prev);
    add({ id: `page-${m.delta > 0 ? 'up' : 'down'}`, tone: m.delta > 0 ? 'good' : 'bad', weight: 50 + Math.min(100, Math.abs(ch)) / 2, title: `Your "${m.key}" page received ${fmtPct(ch)} ${ch > 0 ? 'more' : 'fewer'} views`, detail: `${fmtNum(m.cur)} views, compared with ${fmtNum(m.prev)} before.`, metric: 'pageviews', current: m.cur, previous: m.prev, change: ch, link: `/pages/view?path=${encodeURIComponent(m.key)}` });
  }

  // ── Devices ──
  const prevDev = new Map(devPrev.map((r) => [r.value, r.visitors]));
  for (const r of devCur) {
    const before = prevDev.get(r.value) || 0;
    const ch = pctChange(r.visitors, before);
    if (before >= MIN.device && ch != null && Math.abs(ch) >= 15 && ['mobile', 'desktop', 'tablet'].includes(r.value)) {
      add({ id: `device-${r.value}`, tone: 'info', weight: 30 + Math.abs(ch) / 4, title: `${r.value[0].toUpperCase()}${r.value.slice(1)} visitors ${updown(ch)} by ${fmtPct(ch)}`, detail: `${fmtNum(r.visitors)} compared with ${fmtNum(before)} before.`, metric: 'visitors', current: r.visitors, previous: before, change: ch });
    }
  }

  // ── Forms: completion dropped / many people abandon ──
  const fPrev = new Map(fmPrev.map((f) => [`${f.websiteId}|${f.formKey}`, f]));
  for (const f of fmCur) {
    const before = fPrev.get(`${f.websiteId}|${f.formKey}`);
    if (before && f.views >= MIN.formViews && before.views >= MIN.formViews && before.conversionRate > 0) {
      const ch = pctChange(f.conversionRate, before.conversionRate);
      if (ch <= -15) {
        add({ id: `form-${f.formKey}`, tone: 'warning', weight: 450 + Math.abs(ch), title: `Your "${f.name}" form conversion rate dropped by ${fmtPct(ch)}`, detail: `${f.conversionRate}% of people who saw it submitted it, compared with ${before.conversionRate}% in the previous period.`, metric: 'formConversionRate', current: f.conversionRate, previous: before.conversionRate, change: ch, link: '/forms' });
        continue;
      }
    }
    if (f.starts >= MIN.formViews && f.abandonment / f.starts >= 0.6) {
      add({ id: `form-abandon-${f.formKey}`, tone: 'warning', weight: 300, title: `Most people who start your "${f.name}" form don't finish it`, detail: `${fmtNum(f.abandonment)} of ${fmtNum(f.starts)} people (${Math.round((f.abandonment / f.starts) * 100)}%) started filling it and left without submitting.${f.errors ? ` Visitors also hit ${fmtNum(f.errors)} validation errors.` : ''}`, metric: 'formAbandonment', current: f.abandonment, previous: null, link: '/forms' });
    }
  }

  // ── Top source share (always useful context when there's enough traffic) ──
  const totalSessions = chCur.reduce((s, r) => s + r.sessions, 0);
  if (chCur[0] && totalSessions >= MIN.sessions) {
    add({ id: 'top-source', tone: 'info', weight: 10, title: `${channelLabel(chCur[0].value)} is your biggest source of visitors`, detail: `${Math.round((chCur[0].sessions / totalSessions) * 100)}% of visits (${fmtNum(chCur[0].sessions)}) came from ${channelLabel(chCur[0].value)}.`, metric: 'sessions', current: chCur[0].sessions, link: '/sources' });
  }

  items.sort((a, b) => b.weight - a.weight);
  const clean = items.slice(0, 8).map(({ weight, ...i }) => ({ ...i, change: i.change == null ? null : Math.round(i.change * 10) / 10 }));
  return { summary: summarise(c, p), items: clean, enoughData: c.sessions + p.sessions >= MIN.sessions };
}

/** One-line headline for the period. */
function summarise(c, p) {
  if (!c.sessions) return 'No visits recorded in this period yet.';
  const parts = [`${fmtNum(c.visitors)} visitor${c.visitors === 1 ? '' : 's'}`];
  const ch = pctChange(c.visitors, p.visitors);
  if (ch != null && p.visitors >= MIN.visitors) parts[0] += ` (${ch >= 0 ? 'up' : 'down'} ${fmtPct(ch)})`;
  if (c.leads) parts.push(`${fmtNum(c.leads)} lead${c.leads === 1 ? '' : 's'}`);
  if (c.conversions) parts.push(`${fmtNum(c.conversions)} conversion${c.conversions === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
