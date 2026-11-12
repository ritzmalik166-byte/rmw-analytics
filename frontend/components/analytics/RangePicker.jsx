'use client';
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useFilters, RANGES, customRangeLabel } from '@/providers/FiltersProvider';
import { Select, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/controls';

const pad = (n) => String(n).padStart(2, '0');
/** Local "YYYY-MM-DD" (toISOString would give the UTC date, which is yesterday before 5:30 am in IST). */
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const START = '00:00';
const END = '23:59';

/** URL value ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm") → { day, time }. */
function split(v, fallbackTime) {
  if (!v) return { day: localDay(), time: fallbackTime };
  return { day: v.slice(0, 10), time: v.length > 10 ? v.slice(11, 16) : fallbackTime };
}

function draftFrom(from, to) {
  const a = split(from, START);
  const b = split(to || from, END);
  return { fromDay: a.day, fromTime: a.time, toDay: b.day, toTime: b.time };
}

/** Whole days are sent as plain dates (fast daily rollups); anything else carries the exact times. */
function toRange(d) {
  if (d.fromTime === START && d.toTime === END) return { from: d.fromDay, to: d.toDay };
  return { from: `${d.fromDay}T${d.fromTime}`, to: `${d.toDay}T${d.toTime}` };
}

export function RangePicker({ allow, showCompare = false }) {
  const { range, from, to, setRange, compare, setCompare } = useFilters();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(from, to));
  const options = allow ? RANGES.filter((r) => allow.includes(r.key)) : RANGES;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const start = `${draft.fromDay}T${draft.fromTime}`;
  const end = `${draft.toDay}T${draft.toTime}`;
  const invalid = !draft.fromDay || !draft.toDay || !draft.fromTime || !draft.toTime || start >= end || start > `${localDay()}T${localTime()}`;

  const openDialog = () => { setDraft(draftFrom(from, to)); setOpen(true); };
  /** Quick fills for the dialog: the last N minutes, ending now. */
  const lastMinutes = (mins) => {
    const now = new Date();
    const past = new Date(now.getTime() - mins * 60_000);
    setDraft({ fromDay: localDay(past), fromTime: localTime(past), toDay: localDay(now), toTime: localTime(now) });
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <Select
          aria-label="Date range"
          className="w-48"
          value={range}
          onChange={(e) => (e.target.value === 'custom' ? openDialog() : setRange(e.target.value))}
        >
          {options.map((r) => <option key={r.key} value={r.key}>{r.key === 'custom' && range === 'custom' ? customRangeLabel(from, to) : r.label}</option>)}
        </Select>
        {range === 'custom' && (
          <button type="button" onClick={openDialog} className="whitespace-nowrap text-[12px] text-primary hover:underline">Edit</button>
        )}
        {showCompare && (
          <label className="ml-1 flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600" title="Show each number next to the same-length period just before">
            <Switch checked={compare} onCheckedChange={setCompare} aria-label="Compare with previous period" />
            Compare with previous period
          </label>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Custom date &amp; time range</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="From date"><Input type="date" value={draft.fromDay} max={draft.toDay} onChange={(e) => set({ fromDay: e.target.value })} /></Field>
              <Field label="From time"><Input type="time" value={draft.fromTime} onChange={(e) => set({ fromTime: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="To date"><Input type="date" value={draft.toDay} min={draft.fromDay} max={localDay()} onChange={(e) => set({ toDay: e.target.value })} /></Field>
              <Field label="To time"><Input type="time" value={draft.toTime} onChange={(e) => set({ toTime: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-muted-foreground">Quick fill:</span>
              {[[20, '20 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours']].map(([m, label]) => (
                <button key={m} type="button" onClick={() => lastMinutes(m)} className="rounded border px-2 py-0.5 text-slate-700 hover:bg-slate-50">Last {label}</button>
              ))}
              <button type="button" onClick={() => set({ fromTime: START, toTime: END })} className="rounded border px-2 py-0.5 text-slate-700 hover:bg-slate-50">Whole days</button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Times are inclusive (“to 14:30” counts up to 14:30:59). Leave 00:00 → 23:59 for whole days.
              {invalid && draft.fromDay && draft.toDay && <span className="mt-1 block text-red-600">The start must be before the end and not in the future.</span>}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { setRange('custom', toRange(draft)); setOpen(false); }} disabled={invalid}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
