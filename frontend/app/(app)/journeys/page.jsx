'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowRight, Route, Search, Users2, ExternalLink, Smartphone, Monitor, Tablet } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { api } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { cn, num, timeAgo, toQuery, flag } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, ErrorState, Skeleton, Pagination } from '@/components/ui/feedback';
import { JourneyRoadmap, RoadmapLegend } from '@/components/analytics/JourneyRoadmap';
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

const SEGMENTS = [['', 'All visitors'], ['new', 'New'], ['returning', 'Returning'], ['leads', 'Became leads']];
const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };
const vkey = (v) => `${v.websiteId}:${v.visitorId}`;

function VisitorCard({ v, active, onClick }) {
  const Dev = DEVICE_ICON[v.device?.type] || Monitor;
  const src = v.first ? (v.first.source && v.first.source !== '(direct)' ? v.first.source : v.first.channelLabel) : 'Direct';
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full border-l-4 px-3 py-2.5 text-left transition-colors', active ? 'border-l-[#1a73e8] bg-[#1a73e8]/[0.07]' : 'border-l-transparent hover:bg-slate-50')}>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[13px] text-slate-900">{v.label.replace('Visitor ', '')}</span>
        {v.website?.code && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">{v.website.code}</span>}
        {v.counts.leads > 0 && <span className="rounded bg-[#d93025] px-1.5 text-[10px] font-bold uppercase text-white">Lead</span>}
        {v.counts.sessions > 1 && <span className="rounded bg-[#f9ab00]/20 px-1.5 text-[10px] font-semibold text-[#b06000]">Returning</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(v.lastSeen)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-600">
        <Dev className="h-3 w-3 shrink-0" />
        {v.geo?.country && <span>{flag(v.geo.country)} {v.geo.city || v.geo.country}</span>}
        <span className="truncate">· from {src}</span>
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[10px] font-semibold">
        <span className="rounded bg-[#1a73e8]/10 px-1.5 py-0.5 text-[#1a73e8]">{num(v.counts.pageviews)} pages</span>
        <span className="rounded bg-[#f9ab00]/15 px-1.5 py-0.5 text-[#b06000]">{num(v.counts.sessions)} visit{v.counts.sessions === 1 ? '' : 's'}</span>
        {(v.counts.searches > 0 || v.counts.conversions > 0) && <span className="rounded bg-[#d93025]/10 px-1.5 py-0.5 text-[#d93025]">{num(v.counts.searches + v.counts.conversions)} key</span>}
      </div>
    </button>
  );
}

function VisitorJourneys() {
  const { query, current, rangeLabel } = useFilters();
  const [segment, setSegment] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(null);
  const listQ = { ...query, segment: segment || undefined, q: q.trim() || undefined, page, limit: 30 };
  const list = useQuery({ queryKey: ['journey-visitors', listQ], queryFn: () => api(`/visitors${toQuery(listQ)}`), placeholderData: keepPreviousData });
  const rows = list.data?.rows || [];
  useEffect(() => { if (rows.length && (!sel || !rows.some((r) => vkey(r) === vkey(sel)))) setSel(rows[0]); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const profile = useQuery({ queryKey: ['visitor', sel && vkey(sel)], queryFn: () => api(`/visitors/${sel.websiteId}/${sel.visitorId}${toQuery({ site: query.site })}`), enabled: Boolean(sel) });
  const v = profile.data?.visitor;

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card className="flex max-h-[calc(100vh-180px)] flex-col overflow-hidden lg:sticky lg:top-4">
        <div className="space-y-2 border-b bg-[hsl(214_25%_97%)] p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-600"><Users2 className="h-3.5 w-3.5" />Unique visitors</h3>
            {list.data?.meta && <span className="text-[12px] font-semibold tabular-nums text-[#1a73e8]">{num(list.data.meta.total)}</span>}
          </div>
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" placeholder="Visitor ID, e.g. #A1B2C3" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <div className="flex flex-wrap gap-1">
            {SEGMENTS.map(([k, l]) => <button key={k} onClick={() => { setSegment(k); setPage(1); }} className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', segment === k ? 'bg-[#1a73e8] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>{l}</button>)}
          </div>
        </div>
        <div className="min-h-0 flex-1 divide-y overflow-y-auto">
          {list.isLoading ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="space-y-1.5 px-3 py-3"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)
            : list.error ? <ErrorState error={list.error} onRetry={list.refetch} />
              : !rows.length ? <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No visitors in {rangeLabel.toLowerCase()}.</p>
                : rows.map((r) => <VisitorCard key={vkey(r)} v={r} active={sel && vkey(sel) === vkey(r)} onClick={() => setSel(r)} />)}
        </div>
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b bg-[hsl(214_25%_97%)] px-4 py-2.5">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900">{v ? v.label : sel ? sel.label : 'Journey roadmap'}</h3>
            {v && <p className="text-[12px] text-muted-foreground">First seen {timeAgo(v.firstSeen)} · last seen {timeAgo(v.lastSeen)} · {num(v.counts.sessions)} visits · {num(v.counts.pageviews)} pages{v.first ? ` · first came from ${CHANNELS[v.first.channel] || v.first.channel}` : ''}</p>}
          </div>
          <RoadmapLegend className="ml-auto" />
          {sel && <Link href={`/visitors/${sel.websiteId}/${sel.visitorId}`} className="inline-flex items-center gap-1 text-[12px] text-[#1a73e8] hover:underline">Full profile<ExternalLink className="h-3 w-3" /></Link>}
        </div>
        <div className="p-4">
          {!sel ? <EmptyState icon={Route} title="Pick a visitor" description="Choose someone from the list to see every page and action on their journey." />
            : profile.isLoading ? <div className="space-y-3"><Skeleton className="h-9" />{Array.from({ length: 6 }).map((_, i) => <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}><Skeleton className="h-12 w-[45%]" /></div>)}</div>
              : profile.error ? <ErrorState error={profile.error} onRetry={profile.refetch} />
                : <JourneyRoadmap journey={profile.data.journey} sessions={profile.data.sessions} />}
        </div>
      </Card>
    </div>
  );
}

function CommonPaths() {
  const { current, rangeLabel } = useFilters();
  const [depth, setDepth] = useState(5);
  const [fromPath, setFromPath] = useState('');
  const [applied, setApplied] = useState('');
  const { data, isLoading, error, refetch } = useStats('/stats/journeys', { depth, from_path: applied || undefined });
  const max = Math.max(1, ...(data?.paths || []).map((p) => p.sessions));
  return (
    <>
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

function JourneysInner() {
  const { current, rangeLabel } = useFilters();
  const { can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const people = can('visitors:read');
  const tab = params.get('tab') === 'paths' || !people ? 'paths' : 'visitors';
  return (
    <>
      <PageHeader title="User journeys" description={`${tab === 'visitors' ? 'Every unique visitor and the road they took through the site' : 'Most common page sequences per session'} · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      {people && (
        <div className="mb-4 flex gap-1 border-b">
          {[['visitors', 'Visitor journeys'], ['paths', 'Common paths']].map(([k, l]) => (
            <button key={k} onClick={() => router.replace(`/journeys${k === 'paths' ? '?tab=paths' : ''}`)} className={cn('-mb-px border-b-2 px-3 py-1.5 text-[13px]', tab === k ? 'border-[#1a73e8] font-semibold text-[#1a73e8]' : 'border-transparent text-slate-600 hover:text-slate-900')}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'visitors' ? <VisitorJourneys /> : <CommonPaths />}
    </>
  );
}

export default function JourneysPage() {
  return <Suspense><JourneysInner /></Suspense>;
}
