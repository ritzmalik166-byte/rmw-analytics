import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const dtf = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const hm = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDateTime = (v) => (v ? dtf.format(new Date(v)) : '—');
export const formatDate = (v) => (v ? df.format(new Date(v)) : '—');
export const formatTime = (v) => (v ? tf.format(new Date(v)) : '—');
export const formatHm = (v) => (v ? hm.format(new Date(v)) : '—');

export function timeAgo(v) {
  if (!v) return '—';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) {
    const n = Math.floor(Math.abs(s) / sec);
    if (n >= 1) return s > 0 ? `${n} ${u}${n > 1 ? 's' : ''} ago` : `in ${n} ${u}${n > 1 ? 's' : ''}`;
  }
  return 'just now';
}

export const titleCase = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const nf = new Intl.NumberFormat('en-IN');
export const num = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : nf.format(Number(v)));

/** Compact numbers for tiles/axes: 1.2K, 3.4L (Indian lakh style is confusing on axes, so K/M). */
export function compact(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export const pct = (v, d = 1) => (v == null ? '—' : `${Number(v).toFixed(d).replace(/\.0+$/, '')}%`);

/** 125000 → "2m 05s" */
export function duration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** % change between periods; null when there is no baseline. */
export function change(cur, prev) {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(code) {
  if (!code) return 'Unknown';
  try { return regionNames?.of(code) || code; } catch { return code; }
}
export function flag(code) {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
}

export const shortVisitor = (id) => `#${String(id || '').replace(/^v_/, '').slice(0, 6).toUpperCase()}`;

export function toQuery(params) {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const STATUS_COLORS = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
};

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select();
    const okCopy = document.execCommand('copy'); ta.remove();
    return okCopy;
  }
}
