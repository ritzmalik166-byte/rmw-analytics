import Link from 'next/link';
import { cn, num } from '@/lib/utils';
import { Skeleton } from '@/components/ui/feedback';

/**
 * Ranked list with proportional bars — the densest readable form for "top N" breakdowns.
 * rows: [{ key, label, value, secondary?, href?, icon? }]
 */
export function BarList({ rows, loading, valueLabel = 'Visitors', secondaryLabel, empty = 'No data for this period', max: maxRows = 10, format = num }) {
  if (loading && !rows) {
    return <div className="space-y-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>;
  }
  const list = (rows || []).slice(0, maxRows);
  if (!list.length) return <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...list.map((r) => Number(r.value) || 0));
  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span>&nbsp;</span>
        <span className="flex gap-4">{secondaryLabel && <span className="w-14 text-right">{secondaryLabel}</span>}<span className="w-16 text-right">{valueLabel}</span></span>
      </div>
      <ul className="space-y-1">
        {list.map((r) => {
          const inner = (
            <>
              <span className="absolute inset-y-0 left-0 rounded-sm bg-[hsl(213_62%_26%/0.09)]" style={{ width: `${Math.max(1.5, (Number(r.value) / max) * 100)}%` }} aria-hidden />
              <span className="relative flex min-w-0 flex-1 items-center gap-2 px-2">
                {r.icon}
                <span className="truncate" title={typeof r.label === 'string' ? r.label : undefined}>{r.label}</span>
              </span>
            </>
          );
          return (
            <li key={r.key} className="flex items-center gap-4 text-[13px]">
              {r.href
                ? <Link href={r.href} className="relative flex h-7 min-w-0 flex-1 items-center hover:underline">{inner}</Link>
                : <div className="relative flex h-7 min-w-0 flex-1 items-center">{inner}</div>}
              {secondaryLabel && <span className="w-14 text-right tabular-nums text-muted-foreground">{r.secondary ?? '—'}</span>}
              <span className={cn('w-16 text-right font-medium tabular-nums text-slate-800')}>{format(r.value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
