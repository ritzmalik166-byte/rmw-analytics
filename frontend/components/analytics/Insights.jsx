'use client';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Lightbulb, TrendingDown, TrendingUp, Info } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';

const TONE = {
  warning: { icon: AlertTriangle, cls: 'text-amber-600', bg: 'bg-amber-50' },
  bad: { icon: TrendingDown, cls: 'text-red-600', bg: 'bg-red-50' },
  good: { icon: TrendingUp, cls: 'text-emerald-600', bg: 'bg-emerald-50' },
  info: { icon: Info, cls: 'text-sky-600', bg: 'bg-sky-50' },
};

function Item({ item }) {
  const { linkQuery } = useFilters();
  const t = TONE[item.tone] || TONE.info;
  const body = (
    <>
      <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', t.bg)}><t.icon className={cn('h-4 w-4', t.cls)} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-slate-900">{item.title}</span>
        {item.detail && <span className="mt-0.5 block text-[13px] text-slate-600">{item.detail}</span>}
      </span>
      {item.link && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />}
    </>
  );
  const cls = 'group flex items-start gap-3 px-4 py-3';
  return <li>{item.link ? <Link href={withView(item.link, linkQuery)} className={cn(cls, 'hover:bg-slate-50')}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

/**
 * "What's happening?" — findings computed on the server from this period vs the previous one.
 * Warnings come first. Nothing here is estimated: each sentence quotes the numbers it is based on.
 */
export function Insights() {
  const { rangeLabel } = useFilters();
  const { data, isLoading, error } = useStats('/stats/insights');
  const warnings = (data?.items || []).filter((i) => i.tone === 'warning');
  const rest = (data?.items || []).filter((i) => i.tone !== 'warning');
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <h2 className="text-[14px] font-semibold text-slate-900">What's happening?</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">{rangeLabel} compared with the period before</span>
      </div>
      {isLoading && !data ? (
        <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="flex gap-3"><Skeleton className="h-7 w-7 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>
      ) : error ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">Couldn't work out the insights right now. {error.message}</p>
      ) : !data?.items?.length ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">
          {data?.enoughData === false
            ? 'Not enough visits yet to spot trends reliably. Insights appear once there are a few dozen visits in this period and the one before.'
            : 'Nothing unusual: your numbers are close to the previous period.'}
        </p>
      ) : (
        <>
          {warnings.length > 0 && (
            <div className="border-b bg-amber-50/40">
              <p className="px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Needs attention</p>
              <ul className="divide-y divide-amber-100">{warnings.map((i) => <Item key={i.id} item={i} />)}</ul>
            </div>
          )}
          <ul className="divide-y">{rest.map((i) => <Item key={i.id} item={i} />)}</ul>
        </>
      )}
    </Card>
  );
}
