'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Trash2, CalendarClock, Lock } from 'lucide-react';
import { api, download, apiMessage } from '@/lib/api';
import { formatDateTime, toQuery } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from '@/components/analytics/Panel';
import { RangePicker } from '@/components/analytics/RangePicker';

const DESCRIPTIONS = {
  traffic: 'Daily visitors, sessions, page views, bounce rate, searches, leads and conversions.',
  pages: 'Every page with views, visitors, entries, exits, time on page and scroll depth.',
  sources: 'Channel grouping with sessions, share, bounce and conversion rate.',
  referrers: 'Referring domains with sessions and conversions.',
  campaigns: 'UTM campaigns with sessions, conversions and leads.',
  searches: 'Top site searches with visitors and zero-result counts.',
  geography: 'Countries with sessions, visitors and conversions.',
  devices: 'Device types, browsers and operating systems.',
  conversions: 'Conversions per goal with visitors and value.',
  leads: 'All leads with fields, attribution and status (PII export is audited).',
};

export default function ReportsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { query, current, rangeLabel, websites } = useFilters();
  const [busy, setBusy] = useState(null);
  const { data: reports, isLoading } = useQuery({ queryKey: ['reports'], queryFn: () => api('/reports') });
  const schedules = useQuery({ queryKey: ['report-schedules'], queryFn: () => api('/reports/schedules') });
  const [sch, setSch] = useState({ frequency: 'weekly', websiteId: '', recipients: '' });
  const addSch = useMutation({ mutationFn: () => api('/reports/schedules', { method: 'POST', body: { frequency: sch.frequency, websiteId: sch.websiteId || null, recipients: sch.recipients.split(/[\s,]+/).filter(Boolean) } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['report-schedules'] }); setSch({ ...sch, recipients: '' }); toast.success('Report scheduled'); }, onError: (e) => toast.error(apiMessage(e)) });
  const delSch = useMutation({ mutationFn: (id) => api(`/reports/schedules/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }) });

  const run = async (key, format) => {
    setBusy(`${key}-${format}`);
    try { await download(`/reports/${key}${toQuery({ ...query, format })}`, `${key}.${format}`); } catch (e) { toast.error(apiMessage(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader title="Reports" description={`Download any report for ${current ? current.name : 'all websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      {!can('reports:export') ? <Card className="px-4 py-6 text-[13px] text-muted-foreground">Your role can view analytics but not export reports.</Card> : isLoading ? <Skeleton className="h-64" /> : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Contents</TableHead><TableHead className="text-right">Download</TableHead></TableRow></TableHeader>
            <TableBody>
              {reports.map((r) => {
                const locked = r.pii && !can('leads:export');
                return (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{DESCRIPTIONS[r.key]}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {locked ? <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Lock className="h-3.5 w-3.5" />Admins only</span> : (
                        <>
                          <Button variant="outline" size="sm" loading={busy === `${r.key}-csv`} onClick={() => run(r.key, 'csv')}><FileText />CSV</Button>
                          <Button variant="outline" size="sm" className="ml-1.5" loading={busy === `${r.key}-xlsx`} onClick={() => run(r.key, 'xlsx')}><FileSpreadsheet />Excel</Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Panel title="Scheduled email reports" className="mt-4">
        <div className="p-3">
          <p className="mb-3 text-[12px] text-muted-foreground">Daily (yesterday), weekly (Mondays) or monthly (1st) summary emails with an Excel workbook attached, sent from 07:00 in your organisation's timezone. Requires SMTP on the server.</p>
          <Table>
            <TableHeader><TableRow><TableHead>Frequency</TableHead><TableHead>Website</TableHead><TableHead>Recipients</TableHead><TableHead>Last sent</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(schedules.data || []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="capitalize">{s.frequency}</TableCell>
                  <TableCell>{s.websiteId ? websites.find((w) => w.id === s.websiteId)?.name : 'All websites'}</TableCell>
                  <TableCell className="text-[12px]">{s.recipients.join(', ')}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{s.lastSentAt ? formatDateTime(s.lastSentAt) : 'Not yet'}</TableCell>
                  <TableCell className="text-right">{can('reports:schedule') && <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => delSch.mutate(s.id)}><Trash2 /></Button>}</TableCell>
                </TableRow>
              ))}
              {!schedules.data?.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No scheduled reports</TableCell></TableRow>}
            </TableBody>
          </Table>
          {can('reports:schedule') && (
            <form className="mt-3 grid gap-2 sm:grid-cols-[130px_200px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); addSch.mutate(); }}>
              <Select value={sch.frequency} onChange={(e) => setSch({ ...sch, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select>
              <Select value={sch.websiteId} onChange={(e) => setSch({ ...sch, websiteId: e.target.value })}><option value="">All websites</option>{websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
              <Input required placeholder="Recipients, comma separated" value={sch.recipients} onChange={(e) => setSch({ ...sch, recipients: e.target.value })} />
              <Button type="submit" loading={addSch.isPending}><CalendarClock />Schedule</Button>
            </form>
          )}
        </div>
      </Panel>
    </>
  );
}
