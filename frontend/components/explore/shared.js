import { EVENT_LABELS } from '@rmw-analytics/shared/events';
import { num, pct, duration, countryName, flag, titleCase, toQuery } from '@/lib/utils';
import { channelLabel } from '@/lib/labels';

/** Building blocks shared by the explorations list, the editor and its three canvases. */

export const TECHNIQUES = {
  freeform: { label: 'Free-form', hint: 'Custom tables and charts: break any metric down by any dimension.' },
  funnel: { label: 'Funnel exploration', hint: 'How many visitors complete each step towards a goal, and where they drop off.' },
  path: { label: 'Path exploration', hint: 'What visitors do step by step, as a tree you expand.' },
};

export const COLORS = ['#1a73e8', '#f9ab00', '#d93025', '#188038', '#7b1fa2', '#12b5cb', '#e8710a', '#5f6368'];
export const SEGMENT_COLORS = ['#1a73e8', '#e8710a', '#188038', '#a142f4'];

export const DEFAULT_CONFIG = {
  freeform: { viz: 'table', dims: ['channel'], metrics: ['users', 'sessions', 'engagementRate', 'conversionRate'], segments: [], showRows: 25, compare: false, sort: null, order: 'desc' },
  funnel: {
    steps: [{ type: 'path', match: '*', label: 'Visited the website' }, { type: 'form', match: 'start', label: 'Started a form' }, { type: 'form', match: 'submit', label: 'Submitted a form' }],
    windowHours: 72, segments: [], viz: 'bars',
  },
  path: { nodeType: 'page', start: '', chain: [], unique: true, segment: null },
};

/** Ready-made explorations (the "Template gallery"). */
export const TEMPLATES = [
  { name: 'Traffic by day', hint: 'Active users, sessions and views each day', technique: 'freeform', config: { viz: 'line', dims: ['date'], metrics: ['activeUsers', 'sessions', 'pageviews', 'conversions'] } },
  { name: 'Where visitors come from', hint: 'Traffic type and source with results', technique: 'freeform', config: { viz: 'table', dims: ['channel', 'source'], metrics: ['users', 'sessions', 'engagementRate', 'conversionRate'] } },
  { name: 'Most viewed pages', hint: 'Views and viewers for every page', technique: 'freeform', config: { viz: 'bar', dims: ['pagePath'], metrics: ['views', 'viewers'] } },
  { name: 'Landing pages that convert', hint: 'First page of each visit and its results', technique: 'freeform', config: { viz: 'table', dims: ['landingPage'], metrics: ['sessions', 'bounceRate', 'conversions', 'conversionRate'] } },
  { name: 'Users by country & device', hint: 'Where people are and what they use', technique: 'freeform', config: { viz: 'table', dims: ['country', 'device'], metrics: ['users', 'newUsers', 'avgEngagementTime'] } },
  { name: 'Mobile vs desktop', hint: 'The same report for two segments side by side', technique: 'freeform', config: { viz: 'bar', dims: ['channel'], metrics: ['users', 'conversionRate'], segments: ['mobile', 'desktop'] } },
  { name: 'What people do', hint: 'Every action, how often and by how many', technique: 'freeform', config: { viz: 'bar', dims: ['eventName'], metrics: ['eventCount', 'eventUsers', 'eventsPerUser'] } },
  { name: 'Campaign performance', hint: 'UTM campaigns and their results', technique: 'freeform', config: { viz: 'table', dims: ['campaign', 'medium'], metrics: ['sessions', 'engagementRate', 'conversions', 'conversionRate'] } },
  { name: 'Enquiry funnel', hint: 'Visit → contact page → form → submitted', technique: 'funnel', config: { steps: [{ type: 'path', match: '*', label: 'Visited the website' }, { type: 'path', match: '/contact*', label: 'Opened the contact page' }, { type: 'form', match: 'start', label: 'Started the form' }, { type: 'form', match: 'submit', label: 'Submitted the form' }] } },
  { name: 'Page journeys', hint: 'Which pages people open after the homepage', technique: 'path', config: { nodeType: 'page', start: '/', chain: ['/'] } },
  { name: 'Action journeys', hint: 'What visitors do after viewing a page', technique: 'path', config: { nodeType: 'event', start: '', chain: [] } },
];

/** Suggested segments, like GA's "Direct traffic", "Mobile traffic"… Keys are stable ids. */
export const SUGGESTED_SEGMENTS = [
  { id: 'direct', name: 'Direct traffic', conditions: { channel: 'direct' } },
  { id: 'search', name: 'Search engine traffic', conditions: { channel: 'organic_search' } },
  { id: 'paid', name: 'Paid search traffic', conditions: { channel: 'paid_search' } },
  { id: 'social', name: 'Social media traffic', conditions: { channel: 'organic_social' } },
  { id: 'mobile', name: 'Mobile traffic', conditions: { device: 'mobile' } },
  { id: 'desktop', name: 'Desktop traffic', conditions: { device: 'desktop' } },
  { id: 'tablet', name: 'Tablet traffic', conditions: { device: 'tablet' } },
  { id: 'india', name: 'Visitors from India', conditions: { country: 'IN' } },
  { id: 'submitted', name: 'Submitted a form', conditions: { event: 'form_submit' } },
];

export const CONDITION_FIELDS = [
  { key: 'device', label: 'Device', dim: 'device' },
  { key: 'country', label: 'Country', dim: 'country' },
  { key: 'channel', label: 'Traffic type', dim: 'channel' },
  { key: 'source', label: 'Source', dim: 'source' },
  { key: 'medium', label: 'Medium', dim: 'utm_medium' },
  { key: 'campaign', label: 'Campaign', dim: 'utm_campaign' },
  { key: 'page', label: 'Viewed page', dim: 'page' },
  { key: 'event', label: 'Did action', dim: 'event' },
];

export const uid = () => Math.random().toString(36).slice(2, 10);

/** API query for an exploration's website + dates, narrowed to one segment. */
export function viewQuery(exp, segment) {
  const r = exp?.range || { key: '28d' };
  const q = r.key === 'custom' && r.from ? { site: exp.site || 'all', from: r.from, to: r.to || r.from } : { site: exp?.site || 'all', range: r.key };
  for (const [k, v] of Object.entries(segment?.conditions || {})) if (v) q[`f_${k}`] = v;
  return q;
}
export const queryString = (o) => toQuery(o);

export function formatMetric(m, v) {
  if (v == null) return '—';
  switch (m?.format) {
    case 'percent': return pct(v, 1);
    case 'duration': return duration(v);
    case 'decimal': return Number(v).toFixed(2);
    default: return num(v);
  }
}

const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
export const dayLabel = (t) => fmtDay.format(new Date(`${t}T00:00:00`));

export function formatDim(d, v) {
  if (v == null) return '—';
  if (v === '(unknown)') return 'Unknown';
  switch (d) {
    case 'channel': return channelLabel(v);
    case 'country': return `${flag(v)} ${countryName(v)}`;
    case 'device': case 'userType': return titleCase(v);
    case 'eventName': return EVENT_LABELS[v] || v;
    case 'date': return dayLabel(v);
    case 'pagePath': case 'landingPage': case 'exitPage': return v === '/' ? 'Homepage (/)' : v;
    default: return v;
  }
}

/** Plain label for a path node (event name or page). */
export function nodeLabel(nodeType, v) {
  if (v === '(exit)') return 'Left the website';
  if (nodeType === 'page') return v === '/' ? 'Homepage (/)' : v;
  return EVENT_LABELS[v] || v;
}

/** One-line summary of a segment's conditions ("Device is mobile · Country is IN"). */
export function describeSegment(s) {
  return Object.entries(s?.conditions || {}).filter(([, v]) => v).map(([k, v]) => `${CONDITION_FIELDS.find((f) => f.key === k)?.label || k} is ${k === 'channel' ? channelLabel(v) : v}`).join(' · ');
}

export function lastModified(v) {
  const d = new Date(v);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** CSV download from rows of arrays. */
export function downloadCsv(name, lines) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'exploration'}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
