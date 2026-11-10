'use client';
import { useState } from 'react';
import { useStats } from '@/lib/hooks';
import { num, pct, duration } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarList } from './BarList';
import { Panel, ExportButton } from './Panel';
import { RangePicker } from './RangePicker';

/**
 * Generic breakdown page: tabs of dimensions, a ranked bar list and a full metrics table.
 * dims: [{ key, label, format?: (value) => ReactNode, icon?: (value) => ReactNode }]
 */
export function DimensionPage({ title, description, dims, exportType, aside }) {
  const [dim, setDim] = useState(dims[0].key);
  const def = dims.find((d) => d.key === dim);
  const { current, rangeLabel } = useFilters();
  const { data, isLoading, error, refetch } = useStats(`/stats/dimension/${dim}`, { limit: 200 });
  const label = (v) => (def.format ? def.format(v) : v);

  return (
    <>
      <PageHeader title={title} description={`${description} · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker />{exportType && <ExportButton type={exportType} />}</>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title={`Top ${def.label.toLowerCase()}`} tabs={dims.length > 1 ? dims.map((d) => ({ key: d.key, label: d.label })) : undefined} tab={dim} onTab={setDim} className="lg:col-span-2" error={error} onRetry={refetch}>
          <BarList loading={isLoading} max={12} rows={data?.map((r) => ({ key: r.value, label: label(r.value), icon: def.icon?.(r.value), value: r.sessions || r.count }))} valueLabel={dim === 'event' ? 'Events' : 'Sessions'} />
        </Panel>
        <Card className="overflow-hidden lg:col-span-3">
          <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">{def.label} · all metrics</h3></div>
          {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={8} cols={6} /> : !data?.length ? <EmptyState title="No data for this period" /> : (
            <div className="max-h-[620px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>{def.label}</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Share</TableHead><TableHead className="text-right">Bounce</TableHead><TableHead className="text-right">Avg. session</TableHead><TableHead className="text-right">Conv.</TableHead><TableHead className="text-right">Conv. rate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.value}>
                      <TableCell className="max-w-[280px] truncate"><span className="flex items-center gap-2">{def.icon?.(r.value)}{label(r.value)}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.sessions)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{pct(r.share)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.bounceRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{duration(r.avgSessionMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.conversions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.conversionRate, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
      {aside}
    </>
  );
}
