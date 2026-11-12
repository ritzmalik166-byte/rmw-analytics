'use client';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Target } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, pct } from '@/lib/utils';
import { channelLabel, HELP } from '@/lib/labels';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { PageHeader, EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { Stat, StatGrid, ShareList, RankList, Question, Delta } from '@/components/analytics/Simple';
import { useGoals } from '@/components/analytics/MarkConversion';

const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export default function ConversionsPage() {
  const { current, rangeLabel, site, linkQuery, setFilter } = useFilters();
  const ov = useStats('/stats/overview');
  const rep = useStats('/stats/conversions');
  const { data: goals } = useGoals();
  const c = ov.data?.current;
  const p = ov.data?.previous;
  const r = rep.data;
  const loading = rep.isLoading && !r;
  const hasGoals = (goals || []).some((g) => site === 'all' || g.websiteId === site);

  return (
    <>
      <PageHeader title="Conversions" description={`Visitors completing the actions that matter to you · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker showCompare /><Button size="sm" variant="outline" asChild><Link href={withView('/goals', linkQuery)}><Target />Manage goals</Link></Button></>} />
      {!hasGoals && goals && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50 px-4 py-3 text-[13px]">
          <b>No conversions are set up for {current ? current.name : 'your websites'} yet.</b> Leads are counted automatically, but you choose which other actions count, such as form submissions, phone or WhatsApp clicks. <Link href={withView('/goals', linkQuery)} className="font-medium text-[hsl(var(--primary))] hover:underline">Set them up →</Link>
        </Card>
      )}
      <StatGrid className="xl:grid-cols-4">
        <Stat label="Conversions" current={c?.conversions} previous={p?.conversions} help={HELP.conversions} loading={ov.isLoading && !c} />
        <Stat label="Conversion rate" current={c?.conversionRate} previous={p?.conversionRate} format={(v) => pct(v, 2)} help={HELP.conversionRate} loading={ov.isLoading && !c} />
        <Stat label="Converting visits" current={c?.convertedSessions} previous={p?.convertedSessions} help="Visits in which at least one goal was completed." loading={ov.isLoading && !c} />
        {c?.conversionValue ? <Stat label="Conversion value" current={c.conversionValue} previous={p?.conversionValue} format={(v) => money.format(v || 0)} help="Sum of the values you gave each goal." /> : <Stat label="Leads" current={c?.leads} previous={p?.leads} help={HELP.leads} loading={ov.isLoading && !c} href="/leads" />}
      </StatGrid>

      {rep.error ? <Card className="mt-4"><ErrorState error={rep.error} onRetry={rep.refetch} /></Card> : (
        <>
          <Question>Conversions per day</Question>
          <Card className="h-[200px] px-2 pt-3">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r?.byDay || []} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="t" tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} tickFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} />
                  <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip formatter={(v) => [num(v), 'Conversions']} labelFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
                  <Bar dataKey="count" fill="#188038" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Question hint="Compared with the previous period">By goal</Question>
          <Card className="overflow-hidden">
            {loading ? <TableSkeleton rows={4} cols={4} /> : !r?.byGoal?.length ? <EmptyState icon={Target} title="No conversions in this period" description="Once visitors complete one of your goals, it shows up here." /> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Goal</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">Change</TableHead><TableHead className="text-right">People</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {r.byGoal.map((g) => (
                      <TableRow key={g.goal}>
                        <TableCell className="font-medium">{g.goal}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{num(g.count)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{num(g.previous)}</TableCell>
                        <TableCell className="text-right"><Delta current={g.count} previous={g.previous} /></TableCell>
                        <TableCell className="text-right tabular-nums">{num(g.visitors)}</TableCell>
                        <TableCell className="text-right tabular-nums">{g.value ? money.format(g.value) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <Question hint="How converting visitors arrived; click to drill in">Top sources</Question>
              <Card><ShareList loading={loading} unit="conversions" empty="No conversions yet" rows={r?.byChannel?.map((x) => ({ key: x.value || 'unknown', label: channelLabel(x.value), value: x.conversions, onClick: () => setFilter('channel', x.value) }))} /></Card>
              {r?.bySource?.length > 0 && <Card className="mt-3"><RankList max={6} valueLabel="Conversions" rows={r.bySource.map((x) => ({ key: x.value, label: x.value, value: x.conversions }))} /></Card>}
            </div>
            <div>
              <Question hint="The page where each converting visit started">Top landing pages</Question>
              <Card><RankList loading={loading} empty="No conversions yet" valueLabel="Conversions" rows={r?.byLandingPage?.map((x) => ({ key: x.path, label: x.path === '/' ? 'Homepage' : x.path, sub: x.path, value: x.conversions, href: `/pages/view?path=${encodeURIComponent(x.path)}` }))} /></Card>
            </div>
            <div>
              <Question hint="The page where the goal was completed">Top conversion pages</Question>
              <Card><RankList loading={loading} empty="No conversions yet" valueLabel="Conversions" rows={r?.byPage?.map((x) => ({ key: x.path, label: x.path === '/' ? 'Homepage' : x.path, sub: x.path, value: x.count, href: `/pages/view?path=${encodeURIComponent(x.path)}` }))} /></Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
