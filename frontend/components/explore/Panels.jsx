'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X, Search, MoreVertical, GripVertical, Users2, ArrowUp, ArrowDown, Table2, BarChart3, PieChart as PieIcon, LineChart as LineIcon, MousePointerClick, FileText, RotateCcw } from 'lucide-react';
import { EVENT_LABELS } from '@rmw-analytics/shared/events';
import { api } from '@/lib/api';
import { cn, toQuery, titleCase } from '@/lib/utils';
import { channelLabel } from '@/lib/labels';
import { RANGES } from '@/providers/FiltersProvider';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TECHNIQUES, DEFAULT_CONFIG, SUGGESTED_SEGMENTS, CONDITION_FIELDS, uid, viewQuery, describeSegment, nodeLabel } from './shared';
import { stepLabel } from './FunnelCanvas';

const DND = 'application/x-rmw-explore';
const dragProps = (payload, disabled) => (disabled ? {} : { draggable: true, onDragStart: (e) => { e.dataTransfer.setData(DND, JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copy'; } });
/** Drop zone that accepts items dragged from the Variables column. */
function useDrop(onDrop) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e) => { if ([...e.dataTransfer.types].includes(DND)) { e.preventDefault(); setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (e) => { setOver(false); try { onDrop(JSON.parse(e.dataTransfer.getData(DND))); } catch { /* not ours */ } },
    },
  };
}

function Section({ title, action, children, className }) {
  return (
    <section className={cn('border-b px-3 py-3', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 underline decoration-dotted underline-offset-4">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Chip({ children, onRemove, color, title, ...rest }) {
  return (
    <span title={title} className="group flex min-h-[34px] items-center gap-1.5 rounded border bg-white px-2 py-1 text-[13px] shadow-sm" style={color ? { borderLeft: `3px solid ${color}` } : undefined} {...rest}>
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {onRemove && <button onClick={onRemove} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>}
    </span>
  );
}

function DropSlot({ label, onDrop, children, empty }) {
  const d = useDrop(onDrop);
  return (
    <div {...d.props} className={cn('space-y-1.5 rounded border border-dashed p-1.5 transition-colors', d.over ? 'border-[hsl(var(--primary))] bg-[hsl(213_70%_97%)]' : 'border-slate-200')}>
      {children}
      {empty !== false && <div className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-muted-foreground">{label}</div>}
    </div>
  );
}

// ─── Segment builder ───────────────────────────────────────────────────────
function useValues(exp, field) {
  const q = { ...viewQuery(exp), limit: 60 };
  return useQuery({
    queryKey: ['seg-values', field?.key, q],
    enabled: Boolean(field),
    queryFn: async () => (field.key === 'page'
      ? (await api(`/stats/pages${toQuery({ ...q, limit: 100 })}`)).map((r) => r.path)
      : (await api(`/stats/dimension/${field.dim}${toQuery(q)}`)).map((r) => r.value)),
    staleTime: 60_000,
  });
}
const valueText = (k, v) => (k === 'channel' ? channelLabel(v) : k === 'event' ? EVENT_LABELS[v] || v : k === 'device' ? titleCase(v) : v);

function ConditionRow({ exp, cond, onChange, onRemove, used }) {
  const field = CONDITION_FIELDS.find((f) => f.key === cond.key);
  const { data: values } = useValues(exp, field);
  const listId = `vals-${cond.key}`;
  return (
    <div className="flex items-center gap-2">
      <Select className="w-40" value={cond.key} onChange={(e) => onChange({ key: e.target.value, value: '' })} aria-label="Condition">
        {CONDITION_FIELDS.map((f) => <option key={f.key} value={f.key} disabled={used.includes(f.key) && f.key !== cond.key}>{f.label}</option>)}
      </Select>
      <span className="text-[12px] text-muted-foreground">is</span>
      {['channel', 'device', 'event'].includes(cond.key) ? (
        <Select className="flex-1" value={cond.value} onChange={(e) => onChange({ ...cond, value: e.target.value })} aria-label="Value">
          <option value="">Choose…</option>
          {(values || []).map((v) => <option key={v} value={v}>{valueText(cond.key, v)}</option>)}
        </Select>
      ) : (
        <>
          <Input className="flex-1" list={listId} value={cond.value} onChange={(e) => onChange({ ...cond, value: e.target.value })} placeholder={cond.key === 'country' ? 'e.g. IN' : cond.key === 'page' ? '/contact' : 'Type or pick'} aria-label="Value" />
          <datalist id={listId}>{(values || []).map((v) => <option key={v} value={v} />)}</datalist>
        </>
      )}
      <button onClick={onRemove} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="Remove condition"><X className="h-4 w-4" /></button>
    </div>
  );
}

export function SegmentDialog({ exp, open, initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [conds, setConds] = useState(() => Object.entries(initial?.conditions || {}).map(([key, value]) => ({ key, value })).concat(initial ? [] : [{ key: 'device', value: '' }]));
  const used = conds.map((c) => c.key);
  const complete = conds.filter((c) => c.value?.trim());
  const save = (seg) => { onSave(seg); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit segment' : 'New segment'}</DialogTitle>
          <DialogDescription>A segment is a group of visits, like “Mobile traffic” or “Visitors who submitted a form”. Compare segments side by side in any tab.</DialogDescription>
        </DialogHeader>
        {!initial && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-600">Suggested</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_SEGMENTS.filter((s) => !exp.segments.some((x) => x.id === s.id)).map((s) => (
                <button key={s.id} onClick={() => save({ ...s })} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-slate-200 hover:bg-slate-50"><Users2 className="h-3.5 w-3.5 text-slate-500" />{s.name}</button>
              ))}
            </div>
            <p className="mb-1.5 mt-4 text-[12px] font-medium text-slate-600">Or build your own</p>
          </div>
        )}
        <div className="space-y-2">
          <Input placeholder="Segment name, e.g. Mobile visitors from Google" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <p className="text-[12px] text-muted-foreground">Include visits where all of these are true:</p>
          {conds.map((c, i) => <ConditionRow key={i} exp={exp} cond={c} used={used} onChange={(n) => setConds(conds.map((x, j) => (j === i ? n : x)))} onRemove={() => setConds(conds.filter((_, j) => j !== i))} />)}
          {conds.length < CONDITION_FIELDS.length && <Button variant="ghost" size="sm" onClick={() => setConds([...conds, { key: CONDITION_FIELDS.find((f) => !used.includes(f.key)).key, value: '' }])}><Plus />Add condition</Button>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!complete.length} onClick={() => {
            const conditions = Object.fromEntries(complete.map((c) => [c.key, c.value.trim()]));
            save({ id: initial?.id || uid(), name: name.trim() || describeSegment({ conditions }).slice(0, 60), conditions });
          }}>Save segment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Variables column ──────────────────────────────────────────────────────
export function VariablesPanel({ exp, update, readOnly, catalog, websites, engine, onUse, onClose }) {
  const [search, setSearch] = useState('');
  const [segDialog, setSegDialog] = useState(null); // { initial }
  const s = search.trim().toLowerCase();
  const dims = (catalog?.dimensions || []).filter((d) => !s || d.label.toLowerCase().includes(s));
  const mets = (catalog?.metrics || []).filter((m) => !s || m.label.toLowerCase().includes(s));
  const range = exp.range || { key: '28d' };
  const saveSegment = (seg) => update((e) => ({ ...e, segments: e.segments.some((x) => x.id === seg.id) ? e.segments.map((x) => (x.id === seg.id ? seg : x)) : [...e.segments, seg] }));
  const removeSegment = (id) => update((e) => ({
    ...e,
    segments: e.segments.filter((x) => x.id !== id),
    tabs: e.tabs.map((t) => ({ ...t, config: { ...t.config, segments: (t.config.segments || []).filter((x) => x !== id), ...(t.config.segment === id ? { segment: null } : {}) } })),
  }));

  return (
    <aside className="flex flex-col overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2.5"><h2 className="text-[15px] font-medium">Variables</h2>{onClose && <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Hide variables"><X className="h-4 w-4" /></button>}</div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Exploration name">
          <Input value={exp.name} disabled={readOnly} onChange={(e) => update({ name: e.target.value.slice(0, 120) || 'Untitled exploration' })} aria-label="Exploration name" />
        </Section>
        <Section title="Website & dates">
          <div className="space-y-2">
            <Select value={exp.site} disabled={readOnly} onChange={(e) => update({ site: e.target.value })} aria-label="Website">
              <option value="all">All websites</option>
              {websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select value={range.key} disabled={readOnly} onChange={(e) => update({ range: e.target.value === 'custom' ? { key: 'custom', from: range.from || new Date(Date.now() - 27 * 864e5).toISOString().slice(0, 10), to: range.to || new Date().toISOString().slice(0, 10) } : { key: e.target.value } })} aria-label="Date range">
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select>
            {range.key === 'custom' && (
              <div className="grid grid-cols-2 gap-1.5">
                <Input type="date" value={range.from || ''} max={range.to} disabled={readOnly} onChange={(e) => e.target.value && update({ range: { ...range, from: e.target.value } })} aria-label="From" />
                <Input type="date" value={range.to || ''} min={range.from} disabled={readOnly} onChange={(e) => e.target.value && update({ range: { ...range, to: e.target.value } })} aria-label="To" />
              </div>
            )}
          </div>
        </Section>
        <Section title="Segments" action={!readOnly && <button onClick={() => setSegDialog({})} className="rounded p-0.5 text-slate-600 hover:bg-slate-100" aria-label="Add segment"><Plus className="h-4 w-4" /></button>}>
          {!exp.segments.length && <p className="text-[12px] text-muted-foreground">Groups of visits to compare, like “Mobile traffic”. {readOnly ? '' : 'Click + to add one.'}</p>}
          <div className="space-y-1.5">
            {exp.segments.map((seg) => (
              <div key={seg.id} {...dragProps({ kind: 'segment', key: seg.id }, readOnly)} className="group flex items-center gap-1 rounded border bg-white px-2 py-1.5 text-[13px] shadow-sm" title={`${describeSegment(seg)} · click to compare in this tab`}>
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <button onClick={() => !readOnly && onUse({ kind: 'segment', key: seg.id })} className="min-w-0 flex-1 truncate text-left">{seg.name}</button>
                <Users2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                {!readOnly && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label={`Options for ${seg.name}`}><MoreVertical className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onUse({ kind: 'segment', key: seg.id })}>Apply to this tab</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setSegDialog({ initial: seg })}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onSelect={() => removeSegment(seg.id)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        </Section>
        <div className="sticky top-0 z-10 border-b bg-white px-3 py-2">
          <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search dimensions & metrics" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
        <Section title="Dimensions">
          <p className="mb-1.5 text-[11px] text-muted-foreground">What to break down by. Drag into Rows or click to add.</p>
          <div className="space-y-1">
            {dims.map((d) => {
              const ok = !engine || d.engines.includes(engine);
              return (
                <button key={d.key} {...dragProps({ kind: 'dim', key: d.key }, readOnly || !ok)} onClick={() => ok && !readOnly && onUse({ kind: 'dim', key: d.key })} disabled={!ok || readOnly} title={ok ? `Add ${d.label} to Rows` : 'Not available with the chosen metrics'}
                  className={cn('flex w-full items-center gap-1.5 rounded border-l-[3px] px-2 py-1 text-left text-[13px]', ok ? 'border-l-emerald-500 bg-slate-50 hover:bg-slate-100' : 'border-l-slate-200 text-slate-400')}>
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />{d.label}
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Metrics" className="border-b-0">
          <p className="mb-1.5 text-[11px] text-muted-foreground">What to count. Drag into Values or click to add.</p>
          <div className="space-y-1">
            {mets.map((m) => {
              const other = engine && m.engine !== engine;
              return (
                <button key={m.key} {...dragProps({ kind: 'metric', key: m.key }, readOnly)} onClick={() => !readOnly && onUse({ kind: 'metric', key: m.key })} disabled={readOnly} title={other ? 'Counted per action: adding it switches this tab to action metrics' : `Add ${m.label} to Values`}
                  className={cn('flex w-full items-center gap-1.5 rounded border-l-[3px] px-2 py-1 text-left text-[13px]', other ? 'border-l-slate-200 bg-white text-slate-400 hover:text-slate-600' : 'border-l-sky-500 bg-slate-50 hover:bg-slate-100')}>
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />{m.label}<span className="ml-auto text-[10px] text-slate-400">{m.engine === 'events' ? 'action' : 'visit'}</span>
                </button>
              );
            })}
          </div>
        </Section>
      </div>
      {segDialog && <SegmentDialog exp={exp} open initial={segDialog.initial} onClose={() => setSegDialog(null)} onSave={saveSegment} />}
    </aside>
  );
}

// ─── Settings column ───────────────────────────────────────────────────────
const VIZ = [{ key: 'table', label: 'Table', icon: Table2 }, { key: 'donut', label: 'Donut chart', icon: PieIcon }, { key: 'line', label: 'Line chart (needs Date)', icon: LineIcon }, { key: 'bar', label: 'Bar chart', icon: BarChart3 }];

function SegmentComparisons({ exp, ids, max, onChange, readOnly }) {
  const drop = (p) => p.kind === 'segment' && !ids.includes(p.key) && ids.length < max && onChange([...ids, p.key]);
  const available = exp.segments.filter((s) => !ids.includes(s.id));
  return (
    <Section title="Segment comparisons">
      <DropSlot onDrop={drop} empty={ids.length < max} label={
        available.length && !readOnly ? (
          <Select className="h-7 text-[12px]" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])} aria-label="Add segment">
            <option value="">+ Drop or select segment</option>
            {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        ) : <span>{exp.segments.length ? 'All segments added' : 'Create a segment in Variables first'}</span>
      }>
        {ids.map((id, i) => { const s = exp.segments.find((x) => x.id === id); return s && <Chip key={id} color={['#1a73e8', '#e8710a', '#188038', '#a142f4'][i]} title={describeSegment(s)} onRemove={readOnly ? undefined : () => onChange(ids.filter((x) => x !== id))}>{s.name}</Chip>; })}
      </DropSlot>
      <p className="mt-1 text-[11px] text-muted-foreground">Up to {max}. Without a segment, everyone is included.</p>
    </Section>
  );
}

function useNodeOptions(exp, nodeType) {
  const q = viewQuery(exp);
  return useQuery({
    queryKey: ['path-options', nodeType, q],
    queryFn: async () => (nodeType === 'page'
      ? (await api(`/stats/pages${toQuery({ ...q, limit: 150 })}`)).map((r) => r.path)
      : (await api(`/stats/dimension/event${toQuery({ ...q, limit: 100 })}`)).map((r) => r.value).filter((v) => !['page_leave', 'visibility_hidden', 'route_change', 'scroll', 'session_start', 'identify'].includes(v))),
    staleTime: 60_000,
  });
}

export function SettingsPanel({ exp, tab, catalog, readOnly, onConfig, onTechnique, onClose }) {
  const c = tab.config;
  const metDef = useMemo(() => Object.fromEntries((catalog?.metrics || []).map((m) => [m.key, m])), [catalog]);
  const dimDef = useMemo(() => Object.fromEntries((catalog?.dimensions || []).map((d) => [d.key, d])), [catalog]);
  const engine = tab.technique === 'freeform' && c.metrics?.length ? metDef[c.metrics[0]]?.engine : null;
  const nodeOpts = useNodeOptions(exp, c.nodeType || 'page');

  return (
    <aside className="flex flex-col overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2.5"><h2 className="text-[15px] font-medium">Settings</h2>{onClose && <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Hide settings"><X className="h-4 w-4" /></button>}</div>
      <fieldset disabled={readOnly} className="flex-1 overflow-y-auto">
        <Section title="Technique">
          <Select value={tab.technique} onChange={(e) => onTechnique(e.target.value)} aria-label="Technique">
            {Object.entries(TECHNIQUES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">{TECHNIQUES[tab.technique].hint}</p>
        </Section>

        {tab.technique === 'freeform' && (
          <>
            <Section title="Visualisation">
              <div className="grid grid-cols-4 gap-1.5">
                {VIZ.map((v) => (
                  <button key={v.key} onClick={() => onConfig({ viz: v.key })} title={v.label} aria-label={v.label} aria-pressed={c.viz === v.key}
                    className={cn('flex h-11 items-center justify-center rounded border', c.viz === v.key ? 'border-[hsl(var(--primary))] bg-[hsl(213_70%_96%)] text-[hsl(var(--primary))]' : 'text-slate-500 hover:bg-slate-50')}>
                    <v.icon className="h-5 w-5" />
                  </button>
                ))}
              </div>
            </Section>
            <SegmentComparisons exp={exp} ids={c.segments || []} max={4} readOnly={readOnly} onChange={(segments) => onConfig({ segments })} />
            <Section title="Rows">
              <DropSlot empty={(c.dims || []).length < 2} onDrop={(p) => p.kind === 'dim' && (!engine || dimDef[p.key]?.engines.includes(engine)) && !(c.dims || []).includes(p.key) && onConfig({ dims: [...(c.dims || []), p.key].slice(0, 2), sort: null })}
                label={
                  <Select className="h-7 text-[12px]" value="" onChange={(e) => e.target.value && onConfig({ dims: [...(c.dims || []), e.target.value].slice(0, 2), sort: null })} aria-label="Add dimension">
                    <option value="">+ Drop or select dimension</option>
                    {(catalog?.dimensions || []).filter((d) => !(c.dims || []).includes(d.key)).map((d) => <option key={d.key} value={d.key} disabled={engine && !d.engines.includes(engine)}>{d.label}</option>)}
                  </Select>
                }>
                {(c.dims || []).map((d, i) => <Chip key={d} onRemove={() => onConfig({ dims: c.dims.filter((x) => x !== d), sort: null })}>{i === 1 && <span className="mr-1 text-[11px] text-muted-foreground">then</span>}{dimDef[d]?.label || d}</Chip>)}
              </DropSlot>
              <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                <span className="text-slate-600">Show rows</span>
                <Select className="h-7 w-24 text-[12px]" value={c.showRows || 25} onChange={(e) => onConfig({ showRows: Number(e.target.value) })} aria-label="Show rows">{[10, 25, 50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
              </div>
            </Section>
            <Section title="Values">
              <DropSlot empty={(c.metrics || []).length < 8} onDrop={(p) => p.kind === 'metric' && !(c.metrics || []).includes(p.key) && onConfig(addMetric(c, p.key, metDef, dimDef))}
                label={
                  <Select className="h-7 text-[12px]" value="" onChange={(e) => e.target.value && onConfig(addMetric(c, e.target.value, metDef, dimDef))} aria-label="Add metric">
                    <option value="">+ Drop or select metric</option>
                    {(catalog?.metrics || []).filter((m) => !(c.metrics || []).includes(m.key)).map((m) => <option key={m.key} value={m.key}>{m.label}{engine && m.engine !== engine ? ' (switches to action metrics)' : ''}</option>)}
                  </Select>
                }>
                {(c.metrics || []).map((m) => <Chip key={m} onRemove={() => onConfig({ metrics: c.metrics.filter((x) => x !== m), sort: c.sort === m ? null : c.sort })}>{metDef[m]?.label || m}</Chip>)}
              </DropSlot>
            </Section>
            <Section title="Compare" className="border-b-0">
              <label className="flex items-center justify-between gap-2 text-[13px]">With the previous period<Switch checked={Boolean(c.compare)} onCheckedChange={(v) => onConfig({ compare: v })} aria-label="Compare with previous period" /></label>
            </Section>
          </>
        )}

        {tab.technique === 'funnel' && (
          <>
            <SegmentComparisons exp={exp} ids={c.segments || []} max={4} readOnly={readOnly} onChange={(segments) => onConfig({ segments })} />
            <Section title="Steps">
              <div className="space-y-2">
                {(c.steps || []).map((s, i) => {
                  const set = (patch) => onConfig({ steps: c.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  const move = (d) => { const a = [...c.steps]; [a[i], a[i + d]] = [a[i + d], a[i]]; onConfig({ steps: a }); };
                  return (
                    <div key={i} className="rounded border bg-slate-50 p-2">
                      <div className="mb-1.5 flex items-center gap-1">
                        <span className="text-[12px] font-semibold text-slate-600">Step {i + 1}</span>
                        <span className="ml-auto flex gap-0.5">
                          <button onClick={() => move(-1)} disabled={i === 0} className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button onClick={() => move(1)} disabled={i === c.steps.length - 1} className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                          <button onClick={() => onConfig({ steps: c.steps.filter((_, j) => j !== i) })} disabled={c.steps.length <= 2} className="rounded p-0.5 text-slate-500 hover:bg-white hover:text-red-600 disabled:opacity-30" aria-label="Remove step"><X className="h-3.5 w-3.5" /></button>
                        </span>
                      </div>
                      <Select className="mb-1.5 h-7 text-[12px]" value={s.type} onChange={(e) => set({ type: e.target.value, match: e.target.value === 'form' ? 'submit' : e.target.value === 'path' ? '*' : '', label: '' })} aria-label="Step type">
                        <option value="path">Viewed a page</option><option value="event">Did an action</option><option value="form">Used a form</option><option value="search">Searched the site</option>
                      </Select>
                      {s.type === 'form' ? (
                        <Select className="mb-1.5 h-7 text-[12px]" value={(s.match || 'submit').split(':')[0]} onChange={(e) => set({ match: e.target.value, label: '' })} aria-label="Form step"><option value="view">Saw a form</option><option value="start">Started a form</option><option value="submit">Submitted a form</option></Select>
                      ) : (
                        <>
                          <Input className="mb-1.5 h-7 text-[12px]" list={`fs-${s.type}`} value={s.match || ''} onChange={(e) => set({ match: e.target.value })} placeholder={s.type === 'path' ? '/contact or /projects/* (* = any page)' : s.type === 'event' ? 'e.g. whatsapp_click' : 'Words in the search (optional)'} aria-label="Step match" />
                          {s.type === 'event' && <EventList exp={exp} id="fs-event" />}
                        </>
                      )}
                      <Input className="h-7 text-[12px]" value={s.label || ''} onChange={(e) => set({ label: e.target.value })} placeholder={`Name: ${stepLabel({ ...s, label: '' }, i)}`} maxLength={80} aria-label="Step name" />
                    </div>
                  );
                })}
              </div>
              {(c.steps || []).length < 10 && <Button variant="ghost" size="sm" className="mt-1" onClick={() => onConfig({ steps: [...(c.steps || []), { type: 'path', match: '*', label: '' }] })}><Plus />Add step</Button>}
            </Section>
            <Section title="Time allowed" className="border-b-0">
              <Select value={c.windowHours || 72} onChange={(e) => onConfig({ windowHours: Number(e.target.value) })} aria-label="Time allowed">
                {[[1, '1 hour'], [24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days']].map(([v, l]) => <option key={v} value={v}>Complete within {l}</option>)}
              </Select>
            </Section>
          </>
        )}

        {tab.technique === 'path' && (
          <>
            <Section title="Segment">
              <Select value={c.segment || ''} onChange={(e) => onConfig({ segment: e.target.value || null })} aria-label="Segment">
                <option value="">All users</option>
                {exp.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Section>
            <Section title="Node type">
              <div className="space-y-1.5">
                {[['event', 'Event name', 'Actions: clicks, forms, downloads…', MousePointerClick], ['page', 'Page path', 'Pages people opened', FileText]].map(([k, l, h, Icon]) => (
                  <button key={k} onClick={() => onConfig({ nodeType: k, start: '', chain: [] })} aria-pressed={(c.nodeType || 'page') === k}
                    className={cn('flex w-full items-start gap-2 rounded border px-2.5 py-2 text-left', (c.nodeType || 'page') === k ? 'border-[hsl(var(--primary))] bg-[hsl(213_70%_97%)]' : 'hover:bg-slate-50')}>
                    <Icon className="mt-0.5 h-4 w-4 text-slate-500" /><span><span className="block text-[13px] font-medium">{l}</span><span className="block text-[11px] text-muted-foreground">{h}</span></span>
                  </button>
                ))}
              </div>
            </Section>
            <Section title="Starting point">
              <Select value={c.start || ''} onChange={(e) => onConfig({ start: e.target.value, chain: e.target.value ? [e.target.value] : [] })} aria-label="Starting point">
                <option value="">First {c.nodeType === 'event' ? 'action' : 'page'} of each visit</option>
                {c.start && !(nodeOpts.data || []).includes(c.start) && <option value={c.start}>{nodeLabel(c.nodeType, c.start)}</option>}
                {(nodeOpts.data || []).map((v) => <option key={v} value={v}>{nodeLabel(c.nodeType, v)}</option>)}
              </Select>
            </Section>
            <Section title="View unique nodes only" className="border-b-0">
              <label className="flex items-center justify-between gap-2 text-[13px]">Merge repeats in a row<Switch checked={c.unique !== false} onCheckedChange={(v) => onConfig({ unique: v })} aria-label="View unique nodes only" /></label>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onConfig({ chain: c.start ? [c.start] : [] })}><RotateCcw />Start again</Button>
            </Section>
          </>
        )}
      </fieldset>
    </aside>
  );
}

function EventList({ exp, id }) {
  const opts = useNodeOptions(exp, 'event');
  return <datalist id={id}>{(opts.data || []).map((v) => <option key={v} value={v}>{EVENT_LABELS[v] || v}</option>)}</datalist>;
}

/** Add a metric; a metric of the other engine switches the tab over and drops dimensions it can't use. */
export function addMetric(c, key, metDef, dimDef) {
  const eng = metDef[key]?.engine;
  const metrics = [...(c.metrics || []).filter((m) => metDef[m]?.engine === eng), key].slice(0, 8);
  return { metrics, dims: (c.dims || []).filter((d) => dimDef[d]?.engines.includes(eng)), sort: null };
}

export function freshConfig(technique) {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG[technique]));
}
