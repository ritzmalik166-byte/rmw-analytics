'use client';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { Server, Monitor, Smartphone, Tablet, HelpCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { num, pct, duration, countryName, flag, timeAgo, toQuery, titleCase } from '@/lib/utils';
import { channelLabel, channelHint, HELP } from '@/lib/labels';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, Skeleton } from '@/components/ui/feedback';
import { DashboardSkeleton } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiTrendChart } from '@/components/analytics/MultiTrendChart';
import { Panel, ExportButton } from '@/components/analytics/Panel';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WebsiteDot } from '@/components/analytics/WebsiteDot';
import { Stat, StatGrid, ShareList, RankList, Question } from '@/components/analytics/Simple';
import { Insights } from '@/components/analytics/Insights';

const TREND = [
  { key: 'visitors', label: 'Visitors', color: '#1a73e8' },
  { key: 'sessions', label: 'Sessions', color: '#f9ab00' },
  { key: 'pageviews', label: 'Page views', color: '#d93025' },
  { key: 'leads', label: 'Leads', color: '#188038' },
  { key: 'conversions', label: 'Conversions', color: '#7b1fa2' },
];
const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

function LiveNow() {
  const { data, isLoading } = useStats('/realtime', { range: undefined }, { refetchInterval: 15_000 });
  const n = data?.active;
  return (
    <Panel title="Right now" href="/realtime" hrefLabel="Open realtime">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className={`h-2.5 w-2.5 rounded-full ${n ? 'animate-pulse bg-red-500' : 'bg-slate-300'}`} />
        {isLoading && !data ? <Skeleton className="h-7 w-24" /> : (
          <p className="text-[14px] text-slate-700"><span className="text-2xl font-semibold tabular-nums text-slate-900">{num(n ?? 0)}</span> {n === 1 ? 'person is' : 'people are'} on your website</p>
        )}
      </div>
      <ul className="divide-y text-[13px]">
        {(data?.byPage || []).slice(0, 5).map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 px-4 py-1.5"><span className="truncate">{p.key}</span><span className="tabular-nums font-medium">{p.count}</span></li>
        ))}
        {!isLoading && !data?.byPage?.length && <li className="px-4 py-6 text-center text-muted-foreground">Nobody in the last 5 minutes.</li>}
      </ul>
    </Panel>
  );
}

function RecentLeads() {
  const { data, isLoading } = useStats('/leads', { limit: 5 });
  return (
    <Panel title="Latest leads" href="/leads">
      {isLoading ? (
        <ul className="divide-y">{Array.from({ length: 5 }).map((_, i) => <li key={i} className="px-4 py-2.5"><Skeleton className="h-4 w-2/3" /></li>)}</ul>
      ) : !data?.rows?.length ? <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">No leads in this period.</p> : (
        <ul className="divide-y text-[13px]">
          {data.rows.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.fields.name || l.fields.email || 'Lead'}{l.city ? <span className="font-normal text-muted-foreground"> · {l.city}</span> : null}</p>
                <p className="truncate text-[11px] text-muted-foreground">via {l.attribution?.source} · landed on {l.attribution?.landingPage}</p>
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
      <div className="border-b px-4 py-2.5"><h3 className="text-[13px] font-semibold text-slate-800">Your websites</h3><p className="text-[11px] text-muted-foreground">Click a website to see only its numbers</p></div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Website</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Page views</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Conversion rate</TableHead><TableHead>Last activity</TableHead></TableRow></TableHeader>
          <TableBody>
            {websites.map((w, i) => {
              const c = results[i]?.data?.current;
              const cell = (v) => (results[i]?.isLoading ? <Skeleton className="ml-auto h-4 w-12" /> : v);
              return (
                <TableRow key={w.id} className="cursor-pointer" onClick={() => setSite(w.id)}>
                  <TableCell><span className="flex items-center gap-2 font-medium"><WebsiteDot website={w} />{w.name}<span className="text-[11px] font-normal text-muted-foreground">{w.domain}</span></span></TableCell>
                  <TableCell className="text-right tabular-nums">{cell(num(c?.visitors))}</TableCell>
                  <TableCell className="text-right tabular-nums">{cell(num(c?.pageviews))}</TableCell>
                  <TableCell className="text-right tabular-nums">{cell(num(c?.leads))}</TableCell>
                  <TableCell className="text-right tabular-nums">{cell(c ? pct(c.conversionRate, 2) : '—')}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{w.status?.lastEventAt ? timeAgo(w.status.lastEventAt) : 'No data yet'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  const { current, rangeLabel, websites, websitesLoading, site } = useFilters();
  const { can } = useAuth();
  const ov = useStats('/stats/overview');
  const ts = useStats('/stats/timeseries');
  const insights = useStats('/stats/insights');
  const pages = useStats('/stats/pages', { limit: 8 });
  const channels = useStats('/stats/dimension/channel', { limit: 10 });
  const devices = useStats('/stats/dimension/device', { limit: 5 });
  const countries = useStats('/stats/dimension/country', { limit: 6 });
  const c = ov.data?.current;
  const p = ov.data?.previous;
  const loading = ov.isLoading && !c;
  const refreshing = (ov.isPlaceholderData && ov.isFetching) || (ts.isPlaceholderData && ts.isFetching);

  if (websitesLoading) return <DashboardSkeleton />;
  if (!websites.length) {
    return (
      <>
        <PageHeader title="Website overview" />
        <Card><EmptyState icon={Server} title="Add your first website" description="Create a website to get its tracking code. Paste it into your site and visitors appear here within seconds." action={<Button asChild><Link href="/websites?new=1">Add website</Link></Button>} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Website overview"
        description={`${current ? current.name : 'All websites'} · ${rangeLabel}${insights.data?.summary ? ` · ${insights.data.summary}` : ''}`}
        actions={<><RangePicker showCompare /><ExportButton type="traffic" /></>}
      />
      <div className="relative -mt-1 mb-2 h-0.5 overflow-hidden rounded-full" aria-hidden>
        {refreshing && <div className="ov-progress absolute inset-y-0 w-1/3 rounded-full bg-[#1a73e8]" />}
      </div>
      <style>{'@keyframes ov-progress{0%{left:-33%}100%{left:100%}}.ov-progress{animation:ov-progress 1.1s ease-in-out infinite}'}</style>
      {ov.data?.approximateVisitors && <p className="mb-2 text-[12px] text-muted-foreground">For periods longer than 3 months, visitor totals are estimated from daily totals.</p>}

      <StatGrid>
        <Stat label="Visitors" current={c?.visitors} previous={p?.visitors} help={HELP.visitors} loading={loading} href="/users" />
        <Stat label="Sessions" current={c?.sessions} previous={p?.sessions} help={HELP.sessions} loading={loading} href="/sessions" />
        <Stat label="Page views" current={c?.pageviews} previous={p?.pageviews} help={HELP.pageviews} loading={loading} href="/pages" />
        <Stat label="Engagement time" current={c?.avgEngagementMs} previous={p?.avgEngagementMs} format={duration} help={HELP.engagement} loading={loading} />
        <Stat label="Leads" current={c?.leads} previous={p?.leads} help={HELP.leads} loading={loading} href={can('leads:read') ? '/leads' : undefined} />
        <Stat label="Conversion rate" current={c?.conversionRate} previous={p?.conversionRate} format={(v) => pct(v, 2)} help={HELP.conversionRate} loading={loading} href="/conversions" />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><Insights /></div>
        <LiveNow />
      </div>

      <Question hint="Click a line on or off to compare">Traffic trend</Question>
      <Card className="overflow-hidden">
        <MultiTrendChart data={ts.data?.points} interval={ts.data?.interval} loading={ts.isLoading || ov.isLoading} refreshing={refreshing} defaultActive={['visitors']}
          metrics={TREND.map((m) => ({ ...m, value: c ? num(c[m.key]) : null }))} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Question hint="Click a source to see its pages and results" action={<Link href="/sources" className="text-[12px] text-muted-foreground hover:text-foreground">All sources →</Link>}>Where are visitors coming from?</Question>
          <Card><ShareList loading={channels.isLoading} unit="visits" rows={channels.data?.map((r) => ({ key: r.value, label: channelLabel(r.value), hint: channelHint(r.value), value: r.sessions, href: `/sources?f_channel=${encodeURIComponent(r.value)}` }))} /></Card>
        </div>
        <div>
          <Question hint="Most viewed pages; click one for its full report" action={<Link href="/pages" className="text-[12px] text-muted-foreground hover:text-foreground">All pages →</Link>}>What are visitors viewing?</Question>
          <Card><RankList loading={pages.isLoading} valueLabel="Views" rows={pages.data?.map((r) => ({ key: r.path, label: r.title && r.path !== '/' ? r.title : r.path === '/' ? 'Homepage' : r.path, sub: r.path, value: r.pageviews, href: `/pages/view?path=${encodeURIComponent(r.path)}` }))} /></Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Question action={<Link href="/devices" className="text-[12px] text-muted-foreground hover:text-foreground">Devices →</Link>}>What are they using?</Question>
          <Card><ShareList loading={devices.isLoading} unit="visits" rows={devices.data?.map((r) => { const I = DEVICE_ICON[r.value] || HelpCircle; return { key: r.value, label: titleCase(r.value), icon: <I className="h-4 w-4 text-slate-500" />, value: r.sessions }; })} /></Card>
        </div>
        <div>
          <Question action={<Link href="/geography" className="text-[12px] text-muted-foreground hover:text-foreground">Locations →</Link>}>Where are they?</Question>
          <Card><ShareList loading={countries.isLoading} unit="visits" rows={countries.data?.map((r) => ({ key: r.value, label: countryName(r.value), icon: <span aria-hidden>{flag(r.value)}</span>, value: r.sessions }))} /></Card>
        </div>
      </div>

      {site === 'all' && websites.length > 1 && <div className="mt-6"><ByWebsite /></div>}
      {can('leads:read') && <div className="mt-6"><RecentLeads /></div>}
    </>
  );
}
