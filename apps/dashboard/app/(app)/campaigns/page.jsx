'use client';
import { Megaphone } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { num, pct, duration } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { ExportButton } from '@/components/analytics/Panel';

export default function CampaignsPage() {
  const { current, rangeLabel } = useFilters();
  const { data, isLoading, error, refetch } = useStats('/stats/campaigns');
  return (
    <>
      <PageHeader title="Campaigns" description={`UTM-tagged campaigns with sessions, conversions and leads · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<><RangePicker /><ExportButton type="campaigns" /></>} />
      <Card className="overflow-hidden">
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={8} cols={8} /> : !data?.length ? (
          <EmptyState icon={Megaphone} title="No campaign traffic" description="Tag links with utm_source, utm_medium and utm_campaign (e.g. ?utm_source=google&utm_medium=cpc&utm_campaign=noida_launch)." />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Source / medium</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">Bounce</TableHead><TableHead className="text-right">Avg. session</TableHead><TableHead className="text-right">Conversions</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Conv. rate</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.value}>
                  <TableCell className="font-medium">{r.campaign}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{r.source} / {r.medium}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.sessions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.bounceRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{duration(r.avgSessionMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.conversions)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{num(r.leads)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.conversionRate, 2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
