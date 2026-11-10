'use client';
import { useState } from 'react';
import { ArrowRight, Route } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/analytics/Panel';
import { RangePicker } from '@/components/analytics/RangePicker';

/** Step columns: for each step index, the most common pages and where visitors went next. */
function FlowColumns({ flows }) {
  const steps = [...new Set(flows.map((f) => f.step))].sort((a, b) => a - b).slice(0, 5);
  return (
    <div className="grid gap-3 overflow-x-auto p-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(220px, 1fr))` }}>
      {steps.map((st) => {
        const rows = flows.filter((f) => f.step === st).slice(0, 8);
        const max = Math.max(1, ...rows.map((r) => r.sessions));
        return (
          <div key={st}>
            <p className="kv-label mb-1.5">Step {st + 1} → {st + 2}</p>
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={`${r.from}-${r.to}`} className="relative overflow-hidden rounded border bg-white px-2 py-1.5 text-[12px]">
                  <span className="absolute inset-y-0 left-0 bg-[hsl(213_62%_26%/0.08)]" style={{ width: `${(r.sessions / max) * 100}%` }} aria-hidden />
                  <span className="relative block truncate font-medium" title={r.from}>{r.from}</span>
                  <span className="relative flex items-center gap-1 truncate text-muted-foreground" title={r.to}><ArrowRight className="h-3 w-3 shrink-0" />{r.to}</span>
                  <span className="relative block text-right text-[11px] tabular-nums text-slate-700">{num(r.sessions)} sessions</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function JourneysPage() {
  const { current, rangeLabel } = useFilters();
  const [depth, setDepth] = useState(5);
  const [fromPath, setFromPath] = useState('');
  const [applied, setApplied] = useState('');
  const { data, isLoading, error, refetch } = useStats('/stats/journeys', { depth, from_path: applied || undefined });
  const max = Math.max(1, ...(data?.paths || []).map((p) => p.sessions));
  return (
    <>
      <PageHeader title="User journeys" description={`Most common page sequences per session · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      <Card className="mb-4 flex flex-wrap items-center gap-2 px-3 py-2">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(fromPath.trim()); }}>
          <Input className="w-64" placeholder="Start from page, e.g. /properties" value={fromPath} onChange={(e) => setFromPath(e.target.value)} />
          <button className="text-[12px] text-primary underline" type="submit">Apply</button>
          {applied && <button type="button" className="text-[12px] text-muted-foreground underline" onClick={() => { setFromPath(''); setApplied(''); }}>Clear</button>}
        </form>
        <Select className="w-32" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Depth">{[3, 4, 5, 6, 8].map((d) => <option key={d} value={d}>{d} steps</option>)}</Select>
        {data && <span className="ml-auto text-[12px] text-muted-foreground">{num(data.sessionsAnalysed)} sessions analysed</span>}
      </Card>
      {error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : isLoading && !data ? <Skeleton className="h-96" /> : !data?.paths?.length ? <Card><EmptyState icon={Route} title="No journeys in this period" /></Card> : (
        <div className="space-y-4">
          <Panel title="Top paths">
            <ul className="divide-y">
              {data.paths.slice(0, 25).map((p, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[12px]">
                    {p.steps.map((s, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <ArrowRight className="h-3 w-3 text-slate-400" />}
                        <span className={s === '…' ? 'text-muted-foreground' : 'max-w-[220px] truncate rounded-sm bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700'} title={s}>{s}</span>
                      </span>
                    ))}
                  </div>
                  <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[#194173]" style={{ width: `${(p.sessions / max) * 100}%` }} /></div>
                  <span className="w-16 shrink-0 text-right text-[13px] font-medium tabular-nums">{num(p.sessions)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Step-by-step flow"><FlowColumns flows={data.flows} /></Panel>
        </div>
      )}
    </>
  );
}
