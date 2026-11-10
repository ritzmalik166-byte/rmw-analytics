'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Filter, ArrowDown, X, Pencil } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { cn, num, pct, duration } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RangePicker } from '@/components/analytics/RangePicker';

const STEP_TYPES = [
  { key: 'path', label: 'Page view', hint: 'Path or glob, e.g. /project/*  (* = any page)' },
  { key: 'search', label: 'Search', hint: 'Optional text the query contains' },
  { key: 'event', label: 'Event', hint: 'Event name, e.g. contact_click' },
  { key: 'form', label: 'Form', hint: 'start | submit, optionally :form-key' },
];

const TEMPLATE = [
  { type: 'path', match: '*', label: 'Landing page' },
  { type: 'search', match: '', label: 'Search' },
  { type: 'path', match: '/project/*', label: 'Property view' },
  { type: 'event', match: 'contact_click', label: 'Contact click' },
  { type: 'form', match: 'start', label: 'Form start' },
  { type: 'form', match: 'submit', label: 'Form submit' },
];

function FunnelEditor({ initial, onClose }) {
  const qc = useQueryClient();
  const { websites } = useFilters();
  const [f, setF] = useState(() => initial ? { name: initial.name, websiteId: initial.websiteId || '', windowHours: initial.windowHours, steps: initial.steps } : { name: 'Lead funnel', websiteId: '', windowHours: 72, steps: TEMPLATE });
  const save = useMutation({
    mutationFn: () => api(initial ? `/funnels/${initial.id}` : '/funnels', { method: initial ? 'PATCH' : 'POST', body: { ...f, websiteId: f.websiteId || null, windowHours: Number(f.windowHours) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['funnels'] }); toast.success('Funnel saved'); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const setStep = (i, patch) => setF({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{initial ? 'Edit funnel' : 'Create funnel'}</DialogTitle><DialogDescription>Steps must happen in order, by the same visitor, within the conversion window.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Website"><Select value={f.websiteId} onChange={(e) => setF({ ...f, websiteId: e.target.value })}><option value="">Follows the website filter</option>{websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label="Window (hours)"><Input type="number" min={1} max={2160} value={f.windowHours} onChange={(e) => setF({ ...f, windowHours: e.target.value })} /></Field>
        </div>
        <div className="space-y-2">
          {f.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded border bg-slate-50/60 p-2">
              <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">{i + 1}</span>
              <Input className="w-36" placeholder="Label" value={s.label || ''} onChange={(e) => setStep(i, { label: e.target.value })} />
              <Select className="w-32" value={s.type} onChange={(e) => setStep(i, { type: e.target.value })}>{STEP_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
              <div className="flex-1"><Input placeholder={STEP_TYPES.find((t) => t.key === s.type)?.hint} value={s.match || ''} onChange={(e) => setStep(i, { match: e.target.value })} /></div>
              <Button variant="ghost" size="icon" aria-label="Remove step" disabled={f.steps.length <= 2} onClick={() => setF({ ...f, steps: f.steps.filter((_, j) => j !== i) })}><X /></Button>
            </div>
          ))}
          {f.steps.length < 10 && <Button variant="outline" size="sm" onClick={() => setF({ ...f, steps: [...f.steps, { type: 'path', match: '', label: '' }] })}><Plus />Add step</Button>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save funnel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FunnelReport({ funnel }) {
  const { data, isLoading, error, refetch } = useStats(`/funnels/${funnel.id}/report`);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading && !data) return <div className="space-y-2 p-4">{funnel.steps.map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  const top = data.steps[0]?.count || 0;
  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap gap-6 text-[13px]">
        <span><span className="kv-label block">Entered</span><span className="text-xl font-semibold tabular-nums">{num(top)}</span></span>
        <span><span className="kv-label block">Completed</span><span className="text-xl font-semibold tabular-nums">{num(data.steps.at(-1)?.count)}</span></span>
        <span><span className="kv-label block">Overall conversion</span><span className="text-xl font-semibold tabular-nums">{pct(data.overallConversion)}</span></span>
        <span><span className="kv-label block">Window</span><span className="text-xl font-semibold tabular-nums">{funnel.windowHours}h</span></span>
      </div>
      <ol className="space-y-0">
        {data.steps.map((s, i) => (
          <li key={i}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1 pl-[148px] text-[11px] text-muted-foreground">
                <ArrowDown className="h-3.5 w-3.5" />
                <span className="tabular-nums">{pct(s.conversionFromPrevious)} continued</span>
                {s.dropOff > 0 && <span className="tabular-nums text-red-700">· {num(s.dropOff)} dropped</span>}
                {s.avgTimeFromPreviousMs != null && <span className="tabular-nums">· avg {duration(s.avgTimeFromPreviousMs)}</span>}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-[136px] shrink-0 truncate text-[13px] font-medium" title={`${s.type}: ${s.match || 'any'}`}>{i + 1}. {s.label}</span>
              <div className="relative h-9 flex-1 overflow-hidden rounded-sm bg-slate-100">
                <div className="h-full rounded-sm bg-[#194173]" style={{ width: `${top ? Math.max(0.5, (s.count / top) * 100) : 0}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-[13px] tabular-nums"><span className="font-semibold">{num(s.count)}</span> <span className="text-muted-foreground">{pct(s.conversionFromStart, 0)}</span></span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-muted-foreground">{num(data.visitorsEvaluated)} visitors evaluated. Each visitor counts once per step, in order.</p>
    </div>
  );
}

export default function FunnelsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { current, rangeLabel } = useFilters();
  const { data: funnels, isLoading } = useQuery({ queryKey: ['funnels'], queryFn: () => api('/funnels') });
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => { if (!selected && funnels?.length) setSelected(funnels[0].id); }, [funnels, selected]);
  const del = useMutation({ mutationFn: (id) => api(`/funnels/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['funnels'] }); setSelected(null); toast.success('Funnel deleted'); } });
  const funnel = funnels?.find((f) => f.id === selected);
  return (
    <>
      <PageHeader title="Funnels" description={`Step-by-step conversion paths · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker />{can('funnels:write') && <Button size="sm" onClick={() => setEditing('new')}><Plus />New funnel</Button>}</>} />
      {!isLoading && !funnels?.length ? (
        <Card><EmptyState icon={Filter} title="No funnels yet" description="Build a funnel such as Landing → Search → Property view → Contact click → Form submit." action={can('funnels:write') && <Button onClick={() => setEditing('new')}><Plus />Create funnel</Button>} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <Card className="overflow-hidden">
            <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Saved funnels</h3></div>
            <ul className="divide-y">
              {funnels?.map((f) => (
                <li key={f.id}><button onClick={() => setSelected(f.id)} className={cn('w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50', f.id === selected && 'bg-[hsl(213_70%_95%)] font-semibold text-primary')}>{f.name}<span className="block text-[11px] font-normal text-muted-foreground">{f.steps.length} steps · {f.windowHours}h window</span></button></li>
              ))}
            </ul>
          </Card>
          <Card className="overflow-hidden lg:col-span-3">
            {funnel && (
              <>
                <div className="flex items-center justify-between border-b bg-[hsl(214_25%_97%)] px-3 py-1.5">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">{funnel.name}</h3>
                  {can('funnels:write') && <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => setEditing(funnel)}><Pencil />Edit</Button><Button variant="ghost" size="sm" className="text-red-600" onClick={() => del.mutate(funnel.id)}><Trash2 />Delete</Button></div>}
                </div>
                <FunnelReport funnel={funnel} />
              </>
            )}
          </Card>
        </div>
      )}
      {editing && <FunnelEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
