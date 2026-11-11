'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Trash2, UserPlus, Pencil, Smartphone, Eye, EyeOff } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { cn, copyText, formatDateTime, timeAgo, titleCase, roleLabel } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader, Pagination, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];
const ROLE_HELP = { owner: 'Super Admin: everything, incl. organisation settings and admins', admin: 'Websites, alerts, members, lead PII & exports', analyst: 'All analytics, leads with masked contact details', viewer: 'Analytics dashboards only' };

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

/** Roles the signed-in user may create: Super Admin -> any; Admin -> Analyst / Viewer. */
const creatableRoles = (myRole) => (myRole === 'owner' ? ['owner', 'admin', 'analyst', 'viewer'] : ['analyst', 'viewer']);
const localMobile = (m) => (m ? String(m).replace(/^91(?=\d{10}$)/, '') : '');

function PasswordInput({ value, onChange, required, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-1">
      <Input type={show ? 'text' : 'password'} autoComplete="new-password" required={required} placeholder={placeholder} value={value} onChange={onChange} />
      <Button type="button" variant="outline" size="icon" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</Button>
    </div>
  );
}

function AddUserDialog({ myRole, onClose }) {
  const qc = useQueryClient();
  const roles = creatableRoles(myRole);
  const [f, setF] = useState({ fullName: '', email: '', mobile: '', password: '', role: roles[1] || roles[0] });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api('/org/members', { method: 'POST', body: f }),
    onSuccess: () => { toast.success(`${roleLabel(f.role)} account created`); qc.invalidateQueries({ queryKey: ['members'] }); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add user</DialogTitle><DialogDescription>The account is active immediately. Sign-in needs the password and an SMS code to this mobile number.</DialogDescription></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Full name"><Input required value={f.fullName} onChange={set('fullName')} /></Field>
          <Field label="Role"><Select value={f.role} onChange={set('role')}>{roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select></Field>
          <Field label="Email"><Input type="email" required value={f.email} onChange={set('email')} /></Field>
          <Field label="Mobile"><Input type="tel" inputMode="tel" required placeholder="98XXXXXXXX" value={f.mobile} onChange={set('mobile')} /></Field>
          <Field label="Password" hint="10+ characters with letters and numbers" className="sm:col-span-2"><PasswordInput required value={f.password} onChange={set('password')} /></Field>
          <p className="text-[12px] text-muted-foreground sm:col-span-2">{ROLE_HELP[f.role]}</p>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}><UserPlus />Create account</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ member, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ fullName: member.fullName, mobile: localMobile(member.mobile), newPassword: '', isActive: member.isActive !== false });
  const m = useMutation({
    mutationFn: () => {
      const body = {};
      if (f.fullName !== member.fullName) body.fullName = f.fullName;
      if (f.mobile && f.mobile !== localMobile(member.mobile)) body.mobile = f.mobile;
      if (f.newPassword) body.newPassword = f.newPassword;
      if (f.isActive !== (member.isActive !== false)) body.isActive = f.isActive;
      return api(`/org/members/${member.userId}/profile`, { method: 'PATCH', body });
    },
    onSuccess: () => { toast.success(f.newPassword ? 'Updated. The user was signed out and must use the new password.' : 'Member updated'); qc.invalidateQueries({ queryKey: ['members'] }); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit {member.fullName}</DialogTitle><DialogDescription>{member.email} · {roleLabel(member.role)}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Full name"><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Mobile (for sign-in codes)"><Input type="tel" inputMode="tel" placeholder="98XXXXXXXX" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
          <Field label="New password" hint="Leave blank to keep the current password. No old password needed."><PasswordInput placeholder="Unchanged" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Account active</label>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}>Save changes</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const canEdit = (m) => manage && m.userId !== me.user.id && (me.role === 'owner' || ['analyst', 'viewer'].includes(m.role));
  return (
    <div className="space-y-4">
      {manage && (
        <Section title="Add a user" description={me.role === 'owner' ? 'As Super Admin you can create Super Admin, Admin, Analyst and Viewer accounts.' : 'As Admin you can create Analyst and Viewer accounts.'}>
          <Button onClick={() => setAdding(true)}><UserPlus />Add user</Button>
        </Section>
      )}
      {adding && <AddUserDialog myRole={me.role} onClose={() => setAdding(false)} />}
      {editing && <EditUserDialog member={editing} onClose={() => setEditing(null)} />}
      {manage && (
        <Section title="Or invite by email link">
          <form className="grid gap-2 sm:grid-cols-[1fr_160px_auto]" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <Input type="email" required placeholder="name@company.com" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
            <Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{creatableRoles(me.role).filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select>
            <Button type="submit" loading={invite.isPending}><UserPlus />Invite</Button>
          </form>
          <p className="mt-1.5 text-[12px] text-muted-foreground">{ROLE_HELP[inv.role]}</p>
          {link && <div className="mt-2 flex items-center gap-2 rounded border bg-slate-50 px-2 py-1.5"><code className="min-w-0 flex-1 truncate text-[12px]">{link}</code><Button size="sm" variant="outline" onClick={() => copyText(link).then(() => toast.success('Copied'))}><Copy />Copy</Button></div>}
        </Section>
      )}
      <Card className="overflow-hidden">
        {isLoading ? <TableSkeleton rows={4} cols={6} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Mobile</TableHead><TableHead>Role</TableHead><TableHead>Last sign-in</TableHead><TableHead>Joined</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.members.map((m) => {
                const self = m.userId === me.user.id;
                return (
                  <TableRow key={m.userId}>
                    <TableCell><span className="block font-medium">{m.fullName}{self && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}</span><span className="block text-[12px] text-muted-foreground">{m.email}{m.isActive === false && <Badge variant="danger" className="ml-1.5">Disabled</Badge>}</span></TableCell>
                    <TableCell className="text-[12px]">{m.maskedMobile ? <span className="inline-flex items-center gap-1 tabular-nums"><Smartphone className="h-3.5 w-3.5 text-muted-foreground" />{m.maskedMobile}</span> : <span className="text-amber-700">Not set (no SMS code)</span>}</TableCell>
                    <TableCell>{manage && !self && m.role !== 'owner' ? <Select className="h-7 w-28 text-[12px]" value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value })}>{creatableRoles(me.role).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select> : <Badge>{roleLabel(m.role)}</Badge>}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDateTime(m.joinedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {canEdit(m) && <Button variant="ghost" size="icon" aria-label={`Edit ${m.fullName}`} onClick={() => setEditing(m)}><Pencil /></Button>}
                      {manage && !self && <Button variant="ghost" size="icon" aria-label="Remove member" onClick={() => confirm(`Remove ${m.fullName}?`) && remove.mutate(m.userId)}><Trash2 /></Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {data.invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell><span className="block text-[13px]">{i.email}</span><span className="text-[11px] text-muted-foreground">Invite pending · expires {formatDateTime(i.expiresAt)}</span></TableCell>
                  <TableCell />
                  <TableCell><Badge variant="warning">{roleLabel(i.role)}</Badge></TableCell>
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

function MobileSection() {
  const { me, refetch } = useAuth();
  const [step, setStep] = useState('view');
  const [f, setF] = useState({ mobile: '', currentPassword: '' });
  const [otp, setOtp] = useState('');
  const [ch, setCh] = useState(null);
  const reset = () => { setStep('view'); setF({ mobile: '', currentPassword: '' }); setOtp(''); setCh(null); };
  const request = useMutation({ mutationFn: () => api('/auth/mobile/request', { method: 'POST', body: f }), onSuccess: (r) => { setCh(r); setStep('otp'); toast.success(`Code sent to ${r.maskedMobile}`); }, onError: (e) => toast.error(apiMessage(e)) });
  const verify = useMutation({ mutationFn: () => api('/auth/mobile/verify', { method: 'POST', body: { challenge: ch.challenge, otp } }), onSuccess: () => { toast.success('Mobile verified. Sign-in now needs an SMS code.'); refetch(); reset(); }, onError: (e) => { toast.error(apiMessage(e)); if (e.errorCode === 'CHALLENGE_EXPIRED') setStep('form'); } });
  return (
    <Section title="Mobile number" description="Sign-in sends a one-time code to this number. A new number must be verified with a code sent to it.">
      {step === 'view' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-[13px]"><Smartphone className="h-4 w-4 text-muted-foreground" />{me.user.maskedMobile ? <span className="font-medium tabular-nums">{me.user.maskedMobile}</span> : <span className="text-amber-700">No mobile number. Add one to turn on SMS codes at sign-in.</span>}</span>
          <Button variant="outline" size="sm" onClick={() => setStep('form')}>{me.user.maskedMobile ? 'Change number' : 'Add number'}</Button>
        </div>
      )}
      {step === 'form' && (
        <form className="grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); request.mutate(); }}>
          <Field label="Mobile number"><Input type="tel" inputMode="tel" autoFocus required placeholder="98XXXXXXXX" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
          <Field label="Current password"><Input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={request.isPending}>Send code</Button><Button type="button" variant="ghost" onClick={reset}>Cancel</Button></div>
        </form>
      )}
      {step === 'otp' && (
        <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); verify.mutate(); }}>
          <p className="text-[13px] text-muted-foreground">Enter the code sent to <span className="font-medium text-foreground">{ch?.maskedMobile}</span>.</p>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.4em]" />
          <div className="flex gap-2"><Button type="submit" loading={verify.isPending} disabled={otp.length < 4}>Verify</Button><Button type="button" variant="ghost" onClick={reset}>Cancel</Button></div>
        </form>
      )}
    </Section>
  );
}

function AccountTab() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const save = useMutation({ mutationFn: () => api('/auth/password', { method: 'POST', body: f }), onSuccess: (_, __) => { toast.success('Password updated. Other sessions were signed out.'); setF({ currentPassword: '', newPassword: '' }); }, onError: (e) => toast.error(apiMessage(e)) });
  return (
    <div className="space-y-4">
    <MobileSection />
    <Section title="Change password">
      <form className="grid max-w-md gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label="New password" hint="At least 10 characters with letters and numbers."><Input type="password" autoComplete="new-password" required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <div><Button type="submit" loading={save.isPending}>Update password</Button></div>
      </form>
    </Section>
    </div>
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
