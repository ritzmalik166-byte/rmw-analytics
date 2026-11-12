'use client';
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useFilters, RANGES } from '@/providers/FiltersProvider';
import { Select, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/controls';

const today = () => new Date().toISOString().slice(0, 10);

export function RangePicker({ allow, showCompare = false }) {
  const { range, from, to, setRange, compare, setCompare } = useFilters();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: from || today(), to: to || today() });
  const options = allow ? RANGES.filter((r) => allow.includes(r.key)) : RANGES;
  return (
    <>
      <div className="flex items-center gap-1.5">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <Select
          aria-label="Date range"
          className="w-44"
          value={range}
          onChange={(e) => (e.target.value === 'custom' ? setOpen(true) : setRange(e.target.value))}
        >
          {options.map((r) => <option key={r.key} value={r.key}>{r.key === 'custom' && range === 'custom' ? `${from} → ${to || from}` : r.label}</option>)}
        </Select>
        {showCompare && (
          <label className="ml-1 flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-600" title="Show each number next to the same-length period just before">
            <Switch checked={compare} onCheckedChange={setCompare} aria-label="Compare with previous period" />
            Compare with previous period
          </label>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Custom date range</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={draft.to} min={draft.from} max={today()} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { setRange('custom', draft); setOpen(false); }} disabled={!draft.from || !draft.to}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
