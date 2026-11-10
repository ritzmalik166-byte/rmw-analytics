'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Plus, Server, Settings2, Trash2, Code2, Target, KeyRound, CircleDot, Loader2 } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { cn, copyText, num, timeAgo, formatDateTime } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WebsiteDot } from '@/components/analytics/WebsiteDot';

function StatusPill({ status }) {
  const s = status?.state;
  const map = {
    active: ['bg-emerald-50 text-emerald-700 ring-emerald-200', 'bg-emerald-500', 'Tracking active'],
    stale: ['bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500', 'No events in 24h'],
    waiting: ['bg-slate-100 text-slate-600 ring-slate-200', 'bg-slate-400', 'Waiting for first event'],
  }[s] || ['bg-slate-100 text-slate-600 ring-slate-200', 'bg-slate-400', 'Unknown'];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-1.5 py-px text-[11px] font-medium ring-1 ring-inset', map[0])}><span className={cn('h-1.5 w-1.5 rounded-full', map[1], s === 'active' && 'animate-pulse')} />{map[2]}</span>;
}

function CopyBlock({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded border bg-slate-950 p-3 pr-24 text-[12px] leading-relaxed text-slate-100"><code>{text}</code></pre>
      <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={async () => { if (await copyText(text)) { setDone(true); toast.success('Copied to clipboard'); setTimeout(() => setDone(false), 2000); } }}>
        {done ? <Check /> : <Copy />}{done ? 'Copied' : label}
      </Button>
    </div>
  );
}

function CreateDialog({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', code: '', domain: '' });
  const create = useMutation({ mutationFn: () => api('/websites', { method: 'POST', body: { ...f, code: f.code || undefined } }), onSuccess: onCreated, onError: (e) => toast.error(apiMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add website</DialogTitle><DialogDescription>You'll get a tracking script to paste into the site straight after.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Website name"><Input autoFocus required placeholder="My Property Fact" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Domain" hint="Events are accepted from this domain and its subdomains."><Input required placeholder="mypropertyfact.in" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} /></Field>
          <Field label="Short code" hint="Shown in the website switcher (up to 8 letters), e.g. MPF."><Input maxLength={8} placeholder="MPF" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending}>Create website</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstallTab({ site }) {
  const qc = useQueryClient();
  const [verifying, setVerifying] = useState(false);
  const { data: status } = useQuery({ queryKey: ['website-status', site.id], queryFn: () => api(`/websites/${site.id}/status`), refetchInterval: verifying ? 3000 : 30_000, initialData: site.status });
  useEffect(() => { if (verifying && status?.state === 'active') { setVerifying(false); toast.success(`Receiving data from ${site.domain}`); qc.invalidateQueries({ queryKey: ['websites'] }); } }, [status?.state, verifying, site.domain, qc]);
  const steps = [['Create website', true], ['Copy tracking script', true], ['Install on website', status?.state !== 'waiting'], ['Verify installation', status?.state === 'active'], ['Receiving data', status?.state === 'active']];
  const src = site.snippet.match(/src="([^"]+)"/)?.[1];
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {steps.map(([l, ok], i) => (
          <li key={l} className="flex items-center gap-2">
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', ok ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600')}>{ok ? <Check className="h-3 w-3" /> : i + 1}</span>
            <span className={ok ? 'text-slate-800' : 'text-muted-foreground'}>{l}</span>
            {i < steps.length - 1 && <span className="h-px w-4 bg-slate-300" />}
          </li>
        ))}
      </ol>
      <div>
        <p className="kv-label mb-1.5">Paste this before &lt;/head&gt; on every page</p>
        <CopyBlock text={site.snippet} label="Copy script" />
        <p className="mt-1.5 text-[11px] text-muted-foreground">Site ID <code className="rounded bg-slate-100 px-1">{site.siteId}</code> · loads with defer (never blocks rendering), ~9 KB compressed, first-party storage only — no cookies.</p>
      </div>
      <div className="rounded border bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <StatusPill status={status} />
            <span className="text-[12px] text-muted-foreground">{status?.lastEventAt ? <>Last event {timeAgo(status.lastEventAt)}{status.lastEventPath ? ` on ${status.lastEventPath}` : ''}</> : 'No events received yet'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px]">Events today: <span className="font-semibold tabular-nums">{num(status?.eventsToday)}</span></span>
            <Button size="sm" variant={verifying ? 'secondary' : 'default'} onClick={() => setVerifying((v) => !v)}>{verifying ? <><Loader2 className="animate-spin" />Listening… (stop)</> : <><CircleDot />Verify installation</>}</Button>
          </div>
        </div>
        {verifying && <p className="mt-2 text-[12px] text-muted-foreground">Open <a className="underline" href={`https://${site.domain}`} target="_blank" rel="noreferrer">{site.domain}</a> in another tab. This turns green as soon as the first event arrives.</p>}
      </div>
      <details className="rounded border px-3 py-2 text-[12px]">
        <summary className="cursor-pointer font-medium">Framework notes (Next.js, React, Vue, Angular, WordPress)</summary>
        <div className="mt-2 space-y-2">
          <p><b>Next.js (App Router)</b> — in <code>app/layout.js</code>:</p>
          <CopyBlock text={`import Script from 'next/script';\n\n<Script src="${src}" data-site-id="${site.siteId}" strategy="afterInteractive" />`} />
          <p><b>React / Vue / Angular / plain HTML</b> — add the script tag to <code>index.html</code>. Route changes are detected automatically via the History API.</p>
          <p><b>WordPress</b> — paste into a header-scripts plugin or <code>header.php</code> before <code>&lt;/head&gt;</code>.</p>
          <p><b>Lead forms</b> — add <code>data-analytics-lead data-analytics-fields="name,email,phone,city"</code> to the form and enable Lead capture in Settings. Password/OTP/card fields are never read.</p>
          <p><b>Custom events</b> — <code>analytics.track('property_view', {'{'} propertyId: '123' {'}'})</code>, <code>analytics.trackSearch('3 BHK Noida')</code>, <code>analytics.identify({'{'} customerId: 'CUS_123' {'}'})</code>.</p>
        </div>
      </details>
    </div>
  );
}

const TOGGLES = [
  ['leadCapture', 'Lead capture', 'Accept allowlisted form fields (below) as encrypted leads.'],
  ['heatmaps', 'Heatmaps', 'Record click positions, rage and dead clicks. Increases data volume.'],
  ['identify', 'Identify users', 'Accept analytics.identify() to link logged-in customers across your sites.'],
  ['autoSearch', 'Auto-detect searches', 'Search boxes and ?q= / ?s= style URL parameters.'],
  ['autoForms', 'Form analytics', 'Views, starts, submits and errors (never values).'],
  ['trackErrors', 'JavaScript errors', 'Uncaught errors and promise rejections (messages are scrubbed).'],
  ['trackMedia', 'Video & audio', 'Play, pause and completion of <video>/<audio>.'],
  ['respectDnt', 'Honour Do-Not-Track / GPC', 'Visitors with DNT or Global Privacy Control are not tracked.'],
  ['cookieless', 'Cookieless mode', 'No persistent identifiers: every tab is a new anonymous visitor.'],
];

function SettingsTab({ site, onSaved }) {
  const [s, setS] = useState(site.settings);
  const [meta, setMeta] = useState({ name: site.name, code: site.code, domain: site.domain, allowedOrigins: site.allowedOrigins.join('\n') });
  const save = useMutation({
    mutationFn: () => api(`/websites/${site.id}`, { method: 'PATCH', body: {
      name: meta.name, code: meta.code, domain: meta.domain,
      allowedOrigins: meta.allowedOrigins.split(/\s+/).filter(Boolean),
      settings: { ...s, sampleRate: Number(s.sampleRate), retentionDays: Number(s.retentionDays) },
    } }),
    onSuccess: () => { toast.success('Settings saved'); onSaved(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const list = (k) => (Array.isArray(s[k]) ? s[k].join(', ') : '');
  const setList = (k) => (e) => setS({ ...s, [k]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
        <Field label="Code"><Input maxLength={8} value={meta.code} onChange={(e) => setMeta({ ...meta, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Domain"><Input value={meta.domain} onChange={(e) => setMeta({ ...meta, domain: e.target.value })} /></Field>
      </div>
      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {TOGGLES.map(([k, l, h]) => (
          <label key={k} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
            <span><span className="block text-[13px] font-medium">{l}</span><span className="block text-[11px] text-muted-foreground">{h}</span></span>
            <Switch checked={Boolean(s[k])} onCheckedChange={(v) => setS({ ...s, [k]: v })} />
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Consent mode" hint="Opt-in waits for analytics.consent('granted').">
          <Select value={s.consentMode} onChange={(e) => setS({ ...s, consentMode: e.target.value })}><option value="none">Not required</option><option value="opt-out">Opt-out</option><option value="opt-in">Opt-in (wait for consent)</option></Select>
        </Field>
        <Field label="Sampling rate" hint="Share of visitors tracked (0.01–1)."><Input type="number" step="0.01" min="0.01" max="1" value={s.sampleRate} onChange={(e) => setS({ ...s, sampleRate: e.target.value })} /></Field>
        <Field label="Data retention (days)" hint="Raw data older than this is deleted."><Input type="number" min="30" max="1825" value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Allowlisted lead fields" hint="Comma separated. Only these field names are ever captured."><Input value={list('leadFields')} onChange={setList('leadFields')} /></Field>
        <Field label="Excluded paths" hint="Comma separated prefixes or globs, e.g. /admin, /checkout/*"><Input value={list('excludePaths')} onChange={setList('excludePaths')} /></Field>
        <Field label="Extra search URL parameters" hint="Besides q, s, search, query, keyword…"><Input value={list('searchParams')} onChange={setList('searchParams')} /></Field>
        <Field label="Additional allowed origins" hint="One per line, e.g. https://staging.partner.com"><Textarea rows={2} value={meta.allowedOrigins} onChange={(e) => setMeta({ ...meta, allowedOrigins: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button></div>
    </div>
  );
}

function GoalsTab({ site }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['goals'], queryFn: () => api('/goals') });
  const [g, setG] = useState({ name: '', type: 'event', match: '', value: '' });
  const add = useMutation({ mutationFn: () => api('/goals', { method: 'POST', body: { ...g, websiteId: site.id, value: g.value ? Number(g.value) : undefined } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); setG({ name: '', type: 'event', match: '', value: '' }); toast.success('Goal added'); }, onError: (e) => toast.error(apiMessage(e)) });
  const del = useMutation({ mutationFn: (id) => api(`/goals/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }) });
  const goals = (data || []).filter((x) => x.websiteId === site.id);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">Goals turn events or page visits into conversions. Leads are always counted as the “lead” conversion.</p>
      <Table>
        <TableHeader><TableRow><TableHead>Goal</TableHead><TableHead>Trigger</TableHead><TableHead className="text-right">Value</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {goals.map((x) => <TableRow key={x.id}><TableCell className="font-medium">{x.name}</TableCell><TableCell className="text-[12px]">{x.type === 'event' ? 'Event' : 'Page'} <code>{x.match}</code></TableCell><TableCell className="text-right tabular-nums">{x.value || '—'}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" aria-label="Delete goal" onClick={() => del.mutate(x.id)}><Trash2 /></Button></TableCell></TableRow>)}
          {!goals.length && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No goals yet</TableCell></TableRow>}
        </TableBody>
      </Table>
      <form className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_100px_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Input required placeholder="Goal name, e.g. Brochure download" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
        <Select value={g.type} onChange={(e) => setG({ ...g, type: e.target.value })}><option value="event">Event</option><option value="path">Page path</option></Select>
        <Input required placeholder={g.type === 'event' ? 'event name, e.g. file_download' : '/thank-you or /project/*'} value={g.match} onChange={(e) => setG({ ...g, match: e.target.value })} />
        <Input type="number" min="0" placeholder="Value" value={g.value} onChange={(e) => setG({ ...g, value: e.target.value })} />
        <Button type="submit" loading={add.isPending}><Plus />Add</Button>
      </form>
    </div>
  );
}

function ServerTab({ site }) {
  const [key, setKey] = useState(null);
  const rotate = useMutation({ mutationFn: () => api(`/websites/${site.id}/keys`, { method: 'POST' }), onSuccess: (d) => setKey(d), onError: (e) => toast.error(apiMessage(e)) });
  const endpoint = key?.endpoint || `${site.snippet.match(/src="([^"]+)\/tracker\.js"/)?.[1]}/api/v1/events`;
  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-muted-foreground">Send events from your backend (orders, CRM status changes) with a secret key. Never put the secret key in browser code.</p>
      {key ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3"><p className="mb-1.5 text-[12px] font-medium text-amber-900">Copy this key now — it won't be shown again.</p><CopyBlock text={key.key} label="Copy key" /></div>
      ) : (
        <Button variant="outline" loading={rotate.isPending} onClick={() => rotate.mutate()}><KeyRound />{site.hasSecretKey ? 'Rotate secret key' : 'Create secret key'}</Button>
      )}
      {site.hasSecretKey && !key && <p className="text-[12px] text-muted-foreground">A key exists. Rotating it immediately revokes the old one.</p>}
      <CopyBlock text={`curl -X POST ${endpoint} \\\n  -H "Authorization: Bearer sk_..." -H "Content-Type: application/json" \\\n  -d '{"siteId":"${site.siteId}","ctx":{"vid":"v_customer123ab","sid":"s_server_order1"},\n       "events":[{"id":"e_order_10291","n":"conversion","t":${Date.now()},"pr":{"goal":"booking","value":250000,"currency":"INR"}}]}'`} />
      <p className="text-[12px] text-muted-foreground">Alternatively sign the raw body: <code>X-Signature: t=&lt;unix&gt;,v1=HMAC_SHA256(secret, t + "." + body)</code> (5-minute window).</p>
    </div>
  );
}

function WebsiteDialog({ site, initialTab = 'install', onClose }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const tabs = [['install', 'Install', Code2], ...(can('websites:write') ? [['settings', 'Settings', Settings2], ['goals', 'Goals', Target]] : []), ...(can('websites:keys') ? [['server', 'Server-side API', KeyRound]] : [])];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl [&>*]:min-w-0">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><WebsiteDot website={site} />{site.name}<span className="text-[12px] font-normal text-muted-foreground">{site.domain}</span></DialogTitle></DialogHeader>
        <div className="flex gap-1 border-b">
          {tabs.map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[13px]', tab === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-slate-600 hover:text-slate-900')}><I className="h-3.5 w-3.5" />{l}</button>)}
        </div>
        {tab === 'install' && <InstallTab site={site} />}
        {tab === 'settings' && <SettingsTab site={site} onSaved={() => { qc.invalidateQueries({ queryKey: ['websites'] }); onClose(); }} />}
        {tab === 'goals' && <GoalsTab site={site} />}
        {tab === 'server' && <ServerTab site={site} />}
      </DialogContent>
    </Dialog>
  );
}

function WebsitesInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['websites'], queryFn: () => api('/websites'), refetchInterval: 30_000 });
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [open, setOpen] = useState(null);
  const [removing, setRemoving] = useState(null);
  const remove = useMutation({ mutationFn: (id) => api(`/websites/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); setRemoving(null); toast.success('Website removed'); }, onError: (e) => toast.error(apiMessage(e)) });
  const current = open && data?.find((w) => w.id === open.id);

  return (
    <>
      <PageHeader title="Websites" description="Create a website, copy its script, paste it on the site — data appears in seconds." actions={can('websites:write') && <Button size="sm" onClick={() => setCreating(true)}><Plus />Add website</Button>} />
      {isLoading ? <Skeleton className="h-64" /> : !data?.length ? (
        <Card><EmptyState icon={Server} title="No websites yet" description="Add MPF, RMW, CT or any client website. Each gets its own site ID and tracking script." action={can('websites:write') && <Button onClick={() => setCreating(true)}><Plus />Add website</Button>} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>Website</TableHead><TableHead>Site ID</TableHead><TableHead>Status</TableHead><TableHead>Last event</TableHead><TableHead className="text-right">Events today</TableHead><TableHead>Features</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.map((w) => (
                <TableRow key={w.id}>
                  <TableCell><span className="flex items-center gap-2"><WebsiteDot website={w} /><span><span className="block font-medium">{w.name}</span><span className="block text-[11px] text-muted-foreground">{w.domain}</span></span></span></TableCell>
                  <TableCell><code className="text-[12px]">{w.siteId}</code></TableCell>
                  <TableCell><StatusPill status={w.status} /></TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{w.status?.lastEventAt ? timeAgo(w.status.lastEventAt) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(w.status?.eventsToday)}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{[w.settings.leadCapture && 'Leads', w.settings.heatmaps && 'Heatmaps', w.settings.identify && 'Identify', w.settings.cookieless && 'Cookieless', w.settings.consentMode !== 'none' && `Consent: ${w.settings.consentMode}`].filter(Boolean).join(' · ') || 'Defaults'}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{formatDateTime(w.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="outline" size="sm" onClick={() => setOpen({ id: w.id, tab: 'install' })}><Code2 />Install</Button>
                    {can('websites:write') && <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setOpen({ id: w.id, tab: 'settings' })}><Settings2 /></Button>}
                    {can('websites:write') && <Button variant="ghost" size="icon" aria-label="Remove" className="text-red-600" onClick={() => setRemoving(w)}><Trash2 /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {creating && <CreateDialog onClose={() => { setCreating(false); router.replace('/websites'); }} onCreated={(w) => { qc.invalidateQueries({ queryKey: ['websites'] }); setCreating(false); router.replace('/websites'); setOpen({ id: w.id, tab: 'install' }); toast.success('Website created — now install the script'); }} />}
      {current && <WebsiteDialog site={current} initialTab={open.tab} onClose={() => setOpen(null)} />}
      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove {removing?.name}?</DialogTitle><DialogDescription>Tracking requests for this site will be rejected immediately. Collected data stays until its retention period ends.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate(removing.id)}>Remove website</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WebsitesPage() {
  return <Suspense><WebsitesInner /></Suspense>;
}
