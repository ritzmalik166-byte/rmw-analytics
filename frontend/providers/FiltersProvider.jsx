'use client';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Global filters (website, date range, comparison and report filters) live in the URL so views are
 * shareable and the back button works. The last selected website is remembered per browser.
 */
const FiltersContext = createContext(null);
const SITE_KEY = 'rmwa:site';

export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '28d', label: 'Last 28 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'custom', label: 'Custom range' },
];
const LEGACY_RANGES = { '24h': 'Last 24 hours' };

/**
 * Report filters, in plain words. `dim` is the breakdown that lists the possible values (see FilterBar).
 * Sent to the API as f_<key>=value; every report then counts only the matching visits.
 */
export const FILTERS = [
  { key: 'device', label: 'Device', dim: 'device' },
  { key: 'country', label: 'Country', dim: 'country' },
  { key: 'channel', label: 'Traffic type', dim: 'channel' },
  { key: 'source', label: 'Source', dim: 'source' },
  { key: 'medium', label: 'Medium', dim: 'utm_medium' },
  { key: 'campaign', label: 'Campaign', dim: 'utm_campaign' },
  { key: 'page', label: 'Page visited', dim: 'page' },
  { key: 'event', label: 'Action taken', dim: 'event' },
];
const FILTER_PARAMS = FILTERS.map((f) => `f_${f.key}`);
/** URL params that carry over when moving between reports. */
const CARRY = ['site', 'range', 'from', 'to', 'cmp', ...FILTER_PARAMS];

export function FiltersProvider({ children }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: websites = [], isLoading: websitesLoading } = useQuery({ queryKey: ['websites'], queryFn: () => api('/websites'), staleTime: 30_000 });

  const site = params.get('site') || 'all';
  const range = params.get('range') || (params.get('from') ? 'custom' : '28d');
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const compare = params.get('cmp') !== 'off';
  const paramsKey = params.toString();
  const filters = useMemo(() => {
    const out = {};
    for (const f of FILTERS) { const v = params.get(`f_${f.key}`); if (v) out[f.key] = v; }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const update = useCallback((patch) => {
    const sp = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)));
    if (sp.get('site') === 'all') sp.delete('site');
    if (sp.get('range') === '28d') sp.delete('range');
    const s = sp.toString();
    router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
  }, [params, pathname, router]);

  // Restore the remembered website when the URL doesn't specify one.
  useEffect(() => {
    if (params.get('site') || !websites.length) return;
    try {
      const saved = localStorage.getItem(SITE_KEY);
      if (saved && saved !== 'all' && websites.some((w) => w.id === saved)) update({ site: saved });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websites.length]);

  const setSite = useCallback((id) => {
    try { localStorage.setItem(SITE_KEY, id); } catch { /* ignore */ }
    update({ site: id });
  }, [update]);
  const setRange = useCallback((key, custom) => {
    if (key === 'custom') update({ range: null, from: custom?.from, to: custom?.to });
    else update({ range: key, from: null, to: null });
  }, [update]);
  const setCompare = useCallback((on) => update({ cmp: on ? null : 'off' }), [update]);
  const setFilter = useCallback((key, value) => update({ [`f_${key}`]: value || null }), [update]);
  const clearFilters = useCallback(() => update(Object.fromEntries(FILTER_PARAMS.map((k) => [k, null]))), [update]);

  const query = useMemo(() => {
    const base = range === 'custom' && from ? { site, from, to: to || from } : { site, range };
    for (const [k, v] of Object.entries(filters)) base[`f_${k}`] = v;
    return base;
  }, [site, range, from, to, filters]);
  /** "?site=…&range=…&f_device=…" for links to other reports, so the same view carries over. */
  const linkQuery = useMemo(() => {
    const sp = new URLSearchParams();
    for (const k of CARRY) { const v = params.get(k); if (v) sp.set(k, v); }
    const s = sp.toString();
    return s ? `?${s}` : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);
  const current = websites.find((w) => w.id === site) || null;
  const rangeLabel = range === 'custom' ? `${from} → ${to || from}` : RANGES.find((r) => r.key === range)?.label || LEGACY_RANGES[range] || range;

  const value = useMemo(() => ({
    site, range, from, to, query, setSite, setRange, websites, websitesLoading, current, rangeLabel,
    compare, setCompare, filters, setFilter, clearFilters, linkQuery,
  }), [site, range, from, to, query, setSite, setRange, websites, websitesLoading, current, rangeLabel, compare, setCompare, filters, setFilter, clearFilters, linkQuery]);
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export const useFilters = () => useContext(FiltersContext);

/** Append the current view's query (site, dates, filters) to an internal link, keeping any of its own params. */
export function withView(href, linkQuery) {
  if (!linkQuery) return href;
  if (!href.includes('?')) return `${href}${linkQuery}`;
  const [path, own] = href.split('?');
  const sp = new URLSearchParams(linkQuery.slice(1));
  new URLSearchParams(own).forEach((v, k) => sp.set(k, v));
  return `${path}?${sp}`;
}
