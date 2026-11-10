'use client';
import { ClipboardList } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, pct, duration } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Kpi, KpiGrid } from '@/components/analytics/Kpi';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WebsiteTag } from '@/components/analytics/WebsiteDot';

/** Inline 4-step mini funnel: views → starts → submits (bars share one scale). */
function MiniFunnel({ f }) {
  const max = Math.max(1, f.views, f.starts, f.submits);
  return (
    <div className="flex h-5 w-40 items-end gap-0.5" aria-label={`${f.views} views, ${f.starts} starts, ${f.submits} submits`}>
      {[['views', f.views], ['starts', f.starts], ['submits', f.submits]].map(([k, v]) => (
        <span key={k} title={`${k}: ${v}`} className="flex-1 rounded-t-sm bg-[#194173]" style={{ height: `${Math.max(6, (v / max) * 100)}%`, opacity: k === 'views' ? 0.35 : k === 'starts' ? 0.6 : 1 }} />
      ))}
    </div>
  );
}

export default function FormsPage() {
  const { current, rangeLabel, websites } = useFilters();
  const { data, isLoading, error, refetch } = useStats('/stats/forms');
  const t = (data || []).reduce((a, f) => ({ views: a.views + f.views, starts: a.starts + f.starts, submits: a.submits + f.submits, errors: a.errors + f.errors, leads: a.leads + f.leads }), { views: 0, starts: 0, submits: 0, errors: 0, leads: 0 });
  return (
    <>
      <PageHeader title="Forms" description={`Form views, starts, submissions, errors and abandonment · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      <KpiGrid>
        <Kpi label="Form views" value={num(t.views)} loading={isLoading} />
        <Kpi label="Started" value={num(t.starts)} loading={isLoading} hint={t.views ? `${pct((t.starts / t.views) * 100)} of views` : null} />
        <Kpi label="Submitted" value={num(t.submits)} loading={isLoading} hint={t.starts ? `${pct((t.submits / t.starts) * 100)} completion` : null} />
        <Kpi label="Validation errors" value={num(t.errors)} loading={isLoading} />
        <Kpi label="Leads captured" value={num(t.leads)} loading={isLoading} />
      </KpiGrid>
      <Card className="mt-4 overflow-hidden">
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={6} cols={8} /> : !data?.length ? (
          <EmptyState icon={ClipboardList} title="No form activity" description="Forms are tracked automatically (views, starts, submits, errors) without reading any values. Add data-analytics-lead to a form to capture allowlisted fields as leads." />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Form</TableHead><TableHead>Website</TableHead><TableHead>Funnel</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Starts</TableHead><TableHead className="text-right">Submits</TableHead><TableHead className="text-right">Completion</TableHead><TableHead className="text-right">Abandoned</TableHead><TableHead className="text-right">Errors</TableHead><TableHead className="text-right">Avg. fill time</TableHead><TableHead className="text-right">Leads</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((f) => (
                <TableRow key={`${f.websiteId}-${f.formKey}`}>
                  <TableCell><span className="block font-medium">{f.name}</span><span className="block text-[11px] text-muted-foreground">{f.path} · <span className="font-mono">{f.formKey}</span></span></TableCell>
                  <TableCell><WebsiteTag website={websites.find((w) => w.id === f.websiteId)} /></TableCell>
                  <TableCell><MiniFunnel f={f} /></TableCell>
                  <TableCell className="text-right tabular-nums">{num(f.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(f.starts)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{num(f.submits)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(f.completionRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(f.abandonment)}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.errors ? <span className="text-red-700">{num(f.errors)}</span> : 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{duration(f.avgCompletionMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(f.leads)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
