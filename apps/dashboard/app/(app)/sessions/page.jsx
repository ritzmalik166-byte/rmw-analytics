'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Timer } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { useStats } from '@/lib/hooks';
import { duration, formatDateTime, countryName, flag, titleCase, shortVisitor } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState, Pagination } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';

export default function SessionsPage() {
  const { current, rangeLabel } = useFilters();
  const [f, setF] = useState({ channel: '', device: '', converted: '' });
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useStats('/sessions', { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page, limit: 30 });
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <>
      <PageHeader title="Sessions" description={`Individual visits with source, path and engagement · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-2">
          <Select className="w-44" value={f.channel} onChange={set('channel')} aria-label="Channel"><option value="">All channels</option>{Object.entries(CHANNELS).filter(([k]) => k !== 'internal').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select className="w-36" value={f.device} onChange={set('device')} aria-label="Device"><option value="">All devices</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option></Select>
          <Select className="w-40" value={f.converted} onChange={set('converted')} aria-label="Outcome"><option value="">All sessions</option><option value="true">Converted only</option></Select>
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={12} cols={8} /> : !data?.rows?.length ? <EmptyState icon={Timer} title="No sessions match" /> : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Visitor</TableHead><TableHead>Source</TableHead><TableHead>Entry → exit</TableHead><TableHead>Location</TableHead><TableHead>Device</TableHead><TableHead className="text-right">Pages</TableHead><TableHead className="text-right">Duration</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.rows.map((s) => (
                  <TableRow key={`${s.websiteId}-${s.sessionId}`}>
                    <TableCell className="whitespace-nowrap"><Link href={`/sessions/${s.websiteId}/${s.sessionId}`} className="font-medium text-primary hover:underline">{formatDateTime(s.startedAt)}</Link><span className="ml-1.5 text-[11px] text-muted-foreground">{s.website}</span></TableCell>
                    <TableCell><Link href={`/visitors/${s.websiteId}/${s.visitorId}`} className="font-mono text-[12px] hover:underline">{shortVisitor(s.visitorId)}</Link>{s.isNew && <span className="ml-1 text-[10px] text-emerald-700">new</span>}</TableCell>
                    <TableCell className="text-[12px]">{s.source}<span className="block text-[11px] text-muted-foreground">{CHANNELS[s.channel] || s.channel}{s.utm?.campaign ? ` · ${s.utm.campaign}` : ''}</span></TableCell>
                    <TableCell className="max-w-[260px] truncate text-[12px]" title={`${s.entryPath} → ${s.exitPath}`}>{s.entryPath}{s.exitPath && s.exitPath !== s.entryPath ? ` → ${s.exitPath}` : ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-[12px]">{flag(s.geo?.country)} {s.geo?.city || countryName(s.geo?.country)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[12px]">{titleCase(s.device?.type)} · {s.device?.browser}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.pageviews}</TableCell>
                    <TableCell className="text-right tabular-nums">{duration(s.durationMs)}</TableCell>
                    <TableCell>{s.converted ? <Badge variant="success">Converted</Badge> : s.bounced ? <Badge>Bounced</Badge> : null}</TableCell>
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
