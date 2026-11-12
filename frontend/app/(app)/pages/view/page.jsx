'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStats } from '@/lib/hooks';
import { num, pct, duration } from '@/lib/utils';
import { channelLabel, HELP } from '@/lib/labels';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RangePicker } from '@/components/analytics/RangePicker';
import { Stat, StatGrid, ShareList, Question } from '@/components/analytics/Simple';

const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });

export default function PageDetail() {
  const path = useSearchParams().get('path') || '/';
  const { current, rangeLabel, linkQuery, setFilter } = useFilters();
  const { data, isLoading, error, refetch } = useStats('/stats/page', { path });
  const c = data?.current;
  const p = data?.previous;
  const loading = isLoading && !data;
  const name = path === '/' ? 'Homepage' : data?.title || path;
  const liveUrl = current?.domain ? `https://${current.domain}${path}` : null;

  return (
    <>
      <Link href={withView('/pages', linkQuery)} className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />All pages</Link>
      <PageHeader
        title={name}
        description={`${path} · ${current ? current.name : 'All websites'} · ${rangeLabel}`}
        actions={<>
          {liveUrl && <Button variant="outline" size="sm" asChild><a href={liveUrl} target="_blank" rel="noreferrer"><ExternalLink />Open page</a></Button>}
          <Button variant="outline" size="sm" onClick={() => setFilter('page', path)} title="Show every report for visitors who viewed this page">Filter reports by this page</Button>
          <RangePicker showCompare />
        </>}
      />
      {error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : !loading && !c?.views && !p?.views ? (
        <Card><EmptyState title="No views of this page in this period" description="Try a longer date range, or check the address. Paths are matched exactly, without the query string." /></Card>
      ) : (
        <>
          <StatGrid className="md:grid-cols-3 xl:grid-cols-5">
            <Stat size="sm" label="Visitors" current={c?.visitors} previous={p?.visitors} loading={loading} help="Different people who viewed this page." />
            <Stat size="sm" label="Views" current={c?.views} previous={p?.views} loading={loading} help={HELP.pageviews} />
            <Stat size="sm" label="Avg. engagement" current={c?.avgEngagementMs} previous={p?.avgEngagementMs} format={duration} loading={loading} help="Average time people actively spent on this page per view." />
            <Stat size="sm" label="Exit rate" current={c?.exitRate} previous={p?.exitRate} format={(v) => pct(v)} invert loading={loading} help={HELP.exitRate} />
            <Stat size="sm" label="Conversions" value={c ? num(c.convertedSessions) : undefined} loading={loading} help="Visits that included this page and completed at least one goal." />
          </StatGrid>
          {c && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {num(c.entries)} visits started on this page · people scrolled {pct(c.avgScroll, 0)} of it on average
              {c.conversionsOnPage ? ` · ${num(c.conversionsOnPage)} goals were completed on this page itself` : ''}
              {c.sessions ? ` · ${pct(c.conversionRate, 2)} of visits that included it converted` : ''}
            </p>
          )}

          <Question>Views per day</Question>
          <Card className="h-[200px] px-2 pt-3">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.byDay || []} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="t" tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} tickFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} />
                  <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip formatter={(v) => [num(v), 'Views']} labelFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
                  <Bar dataKey="views" fill="#194173" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Question hint="How the visits that included this page arrived">Traffic sources</Question>
              <Card><ShareList loading={loading} unit="visits" rows={data?.sources?.map((s) => ({ key: s.value || 'unknown', label: channelLabel(s.value), value: s.sessions }))} /></Card>
            </div>
            <div>
              <Question hint="What visitors did on this page (number of people)">Top actions</Question>
              <Card>
                {loading ? <div className="space-y-2.5 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
                  : !data?.actions?.length ? <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">No clicks, scrolls or form activity recorded on this page.</p> : (
                    <ul className="divide-y">
                      {data.actions.map((a) => (
                        <li key={`${a.name}|${a.detail}`} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                          <span className="min-w-0 flex-1 truncate" title={a.label}>{a.label}</span>
                          <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground" title={`${num(a.count)} times`}>{num(a.count)}×</span>
                          <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{num(a.visitors)} <span className="font-normal text-muted-foreground">{a.visitors === 1 ? 'person' : 'people'}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
