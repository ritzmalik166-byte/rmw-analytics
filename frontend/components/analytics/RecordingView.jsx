'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Trash2, Smartphone, Monitor, Tablet, Clock, MapPin, ExternalLink, MousePointerClick } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { cn, duration, flag, countryName, formatDateTime, formatHm } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { ReplayPlayer } from '@/components/analytics/ReplayPlayer';
import { ICON, describe, meaningfulSteps } from '@/components/analytics/Journey';
import { STOP, stopKind, RoadmapLegend } from '@/components/analytics/JourneyRoadmap';

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };
const POLL_MS = 3000;

/**
 * Recording player + "what they did" timeline. Used by the full recording page and the Watch modal.
 */
export function RecordingView({ websiteId, sessionId, inModal = false, onDeleted, onNavigate }) {
  const { can } = useAuth();
  const player = useRef(null);
  const [events, setEvents] = useState(null);
  const [rec, setRec] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(0);
  const [filesMissing, setFilesMissing] = useState(false);
  const lastSeq = useRef(-1);

  const load = useCallback(async () => {
    try {
      const d = await api(`/replays/${websiteId}/${sessionId}${lastSeq.current >= 0 ? `?after=${lastSeq.current}` : ''}`);
      setRec(d.replay);
      if (d.filesMissing) setFilesMissing(true);
      if (d.chunks.length) {
        lastSeq.current = d.lastSeq;
        const fresh = d.chunks.flatMap((c) => c.events);
        setEvents((prev) => [...(prev || []), ...fresh].sort((a, b) => a.timestamp - b.timestamp));
      } else if (lastSeq.current < 0) setEvents([]);
      return d.replay;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [websiteId, sessionId]);

  // First load, then keep polling while the visit is live.
  useEffect(() => {
    let timer;
    let stopped = false;
    const loop = async () => {
      const r = await load();
      if (!stopped && r?.live) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => { stopped = true; clearTimeout(timer); };
  }, [load]);

  const steps = useQuery({ queryKey: ['session', websiteId, sessionId], queryFn: () => api(`/sessions/${websiteId}/${sessionId}`), refetchInterval: rec?.live ? 10_000 : false });
  const t0 = events?.[0]?.timestamp || 0;
  const list = useMemo(() => meaningfulSteps(steps.data?.events || []).map((e) => ({ ...e, at: new Date(e.ts).getTime() - t0 })), [steps.data, t0]);

  const del = async () => {
    if (!confirm('Delete this recording permanently?')) return;
    try { await api(`/replays/${websiteId}/${sessionId}`, { method: 'DELETE' }); toast.success('Recording deleted'); onDeleted?.(); } catch (e) { toast.error(apiMessage(e)); }
  };

  if (error) return <Card><ErrorState error={error} onRetry={() => { setError(null); load(); }} /></Card>;
  const Dev = DEVICE_ICON[rec?.device?.type] || Monitor;
  const noSnapshot = events && !events.some((e) => e.type === 2);

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!inModal && <Link href="/recordings" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Recordings</Link>}
        {rec ? (
          <>
            <h1 className={cn('font-semibold text-slate-900', inModal ? 'text-[16px] pr-8' : 'text-[18px]')}>Visitor {rec.visitorLabel}</h1>
            <span className="rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">{rec.website?.code}</span>
            {rec.live && <span className="inline-flex items-center gap-1 rounded bg-[#d93025] px-2 py-0.5 text-[11px] font-bold uppercase text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live now</span>}
            <span className="inline-flex items-center gap-1 text-[12px] text-slate-600"><Clock className="h-3.5 w-3.5" />{formatDateTime(rec.firstAt)} · {duration(rec.durationMs)}</span>
            <span className="inline-flex items-center gap-1 text-[12px] text-slate-600"><Dev className="h-3.5 w-3.5" />{rec.device ? `${rec.device.type} · ${rec.device.browser || ''}` : 'Device unknown'}{rec.viewport ? ` · ${rec.viewport.w}×${rec.viewport.h}` : ''}</span>
            {rec.geo?.country && <span className="inline-flex items-center gap-1 text-[12px] text-slate-600"><MapPin className="h-3.5 w-3.5" />{flag(rec.geo.country)} {[rec.geo.locality, rec.geo.city, countryName(rec.geo.country)].filter(Boolean).join(', ')}</span>}
            <span className="text-[12px] text-slate-600">from {rec.source && rec.source !== '(direct)' ? rec.source : rec.channelLabel || 'Direct'}</span>
            <div className={cn('flex items-center gap-2', inModal ? 'w-full sm:ml-auto sm:w-auto' : 'ml-auto')}>
              {rec.visitorId && <Button asChild size="sm" variant="outline"><Link href={`/visitors/${websiteId}/${rec.visitorId}`} onClick={onNavigate}><ExternalLink />Visitor profile</Link></Button>}
              {can('visitors:delete') && <Button size="sm" variant="outline" onClick={del}><Trash2 />Delete</Button>}
            </div>
          </>
        ) : <Skeleton className="h-6 w-80" />}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          {filesMissing ? (
            <Card className="px-4 py-16 text-center text-[13px] text-muted-foreground">The recording files for this visit are not on this server. Recordings are stored on the disk of the API server that received them — open it from the deployed dashboard, or point this dashboard at that API.</Card>
          ) : noSnapshot ? (
            <Card className="px-4 py-16 text-center text-[13px] text-muted-foreground">This recording has no page snapshot yet. If the visit is live, it will appear in a few seconds.</Card>
          ) : (
            <ReplayPlayer ref={player} events={events} live={Boolean(rec?.live)} onTime={setNow} />
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Typing in form fields is always masked. Images and fonts load from the live website, so pages changed since the visit may look slightly different.</p>
        </div>

        <Card className={cn('flex flex-col overflow-hidden', inModal ? 'max-h-[40vh] xl:max-h-[calc(92vh-150px)]' : 'max-h-[60vh] xl:max-h-[calc(100vh-200px)]')}>
          <div className="border-b bg-[hsl(214_25%_97%)] px-3 py-2.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">What they did</h3>
            <RoadmapLegend className="mt-1" />
          </div>
          <ol className="min-h-0 flex-1 overflow-y-auto py-1">
            {steps.isLoading ? Array.from({ length: 8 }).map((_, i) => <li key={i} className="px-3 py-2"><Skeleton className="h-9" /></li>)
              : !list.length ? <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">No steps recorded.</li>
                : list.map((e, i) => {
                  const st = STOP[stopKind(e.name)];
                  const Icon = ICON[e.name] || MousePointerClick;
                  const d = describe(e);
                  const passed = now >= e.at;
                  const isCurrent = passed && (i === list.length - 1 || now < list[i + 1].at);
                  return (
                    <li key={e.eventId || i}>
                      <button type="button" onClick={() => player.current?.seek(Math.max(0, e.at - 500))}
                        className={cn('flex w-full items-start gap-2.5 border-l-4 px-3 py-2 text-left transition-colors hover:bg-slate-50', isCurrent ? `${st.card} bg-[#1a73e8]/[0.06]` : 'border-l-transparent', !passed && 'opacity-55')}>
                        <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white', st.dot.split(' ')[0])}><Icon className="h-3 w-3" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-slate-800" title={d.title}>{d.title}</span>
                          {d.sub && d.sub !== d.title && <span className="block truncate text-[11px] text-muted-foreground">{d.sub}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatHm(e.ts)}</span>
                      </button>
                    </li>
                  );
                })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
