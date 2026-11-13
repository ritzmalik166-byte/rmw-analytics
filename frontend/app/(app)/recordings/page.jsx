'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PlayCircle, Video, Smartphone, Monitor, Tablet, Settings2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, duration, flag, timeAgo, toQuery, formatDateTime } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, ErrorState, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WatchLink } from '@/components/analytics/RecordingModal';

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

export default function RecordingsPage() {
  const { query, current, rangeLabel, websites } = useFilters();
  const { can } = useAuth();
  const [status, setStatus] = useState('completed');
  const live = status === 'live';
  const [minSeconds, setMinSeconds] = useState(0);
  const [page, setPage] = useState(1);
  // Page filter lives in the URL (?path=…) so a landing page's recordings can be bookmarked or linked to.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlPath = params.get('path') || '';
  const [pathInput, setPathInput] = useState(urlPath);
  useEffect(() => { setPathInput(urlPath); }, [urlPath]);
  useEffect(() => {
    const t = setTimeout(() => {
      const v = pathInput.trim();
      if (v === urlPath) return;
      const next = new URLSearchParams(params.toString());
      if (v) next.set('path', v); else next.delete('path');
      router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [pathInput]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = { ...query, status, min_seconds: minSeconds || undefined, path: urlPath || undefined, page, limit: 25 };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['replays', q], queryFn: () => api(`/replays${toQuery(q)}`), placeholderData: keepPreviousData, refetchInterval: 15_000,
  });
  const enabledSites = websites.filter((w) => w.settings?.replay);

  return (
    <>
      <PageHeader title="Recordings" description={`Watch completed visits back like a video · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      {!enabledSites.length && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-[#f9ab00]/50 bg-[#f9ab00]/10 px-4 py-3 text-[13px]">
          <Video className="h-5 w-5 text-[#b06000]" />
          <span className="flex-1">Recordings are off for every website. Turn on <b>Session recordings</b> in a website’s settings to start recording visits.</span>
          {can('websites:write') && <Button asChild size="sm" variant="outline"><Link href="/websites"><Settings2 />Website settings</Link></Button>}
        </Card>
      )}
      <Card className="mb-4 flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="inline-flex rounded-full bg-slate-100 p-0.5" role="tablist">
          <button type="button" role="tab" aria-selected={!live} onClick={() => { setStatus('completed'); setPage(1); }}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold', !live ? 'bg-[#1a73e8] text-white shadow' : 'text-slate-700 hover:bg-white')}>
            <PlayCircle className="h-3.5 w-3.5" />Completed
          </button>
          <button type="button" role="tab" aria-selected={live} onClick={() => { setStatus('live'); setPage(1); }}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold', live ? 'bg-[#d93025] text-white shadow' : 'text-slate-700 hover:bg-white')}>
            <span className={cn('h-2 w-2 rounded-full', live ? 'animate-pulse bg-white' : 'bg-[#d93025]')} />Live now
          </button>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-8 pr-8" placeholder="Page contains… e.g. Eldeco-terra" value={pathInput} onChange={(e) => setPathInput(e.target.value)} aria-label="Filter recordings by page" />
          {pathInput && <button type="button" onClick={() => setPathInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Clear page filter"><X className="h-4 w-4" /></button>}
        </div>
        <Select className="w-44" value={minSeconds} onChange={(e) => { setMinSeconds(Number(e.target.value)); setPage(1); }} aria-label="Minimum length">
          <option value={0}>Any length</option><option value={10}>Longer than 10 s</option><option value={30}>Longer than 30 s</option><option value={60}>Longer than 1 min</option><option value={300}>Longer than 5 min</option>
        </Select>
        {data?.meta && <span className="ml-auto text-[12px] text-muted-foreground">{data.meta.total} recording{data.meta.total === 1 ? '' : 's'}{urlPath ? <> covering <b className="text-slate-700">“{urlPath}”</b></> : ''} · refreshes every 15 s</span>}
      </Card>
      <Card className="overflow-hidden">
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={8} cols={7} /> : !data?.rows?.length ? (
          <EmptyState icon={Video} title={urlPath ? `No recordings covering “${urlPath}” in this period` : live ? 'Nobody is on the site right now' : 'No completed recordings in this period'} description={live ? 'Live visits appear here within a few seconds of someone opening a page.' : 'A recording shows up here about a minute after the visitor finishes their visit. Visits still in progress are under “Live now”.'} />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead /><TableHead>Visitor</TableHead><TableHead>Started</TableHead><TableHead>Length</TableHead><TableHead>Pages</TableHead><TableHead>Device / location</TableHead><TableHead>Came from</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const Dev = DEVICE_ICON[r.device?.type] || Monitor;
                return (
                  <TableRow key={`${r.websiteId}:${r.sessionId}`}>
                    <TableCell className="w-10">
                      <WatchLink websiteId={r.websiteId} sessionId={r.sessionId} aria-label="Play recording" className={cn('flex h-9 w-9 items-center justify-center rounded-full text-white shadow', r.live ? 'bg-[#d93025]' : 'bg-[#1a73e8] hover:bg-[#1765cc]')}><PlayCircle className="h-5 w-5" /></WatchLink>
                    </TableCell>
                    <TableCell>
                      <WatchLink websiteId={r.websiteId} sessionId={r.sessionId} className="font-semibold text-slate-900 hover:underline">{r.visitorLabel}</WatchLink>
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">{r.website?.code}</span>
                      {r.live && <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-[#d93025] px-1.5 text-[10px] font-bold uppercase text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live</span>}
                      {r.converted && <span className="ml-1.5 rounded bg-[#188038] px-1.5 text-[10px] font-bold uppercase text-white">Converted</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[12px]"><span className="block">{timeAgo(r.firstAt)}</span><span className="text-[11px] text-muted-foreground">{formatDateTime(r.firstAt)}</span></TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{duration(r.durationMs)}</TableCell>
                    <TableCell className="max-w-[260px]"><span className="rounded bg-[#1a73e8]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#1a73e8]">{r.pages.length || 1}</span><span className="ml-1.5 truncate text-[12px] text-slate-600" title={r.entryPath || ''}>{r.entryPath}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-[12px]"><span className="inline-flex items-center gap-1.5"><Dev className="h-3.5 w-3.5 text-muted-foreground" />{r.device?.type || '—'}</span>{r.geo?.country && <span className="ml-2">{flag(r.geo.country)} {r.geo.city || r.geo.country}</span>}</TableCell>
                    <TableCell className="text-[12px]">{r.source && r.source !== '(direct)' ? r.source : r.channelLabel || 'Direct'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </Card>
    </>
  );
}
