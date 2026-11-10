'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Trash2, UserPlus } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { cn, copyText, formatDateTime, timeAgo, titleCase } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];
const ROLE_HELP = { owner: 'Everything, incl. organisation settings', admin: 'Websites, alerts, members, lead PII & exports', analyst: 'All analytics, leads with masked contact details', viewer: 'Analytics dashboards only' };

function Section({ title, description, children }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-[hsl(214_25%_97%)] px-4 py-2.5"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">{title}</h3>{description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}</div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function OrgTab() {
  const { me, can, refetch } = useAuth();
  const [f, setF] = useState({ name: me.org.name, timezone: me.org.settings?.timezone || 'Asia/Kolkata' });
  const save = useMutation({ mutationFn: () => api('/org', { method: 'PATCH', body: f }), onSuccess: () => { toast.success('Saved'); refetch(); }, onError: (e) => toast.error(apiMessage(e)) });
  return (
    <div className="space-y-4">
      <Section title="Organisation" description="The reporting timezone decides where days start and end in every report.">
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="Name"><Input disabled={!can('org:manage')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Reporting timezone"><Select disabled={!can('org:manage')} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        </div>
        {can('org:manage') && <Button className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
      </Section>
      <Section title="Privacy & data protection">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-slate-700">
          <li>IP addresses are used only to derive approximate location and for rate limiting; they are never stored.</li>
          <li>Visitors get a random first-party ID — no fingerprinting, no cross-site tracking. Cookieless mode is available per website.</li>
          <li>Password, OTP, card, CVV, token and similar fields are never captured, in the browser and again on the server.</li>
          <li>Lead fields are captured only when lead capture is on and the field is allowlisted; they are encrypted at rest (AES-256-GCM).</li>
          <li>Consent modes (opt-in / opt-out), Do-Not-Track and Global Privacy Control are configurable per website.</li>
          <li>Retention per website; visitor export and deletion from each visitor profile; every PII view and export is audit-logged.</li>
        </ul>
      </Section>
    </div>
  );
}

function MembersTab() {
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['members'], queryFn: () => api('/org/members') });
  const [inv, setInv] = useState({ email: '', role: 'analyst' });
  const [link, setLink] = useState(null);
  const invite = useMutation({ mutationFn: () => api('/org/invites', { method: 'POST', body: inv }), onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['members'] }); setInv({ ...inv, email: '' }); if (!d.emailed) setLink(d.url); toast.success(d.emailed ? 'Invite emailed' : 'Invite created — copy the link'); }, onError: (e) => toast.error(apiMessage(e)) });
  const setRole = useMutation({ mutationFn: ({ userId, role }) => api(`/org/members/${userId}`, { method: 'PATCH', body: { role } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }), onError: (e) => toast.error(apiMessage(e)) });
  const remove = useMutation({ mutationFn: (userId) => api(`/org/members/${userId}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); toast.success('Member removed'); }, onError: (e) => toast.error(apiMessage(e)) });
  const revoke = useMutation({ mutationFn: (id) => api(`/org/invites/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }) });
  const manage = can('members:manage');
  return (
    <div className="space-y-4">
      {manage && (
        <Section title="Invite a member">
          <form className="grid gap-2 sm:grid-cols-[1fr_160px_auto]" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <Input type="email" required placeholder="name@company.com" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
            <Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{['admin', 'analyst', 'viewer'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>
            <Button type="submit" loading={invite.isPending}><UserPlus />Invite</Button>
          </form>
          <p className="mt-1.5 text-[12px] text-muted-foreground">{ROLE_HELP[inv.role]}</p>
          {link && <div className="mt-2 flex items-center gap-2 rounded border bg-slate-50 px-2 py-1.5"><code className="min-w-0 flex-1 truncate text-[12px]">{link}</code><Button size="sm" variant="outline" onClick={() => copyText(link).then(() => toast.success('Copied'))}><Copy />Copy</Button></div>}
        </Section>
      )}
      <Card className="overflow-hidden">
        {isLoading ? <TableSkeleton rows={4} cols={5} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Last sign-in</TableHead><TableHead>Joined</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.members.map((m) => {
                const self = m.userId === me.user.id;
                return (
                  <TableRow key={m.userId}>
                    <TableCell><span className="block font-medium">{m.fullName}{self && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}</span><span className="block text-[12px] text-muted-foreground">{m.email}</span></TableCell>
                    <TableCell>{manage && !self && m.role !== 'owner' ? <Select className="h-7 w-28 text-[12px]" value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value })}>{(me.role === 'owner' ? ['owner', 'admin', 'analyst', 'viewer'] : ['analyst', 'viewer']).map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select> : <Badge>{titleCase(m.role)}</Badge>}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDateTime(m.joinedAt)}</TableCell>
                    <TableCell className="text-right">{manage && !self && <Button variant="ghost" size="icon" aria-label="Remove member" onClick={() => remove.mutate(m.userId)}><Trash2 /></Button>}</TableCell>
                  </TableRow>
                );
              })}
              {data.invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell><span className="block text-[13px]">{i.email}</span><span className="text-[11px] text-muted-foreground">Invite pending · expires {formatDateTime(i.expiresAt)}</span></TableCell>
                  <TableCell><Badge variant="warning">{titleCase(i.role)}</Badge></TableCell>
                  <TableCell /><TableCell />
                  <TableCell className="text-right">{manage && <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>Revoke</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function AccountTab() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const save = useMutation({ mutationFn: () => api('/auth/password', { method: 'POST', body: f }), onSuccess: (_, __) => { toast.success('Password updated. Other sessions were signed out.'); setF({ currentPassword: '', newPassword: '' }); }, onError: (e) => toast.error(apiMessage(e)) });
  return (
    <Section title="Change password">
      <form className="grid max-w-md gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label="New password" hint="At least 10 characters with letters and numbers."><Input type="password" autoComplete="new-password" required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <div><Button type="submit" loading={save.isPending}>Update password</Button></div>
      </form>
    </Section>
  );
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['audit', page, action], queryFn: () => api(`/org/audit-logs?page=${page}&limit=50${action ? `&action=${action}` : ''}`), placeholderData: (p) => p });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-2">
        <Select className="w-52" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action"><option value="">All actions</option>{['auth', 'pii', 'visitor', 'website', 'member', 'report', 'lead', 'alert', 'funnel', 'goal', 'org'].map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}</Select>
      </div>
      {isLoading && !data ? <TableSkeleton rows={10} cols={4} /> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-[12px]">{formatDateTime(r.ts)}</TableCell>
                  <TableCell className="text-[12px]">{r.userEmail || 'System'}</TableCell>
                  <TableCell><code className={cn('text-[12px]', r.action.startsWith('pii') && 'text-amber-700', r.action.includes('deleted') && 'text-red-700')}>{r.action}</code></TableCell>
                  <TableCell className="max-w-[160px] truncate text-[12px]">{r.target || '—'}</TableCell>
                  <TableCell className="max-w-[320px] truncate font-mono text-[11px] text-muted-foreground">{Object.keys(r.meta || {}).length ? JSON.stringify(r.meta) : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function SettingsInner() {
  const { can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const tabs = [['organisation', 'Organisation & privacy'], ['members', 'Members'], ['account', 'Account'], ...(can('audit:read') ? [['audit', 'Audit log']] : [])];
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'organisation';
  return (
    <>
      <PageHeader title="Settings" description="Organisation, members and roles, account security and the audit trail. Website-level privacy settings live under Websites." />
      <div className="mb-4 flex gap-1 border-b">
        {tabs.map(([k, l]) => <button key={k} onClick={() => router.replace(`/settings?tab=${k}`)} className={cn('-mb-px border-b-2 px-3 py-1.5 text-[13px]', tab === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-slate-600 hover:text-slate-900')}>{l}</button>)}
      </div>
      {tab === 'organisation' && <OrgTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'account' && <AccountTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}

export default function SettingsPage() {
  return <Suspense><SettingsInner /></Suspense>;
}
