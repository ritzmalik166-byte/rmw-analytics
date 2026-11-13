'use client';
/**
 * Page detail tabs: Visits · Visitors · Clicks · Recordings for one page, each a paginated list with exact
 * date and time. All follow the global website, date range and report filters.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Footprints, Users, MousePointerClick, PlayCircle, Smartphone, Monitor, Tablet, Video } from 'lucide-react';
import { api } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { cn, duration, flag, formatDateTime, timeAgo, shortVisitor, countryName, titleCase, num, toQuery } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const PAGE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'visits', label: 'Visits', icon: Footprints },
  { key: 'visitors', label: 'Visitors', icon: Users },
  { key: 'clicks', label: 'Clicks', icon: MousePointerClick },
  { key: 'recordings', label: 'Recordings', icon: PlayCircle },
];

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };
const PAGE_SIZE = 25;

export function PageTabBar({ tab, onTab }) {
  return (
    <div className="mb-4 flex overflow-x-auto border-b [scrollbar-width:none]" role="tablist">
      {PAGE_TABS.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => onTab(t.key)}
          className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-[13px] font-medium',
            tab === t.key ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-slate-600 hover:text-slate-900')}>
          {t.icon && <t.icon className="h-4 w-4" />}{t.label}
        </button>
      ))}
    </div>
  );
}

/** "12 Nov 2026, 4:05 pm" with "3 hours ago" underneath. */
function When({ at }) {
  return <><span className="block whitespace-nowrap font-medium text-slate-800">{formatDateTime(at)}</span><span className="text-[11px] text-muted-foreground">{timeAgo(at)}</span></>;
}
function Who({ row }) {
  return <Link href={`/visitors/${row.websiteId}/${row.visitorId}`} className="font-mono text-[12px] font-semibold text-[hsl(var(--primary))] hover:underline">{shortVisitor(row.visitorId)}</Link>;
}
function Where({ device, city, country }) {
  const Dev = DEVICE_ICON[device] || Monitor;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]">
      <Dev className="h-3.5 w-3.5 text-muted-foreground" />{titleCase(device) || '—'}
      {(city || country) && <span className="ml-1">{flag(country)} {city || countryName(country)}</span>}
    </span>
  );
}
function Watch({ row }) {
  if (!row.hasRecording) return <span className="text-[11px] text-muted-foreground">—</span>;
  return <Link href={`/recordings/${row.websiteId}/${row.sessionId}`} className="inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1765cc]"><PlayCircle className="h-3.5 w-3.5" />Watch</Link>;
}
function Frame({ loading, error, refetch, empty, cols, children, meta, onPage, toolbar, icon }) {
  return (
    <Card className="overflow-hidden">
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-2">{toolbar}</div>}
      {error ? <ErrorState error={error} onRetry={refetch} /> : loading ? <TableSkeleton rows={8} cols={cols} /> : empty ? <EmptyState icon={icon} title={empty} description="Try a longer date range from the picker above." /> : children}
      <Pagination meta={meta} onPage={onPage} />
    </Card>
  );
}

export function PageVisits({ path }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useStats('/stats/page/visits', { path, page, limit: PAGE_SIZE });
  return (
    <Frame loading={isLoading && !data} error={error} refetch={refetch} cols={7} icon={Footprints} empty={!data?.rows?.length && 'Nobody viewed this page in this period'} meta={data?.meta} onPage={setPage}>
      <Table>
        <TableHeader><TableRow><TableHead>Viewed at</TableHead><TableHead>Visitor</TableHead><TableHead>Came from</TableHead><TableHead>Device / location</TableHead><TableHead className="text-right">Time on page</TableHead><TableHead className="text-right">Scrolled</TableHead><TableHead>Outcome</TableHead><TableHead>Recording</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.rows?.map((r) => (
            <TableRow key={`${r.sessionId}-${r.at}`}>
              <TableCell><Link href={`/sessions/${r.websiteId}/${r.sessionId}`} className="hover:underline"><When at={r.at} /></Link></TableCell>
              <TableCell><Who row={r} />{r.session?.isNew && <span className="ml-1 text-[10px] text-emerald-700">new</span>}</TableCell>
              <TableCell className="text-[12px]">{r.session?.source || 'Direct'}<span className="block text-[11px] text-muted-foreground">{r.session?.channelLabel}{r.session?.campaign ? ` · ${r.session.campaign}` : ''}</span></TableCell>
              <TableCell><Where device={r.session?.device} city={r.session?.city} country={r.session?.country} /></TableCell>
              <TableCell className="text-right tabular-nums">{duration(r.engagedMs)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.scroll ? `${r.scroll}%` : '—'}</TableCell>
              <TableCell>{r.session?.converted ? <Badge variant="success">Converted</Badge> : r.session?.pageviews === 1 ? <Badge>Left after this page</Badge> : <span className="text-[12px] text-muted-foreground">{num(r.session?.pageviews)} pages</span>}</TableCell>
              <TableCell><Watch row={r} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}

export function PageVisitors({ path }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useStats('/stats/page/visitors', { path, page, limit: PAGE_SIZE });
  return (
    <Frame loading={isLoading && !data} error={error} refetch={refetch} cols={7} icon={Users} empty={!data?.rows?.length && 'No visitors on this page in this period'} meta={data?.meta} onPage={setPage}>
      <Table>
        <TableHeader><TableRow><TableHead>Visitor</TableHead><TableHead>First seen on page</TableHead><TableHead>Last seen on page</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Visits</TableHead><TableHead className="text-right">Time on page</TableHead><TableHead>Device / location</TableHead><TableHead>Latest recording</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.rows?.map((r) => (
            <TableRow key={`${r.websiteId}-${r.visitorId}`}>
              <TableCell><Who row={r} />{r.isLead && <Badge variant="success" className="ml-1.5">Lead</Badge>}{r.identified && <Badge className="ml-1.5">Identified</Badge>}</TableCell>
              <TableCell><When at={r.firstAt} /></TableCell>
              <TableCell><When at={r.lastAt} /></TableCell>
              <TableCell className="text-right tabular-nums">{num(r.views)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(r.visits)}</TableCell>
              <TableCell className="text-right tabular-nums">{duration(r.engagedMs)}</TableCell>
              <TableCell><Where device={r.session?.device} city={r.session?.city} country={r.session?.country} /></TableCell>
              <TableCell><Watch row={{ ...r, sessionId: r.lastSessionId }} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}

export function PageClicks({ path }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('all');
  const { data, isLoading, error, refetch } = useStats('/stats/page/clicks', { path, kind, page, limit: PAGE_SIZE });
  const toolbar = (
    <Select className="w-56" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Type of action">
      <option value="all">All clicks & actions</option>
      <option value="contact">Call / WhatsApp / email taps</option>
      <option value="forms">Form activity & leads</option>
      <option value="frustration">Frustrated clicks (rage / dead)</option>
    </Select>
  );
  return (
    <Frame loading={isLoading && !data} error={error} refetch={refetch} cols={5} icon={MousePointerClick} toolbar={toolbar} empty={!data?.rows?.length && 'No clicks recorded on this page in this period'} meta={data?.meta} onPage={setPage}>
      <Table>
        <TableHeader><TableRow><TableHead>When</TableHead><TableHead>What they did</TableHead><TableHead>Visitor</TableHead><TableHead>Device / location</TableHead><TableHead>Recording</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.rows?.map((r, i) => (
            <TableRow key={`${r.sessionId}-${r.at}-${i}`}>
              <TableCell><When at={r.at} /></TableCell>
              <TableCell className="max-w-[360px]"><span className="block truncate font-medium" title={r.label}>{r.label}</span>{r.selector && <span className="block truncate font-mono text-[11px] text-muted-foreground" title={r.selector}>{r.selector}</span>}</TableCell>
              <TableCell><Who row={r} /></TableCell>
              <TableCell><Where device={r.device} city={r.city} country={r.country} /></TableCell>
              <TableCell><Watch row={r} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}

export function PageRecordings({ path }) {
  const { query } = useFilters();
  const [page, setPage] = useState(1);
  const [minSeconds, setMinSeconds] = useState(0);
  const q = { ...query, status: 'all', path, path_exact: 'true', min_seconds: minSeconds || undefined, page, limit: PAGE_SIZE };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['replays', q], queryFn: () => api(`/replays${toQuery(q)}`), placeholderData: keepPreviousData, refetchInterval: 15_000 });
  const toolbar = (
    <>
      <Select className="w-44" value={minSeconds} onChange={(e) => { setMinSeconds(Number(e.target.value)); setPage(1); }} aria-label="Minimum length">
        <option value={0}>Any length</option><option value={10}>Longer than 10 s</option><option value={30}>Longer than 30 s</option><option value={60}>Longer than 1 min</option>
      </Select>
      {data?.meta && <span className="ml-auto text-[12px] text-muted-foreground">{num(data.meta.total)} recording{data.meta.total === 1 ? '' : 's'} that included this page · refreshes every 15 s</span>}
    </>
  );
  return (
    <Frame loading={isLoading && !data} error={error} refetch={refetch} cols={6} icon={Video} toolbar={toolbar} empty={!data?.rows?.length && 'No recordings of this page in this period'} meta={data?.meta} onPage={setPage}>
      <Table>
        <TableHeader><TableRow><TableHead /><TableHead>Visitor</TableHead><TableHead>Started</TableHead><TableHead>Ended</TableHead><TableHead className="text-right">Length</TableHead><TableHead>Pages seen</TableHead><TableHead>Device / location</TableHead><TableHead>Came from</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.rows?.map((r) => {
            const href = `/recordings/${r.websiteId}/${r.sessionId}`;
            return (
              <TableRow key={`${r.websiteId}:${r.sessionId}`}>
                <TableCell className="w-10"><Link href={href} aria-label="Play recording" className={cn('flex h-9 w-9 items-center justify-center rounded-full text-white shadow', r.live ? 'bg-[#d93025]' : 'bg-[#1a73e8] hover:bg-[#1765cc]')}><PlayCircle className="h-5 w-5" /></Link></TableCell>
                <TableCell><Link href={href} className="font-semibold hover:underline">{r.visitorLabel}</Link>{r.live && <span className="ml-1.5 rounded bg-[#d93025] px-1.5 text-[10px] font-bold uppercase text-white">Live</span>}{r.converted && <span className="ml-1.5 rounded bg-[#188038] px-1.5 text-[10px] font-bold uppercase text-white">Converted</span>}</TableCell>
                <TableCell><When at={r.firstAt} /></TableCell>
                <TableCell className="whitespace-nowrap text-[12px]">{formatDateTime(r.lastAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{duration(r.durationMs)}</TableCell>
                <TableCell className="max-w-[240px]"><span className="block truncate text-[12px] text-slate-600" title={r.pages.join(' → ')}>{r.pages.join(' → ') || r.entryPath}</span></TableCell>
                <TableCell><Where device={r.device?.type} city={r.geo?.city} country={r.geo?.country} /></TableCell>
                <TableCell className="text-[12px]">{r.source && r.source !== '(direct)' ? r.source : r.channelLabel || 'Direct'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Frame>
  );
}
