'use client';
import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, compact, num } from '@/lib/utils';
import { Skeleton } from '@/components/ui/feedback';

const fmtDay = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const fmtHour = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: true });
const fmtMinute = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const fmtFull = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const fmtFullHour = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const toDate = (t) => (t.length === 10 ? new Date(`${t}T00:00:00`) : new Date(t));

function ChartTooltip({ active, payload, label, metrics, interval }) {
  if (!active || !payload?.length) return null;
  const d = toDate(label);
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-slate-700">{interval === 'hour' || interval === 'minute' ? fmtFullHour.format(d) : fmtFull.format(d)}</p>
      {payload.map((p) => {
        const m = metrics.find((x) => x.key === p.dataKey);
        return (
          <p key={p.dataKey} className="flex items-center gap-2 py-0.5 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{m.label}
            <span className="ml-auto pl-6 font-semibold tabular-nums">{m.format ? m.format(p.value) : num(p.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * Search Console-style trend: coloured metric tiles that toggle their line on/off, several lines at once.
 * Each line has its own (hidden) scale so small and large metrics are both readable.
 * metrics: [{ key, label, color, value, format? }]
 */
export function MultiTrendChart({ data, interval = 'day', metrics, loading, refreshing = false, height = 300, defaultActive }) {
  const [active, setActive] = useState(() => new Set(defaultActive || metrics.slice(0, 2).map((m) => m.key)));
  const toggle = (k) => setActive((s) => {
    const n = new Set(s);
    if (n.has(k)) { if (n.size > 1) n.delete(k); } else n.add(k);
    return n;
  });
  const shown = metrics.filter((m) => active.has(m.key));
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => {
          const on = active.has(m.key);
          return (
            <button key={m.key} type="button" onClick={() => toggle(m.key)} aria-pressed={on}
              className={cn('relative px-4 py-3 text-left transition-colors', on ? 'text-white' : 'border-b bg-white text-slate-700 hover:bg-slate-50')}
              style={on ? { background: m.color } : { borderTop: `3px solid ${m.color}` }}>
              <span className="flex items-center gap-1.5 text-[12px] font-medium">
                <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-sm border', on ? 'border-white bg-white/20' : 'border-slate-400')}>{on && <Check className="h-3 w-3" />}</span>
                {m.label}
              </span>
              {loading && m.value == null ? <Skeleton className={cn('mt-2 h-7 w-16', on && 'bg-white/30')} /> : <span className={cn('mt-1 block text-[26px] font-normal leading-tight tabular-nums transition-opacity', refreshing && 'opacity-50')}>{m.value ?? '—'}</span>}
              {m.hint && <span className={cn('mt-0.5 block truncate text-[11px] leading-snug', on ? 'text-white/85' : 'text-slate-500')} title={m.hint}>{m.hint}</span>}
            </button>
          );
        })}
      </div>
      <div className="relative px-2 pb-2 pt-4" style={{ height }} aria-busy={refreshing}>
        {refreshing && data && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px] transition-opacity">
            <span className="flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1a73e8]" />Updating…
            </span>
          </div>
        )}
        {loading && !data ? <Skeleton className="h-full w-full" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data || []} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="#e8eaed" />
              <XAxis dataKey="t" tickLine={false} axisLine={{ stroke: '#dadce0' }} tick={{ fontSize: 11, fill: '#5f6368' }} minTickGap={28}
                tickFormatter={(t) => (interval === 'minute' ? fmtMinute.format(toDate(t)) : interval === 'hour' ? fmtHour.format(toDate(t)) : fmtDay.format(toDate(t)))} />
              {shown.map((m, i) => (
                <YAxis key={m.key} yAxisId={m.key} hide={i > 0 || shown.length > 2} width={44} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11, fill: m.color }} allowDecimals={false} tickFormatter={compact} />
              ))}
              <Tooltip content={<ChartTooltip metrics={metrics} interval={interval} />} cursor={{ stroke: '#9aa0a6', strokeDasharray: '3 3' }} />
              {shown.map((m) => (
                <Line key={m.key} yAxisId={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2.25} dot={false}
                  activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
