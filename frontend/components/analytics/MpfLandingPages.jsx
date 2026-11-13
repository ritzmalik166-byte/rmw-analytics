'use client';
import Link from 'next/link';
import { useStats } from '@/lib/hooks';
import { num, duration } from '@/lib/utils';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { PageHeader, TableSkeleton, ErrorState } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { MPF_LANDING_PAGES, rowsFor, thankYouViews } from '@/lib/mpfLandingPages';

const SITE = 'https://mypropertyfact.in';
const TABS = [['visits', 'Visits'], ['visitors', 'Visitors'], ['clicks', 'Clicks'], ['recordings', 'Recordings']];

export function MpfLandingPages() {
  const { current, rangeLabel, linkQuery } = useFilters();
  const { data, isLoading, error, refetch } = useStats('/stats/pages', { sort: 'pageviews', order: 'desc', limit: 2000 });

  const list = MPF_LANDING_PAGES.map((lp) => {
    const rows = rowsFor(lp, data);
    const views = rows.reduce((s, r) => s + (r.pageviews || 0), 0);
    const time = views ? rows.reduce((s, r) => s + (r.avgTimeMs || 0) * (r.pageviews || 0), 0) / views : 0;
    // Open the page's own report; for pages with sub-pages, the busiest sub-page.
    const target = rows.find((r) => r.path.replace(/\/+$/, '').toLowerCase() === lp.path.toLowerCase()) || rows[0];
    return { ...lp, views, visitors: rows.reduce((s, r) => s + (r.visitors || 0), 0), entries: rows.reduce((s, r) => s + (r.entries || 0), 0), time, enquiries: thankYouViews(lp, data), target: target?.path || lp.path, subPages: rows.length };
  }).sort((a, b) => b.views - a.views);

  const href = (p, tab) => withView(`/pages/view?path=${encodeURIComponent(p)}${tab ? `&tab=${tab}` : ''}`, linkQuery);

  return (
    <>
      <PageHeader title="Landing pages" description={`My Property Fact landing pages · ${rangeLabel}`} actions={<RangePicker />} />
      <Card className="overflow-hidden">
        {error ? <ErrorState error={error} onRetry={refetch} /> : isLoading && !data ? <TableSkeleton rows={10} cols={6} /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Project / landing page</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Visitors</TableHead>
                <TableHead className="text-right">Arrived here</TableHead>
                <TableHead className="text-right">Enquiries*</TableHead>
                <TableHead className="text-right">Avg. time</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {list.map((r) => (
                  <TableRow key={r.path} className={r.views ? '' : 'opacity-60'}>
                    <TableCell className="max-w-[460px]">
                      <Link href={href(r.target)} className="block font-medium text-[hsl(var(--primary))] hover:underline">{r.name}</Link>
                      <a href={`${SITE}${r.path}`} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-muted-foreground hover:underline" title="Open the live page">{SITE.replace('https://', '')}{r.path}{r.prefix ? '/…' : ''}</a>
                      {r.note && <span className="block text-[11px] text-muted-foreground">{r.note}</span>}
                      <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px]">
                        {TABS.map(([t, l]) => <Link key={t} href={href(r.target, t)} className="font-medium text-slate-500 hover:text-[hsl(var(--primary))] hover:underline">{l}</Link>)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{num(r.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.visitors)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.entries)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.enquiries)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.views ? duration(r.time) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">* Views of the page's thank-you page (people who sent the form). Faded rows had no visits in this period. Click a name for the full report.</p>
          </div>
        )}
      </Card>
    </>
  );
}
