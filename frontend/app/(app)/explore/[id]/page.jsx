'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Undo2, Redo2, Download, Link2, Check, Loader2, AlertCircle, Eye, Copy, Plus, ChevronDown, Table2, Filter, Route, Pencil, Trash2, PanelLeftOpen, Settings2 } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { cn, copyText } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/controls';
import { useExploration } from '@/components/explore/useExploration';
import { VariablesPanel, SettingsPanel, addMetric, freshConfig } from '@/components/explore/Panels';
import { FreeformCanvas } from '@/components/explore/FreeformCanvas';
import { FunnelCanvas } from '@/components/explore/FunnelCanvas';
import { PathCanvas } from '@/components/explore/PathCanvas';
import { TECHNIQUES, TEMPLATES, SUGGESTED_SEGMENTS, uid, downloadCsv } from '@/components/explore/shared';

const ICON = { freeform: Table2, funnel: Filter, path: Route };
const SHORT = { freeform: 'Free-form', funnel: 'Funnel', path: 'Path' };

function nextTabName(tabs, technique) {
  let n = 1;
  while (tabs.some((t) => t.name === `${SHORT[technique]} ${n}`)) n += 1;
  return `${SHORT[technique]} ${n}`;
}

/** /explore/new?technique=freeform|funnel|path|blank&template=i → create, then open the saved exploration. */
function CreateExploration() {
  const router = useRouter();
  const params = useSearchParams();
  const { site } = useFilters();
  const started = useRef(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = TEMPLATES[Number(params.get('template'))];
    const technique = t?.technique || (params.get('technique') === 'blank' ? 'freeform' : params.get('technique')) || 'freeform';
    const config = { ...freshConfig(technique), ...(params.get('technique') === 'blank' && !t ? { dims: [], metrics: [] } : {}), ...(t?.config || {}) };
    const segments = (config.segments || []).map((id) => SUGGESTED_SEGMENTS.find((s) => s.id === id)).filter(Boolean);
    api('/explorations', {
      method: 'POST',
      body: { name: t?.name || 'Untitled exploration', site: params.get('site') || site || 'all', range: { key: '28d' }, segments, tabs: [{ id: uid(), name: `${SHORT[technique]} 1`, technique, config }] },
    }).then((d) => router.replace(`/explore/${d.id}`)).catch(setError);
  }, [params, router, site]);
  if (error) return <Card><ErrorState error={error} /></Card>;
  return <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Creating exploration…</div>;
}

function SaveStatus({ status, onCopy }) {
  if (status === 'readonly') {
    return <span className="flex items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-600"><Eye className="h-3.5 w-3.5" />View only</span><Button size="sm" onClick={onCopy}><Copy />Make a copy to edit</Button></span>;
  }
  const map = {
    saved: [Check, 'Saved', 'text-emerald-700'],
    pending: [Loader2, 'Saving…', 'text-slate-500'],
    saving: [Loader2, 'Saving…', 'text-slate-500'],
    error: [AlertCircle, 'Not saved, retrying on next change', 'text-red-600'],
  };
  const [Icon, label, cls] = map[status] || map.saved;
  return <span className={cn('inline-flex items-center gap-1 text-[12px]', cls)}><Icon className={cn('h-4 w-4', status !== 'saved' && status !== 'error' && 'animate-spin')} />{label}</span>;
}

function RenameTab({ tab, onClose, onSave }) {
  const [name, setName] = useState(tab?.name || '');
  return (
    <Dialog open={Boolean(tab)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Rename tab</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim().slice(0, 60)); onClose(); } }}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <DialogFooter className="mt-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!name.trim()}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Editor({ id }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { websites } = useFilters();
  const { exp, meta, error, status, update, undo, redo, canUndo, canRedo } = useExploration(id);
  const { data: catalog } = useQuery({ queryKey: ['explore-catalog'], queryFn: () => api('/stats/explore/catalog'), staleTime: Infinity });
  const [activeId, setActiveId] = useState(null);
  const [showVars, setShowVars] = useState(true);
  const [showSettings, setShowSettings] = useState(true);
  const [renaming, setRenaming] = useState(null);
  const exporter = useRef(null);
  const registerExport = useCallback((fn) => { exporter.current = fn; }, []);
  const readOnly = status === 'readonly';

  const tab = useMemo(() => exp?.tabs.find((t) => t.id === activeId) || exp?.tabs[0], [exp, activeId]);
  const metDef = useMemo(() => Object.fromEntries((catalog?.metrics || []).map((m) => [m.key, m])), [catalog]);
  const dimDef = useMemo(() => Object.fromEntries((catalog?.dimensions || []).map((d) => [d.key, d])), [catalog]);
  const engine = tab?.technique === 'freeform' && tab.config.metrics?.length ? metDef[tab.config.metrics[0]]?.engine : null;

  // Keyboard: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (error) return <Card><ErrorState error={error} /></Card>;
  if (!exp || !tab) return <div className="grid gap-3 lg:grid-cols-[240px_260px_1fr]"><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /></div>;

  const setTab = (fn) => update((e) => ({ ...e, tabs: e.tabs.map((t) => (t.id === tab.id ? fn(t) : t)) }));
  const onConfig = (patch) => setTab((t) => ({ ...t, config: { ...t.config, ...patch } }));
  const onTechnique = (technique) => setTab((t) => ({ ...t, technique, name: t.name.startsWith(SHORT[t.technique]) ? nextTabName(exp.tabs, technique) : t.name, config: { ...freshConfig(technique), ...(technique === 'path' ? { segment: t.config.segments?.[0] || t.config.segment || null } : { segments: t.config.segments || (t.config.segment ? [t.config.segment] : []) }) } }));
  const addTab = (technique) => {
    const t = { id: uid(), name: nextTabName(exp.tabs, technique), technique, config: freshConfig(technique) };
    update((e) => ({ ...e, tabs: [...e.tabs, t].slice(0, 10) }));
    setActiveId(t.id);
  };
  const duplicateTab = (src) => {
    const t = { ...JSON.parse(JSON.stringify(src)), id: uid(), name: `${src.name} copy`.slice(0, 60) };
    update((e) => ({ ...e, tabs: [...e.tabs, t].slice(0, 10) }));
    setActiveId(t.id);
  };
  const deleteTab = (src) => {
    if (exp.tabs.length === 1) return;
    update((e) => ({ ...e, tabs: e.tabs.filter((t) => t.id !== src.id) }));
    if (src.id === tab.id) setActiveId(null);
  };

  /** Click (or drop) from Variables: dimension → Rows, metric → Values, segment → this tab's comparison. */
  const onUse = ({ kind, key }) => {
    if (tab.technique === 'freeform') {
      const c = tab.config;
      if (kind === 'dim' && !(c.dims || []).includes(key)) {
        if ((c.dims || []).length >= 2) return toast.info('Rows can hold 2 dimensions. Remove one first.');
        onConfig({ dims: [...(c.dims || []), key], sort: null });
      } else if (kind === 'metric' && !(c.metrics || []).includes(key)) {
        if ((c.metrics || []).length >= 8 && metDef[key]?.engine === engine) return toast.info('Values can hold 8 metrics. Remove one first.');
        onConfig(addMetric(c, key, metDef, dimDef));
      }
    }
    if (kind === 'segment') {
      if (tab.technique === 'path') onConfig({ segment: key });
      else if (!(tab.config.segments || []).includes(key)) {
        if ((tab.config.segments || []).length >= 4) return toast.info('Compare up to 4 segments at a time.');
        onConfig({ segments: [...(tab.config.segments || []), key] });
      }
    }
    if ((kind === 'dim' || kind === 'metric') && tab.technique !== 'freeform') toast.info('Dimensions and metrics are used by Free-form tabs. Funnel and Path tabs are set up in Settings.');
    return undefined;
  };
  const onAddSegment = (seg) => {
    if (readOnly) return;
    const existing = exp.segments.find((s) => JSON.stringify(s.conditions) === JSON.stringify(seg.conditions));
    const segId = existing?.id || uid();
    update((e) => ({
      ...e,
      segments: existing ? e.segments : [...e.segments, { id: segId, ...seg }].slice(0, 20),
      tabs: e.tabs.map((t) => (t.id === tab.id && !(t.config.segments || []).includes(segId) ? { ...t, config: { ...t.config, segments: [...(t.config.segments || []), segId].slice(-4) } } : t)),
    }));
    toast.success(`Comparing “${seg.name}”`, { description: 'Added as a segment. Remove it under Segment comparisons.' });
  };
  const makeCopy = async () => {
    try {
      const d = await api(`/explorations/${id}/duplicate`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['explorations'] });
      router.push(`/explore/${d.id}`);
    } catch (e) { toast.error(apiMessage(e)); }
  };
  const download = () => {
    const out = exporter.current?.();
    if (!out?.lines?.length) return toast.info('Nothing to download yet');
    downloadCsv(`${exp.name}-${out.name}`, out.lines);
    return undefined;
  };
  const copyLink = async () => ((await copyText(window.location.href)) ? toast.success('Link copied. Anyone in your team can open this exploration.') : toast.error('Copy failed'));

  const Canvas = { freeform: FreeformCanvas, funnel: FunnelCanvas, path: PathCanvas }[tab.technique];
  const cols = cn('grid gap-3', showVars && showSettings ? 'xl:grid-cols-[240px_270px_minmax(0,1fr)]' : showVars || showSettings ? 'xl:grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1');

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/explore" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Explorations</Link>
        <h1 className="min-w-0 truncate text-[20px] font-semibold text-slate-900">{exp.name}</h1>
        <span className="text-[12px] text-muted-foreground">by {meta?.owner?.me ? 'you' : meta?.owner?.name}</span>
        <div className="ml-auto flex items-center gap-1">
          {!readOnly && <>
            <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 /></Button>
            <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 /></Button>
          </>}
          <Button variant="ghost" size="icon" onClick={download} aria-label="Download this tab as CSV" title="Download this tab as CSV"><Download /></Button>
          <Button variant="ghost" size="icon" onClick={copyLink} aria-label="Copy link" title="Copy link"><Link2 /></Button>
          <span className="ml-2"><SaveStatus status={status} onCopy={makeCopy} /></span>
        </div>
      </div>

      <div className={cols}>
        {showVars && <div className="xl:sticky xl:top-16 xl:h-[calc(100vh-6rem)]"><VariablesPanel exp={exp} update={update} readOnly={readOnly} catalog={catalog} websites={websites} engine={engine} onUse={onUse} onClose={() => setShowVars(false)} /></div>}
        {showSettings && <div className="xl:sticky xl:top-16 xl:h-[calc(100vh-6rem)]"><SettingsPanel key={tab.id} exp={exp} tab={tab} catalog={catalog} readOnly={readOnly} onConfig={onConfig} onTechnique={onTechnique} onClose={() => setShowSettings(false)} /></div>}
        <div className="min-w-0">
          <div className="flex items-end gap-1 overflow-x-auto">
            {(!showVars || !showSettings) && (
              <span className="mb-1 mr-1 flex gap-1">
                {!showVars && <Button variant="outline" size="sm" onClick={() => setShowVars(true)}><PanelLeftOpen />Variables</Button>}
                {!showSettings && <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}><Settings2 />Settings</Button>}
              </span>
            )}
            {exp.tabs.map((t) => {
              const Icon = ICON[t.technique];
              const active = t.id === tab.id;
              return (
                <div key={t.id} className={cn('flex shrink-0 items-center rounded-t-lg border border-b-0 pl-3 pr-1', active ? 'bg-white' : 'bg-slate-100 hover:bg-slate-50')}>
                  <button onClick={() => setActiveId(t.id)} className={cn('flex items-center gap-2 py-2 text-[13px]', active ? 'font-medium text-slate-900' : 'text-slate-600')}>
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', active ? 'bg-[hsl(var(--primary))] text-white' : 'bg-white text-slate-500')}><Icon className="h-3.5 w-3.5" /></span>{t.name}
                  </button>
                  {!readOnly && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button className="ml-1 rounded p-1 text-slate-500 hover:bg-slate-200" aria-label={`Options for ${t.name}`}><ChevronDown className="h-4 w-4" /></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => setRenaming(t)}><Pencil />Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => duplicateTab(t)}><Copy />Duplicate</DropdownMenuItem>
                        <DropdownMenuItem disabled={exp.tabs.length === 1} className="text-red-600" onSelect={() => deleteTab(t)}><Trash2 />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
            {!readOnly && exp.tabs.length < 10 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="mb-0 shrink-0 rounded-t-lg border border-b-0 bg-slate-100 px-3 py-2 text-slate-600 hover:bg-slate-50" aria-label="Add tab"><Plus className="h-4 w-4" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">New tab</DropdownMenuLabel>
                  {Object.entries(TECHNIQUES).map(([k, v]) => { const Icon = ICON[k]; return <DropdownMenuItem key={k} onSelect={() => addTab(k)}><Icon />{v.label}</DropdownMenuItem>; })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => duplicateTab(tab)}><Copy />Copy of “{tab.name}”</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="min-h-[480px] rounded-b-lg rounded-tr-lg border bg-slate-50/60 p-3">
            <Canvas key={tab.id} exp={exp} config={tab.config} onConfig={readOnly ? () => {} : onConfig} onAddSegment={readOnly ? undefined : onAddSegment} registerExport={registerExport} tabName={tab.name} />
          </div>
        </div>
      </div>
      {renaming && <RenameTab tab={renaming} onClose={() => setRenaming(null)} onSave={(name) => update((e) => ({ ...e, tabs: e.tabs.map((t) => (t.id === renaming.id ? { ...t, name } : t)) }))} />}
    </>
  );
}

export default function ExplorationEditorPage() {
  const { id } = useParams();
  return id === 'new' ? <CreateExploration /> : <Editor id={id} />;
}
