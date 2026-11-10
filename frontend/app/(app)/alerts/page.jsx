'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellRing, Plus, Trash2 } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/controls';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from '@/components/analytics/Panel';

function AlertDialog({ types, onClose }) {
  const qc = useQueryClient();
  const { websites } = useFilters();
  const [f, setF] = useState({ type: 'traffic_spike', websiteId: '', threshold: types.traffic_spike.default, windowMinutes: 60, cooldownMinutes: 60, emails: '', webhookUrl: '' });
  const t = types[f.type];
  const save = useMutation({
    mutationFn: () => api('/alerts', { method: 'POST', body: {
      type: f.type, websiteId: f.websiteId || null, threshold: t.unit ? Number(f.threshold) : null, windowMinutes: Number(f.windowMinutes), cooldownMinutes: Number(f.cooldownMinutes),
      channels: { inApp: true, emails: f.emails.split(/[\s,]+/).filter(Boolean), webhookUrl: f.webhookUrl || null },
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success('Alert created'); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const instant = f.type === 'new_lead' || f.type === 'high_value_conversion';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New alert</DialogTitle><DialogDescription>{t.help}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Alert type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, threshold: types[e.target.value].default ?? '' })}>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="Website"><Select value={f.websiteId} onChange={(e) => setF({ ...f, websiteId: e.target.value })}><option value="">All websites</option>{websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          {t.unit && <Field label={`Threshold (${t.unit})`}><Input type="number" min="0" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></Field>}
          {!instant && <Field label="Window (minutes)"><Input type="number" min="5" max="1440" value={f.windowMinutes} onChange={(e) => setF({ ...f, windowMinutes: e.target.value })} /></Field>}
          {!instant && <Field label="Cooldown (minutes)" hint="Minimum gap between notifications."><Input type="number" min="0" value={f.cooldownMinutes} onChange={(e) => setF({ ...f, cooldownMinutes: e.target.value })} /></Field>}
        </div>
        <Field label="Email recipients" hint="Comma separated. Requires SMTP to be configured on the server."><Input placeholder="team@example.com" value={f.emails} onChange={(e) => setF({ ...f, emails: e.target.value })} /></Field>
        <Field label="Webhook URL (optional)" hint="HTTPS endpoint; Slack / Google Chat incoming webhooks work."><Input placeholder="https://hooks.slack.com/services/…" value={f.webhookUrl} onChange={(e) => setF({ ...f, webhookUrl: e.target.value })} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Create alert</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AlertsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { websites } = useFilters();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['alerts'], queryFn: () => api('/alerts') });
  const events = useQuery({ queryKey: ['alert-events', 'page'], queryFn: () => api('/alerts/events?limit=100'), refetchInterval: 60_000 });
  const toggle = useMutation({ mutationFn: ({ id, enabled }) => api(`/alerts/${id}`, { method: 'PATCH', body: { enabled } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }) });
  const del = useMutation({ mutationFn: (id) => api(`/alerts/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success('Alert deleted'); } });
  const siteName = (id) => (id ? websites.find((w) => w.id === id)?.name || 'Removed website' : 'All websites');
  const types = data?.types || {};
  return (
    <>
      <PageHeader title="Alerts" description="Get notified about traffic spikes and drops, new leads, high-value conversions, error spikes and unusual activity." actions={can('alerts:write') && data && <Button size="sm" onClick={() => setCreating(true)}><Plus />New alert</Button>} />
      {isLoading ? <Skeleton className="h-48" /> : !data?.rules?.length ? (
        <Card><EmptyState icon={BellRing} title="No alerts configured" description="Example: “Traffic increased 240% in the last hour.”" action={can('alerts:write') && <Button onClick={() => setCreating(true)}><Plus />Create alert</Button>} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>Alert</TableHead><TableHead>Website</TableHead><TableHead>Condition</TableHead><TableHead>Delivery</TableHead><TableHead>Last fired</TableHead><TableHead>Enabled</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.rules.map((a) => {
                const t = types[a.type] || {};
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-[12px]">{siteName(a.websiteId)}</TableCell>
                    <TableCell className="text-[12px]">{t.unit ? `≥ ${a.threshold}${t.unit === '%' ? '%' : ` ${t.unit}`}` : 'Every occurrence'}{['new_lead', 'high_value_conversion'].includes(a.type) ? '' : ` · ${a.windowMinutes} min window`}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{['In-app', a.channels?.emails?.length ? `${a.channels.emails.length} email` : null, a.channels?.webhookUrl ? 'Webhook' : null].filter(Boolean).join(' · ')}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{a.lastTriggeredAt ? timeAgo(a.lastTriggeredAt) : 'Never'}</TableCell>
                    <TableCell><Switch checked={a.enabled} disabled={!can('alerts:write')} onCheckedChange={(enabled) => toggle.mutate({ id: a.id, enabled })} /></TableCell>
                    <TableCell className="text-right">{can('alerts:write') && <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => del.mutate(a.id)}><Trash2 /></Button>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Panel title="Alert history" className="mt-4">
        {!events.data?.rows?.length ? <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">No alerts have fired yet.</p> : (
          <ul className="divide-y">
            {events.data.rows.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2 text-[13px]">
                <span className="text-base leading-5" aria-hidden>🚨</span>
                <div className="min-w-0 flex-1"><p><span className="font-medium">{e.name}</span> <Badge variant={e.type === 'new_lead' ? 'success' : e.type.includes('drop') || e.type.includes('error') ? 'danger' : 'info'}>{types[e.type]?.label || e.type}</Badge></p><p className="text-slate-700">{e.message}</p></div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(e.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {creating && <AlertDialog types={types} onClose={() => setCreating(false)} />}
    </>
  );
}
