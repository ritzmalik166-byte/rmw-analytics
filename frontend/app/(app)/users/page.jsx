'use client';
import Link from 'next/link';
import { Monitor, Smartphone, Tablet, HelpCircle } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, pct, duration, countryName, flag, titleCase } from '@/lib/utils';
import { channelLabel, HELP } from '@/lib/labels';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { RangePicker } from '@/components/analytics/RangePicker';
import { ExportButton } from '@/components/analytics/Panel';
import { MultiTrendChart } from '@/components/analytics/MultiTrendChart';
import { Stat, StatGrid, ShareList, Question } from '@/components/analytics/Simple';

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
const place = (v) => { const [cc, name] = String(v).split('|'); return `${name}, ${countryName(cc)}`; };

/** Who visits: totals (all / new / returning / engaged) and users by device, location and source. */
export default function UsersPage() {
  const { current, rangeLabel, setFilter } = useFilters();
  const { can } = useAuth();
  const ov = useStats('/stats/overview');
  const ts = useStats('/stats/timeseries');
  const devices = useStats('/stats/dimension/device', { limit: 5 });
  const countries = useStats('/stats/dimension/country', { limit: 8 });
  const cities = useStats('/stats/dimension/city', { limit: 8 });
  const channels = useStats('/stats/dimension/channel', { limit: 8 });
  const c = ov.data?.current;
  const p = ov.data?.previous;
  const loading = ov.isLoading && !c;
  return (
    <>
      <PageHeader title="Users" description={`Who visits your website · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker showCompare /><ExportButton type="traffic" /></>} />
      <StatGrid className="xl:grid-cols-5">
        <Stat label="Total users" current={c?.allVisitors} previous={p?.allVisitors} help={HELP.allVisitors} loading={loading} />
        <Stat label="Active users" current={c?.visitors} previous={p?.visitors} help={HELP.visitors} loading={loading} />
        <Stat label="New users" current={c?.newVisitors} previous={p?.newVisitors} help={HELP.newVisitors} loading={loading} />
        <Stat label="Returning users" current={c?.returningVisitors} previous={p?.returningVisitors} help={HELP.returningVisitors} loading={loading} />
        <Stat label="Engagement time" current={c?.avgEngagementMs} previous={p?.avgEngagementMs} format={duration} help={HELP.engagement} loading={loading} />
      </StatGrid>
      {c && c.allVisitors > 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {pct((c.newVisitors / c.allVisitors) * 100, 0)} of people were visiting for the first time. {num(c.allVisitors - c.visitors)} left quickly without engaging.
        </p>
      )}

      <Question>Users over time</Question>
      <Card className="overflow-hidden">
        <MultiTrendChart data={ts.data?.points} interval={ts.data?.interval} loading={ts.isLoading} defaultActive={['visitors']}
          metrics={[{ key: 'visitors', label: 'Active users', color: '#1a73e8', value: c ? num(c.visitors) : null }, { key: 'sessions', label: 'Sessions', color: '#f9ab00', value: c ? num(c.sessions) : null }]} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Question hint="Click to filter every report">By device</Question>
          <Card><ShareList loading={devices.isLoading} rows={devices.data?.map((r) => { const I = DEVICE_ICON[r.value] || HelpCircle; return { key: r.value, label: titleCase(r.value), icon: <I className="h-4 w-4 text-slate-500" />, value: r.visitors, onClick: () => setFilter('device', r.value) }; })} unit="users" /></Card>
        </div>
        <div>
          <Question hint="Approximate, from the visitor's network" action={<Link href="/geography" className="text-[12px] text-muted-foreground hover:text-foreground">All locations →</Link>}>By country</Question>
          <Card><ShareList loading={countries.isLoading} rows={countries.data?.map((r) => ({ key: r.value, label: countryName(r.value), icon: <span aria-hidden>{flag(r.value)}</span>, value: r.visitors, onClick: () => setFilter('country', r.value) }))} unit="users" /></Card>
        </div>
        <div>
          <Question action={<Link href="/sources" className="text-[12px] text-muted-foreground hover:text-foreground">Sources →</Link>}>By source</Question>
          <Card><ShareList loading={channels.isLoading} rows={channels.data?.map((r) => ({ key: r.value, label: channelLabel(r.value), value: r.visitors, onClick: () => setFilter('channel', r.value) }))} unit="users" /></Card>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Question hint="Where the location is known">By city</Question>
          <Card><ShareList loading={cities.isLoading} rows={cities.data?.map((r) => ({ key: r.value, label: place(r.value), icon: <span aria-hidden>{flag(String(r.value).split('|')[0])}</span>, value: r.visitors }))} unit="users" empty="No city information in this period" /></Card>
        </div>
        {can('visitors:read') && (
          <Card className="flex flex-col justify-center px-4 py-5 lg:col-span-2">
            <p className="text-[14px] font-medium">Want to see individual visitors?</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Visitor profiles show each anonymous visitor's visits, pages and actions in order.</p>
            <Link href="/visitors" className="mt-2 text-[13px] font-medium text-[hsl(var(--primary))] hover:underline">Browse visitor profiles →</Link>
          </Card>
        )}
      </div>
    </>
  );
}
