'use client';
import { ChevronRight } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, pct, duration } from '@/lib/utils';
import { channelLabel, channelHint, HELP } from '@/lib/labels';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { ExportButton, Panel } from '@/components/analytics/Panel';
import { Stat, StatGrid, ShareList, RankList, Question } from '@/components/analytics/Simple';

/** Breadcrumb: All traffic › Search engines › Google. Each crumb removes the deeper filters. */
function Crumbs() {
  const { filters, setFilter } = useFilters();
  const crumbs = [{ label: 'All traffic', clear: ['channel', 'source'] }];
  if (filters.channel) crumbs.push({ label: channelLabel(filters.channel), clear: ['source'] });
  if (filters.source) crumbs.push({ label: filters.source, clear: [] });
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-[13px]" aria-label="Drill-down">
      {crumbs.map((c, i) => (
        <span key={c.label} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          {i === crumbs.length - 1 ? <span className="font-semibold text-slate-900">{c.label}</span>
            : <button className="text-[hsl(var(--primary))] hover:underline" onClick={() => c.clear.forEach((k) => setFilter(k, null))}>{c.label}</button>}
        </span>
      ))}
    </nav>
  );
}

function SourceTable({ dim, rows, isLoading, error, refetch, onPick, label }) {
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading && !rows) return <TableSkeleton rows={6} cols={6} />;
  if (!rows?.length) return <EmptyState title="No visits from here in this period" />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>{label}</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Share</TableHead><TableHead className="text-right">Avg. visit</TableHead><TableHead className="text-right">Conversions</TableHead><TableHead className="text-right">Conv. rate</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.value} className={onPick ? 'cursor-pointer' : undefined} onClick={onPick ? () => onPick(r.value) : undefined}>
              <TableCell className="max-w-[320px]"><span className="block truncate font-medium">{dim === 'channel' ? channelLabel(r.value) : r.value}</span>{dim === 'channel' && <span className="block truncate text-[11px] text-muted-foreground">{channelHint(r.value)}</span>}</TableCell>
              <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(r.sessions)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{pct(r.share)}</TableCell>
              <TableCell className="text-right tabular-nums">{duration(r.avgSessionMs)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(r.conversions)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(r.conversionRate, 2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SourcesPage() {
  const { filters, setFilter, current, rangeLabel } = useFilters();
  // Drill level: no channel → channels; channel → its sources; source → its landing pages & conversions.
  const level = filters.source ? 'source' : filters.channel ? 'channel' : 'all';
  const listDim = level === 'all' ? 'channel' : 'source';
  const list = useStats(`/stats/dimension/${listDim}`, { limit: 100 });
  const ov = useStats('/stats/overview');
  const landing = useStats('/stats/dimension/entry', { limit: 10 });
  const conv = useStats('/stats/conversions');
  const mediums = useStats('/stats/dimension/utm_medium', { limit: 10 }, { enabled: level !== 'all' });
  const c = ov.data?.current;
  const p = ov.data?.previous;
  const title = level === 'all' ? 'Traffic sources' : level === 'channel' ? channelLabel(filters.channel) : filters.source;

  return (
    <>
      <PageHeader title={title} description={`${level === 'all' ? 'Where your visitors come from' : 'Visits, pages and results from this source'} · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker showCompare /><ExportButton type="sources" /></>} />
      <Crumbs />
      <StatGrid className="xl:grid-cols-4 md:grid-cols-4">
        <Stat size="sm" label="Visitors" current={c?.visitors} previous={p?.visitors} help={HELP.visitors} loading={ov.isLoading} />
        <Stat size="sm" label="Sessions" current={c?.sessions} previous={p?.sessions} help={HELP.sessions} loading={ov.isLoading} />
        <Stat size="sm" label="Conversions" current={c?.conversions} previous={p?.conversions} help={HELP.conversions} loading={ov.isLoading} />
        <Stat size="sm" label="Conversion rate" current={c?.conversionRate} previous={p?.conversionRate} format={(v) => pct(v, 2)} help={HELP.conversionRate} loading={ov.isLoading} />
      </StatGrid>

      {level !== 'source' && (
        <>
          <Question hint={level === 'all' ? 'Click a traffic type to see the websites and platforms inside it' : 'Click a source to see where its visitors landed and what they did'}>{level === 'all' ? 'Traffic types' : `Sources within ${channelLabel(filters.channel)}`}</Question>
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <ShareList loading={list.isLoading} max={10} unit="visits" rows={list.data?.map((r) => ({ key: r.value, label: listDim === 'channel' ? channelLabel(r.value) : r.value, hint: listDim === 'channel' ? channelHint(r.value) : null, value: r.sessions, onClick: () => setFilter(listDim === 'channel' ? 'channel' : 'source', r.value) }))} />
            </Card>
            <Card className="overflow-hidden lg:col-span-3">
              <SourceTable dim={listDim} label={listDim === 'channel' ? 'Traffic type' : 'Source'} rows={list.data} isLoading={list.isLoading} error={list.error} refetch={list.refetch} onPick={(v) => setFilter(listDim === 'channel' ? 'channel' : 'source', v)} />
            </Card>
          </div>
        </>
      )}

      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Question hint="First page of each visit">Landing pages</Question>
          <Card><RankList loading={landing.isLoading} valueLabel="Visits" rows={landing.data?.map((r) => ({ key: r.value, label: r.value, sub: r.conversions ? `${num(r.conversions)} converted` : null, value: r.sessions, href: `/pages/view?path=${encodeURIComponent(r.value)}` }))} /></Card>
        </div>
        <div className="lg:col-span-1">
          <Question hint="Goals completed by these visitors">Conversions</Question>
          <Card><RankList loading={conv.isLoading} empty="No conversions from this traffic yet" valueLabel="Completed" rows={conv.data?.byGoal?.map((g) => ({ key: g.goal, label: g.goal, value: g.count }))} /></Card>
        </div>
        {level !== 'all' ? (
          <div className="lg:col-span-1">
            <Question hint="From utm_medium tags on your links">Medium</Question>
            <Card><ShareList loading={mediums.isLoading} unit="visits" empty="No medium tags" rows={mediums.data?.map((r) => ({ key: r.value, label: r.value, value: r.sessions, onClick: () => setFilter('medium', r.value) }))} /></Card>
          </div>
        ) : (
          <div className="lg:col-span-1">
            <Question hint="Conversions by how visitors arrived">What brings results?</Question>
            <Card><ShareList loading={conv.isLoading} unit="conversions" empty="No conversions in this period" rows={conv.data?.byChannel?.map((r) => ({ key: r.value, label: channelLabel(r.value), value: r.conversions, onClick: () => setFilter('channel', r.value) }))} /></Card>
          </div>
        )}
      </div>
      {level === 'source' && (
        <Panel className="mt-4" title="Visitors from this source on each page" href="/pages">
          <p className="px-4 py-3 text-[13px] text-muted-foreground">Open <b>Pages</b> or <b>Events</b> from the menu: every report now shows only visitors from {filters.source}. Remove the filter at the top to see everyone again.</p>
        </Panel>
      )}
    </>
  );
}
