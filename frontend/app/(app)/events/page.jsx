'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStats } from '@/lib/hooks';
import { cn, num, formatDateTime, shortVisitor } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { Panel } from '@/components/analytics/Panel';
import { BarList } from '@/components/analytics/BarList';
import { Stat, StatGrid } from '@/components/analytics/Simple';
import { MarkConversionButton } from '@/components/analytics/MarkConversion';
import { EVENT_NAMES } from '@rmw-analytics/shared/events';

/** Background events that make no sense as conversions. */
const NOT_CONVERTIBLE = new Set(['session_start', 'page_view', 'route_change', 'page_leave', 'scroll', 'visibility_hidden', 'js_error', 'rage_click', 'dead_click', 'conversion', 'identify']);

const AUTO = new Set(EVENT_NAMES);

function EventDetail({ name }) {
  const { data, isLoading, error, refetch } = useStats(`/stats/events/${encodeURIComponent(name)}`);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold">{data?.label || name}</h2>
          <p className="font-mono text-[11px] text-muted-foreground">{name}{!AUTO.has(name) && ' · custom event'}</p>
        </div>
        {!NOT_CONVERTIBLE.has(name) && <MarkConversionButton event={name} label={data?.label && data.label !== name ? data.label : name} />}
      </div>
      <StatGrid className="grid-cols-3 md:grid-cols-3">
        <Stat size="sm" label="Times it happened" current={data?.count} loading={isLoading && !data} />
        <Stat size="sm" label="People" current={data?.visitors} loading={isLoading && !data} help="Different visitors who did this at least once." />
        <Stat size="sm" label="Per person" value={data ? String(data.perVisitor) : undefined} loading={isLoading && !data} help="Average times each of those people did it." />
      </StatGrid>
      <Card className="overflow-hidden">
        <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">{data?.label || name} · per day</h3></div>
        <div className="h-[180px] px-2 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.byDay || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="t" tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={20} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip formatter={(v) => [num(v), 'Events']} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
              <Bar dataKey="count" fill="#194173" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Top pages"><BarList loading={isLoading} valueLabel="Events" rows={data?.byPath?.map((r) => ({ key: r.path, label: r.path, value: r.count }))} /></Panel>
        <Panel title="Property values"><BarList loading={isLoading} valueLabel="Events" rows={data?.props?.map((r) => ({ key: `${r.key}=${r.value}`, label: <span><span className="text-muted-foreground">{r.key}</span> = {String(r.value)}</span>, value: r.count }))} empty="No properties recorded" /></Panel>
      </div>
      <Panel title="Recent occurrences">
        {!data?.recent?.length ? <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">None</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Visitor</TableHead><TableHead>Page</TableHead><TableHead>Properties</TableHead></TableRow></TableHeader>
            <TableBody>{data.recent.map((e, i) => <TableRow key={i}><TableCell className="whitespace-nowrap text-[12px]">{formatDateTime(e.ts)}</TableCell><TableCell className="font-mono text-[12px]">{shortVisitor(e.visitorId)}</TableCell><TableCell className="max-w-[200px] truncate">{e.page?.path}</TableCell><TableCell className="max-w-[360px] truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(e.props || {})}</TableCell></TableRow>)}</TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export default function EventsPage() {
  const { current, rangeLabel } = useFilters();
  const { data, isLoading, error, refetch } = useStats('/stats/dimension/event', { limit: 200 });
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const rows = (data || []).filter((r) => (filter === 'custom' ? !AUTO.has(r.value) : filter === 'auto' ? AUTO.has(r.value) : true));
  const sel = selected || rows[0]?.value;
  return (
    <>
      <PageHeader title="Events" description={`Everything visitors did: tracked automatically, plus your own analytics.track() events · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b bg-[hsl(214_25%_97%)] px-3 py-1.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Events</h3>
            <div className="flex gap-1">{[['all', 'All'], ['custom', 'Custom'], ['auto', 'Automatic']].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={cn('rounded px-2 py-0.5 text-[11px] font-medium', filter === k ? 'bg-white text-primary ring-1 ring-slate-200' : 'text-slate-500')}>{l}</button>)}</div>
          </div>
          {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={10} cols={3} /> : !rows.length ? <EmptyState title="No events in this period" description="Use analytics.track('event_name', {…}) for custom events." /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">People</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.value} data-state={r.value === sel ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelected(r.value)}>
                    <TableCell><span className="font-medium">{r.label}</span>{r.label !== r.value && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{r.value}</span>}{!AUTO.has(r.value) && <span className="ml-1.5 rounded-sm bg-violet-50 px-1 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">custom</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <div className="lg:col-span-3">{sel ? <EventDetail name={sel} /> : null}</div>
      </div>
    </>
  );
}
