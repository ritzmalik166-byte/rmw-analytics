'use client';
import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { cn, toQuery, pct, countryName } from '@/lib/utils';
import { Skeleton, ErrorState } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Delta } from '@/components/analytics/Simple';
import { COLORS, SEGMENT_COLORS, viewQuery, formatMetric, formatDim, dayLabel } from './shared';

/** Explore dimension → segment condition it can become when a value is clicked. */
const TO_CONDITION = { device: 'device', country: 'country', channel: 'channel', source: 'source', medium: 'medium', campaign: 'campaign', pagePath: 'page', eventName: 'event' };

function useResults(exp, config, segments) {
  const ready = config.metrics?.length > 0;
  return useQueries({
    queries: segments.map((seg) => {
      const q = { ...viewQuery(exp, seg), dims: (config.dims || []).join(','), metrics: (config.metrics || []).join(','), sort: config.sort || undefined, order: config.order || 'desc', compare: config.compare ? '1' : undefined, limit: config.showRows || 25 };
      return { queryKey: ['explore', q], queryFn: () => api(`/stats/explore${toQuery(q)}`), enabled: ready, placeholderData: (p) => p, retry: false };
    }),
  });
}

function Charts({ viz, results, segments, dims }) {
  const ok = results.filter((r) => r.data);
  if (!ok.length) return null;
  const metrics = ok[0].data.metrics;
  const m0 = metrics[0];
  const segName = (i) => segments[i]?.name || 'All users';
  const key = (r) => r.dims.join('|');
  const label = (r) => r.dims.map((v, i) => formatDim(dims[i], v)).join(' · ') || 'Total';

  if (viz === 'line') {
    if (dims[0] !== 'date') return <p className="px-4 py-14 text-center text-[13px] text-muted-foreground">A line chart shows change over time. Put <b>Date</b> in Rows to use it.</p>;
    let series; let points;
    if (ok.length > 1) {
      const byDate = new Map();
      ok.forEach((res, si) => res.data.rows.forEach((r) => { const p = byDate.get(r.dims[0]) || { t: r.dims[0] }; p[`s${si}`] = (p[`s${si}`] || 0) + (r.metrics[m0.key] || 0); byDate.set(r.dims[0], p); }));
      points = [...byDate.values()].sort((a, b) => a.t.localeCompare(b.t));
      series = ok.map((_, si) => ({ key: `s${si}`, name: `${segName(si)} · ${m0.label}`, color: SEGMENT_COLORS[si], metric: m0 }));
    } else if (dims[1]) {
      const rows = ok[0].data.rows;
      const totals = new Map();
      rows.forEach((r) => totals.set(r.dims[1], (totals.get(r.dims[1]) || 0) + (r.metrics[m0.key] || 0)));
      const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
      const byDate = new Map();
      rows.forEach((r) => { if (!top.includes(r.dims[1])) return; const p = byDate.get(r.dims[0]) || { t: r.dims[0] }; p[`d${top.indexOf(r.dims[1])}`] = r.metrics[m0.key]; byDate.set(r.dims[0], p); });
      points = [...byDate.values()].sort((a, b) => a.t.localeCompare(b.t));
      series = top.map((k, i) => ({ key: `d${i}`, name: formatDim(dims[1], k), color: COLORS[i % COLORS.length], metric: m0 }));
    } else {
      points = ok[0].data.rows.map((r) => ({ t: r.dims[0], ...r.metrics })).sort((a, b) => a.t.localeCompare(b.t));
      series = metrics.slice(0, 5).map((m, i) => ({ key: m.key, name: m.label, color: COLORS[i], metric: m, right: i > 0 && metrics.length > 1 && m.format !== m0.format }));
    }
    const hasRight = series.some((s) => s.right);
    return (
      <div className="h-[300px] px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="t" tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} tickFormatter={dayLabel} />
            <YAxis yAxisId="l" width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            {hasRight && <YAxis yAxisId="r" orientation="right" width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />}
            <Tooltip labelFormatter={dayLabel} formatter={(v, n, item) => [formatMetric(series.find((s) => s.key === item.dataKey)?.metric, v), n]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => <Line key={s.key} yAxisId={s.right ? 'r' : 'l'} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={points.length < 20} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (viz === 'donut') {
    if (m0.format !== 'number') return <p className="px-4 py-14 text-center text-[13px] text-muted-foreground">A donut shows shares of a total, which doesn't work for <b>{m0.label}</b>. Put a count first in Values (users, sessions, views…), or pick another chart.</p>;
    return (
      <div className={cn('grid gap-4 p-4', ok.length > 1 && 'md:grid-cols-2')}>
        {ok.map((res, si) => {
          const rows = res.data.rows;
          const top = rows.slice(0, 7);
          const rest = rows.slice(7).reduce((s, r) => s + (r.metrics[m0.key] || 0), 0);
          const pie = [...top.map((r) => ({ name: label(r), value: r.metrics[m0.key] || 0 })), ...(rest ? [{ name: 'Other', value: rest }] : [])];
          const total = pie.reduce((s, p) => s + p.value, 0) || 1;
          return (
            <div key={si}>
              {ok.length > 1 && <p className="mb-1 text-[12px] font-semibold" style={{ color: SEGMENT_COLORS[si] }}>{segName(si)}</p>}
              <div className="grid items-center gap-3 sm:grid-cols-2">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pie} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="88%" paddingAngle={1} isAnimationActive={false}>{pie.map((p, i) => <Cell key={p.name} fill={COLORS[i % COLORS.length]} />)}</Pie>
                      <Tooltip formatter={(v, n) => [`${formatMetric(m0, v)} (${pct((v / total) * 100)})`, n]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-1 text-[12px]">
                  {pie.map((p, i) => <li key={p.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="font-semibold tabular-nums">{pct((p.value / total) * 100, 0)}</span></li>)}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (viz === 'bar') {
    const first = ok[0].data.rows.slice(0, 12);
    const maps = ok.map((res) => new Map(res.data.rows.map((r) => [key(r), r.metrics[m0.key] || 0])));
    const bars = first.map((r) => Object.fromEntries([['name', label(r)], ...maps.map((m, si) => [`s${si}`, m.get(key(r)) || 0])]));
    return (
      <div className="px-2 pt-3" style={{ height: Math.max(180, bars.length * (ok.length > 1 ? 40 : 30) + 50) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={190} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#334155' }} tickFormatter={(v) => (v.length > 30 ? `${v.slice(0, 29)}…` : v)} />
            <Tooltip formatter={(v, n) => [formatMetric(m0, v), n]} contentStyle={{ fontSize: 12, borderRadius: 6 }} cursor={{ fill: 'rgba(25,65,115,0.06)' }} />
            {ok.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {ok.map((_, si) => <Bar key={si} dataKey={`s${si}`} name={ok.length > 1 ? segName(si) : m0.label} fill={ok.length > 1 ? SEGMENT_COLORS[si] : '#194173'} radius={[0, 3, 3, 0]} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return null;
}

/**
 * Free-form canvas. config: { viz, dims, metrics, segments (ids), showRows, compare, sort, order }.
 * onConfig(patch) changes the tab; onAddSegment(segment) turns a clicked value into a segment.
 */
export function FreeformCanvas({ exp, config, onConfig, onAddSegment, registerExport, tabName }) {
  const segments = useMemo(() => {
    const list = (config.segments || []).map((id) => exp.segments.find((s) => s.id === id)).filter(Boolean);
    return list.length ? list : [null];
  }, [config.segments, exp.segments]);
  const results = useResults(exp, config, segments);
  const multi = segments.length > 1;
  const first = results.find((r) => r.data)?.data;
  const error = results.find((r) => r.error)?.error;
  const loading = results.some((r) => r.isLoading);
  const dims = config.dims || [];
  const hasPrev = config.compare && results.some((r) => r.data?.previousTotal && Object.values(r.data.previousTotal).some((v) => v));

  useEffect(() => {
    registerExport?.(() => {
      if (!first) return null;
      const head = [...(multi ? ['Segment'] : []), ...first.dimensions.map((d) => d.label), ...first.metrics.map((m) => m.label)];
      const lines = [head];
      results.forEach((r, si) => r.data?.rows.forEach((row) => lines.push([...(multi ? [segments[si]?.name || 'All users'] : []), ...row.dims, ...first.metrics.map((m) => row.metrics[m.key])])));
      return { name: tabName, lines };
    });
  }, [results, first, multi, segments, registerExport, tabName]);

  if (!config.metrics?.length) {
    return <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-2 p-8 text-center"><p className="text-[15px] font-medium text-slate-700">Pick what to count</p><p className="max-w-sm text-[13px] text-muted-foreground">Add metrics to <b>Values</b> (for example Users or Views) and a dimension to <b>Rows</b> (for example Traffic type) from the Settings column.</p></div>;
  }
  if (error) return <ErrorState error={error} />;
  const sortBy = (k) => onConfig({ sort: k, order: config.sort === k && config.order === 'desc' ? 'asc' : 'desc' });
  const activeSort = config.sort || (dims[0] === 'date' ? 'dim0' : first?.metrics[0]?.key);

  return (
    <div className="space-y-3">
      {config.viz !== 'table' && <div className="rounded-lg border bg-white">{loading && !first ? <Skeleton className="m-4 h-[260px]" /> : <Charts viz={config.viz} results={results} segments={segments} dims={dims} />}</div>}
      {config.compare && first && !hasPrev && <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">There's no data in the previous period to compare with yet. Tracking probably started recently.</p>}
      <div className="overflow-hidden rounded-lg border bg-white">
        {loading && !first ? <div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div> : first && (
          <div className="max-h-[620px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow>
                  {multi && <TableHead>Segment</TableHead>}
                  {first.dimensions.map((d, i) => <TableHead key={d.key} className={cn('whitespace-nowrap', i === 0 && 'cursor-pointer')} onClick={() => i === 0 && sortBy('dim0')}>{d.label}{i === 0 && activeSort === 'dim0' ? (config.order === 'asc' || dims[0] === 'date' ? ' ↑' : ' ↓') : ''}</TableHead>)}
                  {!first.dimensions.length && <TableHead />}
                  {first.metrics.map((m) => <TableHead key={m.key} className={cn('cursor-pointer whitespace-nowrap text-right', activeSort === m.key && 'text-slate-900')} onClick={() => sortBy(m.key)}>{m.label}{activeSort === m.key ? (config.order === 'asc' ? ' ↑' : ' ↓') : ''}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((res, si) => res.data && (
                  <SegmentRows key={si} data={res.data} segment={segments[si]} si={si} multi={multi} dims={dims} hasPrev={hasPrev} onAddSegment={onAddSegment} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {first && <p className="text-[12px] text-muted-foreground">{first.rowCount > (config.showRows || 25) ? `Showing ${config.showRows || 25} of ${first.rowCount} rows (change "Show rows" in Settings). ` : ''}Click a column to sort{dims.some((d) => TO_CONDITION[d]) ? ' · click a value to turn it into a segment' : ''}.</p>}
    </div>
  );
}

function SegmentRows({ data, segment, si, multi, dims, hasPrev, onAddSegment }) {
  const span = Math.max(1, data.dimensions.length);
  return (
    <>
      <TableRow className="bg-slate-50 font-semibold hover:bg-slate-50">
        {multi && <TableCell className="whitespace-nowrap text-[12px]" style={{ color: SEGMENT_COLORS[si] }}>{segment?.name || 'All users'}</TableCell>}
        <TableCell colSpan={span} className="text-[12px]">Total</TableCell>
        {data.metrics.map((m) => (
          <TableCell key={m.key} className="text-right tabular-nums">
            {formatMetric(m, data.total[m.key])}
            {hasPrev && data.previousTotal && <span className="block whitespace-nowrap text-[11px] font-normal"><Delta current={data.total[m.key]} previous={data.previousTotal[m.key]} invert={m.lowerIsBetter} /> <span className="text-muted-foreground">vs {formatMetric(m, data.previousTotal[m.key])}</span></span>}
          </TableCell>
        ))}
      </TableRow>
      {data.rows.map((r) => (
        <TableRow key={`${si}-${r.dims.join('|')}`}>
          {multi && <TableCell className="text-[12px] text-muted-foreground">{segment?.name || 'All users'}</TableCell>}
          {r.dims.map((v, i) => {
            const cond = TO_CONDITION[dims[i]];
            return (
              <TableCell key={dims[i]} className="max-w-[300px]">
                {cond && v !== '(unknown)' && onAddSegment
                  ? <button onClick={() => onAddSegment({ name: `${data.dimensions[i].label}: ${dims[i] === 'country' ? countryName(v) : formatDim(dims[i], v)}`.slice(0, 60), conditions: { [cond]: v } })} className="block max-w-full truncate text-left text-[hsl(var(--primary))] hover:underline" title="Create a segment from this value">{formatDim(dims[i], v)}</button>
                  : <span className="block truncate" title={String(v)}>{formatDim(dims[i], v)}</span>}
              </TableCell>
            );
          })}
          {!r.dims.length && <TableCell>All</TableCell>}
          {data.metrics.map((m) => (
            <TableCell key={m.key} className="whitespace-nowrap text-right tabular-nums">
              {formatMetric(m, r.metrics[m.key])}
              {hasPrev && 'previous' in r && r.previous && <span className="ml-1.5"><Delta current={r.metrics[m.key]} previous={r.previous[m.key]} invert={m.lowerIsBetter} /></span>}
            </TableCell>
          ))}
        </TableRow>
      ))}
      {!data.rows.length && <TableRow><TableCell colSpan={span + data.metrics.length + (multi ? 1 : 0)} className="py-8 text-center text-muted-foreground">No data for {segment?.name || 'these settings'} in this period.</TableCell></TableRow>}
    </>
  );
}
