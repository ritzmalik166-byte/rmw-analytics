'use client';
import { Search } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, timeAgo } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Kpi, KpiGrid } from '@/components/analytics/Kpi';
import { TrendChart } from '@/components/analytics/TrendChart';
import { BarList } from '@/components/analytics/BarList';
import { Panel, ExportButton } from '@/components/analytics/Panel';
import { RangePicker } from '@/components/analytics/RangePicker';

export default function SearchesPage() {
  const { current, rangeLabel } = useFilters();
  const { data, isLoading, error, refetch } = useStats('/stats/searches');
  const max = Math.max(1, ...(data?.top || []).map((r) => r.count));
  return (
    <>
      <PageHeader title="Searches" description={`What visitors search for on your sites · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker /><ExportButton type="searches" /></>} />
      <KpiGrid className="xl:grid-cols-4">
        <Kpi label="Searches" value={num(data?.totals?.searches)} loading={isLoading} />
        <Kpi label="Visitors who searched" value={num(data?.totals?.searchers)} loading={isLoading} />
        <Kpi label="Unique queries" value={num(data?.totals?.unique)} loading={isLoading} />
        <Kpi label="Zero-result queries" value={num(data?.zeroResults?.length)} loading={isLoading} hint="Queries that returned nothing" />
      </KpiGrid>
      <Card className="mt-4 overflow-hidden"><TrendChart data={data?.byDay} loading={isLoading} metrics={[{ key: 'count', label: 'Searches' }]} height={200} /></Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Top searches</h3></div>
          {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={10} cols={5} /> : !data?.top?.length ? <EmptyState icon={Search} title="No searches tracked" description="Search boxes are detected automatically. You can also call analytics.trackSearch('3 BHK Noida')." /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Query</TableHead><TableHead className="text-right">Searches</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Avg. results</TableHead><TableHead>Last searched</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.top.map((r) => (
                  <TableRow key={r.normalized}>
                    <TableCell className="relative max-w-[320px]">
                      <span className="absolute inset-y-1 left-0 rounded-sm bg-[hsl(213_62%_26%/0.07)]" style={{ width: `${(r.count / max) * 100}%` }} aria-hidden />
                      <span className="relative truncate font-medium">{r.query}</span>
                      {r.zeroResults > 0 && <span className="relative ml-2 rounded-sm bg-amber-50 px-1 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">{r.zeroResults} empty</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{num(r.count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avgResults ?? '—'}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{timeAgo(r.lastSearched)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <div className="space-y-4">
          <Panel title="Zero-result searches"><BarList loading={isLoading} valueLabel="Searches" empty="None — or result counts aren't being sent" rows={data?.zeroResults?.map((r) => ({ key: r.query, label: r.query, value: r.count }))} /></Panel>
          <Panel title="Categories"><BarList loading={isLoading} valueLabel="Searches" empty="No categories sent" rows={data?.categories?.map((r) => ({ key: r.category, label: r.category, value: r.count }))} /></Panel>
          <Panel title="Search pages"><BarList loading={isLoading} valueLabel="Searches" rows={data?.pages?.map((r) => ({ key: r.path, label: r.path, value: r.count }))} /></Panel>
        </div>
      </div>
    </>
  );
}
