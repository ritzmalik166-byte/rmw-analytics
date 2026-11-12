'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X, SlidersHorizontal, Search } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { EVENT_LABELS } from '@rmw-analytics/shared/events';
import { api } from '@/lib/api';
import { cn, countryName, flag, num, titleCase, toQuery } from '@/lib/utils';
import { useFilters, FILTERS } from '@/providers/FiltersProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/feedback';

/** Human label for a filter value ("organic_search" → "Organic search", "IN" → "🇮🇳 India"). */
export function filterValueLabel(key, v) {
  if (v == null) return '';
  switch (key) {
    case 'device': return titleCase(v);
    case 'country': return `${flag(v)} ${countryName(v)}`;
    case 'channel': return CHANNELS[v] || v;
    case 'event': return EVENT_LABELS[v] || v;
    default: return v;
  }
}

/** Possible values for one filter: the top values in the current date range (other filters applied). */
function useOptions(def, open) {
  const { query } = useFilters();
  const q = { ...query, [`f_${def?.key}`]: undefined };
  return useQuery({
    queryKey: ['filter-options', def?.key, q],
    enabled: Boolean(open && def),
    queryFn: async () => {
      if (def.key === 'page') {
        const rows = await api(`/stats/pages${toQuery({ ...q, limit: 100 })}`);
        return rows.map((r) => ({ value: r.path, count: r.pageviews, hint: r.title }));
      }
      const rows = await api(`/stats/dimension/${def.dim}${toQuery({ ...q, limit: 60 })}`);
      return rows.map((r) => ({ value: r.value, count: def.key === 'event' ? r.count : r.sessions }));
    },
  });
}

function ValuePicker({ def, onClose }) {
  const { setFilter } = useFilters();
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useOptions(def, true);
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data || []).filter((o) => !s || String(o.value).toLowerCase().includes(s) || filterValueLabel(def.key, o.value).toLowerCase().includes(s));
  }, [data, search, def.key]);
  const pick = (v) => { setFilter(def.key, v); onClose(); };
  const free = ['page', 'campaign', 'source', 'medium'].includes(def.key) && search.trim() && !list.some((o) => o.value === search.trim());
  return (
    <>
      <div className="relative">
        <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input autoFocus className="pl-8" placeholder={`Search ${def.label.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="-mx-1 max-h-[340px] overflow-y-auto">
        {isLoading && <div className="space-y-2 p-1">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>}
        {error && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Couldn't load the options. {error.message}</p>}
        {free && (
          <button onClick={() => pick(search.trim())} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" />Use “{search.trim()}”
          </button>
        )}
        {list.map((o) => (
          <button key={o.value} onClick={() => pick(o.value)} className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-[13px] hover:bg-slate-50">
            <span className="min-w-0 flex-1"><span className="block truncate">{filterValueLabel(def.key, o.value)}</span>{o.hint && <span className="block truncate text-[11px] text-muted-foreground">{o.hint}</span>}</span>
            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{num(o.count)}</span>
          </button>
        ))}
        {!isLoading && !error && !list.length && !free && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No {def.label.toLowerCase()} values in this period.</p>}
      </div>
    </>
  );
}

/**
 * "Showing: All visitors  [+ Add filter]" or "Showing: Device is Mobile ✕ · Traffic type is Organic search ✕".
 * Every report on the page counts only the visits that match all filters.
 */
export function FilterBar({ className }) {
  const { filters, setFilter, clearFilters } = useFilters();
  const [picking, setPicking] = useState(null);
  const active = FILTERS.filter((f) => filters[f.key]);
  const available = FILTERS.filter((f) => !filters[f.key]);
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-1.5 text-[13px]', className)}>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" />Showing:</span>
      {!active.length && <span className="font-medium text-slate-700">All visitors</span>}
      {active.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-[hsl(213_70%_95%)] py-0.5 pl-2.5 pr-1 text-[12px] text-[hsl(var(--primary))] ring-1 ring-[hsl(213_60%_85%)]">
          <span className="text-slate-600">{f.label} is</span>
          <span className="max-w-[220px] truncate font-semibold" title={filters[f.key]}>{filterValueLabel(f.key, filters[f.key])}</span>
          <button onClick={() => setFilter(f.key, null)} className="rounded-full p-0.5 hover:bg-white" aria-label={`Remove ${f.label} filter`}><X className="h-3 w-3" /></button>
        </span>
      ))}
      {available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"><Plus className="h-3.5 w-3.5" />Add filter</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Only show visitors by</DropdownMenuLabel>
            {available.map((f) => <DropdownMenuItem key={f.key} onSelect={() => setPicking(f)}>{f.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {active.length > 1 && <button onClick={clearFilters} className="text-[12px] text-muted-foreground underline-offset-2 hover:underline">Clear all</button>}
      <Dialog open={Boolean(picking)} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Filter by {picking?.label.toLowerCase()}</DialogTitle>
            <DialogDescription>Every report will count only the visits that match. Numbers show visits in the selected dates.</DialogDescription>
          </DialogHeader>
          {picking && <ValuePicker def={picking} onClose={() => setPicking(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
