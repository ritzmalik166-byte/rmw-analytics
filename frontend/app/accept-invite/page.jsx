'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '@/lib/api';
import { AuthCard, FormError } from '@/components/auth/AuthCard';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function AcceptForm() {
  const token = useSearchParams().get('token') || '';
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/accept-invite', { method: 'POST', body: { token, ...form } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/overview');
    } catch (err) { setError(apiMessage(err)); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Accept invitation" description="Set your name and password to join the organisation. If you already have an account, use your existing password.">
      <form onSubmit={submit} className="space-y-3.5">
        <FormError message={!token ? 'This invite link is missing its token.' : error} />
        <Field label="Full name" htmlFor="n"><Input id="n" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Password" htmlFor="p" hint="At least 10 characters with letters and numbers."><Input id="p" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!token}>Join</Button>
      </form>
    </AuthCard>
  );
}

export default function AcceptInvitePage() {
  return <Suspense><AcceptForm /></Suspense>;
}
