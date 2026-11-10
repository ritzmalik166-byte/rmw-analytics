'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Inbox, Search, ShieldAlert } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { api, apiMessage } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { cn, formatDateTime, formatTime, titleCase, timeAgo, shortVisitor } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState, Pagination } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { ExportButton } from '@/components/analytics/Panel';
import { WebsiteTag } from '@/components/analytics/WebsiteDot';

const STATUS_COLOR = { new: 'blue', contacted: 'amber', qualified: 'violet', converted: 'green', spam: 'red', closed: 'slate' };

function LeadDialog({ lead, statuses, onClose }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [note, setNote] = useState('');
  const update = useMutation({
    mutationFn: (body) => api(`/leads/${lead.id}`, { method: 'PATCH', body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stats', '/leads'] }); setNote(''); toast.success('Lead updated'); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const a = lead.attribution || {};
  const rows = [
    ...Object.entries(lead.fields).map(([k, v]) => [titleCase(k), v]),
    ['Source', `${a.source || '—'} (${CHANNELS[a.channel] || a.channel})`],
    ['Campaign', a.utm?.campaign || '—'],
    ['Landing page', a.landingPage],
    ['Last search', a.lastSearch ? `“${a.lastSearch}”` : '—'],
    ['Form page', lead.path],
    ['Time', formatDateTime(lead.ts)],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Lead <WebsiteTag website={lead.website} /><StatusBadge name={titleCase(lead.status)} color={STATUS_COLOR[lead.status]} /></DialogTitle>
          <DialogDescription>Visitor <Link className="underline" href={`/visitors/${lead.websiteId}/${lead.visitorId}`}>{shortVisitor(lead.visitorId)}</Link> · {timeAgo(lead.ts)}</DialogDescription>
        </DialogHeader>
        {lead.masked && <p className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"><ShieldAlert className="h-4 w-4" />Contact details are masked for your role.</p>}
        <dl className="divide-y rounded border text-[13px]">
          {rows.map(([k, v]) => <div key={k} className="grid grid-cols-3 gap-2 px-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="col-span-2 break-words">{v || '—'}</dd></div>)}
        </dl>
        {lead.notes?.length > 0 && (
          <div className="space-y-1.5">
            <p className="kv-label">Notes</p>
            {lead.notes.map((n, i) => <p key={i} className="rounded bg-slate-50 px-2.5 py-1.5 text-[12px]">{n.text}<span className="block text-[11px] text-muted-foreground">{n.by} · {formatDateTime(n.at)}</span></p>)}
          </div>
        )}
        {can('leads:write') && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s) => <Button key={s} size="sm" variant={s === lead.status ? 'default' : 'outline'} disabled={update.isPending || s === lead.status} onClick={() => update.mutate({ status: s })}>{titleCase(s)}</Button>)}
            </div>
            <Textarea placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex justify-end"><Button size="sm" disabled={!note.trim()} loading={update.isPending} onClick={() => update.mutate({ note })}>Add note</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function LeadsPage() {
  const { current, rangeLabel } = useFilters();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, isLoading, error, refetch } = useStats('/leads', { q: q.trim() || undefined, status: status || undefined, page, limit: 25 });
  return (
    <>
      <PageHeader title="Leads" description={`Allowlisted form submissions with full attribution · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker />{can('leads:export') && <ExportButton type="leads" />}</>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-2">
          <div className="relative w-full max-w-xs"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Exact email or phone, city, page, search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All statuses</option>{(data?.statuses || []).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
          {data?.rows?.[0]?.masked && <span className="ml-auto flex items-center gap-1 text-[12px] text-amber-700"><ShieldAlert className="h-3.5 w-3.5" />Contact details masked for your role</span>}
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={10} cols={7} /> : !data?.rows?.length ? (
          <EmptyState icon={Inbox} title="No leads in this period" description="Enable lead capture for a website (Websites → Settings) and add data-analytics-lead to its enquiry form, or call analytics.trackLead()." />
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Lead</TableHead><TableHead>Website</TableHead><TableHead>Source</TableHead><TableHead>Landing page</TableHead><TableHead>Search</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.rows.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setOpen(l)}>
                    <TableCell className="whitespace-nowrap text-[12px]"><span className="block">{formatTime(l.ts)}</span><span className="text-muted-foreground">{timeAgo(l.ts)}</span></TableCell>
                    <TableCell>
                      <span className="block font-medium">{l.fields.name || l.fields.full_name || '—'}</span>
                      <span className="block text-[12px] text-muted-foreground">{[l.fields.email, l.fields.phone || l.fields.mobile, l.city].filter(Boolean).join(' · ')}</span>
                    </TableCell>
                    <TableCell><WebsiteTag website={l.website} /></TableCell>
                    <TableCell className="text-[12px]">{l.attribution?.source}<span className="block text-[11px] text-muted-foreground">{CHANNELS[l.attribution?.channel]}{l.attribution?.utm?.campaign ? ` · ${l.attribution.utm.campaign}` : ''}</span></TableCell>
                    <TableCell className="max-w-[180px] truncate text-[12px]">{l.attribution?.landingPage}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-[12px]">{l.attribution?.lastSearch ? `“${l.attribution.lastSearch}”` : '—'}</TableCell>
                    <TableCell><StatusBadge name={titleCase(l.status)} color={STATUS_COLOR[l.status]} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination meta={data.meta} onPage={setPage} />
          </>
        )}
      </Card>
      {open && <LeadDialog lead={open} statuses={data?.statuses || []} onClose={() => setOpen(null)} />}
    </>
  );
}
