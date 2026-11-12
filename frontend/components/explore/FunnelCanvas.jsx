'use client';
import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { num, pct, duration, toQuery } from '@/lib/utils';
import { Skeleton, ErrorState } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SEGMENT_COLORS, viewQuery } from './shared';

export const stepLabel = (s, i) => s.label?.trim() || (s.type === 'path' ? (s.match && s.match !== '*' ? `Viewed ${s.match}` : 'Visited any page') : s.type === 'event' ? `Did ${s.match || '…'}` : s.type === 'form' ? `${(s.match || 'submit').split(':')[0] === 'start' ? 'Started' : 'Submitted'} a form` : 'Searched') || `Step ${i + 1}`;
const valid = (steps) => steps?.length >= 2 && steps.every((s) => s.type !== 'event' || s.match?.trim());

/** Funnel exploration canvas. config: { steps: [{type, match, label}], windowHours, segments (ids) }. */
export function FunnelCanvas({ exp, config, registerExport, tabName }) {
  const segments = useMemo(() => {
    const list = (config.segments || []).map((id) => exp.segments.find((s) => s.id === id)).filter(Boolean);
    return list.length ? list : [null];
  }, [config.segments, exp.segments]);
  const steps = (config.steps || []).map((s, i) => ({ type: s.type, match: s.match || '', label: stepLabel(s, i).slice(0, 80) }));
  const ok = valid(config.steps);
  const results = useQueries({
    queries: segments.map((seg) => {
      const q = viewQuery(exp, seg);
      const body = { steps, windowHours: config.windowHours || 72 };
      return { queryKey: ['explore-funnel', q, body], queryFn: () => api(`/funnels/preview${toQuery(q)}`, { method: 'POST', body }), enabled: ok, placeholderData: (p) => p, retry: false };
    }),
  });
  const multi = segments.length > 1;
  const segName = (i) => segments[i]?.name || 'All users';

  useEffect(() => {
    registerExport?.(() => ({ name: tabName, lines: [['Segment', 'Step', 'Visitors', '% of step 1', 'Dropped off', 'Avg time from previous step (s)'], ...results.flatMap((r, si) => (r.data?.steps || []).map((s, i) => [segName(si), `${i + 1}. ${s.label}`, s.count, s.conversionFromStart, i < r.data.steps.length - 1 ? r.data.steps[i].count - r.data.steps[i + 1].count : '', s.avgTimeFromPreviousMs == null ? '' : Math.round(s.avgTimeFromPreviousMs / 1000)]))] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, registerExport, tabName]);

  if (!ok) return <div className="flex min-h-[360px] flex-col items-center justify-center gap-1 p-8 text-center"><p className="text-[15px] font-medium text-slate-700">Set up your steps</p><p className="max-w-sm text-[13px] text-muted-foreground">Add at least two steps under <b>Steps</b> in Settings, such as “Visited any page” then “Submitted a form”.</p></div>;
  const error = results.find((r) => r.error)?.error;
  if (error) return <ErrorState error={error} />;
  if (results.some((r) => r.isLoading && !r.data)) return <Skeleton className="m-4 h-[320px]" />;

  const bars = steps.map((s, i) => Object.fromEntries([['name', `${i + 1}. ${s.label}`], ...results.flatMap((r, si) => [[`s${si}`, r.data?.steps[i]?.conversionFromStart ?? 0], [`c${si}`, r.data?.steps[i]?.count ?? 0]])]));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white">
        <div className="flex items-baseline justify-between border-b px-4 py-2.5">
          <p className="text-[15px] font-medium text-slate-800">{multi ? 'Segments compared' : segName(0)}</p>
          <p className="text-[12px] text-muted-foreground">Visitors must complete step 1 first, then the others in order within {config.windowHours || 72} hours</p>
        </div>
        <div className="h-[320px] px-2 pt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 24, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tickLine={false} interval={0} tick={{ fontSize: 11, fill: '#334155' }} tickFormatter={(v) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
              <YAxis width={40} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip formatter={(v, n, item) => [`${pct(v)} (${num(item.payload[item.dataKey.replace('s', 'c')])} visitors)`, n]} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {results.map((_, si) => (
                <Bar key={si} dataKey={`s${si}`} name={segName(si)} fill={multi ? SEGMENT_COLORS[si] : '#1a73e8'} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey={`s${si}`} position="top" formatter={(v) => pct(v, 0)} style={{ fontSize: 11, fill: '#334155' }} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <Table>
          <TableHeader><TableRow>{multi && <TableHead>Segment</TableHead>}<TableHead>Step</TableHead><TableHead className="text-right">Visitors</TableHead><TableHead className="text-right">% of step 1</TableHead><TableHead className="text-right">Continued</TableHead><TableHead className="text-right">Dropped off here</TableHead><TableHead className="text-right">Time from previous step</TableHead></TableRow></TableHeader>
          <TableBody>
            {results.map((r, si) => (r.data?.steps || []).map((s, i, all) => {
              const dropped = i < all.length - 1 ? s.count - all[i + 1].count : null;
              return (
                <TableRow key={`${si}-${i}`}>
                  {multi && <TableCell className="whitespace-nowrap text-[12px]" style={{ color: SEGMENT_COLORS[si] }}>{segName(si)}</TableCell>}
                  <TableCell className="font-medium">{i + 1}. {s.label}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{num(s.count)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(s.conversionFromStart)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{i === 0 ? '—' : pct(s.conversionFromPrevious)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dropped == null ? '—' : <>{num(dropped)} <span className="text-[11px] text-muted-foreground">({pct(s.count ? (dropped / s.count) * 100 : 0, 0)})</span></>}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{s.avgTimeFromPreviousMs == null ? '—' : duration(s.avgTimeFromPreviousMs)}</TableCell>
                </TableRow>
              );
            }))}
          </TableBody>
        </Table>
      </div>
      {results.map((r, si) => r.data && <p key={si} className="text-[12px] text-muted-foreground">{multi ? `${segName(si)}: ` : ''}{pct(r.data.overallConversion)} of visitors who did step 1 completed the whole funnel.</p>)}
    </div>
  );
}
