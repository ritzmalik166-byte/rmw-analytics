'use client';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Global filters (website + date range) live in the URL so views are shareable and the back button
 * works. The last selected website is remembered per browser.
 */
const FiltersContext = createContext(null);
const SITE_KEY = 'rmwa:site';

export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'custom', label: 'Custom range' },
];

export function FiltersProvider({ children }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: websites = [], isLoading: websitesLoading } = useQuery({ queryKey: ['websites'], queryFn: () => api('/websites'), staleTime: 30_000 });

  const site = params.get('site') || 'all';
  const range = params.get('range') || (params.get('from') ? 'custom' : '30d');
  const from = params.get('from') || '';
  const to = params.get('to') || '';

  const update = useCallback((patch) => {
    const sp = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)));
    if (sp.get('site') === 'all') sp.delete('site');
    if (sp.get('range') === '30d') sp.delete('range');
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

  const query = useMemo(() => (range === 'custom' && from ? { site, from, to: to || from } : { site, range }), [site, range, from, to]);
  const current = websites.find((w) => w.id === site) || null;
  const rangeLabel = range === 'custom' ? `${from} → ${to || from}` : RANGES.find((r) => r.key === range)?.label;

  const value = useMemo(() => ({ site, range, from, to, query, setSite, setRange, websites, websitesLoading, current, rangeLabel }), [site, range, from, to, query, setSite, setRange, websites, websitesLoading, current, rangeLabel]);
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export const useFilters = () => useContext(FiltersContext);
