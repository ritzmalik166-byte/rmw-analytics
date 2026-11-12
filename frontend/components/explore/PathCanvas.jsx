'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { num, toQuery } from '@/lib/utils';
import { Skeleton, ErrorState } from '@/components/ui/feedback';
import { viewQuery, nodeLabel } from './shared';

const COL_W = 190;    // node + label area
const GAP = 120;      // space for the flow bands
const BAR = 12;
const HEAD = 34;
const AREA = 380;     // height shared by the nodes of a column
const MIN_H = 30;
const SPACING = 12;

/** Node rectangles of one column, heights proportional to visits. */
function layout(col) {
  const items = [...col.nodes.map((n) => ({ ...n, kind: 'node' })), ...(col.more ? [{ value: '__more', count: col.more.count, kind: 'more', label: `+${col.more.nodes} more` }] : [])];
  const total = items.reduce((s, n) => s + n.count, 0) || 1;
  let y = HEAD;
  return items.map((n) => {
    const h = Math.max(MIN_H, Math.round((n.count / total) * AREA));
    const r = { ...n, y, h };
    y += h + SPACING;
    return r;
  });
}

const clip = (s, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Path exploration canvas. config: { nodeType, start, chain, unique, segment }. */
export function PathCanvas({ exp, config, onConfig, registerExport, tabName }) {
  const segment = exp.segments.find((s) => s.id === config.segment) || null;
  const chain = config.start ? [config.start, ...(config.chain || []).slice(config.chain?.[0] === config.start ? 1 : 0)] : config.chain || [];
  const q = { ...viewQuery(exp, segment), node: config.nodeType || 'event', start: config.start || undefined, chain: JSON.stringify(chain), unique: config.unique === false ? '0' : '1', limit: 8 };
  const { data, isLoading, error, isFetching } = useQuery({ queryKey: ['explore-path', q], queryFn: () => api(`/stats/explore/path${toQuery(q)}`), placeholderData: (p) => p, retry: false });

  useEffect(() => {
    registerExport?.(() => data && { name: tabName, lines: [['Step', 'Node', 'Visits'], ...data.columns.flatMap((c) => c.nodes.map((n) => [c.step === 0 ? 'Starting point' : `Step +${c.step}`, nodeLabel(data.nodeType, n.value), n.count]))] });
  }, [data, registerExport, tabName]);

  if (error) return <ErrorState error={error} />;
  if (isLoading && !data) return <Skeleton className="m-4 h-[380px]" />;
  if (!data?.sessions) {
    return <div className="flex min-h-[360px] flex-col items-center justify-center gap-1 p-8 text-center"><p className="text-[15px] font-medium text-slate-700">No visits to show</p><p className="max-w-sm text-[13px] text-muted-foreground">{config.start ? `No visit in this period included “${nodeLabel(config.nodeType, config.start)}”. Change the starting point in Settings.` : 'There are no visits in this period for this segment.'}</p></div>;
  }

  const cols = data.columns.map(layout);
  const height = Math.max(...cols.map((c) => (c.length ? c.at(-1).y + c.at(-1).h : HEAD))) + 8;
  const width = cols.length * (COL_W + GAP) - GAP + 40;
  const xOf = (j) => j * (COL_W + GAP);

  const pick = (j, node) => {
    if (node.kind !== 'node' || node.value === '(exit)') return;
    if (config.start && j === 0) return; // the starting point is fixed in Settings
    // Clicking the expanded node again collapses everything after it.
    onConfig({ chain: chain[j] === node.value ? chain.slice(0, j) : [...chain.slice(0, j), node.value] });
  };

  // Flow bands: from the expanded node of column j to every node of column j+1.
  const flows = [];
  cols.forEach((col, j) => {
    const next = cols[j + 1];
    const sel = col.find((n) => n.kind === 'node' && n.value === chain[j]);
    if (!next || !sel) return;
    const total = next.reduce((s, n) => s + n.count, 0) || 1;
    let acc = 0;
    const x0 = xOf(j) + BAR;
    const x1 = xOf(j + 1);
    const xm = (x0 + x1) / 2;
    next.forEach((n) => {
      const s0 = sel.y + (acc / total) * sel.h;
      acc += n.count;
      const s1 = sel.y + (acc / total) * sel.h;
      flows.push(<path key={`${j}-${n.value}`} d={`M${x0},${s0} C${xm},${s0} ${xm},${n.y} ${x1},${n.y} L${x1},${n.y + n.h} C${xm},${n.y + n.h} ${xm},${s1} ${x0},${s1} Z`} fill={n.kind === 'more' ? '#eef2f7' : n.value === chain[j + 1] ? '#c6dafc' : '#e3edfd'} />);
    });
  });

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <p className="text-[15px] font-medium text-slate-800">{segment?.name || 'All users'}</p>
        <p className="text-[12px] text-muted-foreground">{num(data.sessions)} visits{data.sampled ? ' (sample of the first 50,000)' : ''} · click a {config.nodeType === 'page' ? 'page' : 'step'} to see what came next{isFetching ? ' · updating…' : ''}</p>
      </div>
      <div className="overflow-x-auto p-4">
        <svg width={width} height={height} className="block" role="img" aria-label="Visitor paths, step by step">
          {flows}
          {cols.map((col, j) => (
            <g key={j} transform={`translate(${xOf(j)},0)`}>
              <text x={0} y={14} className="fill-slate-500" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em' }}>{j === 0 ? 'STARTING POINT' : `STEP +${j}`}</text>
              {col.map((n) => {
                const selected = n.kind === 'node' && n.value === chain[j];
                const clickable = n.kind === 'node' && n.value !== '(exit)' && !(config.start && j === 0);
                const name = n.kind === 'more' ? n.label : nodeLabel(data.nodeType, n.value);
                return (
                  <g key={n.value} onClick={() => pick(j, n)} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                    <title>{`${name}: ${num(n.count)} visits${clickable ? (selected ? ' (click to collapse)' : ' (click to see the next step)') : ''}`}</title>
                    <rect x={0} y={n.y} width={BAR} height={n.h} rx={2} fill={n.kind === 'more' ? '#cbd5e1' : n.value === '(exit)' ? '#f28b82' : selected ? '#1a73e8' : '#8ab4f8'} />
                    <rect x={BAR} y={n.y} width={COL_W - BAR} height={n.h} fill={selected ? 'rgba(26,115,232,0.08)' : 'transparent'} />
                    <text x={BAR + 8} y={n.y + 13} className={n.kind === 'more' ? 'fill-[#1a73e8]' : 'fill-slate-800'} style={{ fontSize: 12, fontWeight: n.kind === 'more' ? 600 : 400 }}>{clip(name)}</text>
                    {n.h >= 28 && <text x={BAR + 8} y={n.y + 27} className="fill-slate-900" style={{ fontSize: 12, fontWeight: 700 }}>{num(n.count)}</text>}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
