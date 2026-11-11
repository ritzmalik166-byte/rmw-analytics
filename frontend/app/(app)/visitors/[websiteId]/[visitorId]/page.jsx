'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Download, Trash2, PlayCircle, Video } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { api, download, apiMessage } from '@/lib/api';
import { cn, num, countryName, flag, formatDateTime, duration, titleCase, timeAgo } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, ErrorState, PageSkeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from '@/components/analytics/Panel';
import { Journey } from '@/components/analytics/Journey';
import { WebsiteTag } from '@/components/analytics/WebsiteDot';

function Fact({ label, children }) {
  return (
    <div className="py-1.5">
      <dt className="kv-label">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-slate-800">{children ?? '—'}</dd>
    </div>
  );
}

function RecordingRow({ r, websiteId }) {
  const href = `/recordings/${websiteId}/${r.sessionId}`;
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Link href={href} aria-label="Play recording" className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow', r.live ? 'bg-[#d93025]' : 'bg-[#1a73e8] hover:bg-[#1765cc]')}><PlayCircle className="h-4 w-4" /></Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="block text-[13px] font-medium text-slate-800 hover:underline">{formatDateTime(r.firstAt)}</Link>
        <span className="block truncate text-[11px] text-muted-foreground" title={r.pages.join(', ')}>{r.pages.length || 1} page{r.pages.length === 1 ? '' : 's'} · {r.entryPath || '—'}</span>
      </div>
      {r.converted && <Badge variant="success">Converted</Badge>}
      <span className="shrink-0 text-right text-[12px] tabular-nums text-slate-700">{duration(r.durationMs)}<span className="block text-[11px] text-muted-foreground">{timeAgo(r.lastAt)}</span></span>
    </li>
  );
}

function VisitorRecordings({ websiteId, visitorId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['replays', 'visitor', websiteId, visitorId],
    queryFn: () => api(`/replays?site=${websiteId}&visitor=${encodeURIComponent(visitorId)}&status=all&limit=100`),
    refetchInterval: 30_000,
  });
  const rows = data?.rows || [];
  const live = rows.filter((r) => r.live);
  const done = rows.filter((r) => !r.live);
  return (
    <Panel title={`Recordings (${done.length})`}>
      {isLoading ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Loading recordings…</p> : !rows.length ? (
        <div className="flex items-center gap-2 px-3 py-6 text-[13px] text-muted-foreground"><Video className="h-4 w-4" />No recordings for this visitor yet.</div>
      ) : (
        <>
          {live.length > 0 && (
            <div className="border-b bg-[#d93025]/5">
              <p className="flex items-center gap-1.5 px-3 pt-2 text-[11px] font-bold uppercase tracking-wide text-[#d93025]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d93025]" />On the site now</p>
              <ul className="divide-y">{live.map((r) => <RecordingRow key={r.sessionId} r={r} websiteId={websiteId} />)}</ul>
            </div>
          )}
          {done.length ? <ul className="max-h-[360px] divide-y overflow-y-auto">{done.map((r) => <RecordingRow key={r.sessionId} r={r} websiteId={websiteId} />)}</ul>
            : <p className="px-3 py-4 text-[12px] text-muted-foreground">The recording will be ready here about a minute after the current visit ends.</p>}
        </>
      )}
    </Panel>
  );
}

export default function VisitorProfilePage({ params }) {
  const { websiteId, visitorId } = use(params);
  const router = useRouter();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['visitor', websiteId, visitorId], queryFn: () => api(`/visitors/${websiteId}/${visitorId}`) });
  const recs = useQuery({ queryKey: ['replays', 'visitor', websiteId, visitorId], queryFn: () => api(`/replays?site=${websiteId}&visitor=${encodeURIComponent(visitorId)}&status=all&limit=100`), refetchInterval: 30_000 });
  const recBySession = new Map((recs.data?.rows || []).map((r) => [r.sessionId, r]));
  if (isLoading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const v = data.visitor;
  const conversions = v.counts.conversions;

  const erase = async () => {
    setBusy(true);
    try {
      await api(`/visitors/${websiteId}/${visitorId}`, { method: 'DELETE' });
      toast.success('Visitor data deleted');
      router.replace('/visitors');
    } catch (e) { toast.error(apiMessage(e)); setBusy(false); }
  };

  return (
    <>
      <Link href="/visitors" className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Visitors</Link>
      <PageHeader
        title={<span className="flex items-center gap-2">{v.label}<WebsiteTag website={v.website} />{v.counts.leads > 0 && <Badge variant="success">Lead</Badge>}{data.identity && <Badge variant="info">Identified</Badge>}</span>}
        description={`Pseudonymous ID ${v.visitorId}${v.cookieless ? ' · cookieless mode' : ''}`}
        actions={<>
          {can('visitors:export') && <Button variant="outline" size="sm" onClick={() => download(`/visitors/${websiteId}/${visitorId}/export`, `visitor-${visitorId}.json`).catch((e) => toast.error(apiMessage(e)))}><Download />Export data</Button>}
          {can('visitors:delete') && <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirm(true)}><Trash2 />Delete visitor</Button>}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Panel title="Profile">
            <dl className="grid grid-cols-2 gap-x-4 px-3 py-2">
              <Fact label="First seen">{formatDateTime(v.firstSeen)}</Fact>
              <Fact label="Last seen">{formatDateTime(v.lastSeen)}</Fact>
              <Fact label="Device">{v.device ? `${v.device.os} ${titleCase(v.device.type)}` : null}</Fact>
              <Fact label="Browser">{v.device?.browser}</Fact>
              <Fact label="Approx. location">{v.geo?.country ? `${flag(v.geo.country)} ${v.geo.city ? `${v.geo.city}, ` : ''}${countryName(v.geo.country)}` : null}</Fact>
              <Fact label="Screen">{v.device?.screen}</Fact>
              <Fact label="First source">{v.first ? `${v.first.source} (${CHANNELS[v.first.channel] || v.first.channel})` : null}</Fact>
              <Fact label="Landing page">{v.first?.landingPath}</Fact>
              {v.first?.utm?.campaign && <Fact label="Campaign">{v.first.utm.campaign}</Fact>}
            </dl>
            <div className="grid grid-cols-3 border-t text-center">
              {[['Sessions', v.counts.sessions], ['Pages', v.counts.pageviews], ['Events', v.counts.events], ['Searches', v.counts.searches], ['Conversions', conversions], ['Leads', v.counts.leads]].map(([l, n]) => (
                <div key={l} className="border-b border-r px-2 py-2 [&:nth-child(3n)]:border-r-0"><p className="text-lg font-semibold tabular-nums">{num(n)}</p><p className="kv-label">{l}</p></div>
              ))}
            </div>
          </Panel>
          {data.identity && (
            <Panel title="Identity (explicitly identified)">
              <dl className="px-3 py-2">
                <Fact label="Customer ID">{data.identity.customerId}</Fact>
                {Object.entries(data.identity.traits || {}).map(([k, val]) => <Fact key={k} label={k}>{String(val)}</Fact>)}
                {data.identity.linkedVisitors.length > 1 && <Fact label="Linked across your websites">{data.identity.linkedVisitors.map((l) => `${l.website} ${l.visitorId.slice(0, 8)}`).join(', ')}</Fact>}
              </dl>
            </Panel>
          )}
          {data.leads.length > 0 && (
            <Panel title="Leads">
              <ul className="divide-y">
                {data.leads.map((l) => (
                  <li key={l.id} className="px-3 py-2 text-[13px]">
                    <p className="text-[11px] text-muted-foreground">{formatDateTime(l.ts)} · {l.path}</p>
                    {Object.entries(l.fields).map(([k, val]) => <p key={k}><span className="text-muted-foreground">{titleCase(k)}:</span> {val}</p>)}
                    {l.masked && <p className="mt-1 text-[11px] text-amber-700">Contact details are masked for your role.</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {data.searches.length > 0 && (
            <Panel title="Searches">
              <ul className="divide-y text-[13px]">{data.searches.map((s, i) => <li key={i} className="flex justify-between gap-2 px-3 py-1.5"><span className="truncate">“{s.query}”</span><span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(s.ts)}</span></li>)}</ul>
            </Panel>
          )}
        </div>
        <div className="space-y-4 lg:col-span-2">
          <VisitorRecordings websiteId={websiteId} visitorId={visitorId} />
          <Panel title="Journey" bodyClassName="max-h-[640px] overflow-y-auto"><Journey events={data.journey} /></Panel>
          <Panel title={`Sessions (${data.sessions.length})`}>
            <Table>
              <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Source</TableHead><TableHead>Entry → exit</TableHead><TableHead className="text-right">Pages</TableHead><TableHead className="text-right">Duration</TableHead><TableHead /><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.sessions.map((s) => (
                  <TableRow key={s.sessionId}>
                    <TableCell className="whitespace-nowrap"><Link className="hover:underline" href={`/sessions/${websiteId}/${s.sessionId}`}>{formatDateTime(s.startedAt)}</Link></TableCell>
                    <TableCell className="text-[12px]">{s.source}{s.utm?.campaign ? ` · ${s.utm.campaign}` : ''}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-[12px]">{s.entryPath}{s.exitPath && s.exitPath !== s.entryPath ? ` → ${s.exitPath}` : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.pageviews}</TableCell>
                    <TableCell className="text-right tabular-nums">{duration(s.durationMs)}</TableCell>
                    <TableCell>{s.converted ? <Badge variant="success">Converted</Badge> : s.bounced ? <Badge>Bounced</Badge> : null}</TableCell>
                    <TableCell className="w-10">{recBySession.has(s.sessionId) && (
                      <Link href={`/recordings/${websiteId}/${s.sessionId}`} title={recBySession.get(s.sessionId).live ? 'Live now' : 'Watch recording'} aria-label="Watch recording"
                        className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white', recBySession.get(s.sessionId).live ? 'bg-[#d93025]' : 'bg-[#1a73e8] hover:bg-[#1765cc]')}><PlayCircle className="h-4 w-4" /></Link>
                    )}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </div>
      </div>
      <Dialog open={confirm} onOpenChange={(o) => !busy && setConfirm(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete all data for this visitor?</DialogTitle><DialogDescription>Events, sessions, searches, leads and conversions for {v.label} on {v.website?.name} are permanently erased. This is logged in the audit trail and cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="destructive" loading={busy} onClick={erase}>Delete permanently</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
