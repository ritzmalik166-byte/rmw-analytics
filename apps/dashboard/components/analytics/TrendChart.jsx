'use client';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, compact, num } from '@/lib/utils';
import { Skeleton } from '@/components/ui/feedback';

const NAVY = '#194173';
const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const fmtHour = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtFull = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const fmtFullHour = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const toDate = (t) => (t.length === 10 ? new Date(`${t}T00:00:00`) : new Date(t));

function ChartTooltip({ active, payload, label, metric, interval }) {
  if (!active || !payload?.length) return null;
  const d = toDate(label);
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-slate-700">{interval === 'hour' ? fmtFullHour.format(d) : fmtFull.format(d)}</p>
      <p className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-sm" style={{ background: NAVY }} />{metric.label}<span className="ml-auto pl-4 font-semibold tabular-nums">{metric.format ? metric.format(payload[0].value) : num(payload[0].value)}</span></p>
    </div>
  );
}

/**
 * Single-series trend with a metric switcher (one axis, one series at a time — never dual-axis).
 * metrics: [{ key, label, format? }]
 */
export function TrendChart({ data, interval = 'day', metrics, loading, height = 260 }) {
  const [active, setActive] = useState(metrics[0].key);
  const metric = metrics.find((m) => m.key === active) || metrics[0];
  const total = (data || []).reduce((s, p) => s + (Number(p[metric.key]) || 0), 0);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2" role="tablist" aria-label="Metric">
        {metrics.map((m) => (
          <button key={m.key} role="tab" aria-selected={m.key === active} onClick={() => setActive(m.key)}
            className={cn('rounded px-2.5 py-1 text-[12px] font-medium transition-colors', m.key === active ? 'bg-[hsl(213_70%_95%)] text-[hsl(var(--primary))]' : 'text-slate-600 hover:bg-slate-100')}>
            {m.label}
          </button>
        ))}
        {!metric.noTotal && <span className="ml-auto text-xs text-muted-foreground">Total <span className="font-semibold tabular-nums text-slate-800">{metric.format ? metric.format(total) : num(total)}</span></span>}
      </div>
      <div className="px-2 pb-2 pt-3" style={{ height }}>
        {loading && !data ? <Skeleton className="h-full w-full" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data || []} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NAVY} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={NAVY} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="t" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24}
                tickFormatter={(t) => (interval === 'hour' ? fmtHour.format(toDate(t)) : fmtDay.format(toDate(t)))} />
              <YAxis width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip metric={metric} interval={interval} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
              <Area type="monotone" dataKey={metric.key} stroke={NAVY} strokeWidth={2} fill={`url(#fill-${metric.key})`} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
