import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn, change } from '@/lib/utils';
import { Skeleton } from '@/components/ui/feedback';

/**
 * KPI tile in the RMW-CRM StatCard style (left accent bar, uppercase label) with a period-over-period delta.
 * `invert` flips the good/bad colouring for metrics where lower is better (bounce rate).
 */
export function Kpi({ label, value, current, previous, invert = false, hint, loading, icon: Icon }) {
  const delta = previous === undefined ? undefined : change(Number(current) || 0, Number(previous) || 0);
  const good = delta == null || delta === 0 ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className="rounded border border-l-[3px] border-l-[hsl(var(--primary))] bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      {loading ? <Skeleton className="mt-1.5 h-6 w-20" /> : <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value ?? '—'}</p>}
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {delta !== undefined && delta !== null && !loading && (
          <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', good === true && 'text-emerald-700', good === false && 'text-red-700')} title="Change vs previous period">
            {delta === 0 ? <><Minus className="h-3 w-3" />0%</> : <>{delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(delta) >= 1000 ? '999+' : Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%</>}
          </span>
        )}
        {hint && <span className="truncate">{hint}</span>}
      </div>
    </div>
  );
}

export function KpiGrid({ children, className }) {
  return <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5', className)}>{children}</div>;
}
