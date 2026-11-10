'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Search, Users2 } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { useStats } from '@/lib/hooks';
import { cn, num, countryName, flag, timeAgo, formatDateTime, titleCase } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState, Pagination } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WebsiteTag } from '@/components/analytics/WebsiteDot';

const SEGMENTS = [['', 'All'], ['new', 'New'], ['returning', 'Returning'], ['leads', 'With leads'], ['identified', 'Identified']];

export default function VisitorsPage() {
  const { current, rangeLabel, websites } = useFilters();
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useStats('/visitors', { q: q.trim() || undefined, segment: segment || undefined, page, limit: 25 });
  const byId = Object.fromEntries(websites.map((w) => [w.id, w]));
  return (
    <>
      <PageHeader title="Visitors" description={`Pseudonymous visitor profiles seen in the period · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-2">
          <div className="relative w-full max-w-[220px]"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Visitor ID, e.g. A82F91" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <div className="flex gap-1">{SEGMENTS.map(([k, l]) => <button key={k} onClick={() => { setSegment(k); setPage(1); }} className={cn('rounded px-2.5 py-1 text-[12px] font-medium', segment === k ? 'bg-white text-primary ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/60')}>{l}</button>)}</div>
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={12} cols={8} /> : !data?.rows?.length ? <EmptyState icon={Users2} title="No visitors match" /> : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Visitor</TableHead><TableHead>Website</TableHead><TableHead>Location</TableHead><TableHead>Device</TableHead><TableHead>First source</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Pages</TableHead><TableHead className="text-right">Searches</TableHead><TableHead>First seen</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.rows.map((v) => (
                  <TableRow key={`${v.websiteId}-${v.visitorId}`}>
                    <TableCell>
                      <Link href={`/visitors/${v.websiteId}/${v.visitorId}`} className="font-semibold text-primary hover:underline">{v.label}</Link>
                      <span className="ml-1.5 inline-flex gap-1">{v.counts.leads > 0 && <Badge variant="success">Lead</Badge>}{v.identified && <Badge variant="info">Identified</Badge>}{v.counts.sessions > 1 && <Badge>Returning</Badge>}</span>
                    </TableCell>
                    <TableCell><WebsiteTag website={byId[v.websiteId]} /></TableCell>
                    <TableCell className="whitespace-nowrap">{flag(v.geo?.country)} {v.geo?.city ? `${v.geo.city}, ` : ''}{countryName(v.geo?.country)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[12px]">{v.device ? `${v.device.os} ${titleCase(v.device.type)} · ${v.device.browser}` : '—'}</TableCell>
                    <TableCell className="text-[12px]">{v.first ? `${v.first.source || CHANNELS[v.first.channel]}` : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(v.counts.sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(v.counts.pageviews)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(v.counts.searches)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">{formatDateTime(v.firstSeen)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">{timeAgo(v.lastSeen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination meta={data.meta} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
