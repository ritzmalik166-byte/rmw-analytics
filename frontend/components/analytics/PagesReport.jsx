'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { cn, num, pct, duration } from '@/lib/utils';
import { HELP } from '@/lib/labels';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { ExportButton } from '@/components/analytics/Panel';
import { InfoTip } from '@/components/analytics/Simple';

const MODES = {
  pages: { title: 'Pages', description: 'Every page people viewed', sort: 'pageviews', bar: 'pageviews' },
  landing: { title: 'Landing pages', description: 'The first page people saw when they arrived', sort: 'entries', bar: 'entries' },
  exit: { title: 'Exit pages', description: 'The last page people saw before leaving', sort: 'exits', bar: 'exits' },
};
const SORTS = [['pageviews', 'Views'], ['visitors', 'Visitors'], ['entries', 'Entries'], ['exits', 'Exits'], ['avgTimeMs', 'Engagement time']];

export function PagesReport({ mode = 'pages' }) {
  const m = MODES[mode];
  const { current, rangeLabel, linkQuery } = useFilters();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(m.sort);
  const [order, setOrder] = useState('desc');
  const { data, isLoading, error, refetch } = useStats('/stats/pages', { q: q.trim() || undefined, sort, order, limit: 300 });
  const max = Math.max(1, ...(data || []).map((r) => r[m.bar] || 0));
  const th = (key, label, help) => <TableHead className={cn('text-right', sort === key && 'text-slate-900')}><span className="inline-flex items-center gap-1">{label}<InfoTip text={help} /></span></TableHead>;
  return (
    <>
      <PageHeader title={m.title} description={`${m.description} · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker /><ExportButton type="pages" /></>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative w-full max-w-xs"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Find a page by address or name, e.g. Eldeco" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="w-48" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">{SORTS.map(([k, l]) => <option key={k} value={k}>Sort by {l.toLowerCase()}</option>)}</Select>
          <div className="flex rounded border text-[12px]" role="group" aria-label="Order">
            {[['desc', 'Most'], ['asc', 'Least']].map(([k, l]) => <button key={k} onClick={() => setOrder(k)} className={cn('px-2.5 py-1', order === k ? 'bg-[hsl(var(--primary))] text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>)}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{data ? `${data.length} pages · click a page for its full report` : ''}</span>
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={10} cols={7} /> : !data?.length ? <EmptyState title="No page views in this period" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Page</TableHead>
                {th('pageviews', 'Views', HELP.pageviews)}{th('visitors', 'Visitors')}{th('entries', 'Entries', 'Visits that started on this page')}{th('exits', 'Exits', 'Visits that ended on this page')}
                {th('exitRate', 'Exit rate', HELP.exitRate)}{th('avgTimeMs', 'Engagement time', 'Average active time per view')}{th('avgScroll', 'Scrolled', 'Average share of the page scrolled')}
              </TableRow></TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.path}>
                    <TableCell className="relative max-w-[420px]">
                      <span className="absolute inset-y-1 left-0 rounded-sm bg-[hsl(213_62%_26%/0.07)]" style={{ width: `${((r[m.bar] || 0) / max) * 100}%` }} aria-hidden />
                      <Link href={withView(`/pages/view?path=${encodeURIComponent(r.path)}`, linkQuery)} className="relative block truncate font-medium text-[hsl(var(--primary))] hover:underline" title={r.path}>{r.path === '/' ? 'Homepage (/)' : r.path}</Link>
                      {r.title && <span className="relative block truncate text-[11px] text-muted-foreground">{r.title}</span>}
                      <span className="relative mt-0.5 flex flex-wrap gap-x-2.5 text-[11px]">
                        {[['visits', 'Visits'], ['visitors', 'Visitors'], ['clicks', 'Clicks'], ['recordings', 'Recordings']].map(([t, l]) => (
                          <Link key={t} href={withView(`/pages/view?path=${encodeURIComponent(r.path)}&tab=${t}`, linkQuery)} className="font-medium text-slate-500 hover:text-[hsl(var(--primary))] hover:underline">{l}</Link>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{num(r.pageviews)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.entries)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.exits)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.exitRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{duration(r.avgTimeMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.avgScroll, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
