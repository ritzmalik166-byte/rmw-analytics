'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { api } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { num, pct, duration, countryName, flag, timeAgo, toQuery, titleCase } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, Skeleton } from '@/components/ui/feedback';
import { DashboardSkeleton } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Kpi, KpiGrid } from '@/components/analytics/Kpi';
import { TrendChart } from '@/components/analytics/TrendChart';
import { BarList } from '@/components/analytics/BarList';
import { Panel, ExportButton } from '@/components/analytics/Panel';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WebsiteDot } from '@/components/analytics/WebsiteDot';

const METRICS = [
  { key: 'visitors', label: 'Visitors' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'pageviews', label: 'Page views' },
  { key: 'leads', label: 'Leads' },
  { key: 'conversions', label: 'Conversions' },
];

function SourcesPanel() {
  const [tab, setTab] = useState('channel');
  const dim = tab === 'campaign' ? 'utm_campaign' : tab;
  const { data, isLoading, error, refetch } = useStats(`/stats/dimension/${dim}`, { limit: 10 });
  return (
    <Panel title="Traffic sources" tabs={[{ key: 'channel', label: 'Channels' }, { key: 'referrer', label: 'Referrers' }, { key: 'campaign', label: 'Campaigns' }]} tab={tab} onTab={setTab} href={tab === 'campaign' ? '/campaigns' : '/sources'} error={error} onRetry={refetch}>
      <BarList loading={isLoading} valueLabel="Sessions" secondaryLabel="Conv." rows={data?.map((r) => ({ key: r.value, label: tab === 'channel' ? CHANNELS[r.value] || r.value : r.value, value: r.sessions, secondary: r.conversions }))} />
    </Panel>
  );
}

function DevicesPanel() {
  const [tab, setTab] = useState('device');
  const { data, isLoading, error, refetch } = useStats(`/stats/dimension/${tab}`, { limit: 8 });
  return (
    <Panel title="Devices" tabs={[{ key: 'device', label: 'Type' }, { key: 'browser', label: 'Browser' }, { key: 'os', label: 'OS' }]} tab={tab} onTab={setTab} href={tab === 'browser' ? '/browsers' : '/devices'} error={error} onRetry={refetch}>
      <BarList loading={isLoading} valueLabel="Share" format={(v) => pct(v)} rows={data?.map((r) => ({ key: r.value, label: tab === 'device' ? titleCase(r.value) : r.value, value: r.share }))} />
    </Panel>
  );
}

function LiveMini() {
  const { query } = useFilters();
  const { data, isLoading } = useStats('/realtime', { range: undefined }, { refetchInterval: 15_000 });
  return (
    <Panel title="Live now" href="/realtime" hrefLabel="Open real-time">
      <div className="flex items-center gap-3 border-b px-3 py-3">
        <span className={`h-2.5 w-2.5 rounded-full ${data?.active ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
        {isLoading && !data ? <Skeleton className="h-7 w-10" /> : <span className="text-2xl font-semibold tabular-nums">{data?.active ?? '—'}</span>}
        <span className="text-[13px] text-muted-foreground">active visitors{query.site === 'all' ? ' across all websites' : ''}</span>
      </div>
      <ul className="divide-y text-[13px]">
        {(data?.feed || []).slice(0, 7).map((f, i) => (
          <li key={`${f.ts}-${i}`} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-14 shrink-0 tabular-nums text-[11px] text-muted-foreground">{new Date(f.ts).toLocaleTimeString('en-IN', { hour12: false })}</span>
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{f.label}</span>{f.detail ? <span className="text-muted-foreground"> · {f.detail}</span> : f.path ? <span className="text-muted-foreground"> · {f.path}</span> : null}</span>
          </li>
        ))}
        {isLoading && !data && Array.from({ length: 6 }).map((_, i) => <li key={i} className="flex items-center gap-3 px-3 py-2"><Skeleton className="h-3 w-12" /><Skeleton className="h-3 flex-1" /></li>)}
        {!isLoading && !data?.feed?.length && <li className="px-3 py-8 text-center text-muted-foreground">Waiting for activity…</li>}
      </ul>
    </Panel>
  );
}

function RecentLeads() {
  const { data, isLoading } = useStats('/leads', { limit: 6 });
  return (
    <Panel title="Recent leads" href="/leads">
      {isLoading ? (
        <ul className="divide-y">{Array.from({ length: 6 }).map((_, i) => <li key={i} className="flex items-center gap-3 px-3 py-2.5"><div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-3/5" /></div><Skeleton className="h-3 w-10" /></li>)}</ul>
      ) : !data?.rows?.length ? <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No leads in this period.</p> : (
        <ul className="divide-y text-[13px]">
          {data.rows.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.fields.name || l.fields.email || 'Lead'}{l.city ? <span className="font-normal text-muted-foreground"> · {l.city}</span> : null}</p>
                <p className="truncate text-[11px] text-muted-foreground">{l.attribution?.source} · {l.attribution?.landingPage}{l.attribution?.lastSearch ? ` · “${l.attribution.lastSearch}”` : ''}</p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(l.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ByWebsite() {
  const { websites, query, setSite } = useFilters();
  const results = useQueries({ queries: websites.map((w) => ({ queryKey: ['stats', '/stats/overview', { ...query, site: w.id }], queryFn: () => api(`/stats/overview${toQuery({ ...query, site: w.id })}`) })) });
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">By website</h3></div>
      <Table>
        <TableHeader><TableRow><TableHead>Website</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Page views</TableHead><TableHead className="text-right">Engagement</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Conversions</TableHead><TableHead>Last event</TableHead></TableRow></TableHeader>
        <TableBody>
          {websites.map((w, i) => {
            const c = results[i]?.data?.current;
            const cell = (v) => (results[i]?.isLoading ? <Skeleton className="ml-auto h-4 w-12" /> : v);
            return (
              <TableRow key={w.id} className="cursor-pointer" onClick={() => setSite(w.id)}>
                <TableCell><span className="flex items-center gap-2 font-medium"><WebsiteDot website={w} />{w.name}<span className="text-[11px] font-normal text-muted-foreground">{w.domain}</span></span></TableCell>
                <TableCell className="text-right tabular-nums">{cell(num(c?.visitors))}</TableCell>
                <TableCell className="text-right tabular-nums">{cell(num(c?.sessions))}</TableCell>
                <TableCell className="text-right tabular-nums">{cell(num(c?.pageviews))}</TableCell>
                <TableCell className="text-right tabular-nums">{cell(c ? pct(c.engagementRate) : '—')}</TableCell>
                <TableCell className="text-right tabular-nums">{cell(num(c?.leads))}</TableCell>
                <TableCell className="text-right tabular-nums">{cell(num(c?.conversions))}</TableCell>
                <TableCell className="text-[12px] text-muted-foreground">{w.status?.lastEventAt ? timeAgo(w.status.lastEventAt) : 'No data yet'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function OverviewPage() {
  const { current, rangeLabel, websites, websitesLoading, site } = useFilters();
  const { can } = useAuth();
  const ov = useStats('/stats/overview');
  const ts = useStats('/stats/timeseries');
  const pages = useStats('/stats/pages', { limit: 10 });
  const searches = useStats('/stats/searches');
  const countries = useStats('/stats/dimension/country', { limit: 8 });
  const c = ov.data?.current;
  const p = ov.data?.previous;

  if (websitesLoading) return <DashboardSkeleton />;
  if (!websites.length) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card><EmptyState icon={Server} title="Add your first website" description="Create a website to get its tracking script. Paste it into the site and visitors will appear here within seconds." action={<Button asChild><Link href="/websites?new=1">Add website</Link></Button>} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${current ? current.name : 'All websites'} · ${rangeLabel}${ov.data?.approximateVisitors ? ' · visitor totals are approximate for ranges over 92 days' : ''}`}
        actions={<><RangePicker /><ExportButton type="traffic" /></>}
      />
      <KpiGrid>
        <Kpi label="Visitors" value={num(c?.visitors)} current={c?.visitors} previous={p?.visitors} loading={ov.isLoading} />
        <Kpi label="Sessions" value={num(c?.sessions)} current={c?.sessions} previous={p?.sessions} loading={ov.isLoading} hint={c ? `${c.pagesPerSession} pages / session` : null} />
        <Kpi label="Page views" value={num(c?.pageviews)} current={c?.pageviews} previous={p?.pageviews} loading={ov.isLoading} />
        <Kpi label="New visitors" value={num(c?.newVisitors)} current={c?.newVisitors} previous={p?.newVisitors} loading={ov.isLoading} />
        <Kpi label="Returning visitors" value={num(c?.returningVisitors)} current={c?.returningVisitors} previous={p?.returningVisitors} loading={ov.isLoading} />
        <Kpi label="Engagement rate" value={c ? pct(c.engagementRate) : null} current={c?.engagementRate} previous={p?.engagementRate} loading={ov.isLoading} hint={c ? `Bounce ${pct(c.bounceRate)}` : null} />
        <Kpi label="Avg. session" value={c ? duration(c.avgSessionMs) : null} current={c?.avgSessionMs} previous={p?.avgSessionMs} loading={ov.isLoading} />
        <Kpi label="Searches" value={num(c?.searches)} current={c?.searches} previous={p?.searches} loading={ov.isLoading} />
        <Kpi label="Conversions" value={num(c?.conversions)} current={c?.conversions} previous={p?.conversions} loading={ov.isLoading} hint={c ? `${pct(c.conversionRate, 2)} of sessions` : null} />
        <Kpi label="Leads" value={num(c?.leads)} current={c?.leads} previous={p?.leads} loading={ov.isLoading} />
      </KpiGrid>

      <Card className="mt-4 overflow-hidden"><TrendChart data={ts.data?.points} interval={ts.data?.interval} loading={ts.isLoading} metrics={METRICS} /></Card>

      {site === 'all' && websites.length > 1 && <div className="mt-4"><ByWebsite /></div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Top pages" href="/pages" error={pages.error} onRetry={pages.refetch}>
          <BarList loading={pages.isLoading} valueLabel="Views" secondaryLabel="Visitors" rows={pages.data?.map((r) => ({ key: r.path, label: r.path, value: r.pageviews, secondary: num(r.visitors) }))} />
        </Panel>
        <SourcesPanel />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Top searches" href="/searches" error={searches.error} onRetry={searches.refetch}>
          <BarList loading={searches.isLoading} valueLabel="Searches" empty="No searches tracked in this period" rows={searches.data?.top?.map((r) => ({ key: r.normalized, label: r.query, value: r.count }))} />
        </Panel>
        <Panel title="Countries" href="/geography" error={countries.error} onRetry={countries.refetch}>
          <BarList loading={countries.isLoading} valueLabel="Sessions" rows={countries.data?.map((r) => ({ key: r.value, label: countryName(r.value), icon: <span aria-hidden>{flag(r.value)}</span>, value: r.sessions }))} />
        </Panel>
        <DevicesPanel />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {can('leads:read') && <RecentLeads />}
        <LiveMini />
      </div>
    </>
  );
}
