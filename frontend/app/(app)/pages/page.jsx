'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, pct, duration } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { ExportButton } from '@/components/analytics/Panel';

const SORTS = [['pageviews', 'Page views'], ['visitors', 'Visitors'], ['entries', 'Entries'], ['exits', 'Exits'], ['avgTimeMs', 'Time on page']];

export default function PagesPage() {
  const { current, rangeLabel } = useFilters();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('pageviews');
  const { data, isLoading, error, refetch } = useStats('/stats/pages', { q: q.trim() || undefined, sort, limit: 300 });
  const max = Math.max(1, ...(data || []).map((r) => r.pageviews));
  return (
    <>
      <PageHeader title="Pages" description={`Page views, entries, exits and engagement per path · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker /><ExportButton type="pages" /></>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-2">
          <div className="relative w-full max-w-xs"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Filter paths, e.g. /project" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="w-44" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">{SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}</Select>
          <span className="ml-auto text-xs text-muted-foreground">{data ? `${data.length} pages` : ''}</span>
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={10} cols={7} /> : !data?.length ? <EmptyState title="No page views in this period" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Page</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Entries</TableHead><TableHead className="text-right">Exits</TableHead><TableHead className="text-right">Exit rate</TableHead><TableHead className="text-right">Avg. time</TableHead><TableHead className="text-right">Avg. scroll</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.path}>
                  <TableCell className="relative max-w-[420px]">
                    <span className="absolute inset-y-1 left-0 rounded-sm bg-[hsl(213_62%_26%/0.07)]" style={{ width: `${(r.pageviews / max) * 100}%` }} aria-hidden />
                    <span className="relative block truncate font-medium" title={r.path}>{r.path}</span>
                    {r.title && <span className="relative block truncate text-[11px] text-muted-foreground">{r.title}</span>}
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
        )}
      </Card>
    </>
  );
}
