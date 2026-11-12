'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Target, Trash2, Plus } from 'lucide-react';
import { EVENT_LABELS } from '@rmw-analytics/shared/events';
import { api, apiMessage } from '@/lib/api';
import { useStats } from '@/lib/hooks';
import { num } from '@/lib/utils';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WebsiteTag } from '@/components/analytics/WebsiteDot';
import { useGoals, useCreateGoal } from '@/components/analytics/MarkConversion';

/** Ready-made conversions most websites want. */
const PRESETS = [
  { match: 'form_submit', name: 'Form submitted' },
  { match: 'phone_click', name: 'Phone clicked' },
  { match: 'whatsapp_click', name: 'WhatsApp clicked' },
  { match: 'email_click', name: 'Email clicked' },
  { match: 'file_download', name: 'Download completed' },
  { match: 'lead', name: 'Lead submitted' },
];

function NewGoal({ onDone }) {
  const { site, websites } = useFilters();
  const create = useCreateGoal();
  const events = useStats('/stats/dimension/event', { limit: 200 });
  const [type, setType] = useState('event');
  const [match, setMatch] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [websiteId, setWebsiteId] = useState(site !== 'all' ? site : 'all');
  // Events actually seen on the site (custom ones included) plus the presets, without duplicates.
  const options = useMemo(() => {
    const seen = new Map(PRESETS.map((p) => [p.match, p.name]));
    for (const r of events.data || []) if (!seen.has(r.value) && !['page_view', 'session_start', 'page_leave', 'route_change', 'visibility_hidden', 'scroll'].includes(r.value)) seen.set(r.value, EVENT_LABELS[r.value] || r.value);
    return [...seen];
  }, [events.data]);
  const submit = (e) => {
    e.preventDefault();
    const ids = websiteId === 'all' ? websites.map((w) => w.id) : [websiteId];
    create.mutate({ websiteIds: ids, name: name.trim() || (type === 'path' ? `Visited ${match}` : EVENT_LABELS[match] || match), type, match: match.trim(), value: value ? Number(value) : undefined }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 border-b bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-5">
      <Field label="Count a conversion when">
        <Select value={type} onChange={(e) => { setType(e.target.value); setMatch(''); }}>
          <option value="event">someone does an action</option>
          <option value="path">someone reaches a page</option>
        </Select>
      </Field>
      <Field label={type === 'event' ? 'Action' : 'Page address'}>
        {type === 'event' ? (
          <Select required value={match} onChange={(e) => { setMatch(e.target.value); if (!name) setName(''); }}>
            <option value="">Choose an action…</option>
            {options.map(([k, l]) => <option key={k} value={k}>{l}{l !== k ? ` (${k})` : ''}</option>)}
          </Select>
        ) : <Input required placeholder="/thank-you  or  /booking/*" value={match} onChange={(e) => setMatch(e.target.value)} />}
      </Field>
      <Field label="Name (shown in reports)"><Input placeholder={type === 'path' ? 'Booking completed' : 'e.g. WhatsApp clicked'} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
      <Field label="Value per conversion (optional)"><Input type="number" min="0" step="any" placeholder="e.g. 500" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      <Field label="Website">
        <Select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)}>
          {websites.length > 1 && <option value="all">All websites</option>}
          {websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </Field>
      <div className="flex items-center gap-2 md:col-span-2 xl:col-span-5">
        <Button type="submit" loading={create.isPending} disabled={!match.trim()}>Save conversion</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <span className="text-[12px] text-muted-foreground">Matching activity from the last 90 days is counted too. Use * in page addresses to match several pages.</span>
      </div>
    </form>
  );
}

export default function GoalsPage() {
  const { websites, site, rangeLabel, linkQuery } = useFilters();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: goals, isLoading } = useGoals();
  const report = useStats('/stats/conversions');
  const create = useCreateGoal();
  const [adding, setAdding] = useState(false);
  const del = useMutation({
    mutationFn: (id) => api(`/goals/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Conversion removed. Past results are kept.'); qc.invalidateQueries({ queryKey: ['goals'] }); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const shown = (goals || []).filter((g) => site === 'all' || g.websiteId === site);
  const counts = Object.fromEntries((report.data?.byGoal || []).map((g) => [g.goal, g.count]));
  const targets = site === 'all' ? websites : websites.filter((w) => w.id === site);
  const quick = PRESETS.filter((p) => targets.some((w) => !(goals || []).some((g) => g.websiteId === w.id && g.type === 'event' && g.match === p.match)));
  const editable = can('websites:write');

  return (
    <>
      <PageHeader title="Goals" description={`Actions that count as a conversion · results for ${rangeLabel}`} actions={<><RangePicker />{editable && <Button size="sm" onClick={() => setAdding(true)}><Plus />New conversion</Button>}</>} />
      {editable && quick.length > 0 && (
        <Card className="mb-4 p-4">
          <p className="text-[13px] font-medium">Quick add</p>
          <p className="mb-2 text-[12px] text-muted-foreground">Common actions to count as conversions{site === 'all' ? ' on all websites' : ''}:</p>
          <div className="flex flex-wrap gap-2">
            {quick.map((p) => (
              <Button key={p.match} variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate({ websiteIds: targets.filter((w) => !(goals || []).some((g) => g.websiteId === w.id && g.type === 'event' && g.match === p.match)).map((w) => w.id), name: p.name, type: 'event', match: p.match })}>
                <Plus />{p.name}
              </Button>
            ))}
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        {adding && <NewGoal onDone={() => setAdding(false)} />}
        {isLoading ? <TableSkeleton rows={5} cols={5} /> : !shown.length ? (
          <EmptyState icon={Target} title="No conversions set up yet" description="Choose which actions matter to you, such as a form submission or a WhatsApp click, and they'll be counted as conversions in every report." action={editable && !adding ? <Button onClick={() => setAdding(true)}>Set up a conversion</Button> : null} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Conversion</TableHead><TableHead>Counted when</TableHead><TableHead>Website</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">{rangeLabel}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {shown.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{g.type === 'event' ? <>Action: <span className="font-mono">{g.match}</span></> : <>Reaches page <span className="font-mono">{g.match}</span></>}</TableCell>
                    <TableCell><WebsiteTag website={websites.find((w) => w.id === g.websiteId)} /></TableCell>
                    <TableCell className="text-right tabular-nums">{g.value ? num(g.value) : '—'}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{report.isLoading ? '…' : num(counts[g.name] || 0)}</TableCell>
                    <TableCell className="text-right">{editable && <Button variant="ghost" size="icon" aria-label={`Remove ${g.name}`} onClick={() => del.mutate(g.id)}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Custom events from <span className="font-mono">analytics.track('name', {'{…}'})</span> can be counted too. Results are in <Link className="text-[hsl(var(--primary))] hover:underline" href={withView('/conversions', linkQuery)}>Conversion rate</Link>.
      </p>
    </>
  );
}
