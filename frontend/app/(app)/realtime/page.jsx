'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { api } from '@/lib/api';
import { cn, countryName, flag, shortVisitor, toQuery, timeAgo, titleCase } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/analytics/Panel';
import { BarList } from '@/components/analytics/BarList';

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
const FEED_LIMIT = 80;
const ACTION_TONE = { lead: 'success', form_submit: 'success', conversion: 'success', search: 'info', js_error: 'danger', rage_click: 'warning', session_start: 'secondary' };

/**
 * Live data: SSE stream (snapshot → activity → presence). Falls back to polling every 10s when the
 * stream can't be established (e.g. a proxy that buffers responses).
 */
function useRealtime(site) {
  const [state, setState] = useState({ active: 0, visitors: [], feed: [], perMinute: [], byPage: [], byCountry: [], byDevice: [], bySource: [] });
  const [mode, setMode] = useState('connecting');
  const esRef = useRef(null);

  useEffect(() => {
    let poll = null;
    let cancelled = false;
    const q = toQuery({ site });
    const snapshot = async () => {
      try { const d = await api(`/realtime${q}`); if (!cancelled) setState(d); } catch { /* keep last */ }
    };
    const startPolling = () => {
      setMode('polling');
      snapshot();
      poll = setInterval(snapshot, 10_000);
    };
    if (typeof EventSource === 'undefined') { startPolling(); return () => clearInterval(poll); }
    const es = new EventSource(`/api/v1/realtime/stream${q}`, { withCredentials: true });
    esRef.current = es;
    let opened = false;
    const failTimer = setTimeout(() => { if (!opened) { es.close(); startPolling(); } }, 8000);
    es.addEventListener('snapshot', (e) => { opened = true; setMode('live'); setState(JSON.parse(e.data)); });
    es.addEventListener('activity', (e) => {
      const item = JSON.parse(e.data);
      setState((s) => ({ ...s, feed: [item, ...s.feed].slice(0, FEED_LIMIT) }));
    });
    es.addEventListener('presence', (e) => {
      const p = JSON.parse(e.data);
      setState((s) => ({ ...s, active: p.active, visitors: p.visitors }));
    });
    es.onerror = () => { if (!opened) { clearTimeout(failTimer); es.close(); startPolling(); } };
    // Aggregates (per-minute, by page…) are refreshed periodically even when streaming.
    const agg = setInterval(snapshot, 30_000);
    return () => { cancelled = true; clearTimeout(failTimer); clearInterval(agg); clearInterval(poll); es.close(); };
  }, [site]);

  return { ...state, mode };
}

function FeedRow({ f }) {
  return (
    <li className="flex items-start gap-3 px-3 py-1.5 text-[13px]">
      <span className="w-[60px] shrink-0 pt-px tabular-nums text-[11px] text-muted-foreground">{new Date(f.ts).toLocaleTimeString('en-IN', { hour12: false })}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant={ACTION_TONE[f.name] || 'secondary'}>{f.label}</Badge>
          {f.detail && <span className="truncate text-slate-700">{f.name === 'search' ? `“${f.detail}”` : f.detail}</span>}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {f.site?.code ? `${f.site.code} · ` : ''}{f.path}{f.geo?.city ? ` · ${f.geo.city}` : f.geo?.country ? ` · ${countryName(f.geo.country)}` : ''} · {shortVisitor(f.visitorId)}
        </p>
      </div>
    </li>
  );
}

export default function RealtimePage() {
  const { site, websites, current } = useFilters();
  const rt = useRealtime(site);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  const byId = useMemo(() => Object.fromEntries(websites.map((w) => [w.id, w])), [websites]);
  const pv30 = (rt.perMinute || []).reduce((s, m) => s + m.pageviews, 0);

  return (
    <>
      <PageHeader
        title="Real-time"
        description={`${current ? current.name : 'All websites'} · visitors active in the last 5 minutes`}
        actions={<span className={cn('inline-flex items-center gap-1.5 rounded border bg-white px-2 py-1 text-[12px]', rt.mode === 'live' ? 'text-emerald-700' : 'text-slate-600')}><span className={cn('h-2 w-2 rounded-full', rt.mode === 'live' ? 'animate-pulse bg-emerald-500' : 'bg-amber-400')} />{rt.mode === 'live' ? 'Streaming live' : rt.mode === 'polling' ? 'Refreshing every 10s' : 'Connecting…'}</span>}
      />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="flex flex-col justify-center border-l-[3px] border-l-[hsl(var(--primary))] px-4 py-4 lg:col-span-1">
          <p className="flex items-center gap-2 text-4xl font-semibold tabular-nums text-slate-900"><span className={cn('h-3 w-3 rounded-full', rt.active ? 'animate-pulse bg-red-500' : 'bg-slate-300')} />{rt.active}</p>
          <p className="mt-1 text-[14px] font-medium text-slate-700">{rt.active === 1 ? 'person is' : 'people are'} on your website right now</p>
          <p className="mt-1 text-xs text-muted-foreground">{pv30.toLocaleString('en-IN')} page views in the last 30 minutes</p>
        </Card>
        <Card className="overflow-hidden lg:col-span-3">
          <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Page views per minute · last 30 minutes</h3></div>
          <div className="h-[132px] px-2 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rt.perMinute} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="t" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={30} tickFormatter={(t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })} />
                <YAxis width={30} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: 'rgba(25,65,115,0.06)' }} formatter={(v) => [v, 'Page views']} labelFormatter={(t) => new Date(t).toLocaleTimeString('en-IN', { hour12: false })} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="pageviews" fill="#194173" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Panel title={`Active visitors (${rt.active})`} className="xl:col-span-3" bodyClassName="max-h-[560px] overflow-y-auto">
          {!rt.visitors?.length ? <p className="px-3 py-14 text-center text-[13px] text-muted-foreground">No one is on {current ? current.name : 'your websites'} right now.</p> : (
            <ul className="divide-y">
              {rt.visitors.map((v) => {
                const Icon = DEVICE_ICON[v.device] || Monitor;
                const w = byId[v.websiteId];
                return (
                  <li key={`${v.websiteId}-${v.visitorId}`} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-label={v.device} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate"><Link href={`/visitors/${v.websiteId}/${v.visitorId}`} className="font-semibold hover:underline">Visitor {shortVisitor(v.visitorId)}</Link><span className="text-slate-700"> — {v.action}</span></p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {w ? `${w.code} · ` : ''}{v.geo?.city ? `${v.geo.city}, ` : ''}{countryName(v.geo?.country)} {flag(v.geo?.country)} · {titleCase(v.device)}{v.browser ? ` · ${v.browser}` : ''}{v.channel ? ` · ${CHANNELS[v.channel] || v.channel}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(v.lastSeen)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Live activity feed" className="xl:col-span-2" bodyClassName="max-h-[560px] overflow-y-auto">
          {!rt.feed?.length ? <p className="px-3 py-14 text-center text-[13px] text-muted-foreground">Events will stream in here as they happen.</p> : <ul className="divide-y">{rt.feed.map((f, i) => <FeedRow key={`${f.ts}-${f.visitorId}-${i}`} f={f} />)}</ul>}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Top pages now"><BarList rows={rt.byPage?.map((r) => ({ key: r.key, label: r.key, value: r.count }))} empty="—" /></Panel>
        <Panel title="Countries"><BarList rows={rt.byCountry?.map((r) => ({ key: r.key, label: countryName(r.key), icon: <span aria-hidden>{flag(r.key)}</span>, value: r.count }))} empty="—" /></Panel>
        <Panel title="Devices"><BarList rows={rt.byDevice?.map((r) => ({ key: r.key, label: titleCase(r.key), value: r.count }))} empty="—" /></Panel>
      </div>
    </>
  );
}
