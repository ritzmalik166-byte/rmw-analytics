'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table2, BarChart3, PieChart as PieIcon, LineChart as LineIcon, Download, Link2, Save, Trash2, LayoutTemplate, Filter, Route, Info } from 'lucide-react';
import { EVENT_LABELS } from '@rmw-analytics/shared/events';
import { api } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { cn, num, pct, duration, countryName, flag, titleCase, copyText } from '@/lib/utils';
import { channelLabel } from '@/lib/labels';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { PageHeader, ErrorState, Skeleton, EmptyState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { Delta } from '@/components/analytics/Simple';

/**
 * Explore: GA4-style free-form exploration in one place. Pick up to 2 dimensions (rows, break down by),
 * any compatible metrics and a visualisation; filters and dates come from the bar at the top.
 * The whole exploration lives in the URL (shareable); "Save" keeps named explorations in this browser.
 */

const TEMPLATES = [
  { name: 'Traffic by day', hint: 'Users, sessions and views each day', dims: ['date'], metrics: ['activeUsers', 'sessions', 'pageviews', 'conversions'], viz: 'line' },
  { name: 'Where visitors come from', hint: 'Traffic type and source, with results', dims: ['channel', 'source'], metrics: ['users', 'sessions', 'engagementRate', 'conversionRate'], viz: 'table' },
  { name: 'Most viewed pages', hint: 'Views and viewers per page', dims: ['pagePath'], metrics: ['views', 'viewers'], viz: 'bar' },
  { name: 'Landing pages that convert', hint: 'First page of a visit and its results', dims: ['landingPage'], metrics: ['sessions', 'bounceRate', 'conversions', 'conversionRate'], viz: 'table' },
  { name: 'Users by country & device', hint: 'Where people are and what they use', dims: ['country', 'device'], metrics: ['users', 'newUsers', 'avgEngagementTime'], viz: 'table' },
  { name: 'What people do', hint: 'Every action, how often and by how many', dims: ['eventName'], metrics: ['eventCount', 'eventUsers', 'eventsPerUser'], viz: 'bar' },
  { name: 'Device split', hint: 'Mobile vs desktop vs tablet', dims: ['device'], metrics: ['users'], viz: 'donut' },
  { name: 'Campaign performance', hint: 'UTM campaigns and their results', dims: ['campaign', 'medium'], metrics: ['sessions', 'engagementRate', 'conversions', 'conversionRate'], viz: 'table' },
  { name: 'New vs returning', hint: 'How first-time visitors behave', dims: ['userType'], metrics: ['users', 'sessions', 'pagesPerSession', 'conversionRate'], viz: 'table' },
];
const VIZ = [
  { key: 'table', label: 'Table', icon: Table2 },
  { key: 'bar', label: 'Bar chart', icon: BarChart3 },
  { key: 'donut', label: 'Donut', icon: PieIcon },
  { key: 'line', label: 'Line over time', icon: LineIcon },
];
const COLORS = ['#1a73e8', '#f9ab00', '#d93025', '#188038', '#7b1fa2', '#12b5cb', '#e8710a', '#5f6368'];
const SAVED_KEY = 'rmwa:explorations';
const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
/** Explore dimension → report filter it can drill into. */
const DRILL = { device: 'device', country: 'country', channel: 'channel', source: 'source', medium: 'medium', campaign: 'campaign', pagePath: 'page', eventName: 'event' };

function formatMetric(m, v) {
  if (v == null) return '—';
  switch (m.format) {
    case 'percent': return pct(v, 1);
    case 'duration': return duration(v);
    case 'decimal': return Number(v).toFixed(2);
    default: return num(v);
  }
}
function formatDim(d, v) {
  if (v == null || v === '(unknown)') return v === '(unknown)' ? 'Unknown' : '—';
  switch (d) {
    case 'channel': return channelLabel(v);
    case 'country': return `${flag(v)} ${countryName(v)}`;
    case 'device': return titleCase(v);
    case 'eventName': return EVENT_LABELS[v] ? `${EVENT_LABELS[v]}` : v;
    case 'date': return fmtDay.format(new Date(`${v}T00:00:00`));
    case 'pagePath': case 'landingPage': case 'exitPage': return v === '/' ? 'Homepage (/)' : v;
    default: return v;
  }
}
const sumable = (m) => m.format === 'number';

function loadSaved() { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } }
function storeSaved(list) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* private mode */ } }

/** Exploration state in the URL: dims, metrics, viz, sort, order. */
function useExploreState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k, d) => params.get(k) ?? d;
  const state = {
    dims: get('dims', 'channel').split(',').filter(Boolean),
    metrics: get('metrics', 'users,sessions,engagementRate,conversionRate').split(',').filter(Boolean),
    viz: get('viz', 'table'),
    sort: params.get('sort') || undefined,
    order: get('order', 'desc'),
  };
  const set = (patch) => {
    const sp = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => { const s = Array.isArray(v) ? v.join(',') : v; if (s) sp.set(k, s); else sp.delete(k); });
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };
  return [state, set];
}

function Section({ title, children, action }) {
  return (
    <div className="border-b px-3 py-3 last:border-0">
      <div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>{action}</div>
      {children}
    </div>
  );
}

function Chart({ data, viz, dims, metrics }) {
  const m0 = data.metrics[0];
  const label = (r) => r.dims.map((v, i) => formatDim(dims[i], v)).join(' · ') || 'Total';
  if (viz === 'line') {
    if (dims[0] !== 'date') return <p className="px-4 py-16 text-center text-[13px] text-muted-foreground">A line over time needs <b>Date</b> as the first dimension. Pick it under Rows, or choose another chart.</p>;
    // With a breakdown: one line per top value of the second dimension for the first metric. Otherwise: one line per metric.
    let series; let points;
    if (dims[1]) {
      const totals = new Map();
      data.rows.forEach((r) => totals.set(r.dims[1], (totals.get(r.dims[1]) || 0) + (r.metrics[m0.key] || 0)));
      const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
      const byDate = new Map();
      data.rows.forEach((r) => { if (!top.includes(r.dims[1])) return; const p = byDate.get(r.dims[0]) || { t: r.dims[0] }; p[r.dims[1]] = r.metrics[m0.key]; byDate.set(r.dims[0], p); });
      points = [...byDate.values()].sort((a, b) => a.t.localeCompare(b.t));
      series = top.map((k, i) => ({ key: k, name: formatDim(dims[1], k), color: COLORS[i % COLORS.length], metric: m0 }));
    } else {
      points = data.rows.map((r) => ({ t: r.dims[0], ...r.metrics })).sort((a, b) => a.t.localeCompare(b.t));
      series = data.metrics.slice(0, 5).map((m, i) => ({ key: m.key, name: m.label, color: COLORS[i], metric: m, axis: i === 0 ? 'l' : 'r' }));
    }
    return (
      <div className="h-[320px] px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="t" tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} tickFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} />
            <YAxis yAxisId="l" width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            {!dims[1] && series.length > 1 && <YAxis yAxisId="r" orientation="right" width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />}
            <Tooltip labelFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} formatter={(v, n, item) => [formatMetric(series.find((s) => s.key === item.dataKey)?.metric || m0, v), n]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => <Line key={s.key} yAxisId={dims[1] || s.axis !== 'r' || series.length === 1 ? 'l' : 'r'} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  const top = data.rows.slice(0, viz === 'donut' ? 7 : 12);
  if (viz === 'donut') {
    if (!sumable(m0)) return <p className="px-4 py-16 text-center text-[13px] text-muted-foreground">A donut shows shares of a total, which doesn't work for <b>{m0.label}</b>. Put a count (users, sessions, views…) first, or use a bar chart.</p>;
    const rest = data.rows.slice(7).reduce((s, r) => s + (r.metrics[m0.key] || 0), 0);
    const pie = [...top.map((r) => ({ name: label(r), value: r.metrics[m0.key] || 0 })), ...(rest ? [{ name: 'Other', value: rest }] : [])];
    const total = pie.reduce((s, p) => s + p.value, 0);
    return (
      <div className="grid items-center gap-4 p-4 md:grid-cols-2">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1} isAnimationActive={false}>
                {pie.map((p, i) => <Cell key={p.name} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [`${formatMetric(m0, v)} (${pct((v / total) * 100)})`, n]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1.5 text-[13px]">
          {pie.map((p, i) => <li key={p.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="tabular-nums text-muted-foreground">{formatMetric(m0, p.value)}</span><span className="w-12 text-right font-semibold tabular-nums">{pct((p.value / total) * 100, 0)}</span></li>)}
        </ul>
      </div>
    );
  }
  if (viz === 'bar') {
    const bars = top.map((r) => ({ name: label(r), value: r.metrics[m0.key] || 0 }));
    return (
      <div className="px-2 pt-3" style={{ height: Math.max(180, bars.length * 30 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={180} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#334155' }} tickFormatter={(v) => (v.length > 28 ? `${v.slice(0, 27)}…` : v)} />
            <Tooltip formatter={(v) => [formatMetric(m0, v), m0.label]} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
            <Bar dataKey="value" fill="#194173" radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return null;
}

export default function ExplorePage() {
  const { current, rangeLabel, compare, setFilter, linkQuery, query } = useFilters();
  const [st, set] = useExploreState();
  const [saved, setSaved] = useState([]);
  const [saveName, setSaveName] = useState('');
  useEffect(() => { setSaved(loadSaved()); }, []);
  const { data: cat } = useQuery({ queryKey: ['explore-catalog'], queryFn: () => api('/stats/explore/catalog'), staleTime: Infinity });
  const dimDef = useMemo(() => Object.fromEntries((cat?.dimensions || []).map((d) => [d.key, d])), [cat]);
  const metDef = useMemo(() => Object.fromEntries((cat?.metrics || []).map((m) => [m.key, m])), [cat]);
  const res = useStats('/stats/explore', { dims: st.dims.join(','), metrics: st.metrics.join(','), sort: st.sort, order: st.order, compare: compare ? '1' : undefined, limit: 500 }, { enabled: st.metrics.length > 0, retry: false });
  const data = res.data;

  // The engine follows the chosen metrics; dimensions and metrics of the other engine are disabled with a reason.
  const engine = st.metrics.length ? metDef[st.metrics[0]]?.engine : null;
  const dimOk = (k) => !engine || dimDef[k]?.engines.includes(engine);
  const metOk = (k) => !engine || metDef[k]?.engine === engine;
  const toggleMetric = (k) => {
    const has = st.metrics.includes(k);
    const next = has ? st.metrics.filter((x) => x !== k) : [...st.metrics.filter((x) => metDef[x]?.engine === metDef[k]?.engine), k].slice(0, 8);
    // Switching engines drops dimensions the new engine can't use.
    const eng = metDef[next[0]]?.engine;
    set({ metrics: next, dims: st.dims.filter((d) => !eng || dimDef[d]?.engines.includes(eng)), sort: null });
  };
  const setDim = (i, v) => { const d = [...st.dims]; if (v) d[i] = v; else d.splice(i, 1); set({ dims: [...new Set(d.filter(Boolean))], sort: null }); };
  const applyTemplate = (t) => set({ dims: t.dims, metrics: t.metrics, viz: t.viz, sort: null, order: null });
  const sortBy = (k) => set({ sort: k, order: st.sort === k && st.order === 'desc' ? 'asc' : 'desc' });

  const saveCurrent = () => {
    const name = saveName.trim() || `${st.dims.map((d) => dimDef[d]?.label).join(' × ') || 'Totals'}`;
    const next = [{ name, dims: st.dims, metrics: st.metrics, viz: st.viz, savedAt: Date.now() }, ...saved.filter((s) => s.name !== name)].slice(0, 30);
    setSaved(next); storeSaved(next); setSaveName(''); toast.success(`Saved "${name}" in this browser`);
  };
  const removeSaved = (name) => { const next = saved.filter((s) => s.name !== name); setSaved(next); storeSaved(next); };
  const downloadCsv = () => {
    if (!data) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [...data.dimensions.map((d) => d.label), ...data.metrics.map((m) => m.label)];
    const lines = [head, ...data.rows.map((r) => [...r.dims, ...data.metrics.map((m) => r.metrics[m.key])]), ['Total', ...data.dimensions.slice(1).map(() => ''), ...data.metrics.map((m) => data.total[m.key])]];
    const blob = new Blob([lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `exploration-${query.range || 'custom'}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  };
  const copyLink = async () => { (await copyText(window.location.href)) ? toast.success('Link copied. It opens this exact exploration.') : toast.error('Copy failed'); };

  const groups = [
    { title: 'Visits', items: (cat?.metrics || []).filter((m) => m.engine === 'sessions') },
    { title: 'Actions', items: (cat?.metrics || []).filter((m) => m.engine === 'events') },
  ];
  const dimOptions = (cat?.dimensions || []);

  return (
    <>
      <PageHeader
        title="Explore"
        description={`Build any report in one place: choose what to break down by and what to count · ${current ? current.name : 'All websites'} · ${rangeLabel}`}
        actions={<><RangePicker showCompare /><Button size="sm" variant="outline" onClick={copyLink}><Link2 />Copy link</Button><Button size="sm" variant="outline" onClick={downloadCsv} disabled={!data?.rows?.length}><Download />CSV</Button></>}
      />
      <div className="mb-3 flex flex-wrap gap-1 text-[12px]">
        <span className="rounded-full bg-[hsl(var(--primary))] px-3 py-1 font-medium text-white">Free-form</span>
        <Link href={withView('/funnels', linkQuery)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"><Filter className="h-3 w-3" />Funnel</Link>
        <Link href={withView('/journeys', linkQuery)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"><Route className="h-3 w-3" />Path</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── Variables & settings ── */}
        <Card className="h-fit overflow-hidden lg:sticky lg:top-16">
          <Section title="Start from a template">
            <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
              {TEMPLATES.map((t) => (
                <button key={t.name} onClick={() => applyTemplate(t)} className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50">
                  <LayoutTemplate className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0"><span className="block text-[13px] text-slate-800">{t.name}</span><span className="block truncate text-[11px] text-muted-foreground">{t.hint}</span></span>
                </button>
              ))}
            </div>
          </Section>
          <Section title="Rows (break down by)">
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <Select key={i} aria-label={i === 0 ? 'Rows' : 'Then by'} value={st.dims[i] || ''} onChange={(e) => setDim(i, e.target.value)} disabled={i === 1 && !st.dims[0]}>
                  <option value="">{i === 0 ? 'No breakdown (totals only)' : 'Then by… (optional)'}</option>
                  {dimOptions.map((d) => <option key={d.key} value={d.key} disabled={!dimOk(d.key) || (st.dims.includes(d.key) && st.dims[i] !== d.key)}>{d.label}{!dimOk(d.key) ? ' — not with these metrics' : ''}</option>)}
                </Select>
              ))}
            </div>
          </Section>
          <Section title={`Values (${st.metrics.length}/8)`}>
            {groups.map((g) => (
              <div key={g.title} className="mb-2 last:mb-0">
                <p className="mb-1 text-[11px] text-muted-foreground">{g.title === 'Visits' ? 'Counted per visit' : 'Counted per action (events, page views)'}</p>
                <div className="flex flex-wrap gap-1">
                  {g.items.map((m) => {
                    const on = st.metrics.includes(m.key);
                    const ok = metOk(m.key) || on;
                    return (
                      <button key={m.key} onClick={() => toggleMetric(m.key)} title={ok ? m.label : `Switches to ${g.title.toLowerCase()} metrics`}
                        className={cn('rounded-full px-2 py-0.5 text-[12px] ring-1 transition-colors', on ? 'bg-[hsl(var(--primary))] text-white ring-[hsl(var(--primary))]' : ok ? 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50' : 'bg-slate-50 text-slate-400 ring-slate-100 hover:text-slate-600')}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="mt-2 flex gap-1 text-[11px] text-muted-foreground"><Info className="mt-px h-3 w-3 shrink-0" />Visit and action values can't be mixed; picking one from the other group switches over.</p>
          </Section>
          <Section title="Visualisation">
            <div className="grid grid-cols-4 gap-1">
              {VIZ.map((v) => (
                <button key={v.key} onClick={() => set({ viz: v.key })} title={v.label} aria-label={v.label} aria-pressed={st.viz === v.key}
                  className={cn('flex h-10 items-center justify-center rounded ring-1', st.viz === v.key ? 'bg-[hsl(213_70%_95%)] text-[hsl(var(--primary))] ring-[hsl(var(--primary))]' : 'text-slate-500 ring-slate-200 hover:bg-slate-50')}>
                  <v.icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </Section>
          <Section title="Saved in this browser">
            <div className="flex gap-1">
              <Input placeholder="Name this exploration" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={60} />
              <Button size="sm" variant="outline" onClick={saveCurrent} aria-label="Save exploration"><Save /></Button>
            </div>
            {saved.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {saved.map((s) => (
                  <li key={s.name} className="flex items-center gap-1">
                    <button onClick={() => set({ dims: s.dims, metrics: s.metrics, viz: s.viz, sort: null })} className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[13px] hover:bg-slate-50">{s.name}</button>
                    <button onClick={() => removeSaved(s.name)} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Delete ${s.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Card>

        {/* ── Canvas ── */}
        <div className="min-w-0 space-y-4">
          {res.error ? <Card><ErrorState error={res.error} onRetry={res.refetch} /></Card> : !st.metrics.length ? (
            <Card><EmptyState title="Pick at least one value" description="Choose what to count on the left (for example Users or Views), or start from a template." /></Card>
          ) : (
            <>
              {st.viz !== 'table' && (
                <Card className="overflow-hidden">
                  {res.isLoading && !data ? <Skeleton className="m-4 h-[260px]" /> : data && <Chart data={data} viz={st.viz} dims={st.dims} metrics={st.metrics} />}
                </Card>
              )}
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-[12px] text-muted-foreground">
                  <span>{data ? `${num(data.rowCount)} rows${data.truncated ? ' (showing the first 500)' : ''} · click a column to sort${st.dims.some((d) => DRILL[d]) ? ' · click a value to filter everything by it' : ''}` : 'Loading…'}</span>
                  {res.isFetching && data && <span>Updating…</span>}
                </div>
                {res.isLoading && !data ? <div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div> : data && (
                  <div className="max-h-[640px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-white">
                        <TableRow>
                          {data.dimensions.map((d, i) => <TableHead key={d.key} className="cursor-pointer whitespace-nowrap" onClick={() => i === 0 && sortBy('dim0')}>{d.label}</TableHead>)}
                          {!data.dimensions.length && <TableHead />}
                          {data.metrics.map((m) => (
                            <TableHead key={m.key} className={cn('cursor-pointer whitespace-nowrap text-right', (st.sort || data.metrics[0].key) === m.key && 'text-slate-900')} onClick={() => sortBy(m.key)}>
                              {m.label}{(st.sort || (st.dims[0] !== 'date' && data.metrics[0].key)) === m.key ? (st.order === 'asc' ? ' ↑' : ' ↓') : ''}
                            </TableHead>
                          ))}
                        </TableRow>
                        <TableRow className="bg-slate-50 font-semibold hover:bg-slate-50">
                          <TableCell colSpan={Math.max(1, data.dimensions.length)} className="text-[12px]">Total</TableCell>
                          {data.metrics.map((m) => (
                            <TableCell key={m.key} className="text-right tabular-nums">
                              {formatMetric(m, data.total[m.key])}
                              {data.previousTotal && <span className="block text-[11px] font-normal"><Delta current={data.total[m.key]} previous={data.previousTotal[m.key]} invert={m.lowerIsBetter} /> <span className="text-muted-foreground">vs {formatMetric(m, data.previousTotal[m.key])}</span></span>}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.rows.map((r) => (
                          <TableRow key={r.dims.join('|') || 'total'}>
                            {r.dims.map((v, i) => {
                              const d = st.dims[i];
                              const drill = DRILL[d] && v !== '(unknown)';
                              return (
                                <TableCell key={d} className="max-w-[300px]">
                                  {drill ? <button onClick={() => setFilter(DRILL[d], v)} className="block max-w-full truncate text-left text-[hsl(var(--primary))] hover:underline" title={`Only show ${formatDim(d, v)}`}>{formatDim(d, v)}</button>
                                    : <span className="block truncate" title={String(v)}>{formatDim(d, v)}</span>}
                                </TableCell>
                              );
                            })}
                            {!r.dims.length && <TableCell>All</TableCell>}
                            {data.metrics.map((m) => (
                              <TableCell key={m.key} className="whitespace-nowrap text-right tabular-nums">
                                {formatMetric(m, r.metrics[m.key])}
                                {'previous' in r && <span className="ml-1.5">{r.previous ? <Delta current={r.metrics[m.key]} previous={r.previous[m.key]} invert={m.lowerIsBetter} /> : <span className="text-[11px] text-muted-foreground">new</span>}</span>}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                        {!data.rows.length && <TableRow><TableCell colSpan={data.dimensions.length + data.metrics.length + 1} className="py-10 text-center text-muted-foreground">No data for this period and these filters.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
              {compare && st.dims.includes('date') && <p className="text-[12px] text-muted-foreground">With a Date breakdown, the comparison is shown on the Total row only, since the days don't line up.</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
