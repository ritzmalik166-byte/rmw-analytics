'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { AuthCard, FormError } from '@/components/auth/AuthCard';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { me } = useAuth();
  const next = params.get('next')?.startsWith('/') ? params.get('next') : '/overview';
  const { data: setup } = useQuery({ queryKey: ['setup-status'], queryFn: () => api('/auth/setup-status') });
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', fullName: '', organization: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (setup?.needsSetup) setMode('register'); }, [setup?.needsSetup]);
  useEffect(() => { if (me) router.replace(next); }, [me, next, router]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') await api('/auth/register', { method: 'POST', body: form });
      else await api('/auth/login', { method: 'POST', body: { email: form.email, password: form.password } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(mode === 'register' ? '/websites?new=1' : next);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const register = mode === 'register';
  return (
    <AuthCard
      title={register ? (setup?.needsSetup ? 'Set up RMW Analytics' : 'Create an account') : 'Sign in'}
      description={register ? (setup?.needsSetup ? 'Create the first owner account and organisation.' : 'Create your organisation and owner account.') : 'Use your work email and password.'}
      footer={setup?.signupOpen && !setup?.needsSetup && (
        <button className="underline" onClick={() => { setError(''); setMode(register ? 'login' : 'register'); }}>{register ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      )}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <FormError message={error} />
        {register && (
          <>
            <Field label="Full name" htmlFor="fullName"><Input id="fullName" autoComplete="name" required value={form.fullName} onChange={set('fullName')} /></Field>
            <Field label="Organisation" htmlFor="org"><Input id="org" placeholder="e.g. Ritz Media World" value={form.organization} onChange={set('organization')} /></Field>
          </>
        )}
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" htmlFor="password" hint={register ? 'At least 10 characters with letters and numbers.' : undefined}>
          <Input id="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required value={form.password} onChange={set('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>{register ? 'Create account' : 'Sign in'}</Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
