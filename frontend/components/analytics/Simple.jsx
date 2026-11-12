'use client';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import { cn, change, num } from '@/lib/utils';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { Skeleton } from '@/components/ui/feedback';

/** Small (i) with a plain-language explanation on hover/focus. */
export function InfoTip({ text, className }) {
  if (!text) return null;
  return (
    <span tabIndex={0} title={text} aria-label={text} className={cn('inline-flex cursor-help text-slate-400 outline-none hover:text-slate-600 focus-visible:text-slate-700', className)}>
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

/** "↑ 18.4%" coloured by whether the change is good. `invert` for metrics where lower is better. */
export function Delta({ current, previous, invert = false, className }) {
  const d = change(Number(current) || 0, Number(previous) || 0);
  if (d == null) return <span className={cn('text-[12px] text-muted-foreground', className)}>New</span>;
  const good = d === 0 ? null : invert ? d < 0 : d > 0;
  const abs = Math.abs(d);
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[12px] font-semibold tabular-nums', good === true && 'text-emerald-700', good === false && 'text-red-600', good === null && 'text-slate-500', className)}>
      {d === 0 ? <Minus className="h-3.5 w-3.5" /> : d > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {abs >= 1000 ? '999+' : abs.toFixed(abs < 10 ? 1 : 0).replace(/\.0$/, '')}%
    </span>
  );
}

/**
 * One headline number: label, value, change vs the previous period, and (with comparison on) the previous value.
 * `help` is a one-sentence explanation shown in a tooltip, so nobody needs to know analytics jargon.
 */
export function Stat({ label, value, current, previous, format = num, invert, help, loading, href, size = 'lg' }) {
  const { compare, linkQuery } = useFilters();
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <p className="text-[13px] font-medium text-slate-600">{label}</p>
        <InfoTip text={help} />
      </div>
      {loading ? <Skeleton className={cn('mt-2', size === 'lg' ? 'h-8 w-24' : 'h-6 w-16')} /> : (
        <p className={cn('mt-1 font-semibold tabular-nums tracking-tight text-slate-900', size === 'lg' ? 'text-[28px] leading-9' : 'text-xl')}>{value ?? format(current)}</p>
      )}
      {!loading && previous !== undefined && compare && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          {!Number(previous) && Number(current) ? <span>No data in the previous period</span> : (
            <><Delta current={current} previous={previous} invert={invert} /><span>vs {format(previous)} before</span></>
          )}
        </div>
      )}
    </>
  );
  const cls = 'block rounded-lg border bg-card px-4 py-3';
  return href ? <Link href={withView(href, linkQuery)} className={cn(cls, 'transition-colors hover:border-[hsl(var(--primary))]/40 hover:bg-slate-50/60')}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function StatGrid({ children, className }) {
  return <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', className)}>{children}</div>;
}

/**
 * "Google Search  48%  ████████" — a share of total with a bar. Rows can link (drill down) or act on click.
 * rows: [{ key, label, value, icon?, href?, onClick?, hint? }]
 */
export function ShareList({ rows, loading, empty = 'No data for this period', max = 8, valueFormat = num, showValue = true, unit }) {
  const { linkQuery } = useFilters();
  if (loading && !rows) return <div className="space-y-2.5 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>;
  const all = rows || [];
  const total = all.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const list = all.slice(0, max);
  if (!list.length || !total) return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-0.5 p-2">
      {list.map((r) => {
        const share = (Number(r.value) / total) * 100;
        const inner = (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {r.icon}
              <span className="min-w-0"><span className="block truncate text-[13px] text-slate-800" title={typeof r.label === 'string' ? r.label : undefined}>{r.label}</span>{r.hint && <span className="block truncate text-[11px] text-muted-foreground">{r.hint}</span>}</span>
            </span>
            <span className="hidden w-28 shrink-0 sm:block" aria-hidden>
              <span className="block h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full bg-[hsl(var(--primary))]" style={{ width: `${Math.max(2, share)}%` }} /></span>
            </span>
            {showValue && <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground" title={unit ? `${num(r.value)} ${unit}` : undefined}>{valueFormat(r.value)}</span>}
            <span className="w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-800">{share < 1 && share > 0 ? '<1' : Math.round(share)}%</span>
          </>
        );
        const cls = 'flex items-center gap-3 rounded-md px-2 py-1.5';
        return (
          <li key={r.key}>
            {r.href ? <Link href={withView(r.href, linkQuery)} className={cn(cls, 'hover:bg-slate-50')}>{inner}</Link>
              : r.onClick ? <button onClick={r.onClick} className={cn(cls, 'w-full text-left hover:bg-slate-50')}>{inner}</button>
                : <div className={cls}>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Ranked "1. Homepage  8,420" list. rows: [{ key, label, sub?, value, href? }] */
export function RankList({ rows, loading, empty = 'No data for this period', max = 8, format = num, valueLabel }) {
  const { linkQuery } = useFilters();
  if (loading && !rows) return <div className="space-y-2.5 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>;
  const list = (rows || []).slice(0, max);
  if (!list.length) return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ol className="p-2">
      {valueLabel && <li className="flex justify-end px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{valueLabel}</li>}
      {list.map((r, i) => {
        const inner = (
          <>
            <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-slate-400">{i + 1}.</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-slate-800" title={typeof r.label === 'string' ? r.label : undefined}>{r.label}</span>{r.sub && <span className="block truncate text-[11px] text-muted-foreground">{r.sub}</span>}</span>
            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-800">{format(r.value)}</span>
          </>
        );
        const cls = 'flex items-center gap-3 rounded-md px-2 py-1.5';
        return <li key={r.key}>{r.href ? <Link href={withView(r.href, linkQuery)} className={cn(cls, 'hover:bg-slate-50')}>{inner}</Link> : <div className={cls}>{inner}</div>}</li>;
      })}
    </ol>
  );
}

/** Section heading phrased as the question it answers. */
export function Question({ children, hint, action }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">{children}</h2>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
