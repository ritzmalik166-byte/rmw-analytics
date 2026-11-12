'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MousePointerClick, Download } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { cn, num, timeAgo } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { Stat, StatGrid, Question } from '@/components/analytics/Simple';
import { MarkConversionButton } from '@/components/analytics/MarkConversion';

const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const TABS = [
  { key: 'all', label: 'All clicks' },
  { key: 'contact', label: 'Phone, email & WhatsApp' },
  { key: 'outbound', label: 'Links to other sites' },
  { key: 'frustration', label: 'Frustrated clicks' },
];

/** Clicks report (mode="clicks") or file downloads (mode="downloads"). */
export function ClicksReport({ mode = 'clicks' }) {
  const downloads = mode === 'downloads';
  const { current, rangeLabel } = useFilters();
  const [kind, setKind] = useState('all');
  const k = downloads ? 'download' : kind;
  const { data, isLoading, error, refetch } = useStats('/stats/clicks', { kind: k });
  const loading = isLoading && !data;
  return (
    <>
      <PageHeader
        title={downloads ? 'Downloads' : 'Clicks'}
        description={`${downloads ? 'Files people downloaded (PDFs, brochures, price lists…)' : 'Buttons and links people clicked, in plain words'} · ${current ? current.name : 'All websites'} · ${rangeLabel}`}
        actions={<RangePicker />}
      />
      {!downloads && (
        <div className="mb-3 flex flex-wrap gap-1">
          {TABS.map((t) => <button key={t.key} onClick={() => setKind(t.key)} className={cn('rounded-full px-3 py-1 text-[12px] font-medium ring-1', kind === t.key ? 'bg-[hsl(var(--primary))] text-white ring-[hsl(var(--primary))]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{t.label}</button>)}
        </div>
      )}
      <StatGrid className="md:grid-cols-4">
        <Stat size="sm" label={downloads ? 'Downloads' : 'Clicks'} current={data?.totals.count} loading={loading} />
        <Stat size="sm" label={downloads ? 'People who downloaded' : 'People who clicked'} current={data?.totals.visitors} loading={loading} />
        {(data?.byType || []).slice(0, 2).map((t) => <Stat key={t.name} size="sm" label={t.label} current={t.count} loading={loading} help={`${num(t.visitors)} people`} />)}
      </StatGrid>
      {kind === 'frustration' && <p className="mt-2 text-[12px] text-muted-foreground">Repeated clicks on the same spot, or clicks on things that didn't respond. These usually point to something that looks clickable but isn't, or a slow button.</p>}

      <Question>{downloads ? 'Downloads per day' : 'Clicks per day'}</Question>
      <Card className="h-[180px] px-2 pt-3">
        {loading ? <Skeleton className="h-full w-full" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.byDay || []} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="t" tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} tickFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip formatter={(v) => [num(v), downloads ? 'Downloads' : 'Clicks']} labelFormatter={(t) => fmtDay.format(new Date(`${t}T00:00:00`))} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
              <Bar dataKey="count" fill="#194173" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Question hint="Sorted by the number of different people">{downloads ? 'Files' : 'What people clicked'}</Question>
      <Card className="overflow-hidden">
        {error ? <ErrorState error={error} onRetry={refetch} /> : loading ? <TableSkeleton rows={8} cols={5} /> : !data?.rows?.length ? (
          <EmptyState icon={downloads ? Download : MousePointerClick} title={downloads ? 'No downloads in this period' : 'No clicks in this period'} description={downloads ? 'Links to PDF, ZIP, DOC, XLS and similar files are counted automatically.' : 'Buttons and links are counted automatically. Add data-track="name" to any element to give it a custom event name.'} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>{downloads ? 'File' : 'Action'}</TableHead><TableHead>On pages</TableHead><TableHead className="text-right">People</TableHead><TableHead className="text-right">Times</TableHead><TableHead>Last</TableHead>{!downloads && <TableHead />}</TableRow></TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={`${r.name}|${r.detail}|${r.href}`}>
                    <TableCell className="max-w-[380px]"><span className="block truncate font-medium" title={r.label}>{r.label}</span>{r.href && <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.href}</span>}</TableCell>
                    <TableCell className="max-w-[220px] text-[12px] text-muted-foreground"><span className="block truncate">{(r.topPages || []).join(', ')}{r.pages > 3 ? ` +${r.pages - 3} more` : ''}</span></TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{num(r.visitors)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{num(r.count)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">{timeAgo(r.lastAt)}</TableCell>
                    {!downloads && <TableCell className="text-right">{['phone_click', 'email_click', 'whatsapp_click', 'outbound_click'].includes(r.name) && <MarkConversionButton event={r.name} label={r.type} compact />}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {downloads && <div className="mt-3 flex justify-end"><MarkConversionButton event="file_download" label="File downloaded" /></div>}
    </>
  );
}
