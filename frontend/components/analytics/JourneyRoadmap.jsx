'use client';
import Link from 'next/link';
import { Flag, MapPin, MousePointerClick, Clock, Smartphone, Monitor, Tablet, PlayCircle } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { cn, formatHm, formatDate, duration, flag, countryName } from '@/lib/utils';
import { ICON, describe, meaningfulSteps } from './Journey';
import { WatchLink } from '@/components/analytics/RecordingModal';

/** Roadmap colours: blue = pages, yellow = actions, red = key moments. */
export const STOP = {
  page: { label: 'Page visited', dot: 'bg-[#1a73e8] ring-[#1a73e8]/25', card: 'border-l-[#1a73e8]', text: 'text-[#1a73e8]' },
  action: { label: 'Action', dot: 'bg-[#f9ab00] ring-[#f9ab00]/30', card: 'border-l-[#f9ab00]', text: 'text-[#b06000]' },
  key: { label: 'Key moment', dot: 'bg-[#d93025] ring-[#d93025]/25', card: 'border-l-[#d93025]', text: 'text-[#d93025]' },
};
const KEY_EVENTS = new Set(['search', 'form_submit', 'lead', 'conversion', 'identify', 'file_download']);
export const stopKind = (name) => (name === 'page_view' ? 'page' : KEY_EVENTS.has(name) ? 'key' : 'action');

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

export function RoadmapLegend({ className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600', className)}>
      {Object.values(STOP).map((s) => <span key={s.label} className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', s.dot)} />{s.label}</span>)}
    </div>
  );
}

/** Group the chronological journey into visits (sessions), oldest first. */
function groupVisits(journey, sessions) {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const visits = [];
  for (const e of meaningfulSteps(journey)) {
    let v = visits[visits.length - 1];
    if (!v || v.sessionId !== e.sessionId) {
      v = { sessionId: e.sessionId, session: byId.get(e.sessionId) || null, steps: [] };
      visits.push(v);
    }
    // Collapse consecutive identical page views (reloads).
    const prev = v.steps[v.steps.length - 1];
    if (prev && e.name === 'page_view' && prev.name === 'page_view' && prev.page?.path === e.page?.path) continue;
    v.steps.push(e);
  }
  return visits;
}

function sourceOf(s) {
  if (!s) return 'Unknown source';
  const ch = CHANNELS[s.channel] || s.channel || 'Direct';
  return s.source && s.source !== '(direct)' ? `${ch} · ${s.source}` : ch;
}

function Road({ children }) {
  return (
    <div className="relative">
      {/* The road: dark asphalt with a dashed yellow centre line, on the left on phones and centred on wide screens. */}
      <div aria-hidden className="absolute bottom-0 left-[13px] top-0 w-[14px] rounded-full bg-slate-700 md:left-1/2 md:-translate-x-1/2">
        <div className="absolute inset-y-2 left-1/2 w-[2px] -translate-x-1/2 bg-[repeating-linear-gradient(to_bottom,#f9ab00_0_8px,transparent_8px_16px)]" />
      </div>
      <ol className="relative space-y-3">{children}</ol>
    </div>
  );
}

function Milestone({ icon: Icon, tone, title, sub }) {
  return (
    <li className="relative grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 md:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)]">
      <div className="hidden md:block" />
      <span className={cn('z-10 mx-auto flex h-10 w-10 items-center justify-center rounded-full border-4 border-white text-white shadow', tone)}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 md:col-start-3">
        <p className="text-[13px] font-semibold text-slate-900">{title}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </li>
  );
}

function Stop({ e, side, index }) {
  const kind = stopKind(e.name);
  const st = STOP[kind];
  const Icon = ICON[e.name] || MousePointerClick;
  const d = describe(e);
  const card = (
    <div className={cn('min-w-0 rounded-md border border-l-4 bg-white px-3 py-2 shadow-sm', st.card)}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', st.text)} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800" title={d.title}>{d.title}</p>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatHm(e.ts)}</span>
      </div>
      {d.sub && d.sub !== d.title && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={d.sub}>{d.sub}</p>}
    </div>
  );
  return (
    <li className="relative grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 md:grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)]">
      <div className={cn('hidden min-w-0 md:block', side === 'left' ? '' : 'invisible')}>{side === 'left' && card}</div>
      <span className={cn('z-10 mx-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-4', st.dot)} title={st.label}>{index}</span>
      <div className={cn('min-w-0', side === 'left' ? 'md:invisible' : '')}>{card}</div>
    </li>
  );
}

/** A visitor's complete journey drawn as a road: one stretch per visit, start pin → stops → finish flag. */
export function JourneyRoadmap({ journey = [], sessions = [], websiteId }) {
  const visits = groupVisits(journey, sessions);
  if (!visits.length) return <p className="px-3 py-12 text-center text-[13px] text-muted-foreground">No activity recorded for this visitor.</p>;
  return (
    <div className="space-y-6">
      {visits.map((v, vi) => {
        const s = v.session;
        const DevIcon = DEVICE_ICON[s?.device?.type] || Monitor;
        const pages = v.steps.filter((e) => e.name === 'page_view').length;
        return (
          <section key={v.sessionId || vi} aria-label={`Visit ${vi + 1}`}>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-gradient-to-r from-[#1a73e8]/10 via-[#f9ab00]/10 to-[#d93025]/10 px-3 py-2">
              <span className="rounded bg-[#1a73e8] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Visit {vi + 1}</span>
              <span className="text-[12px] font-medium text-slate-800">{formatDate(v.steps[0]?.ts)}</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-slate-600"><DevIcon className="h-3.5 w-3.5" />{s?.device?.type ? `${s.device.type} · ${s.device.browser || ''}` : 'Device unknown'}</span>
              {s?.geo?.country && <span className="text-[12px] text-slate-600">{flag(s.geo.country)} {[s.geo.locality, s.geo.city, countryName(s.geo.country)].filter(Boolean).join(', ')}</span>}
              <span className="ml-auto inline-flex items-center gap-3 text-[12px] text-slate-600">
                <span>{pages} page{pages === 1 ? '' : 's'}</span>
                {s?.durationMs != null && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{duration(s.durationMs)}</span>}
                {s?.converted && <span className="rounded bg-[#d93025] px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Converted</span>}
                {s?.hasReplay && websiteId && <WatchLink websiteId={websiteId} sessionId={v.sessionId} className="inline-flex items-center gap-1 rounded bg-[#1a73e8] px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#1765cc]"><PlayCircle className="h-3.5 w-3.5" />Watch recording</WatchLink>}
              </span>
            </div>
            <Road>
              <Milestone icon={MapPin} tone="bg-[#1a73e8]" title={`Arrived from ${sourceOf(s)}`} sub={s?.utm?.campaign ? `Campaign: ${s.utm.campaign}${s.utm.term ? ` · Keyword: ${s.utm.term}` : ''}` : s?.entryPath ? `Landed on ${s.entryPath}` : null} />
              {v.steps.map((e, i) => <Stop key={e.eventId || i} e={e} index={i + 1} side={i % 2 === 0 ? 'left' : 'right'} />)}
              <Milestone icon={Flag} tone="bg-[#d93025]" title={vi === visits.length - 1 ? 'Last seen here' : 'Left the website'} sub={s?.exitPath ? `Exit page: ${s.exitPath}` : null} />
            </Road>
          </section>
        );
      })}
    </div>
  );
}
