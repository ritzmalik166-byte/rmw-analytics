'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { AuthCard, FormError } from '@/components/auth/AuthCard';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { me } = useAuth();
  const next = params.get('next')?.startsWith('/') ? params.get('next') : '/overview';
  const { data: setup } = useQuery({ queryKey: ['setup-status'], queryFn: () => api('/auth/setup-status') });
  const [mode, setMode] = useState('login'); // login | register | otp
  const [form, setForm] = useState({ email: '', password: '', fullName: '', organization: '' });
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useCountdown();

  useEffect(() => { if (setup?.needsSetup) setMode('register'); }, [setup?.needsSetup]);
  useEffect(() => { if (me) router.replace(next); }, [me, next, router]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const done = async (to) => { await qc.invalidateQueries({ queryKey: ['me'] }); router.replace(to); };
  const run = async (fn) => {
    setError('');
    setBusy(true);
    try { await fn(); } catch (err) {
      setError(apiMessage(err));
      if (err.details?.retryAfter) setCooldown(err.details.retryAfter);
      if (err.errorCode === 'CHALLENGE_EXPIRED') { setMode('login'); setOtp(''); }
    } finally { setBusy(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: form });
        return done('/websites?new=1');
      }
      if (mode === 'otp') {
        await api('/auth/login/verify', { method: 'POST', body: { challenge: challenge.challenge, otp } });
        return done(next);
      }
      const r = await api('/auth/login', { method: 'POST', body: { email: form.email, password: form.password } });
      if (r?.otpRequired) {
        setChallenge(r);
        setOtp('');
        setCooldown(r.resendIn || 60);
        setMode('otp');
        return undefined;
      }
      return done(next);
    });
  };

  const resend = () => run(async () => {
    const r = await api('/auth/login/resend', { method: 'POST', body: { challenge: challenge.challenge } });
    setChallenge(r);
    setOtp('');
    setCooldown(r.resendIn || 60);
  });

  if (mode === 'otp') {
    return (
      <AuthCard title="Verify it's you" description={`Enter the code sent by SMS to ${challenge?.maskedMobile}. It expires in ${Math.round((challenge?.expiresIn || 300) / 60)} minutes.`}
        footer={<button className="inline-flex items-center gap-1 underline" onClick={() => { setMode('login'); setError(''); setOtp(''); }}><ArrowLeft className="h-3.5 w-3.5" />Use a different account</button>}>
        <form onSubmit={submit} className="space-y-3.5">
          <FormError message={error} />
          <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-[13px] text-slate-600"><Smartphone className="h-4 w-4 shrink-0" />Code sent to <span className="font-medium text-slate-900">{challenge?.maskedMobile}</span></div>
          <Field label="Verification code" htmlFor="otp">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus required value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.4em]" />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={otp.length < 4}>Verify and sign in</Button>
          <div className="text-center text-[13px]">
            <button type="button" className="font-medium text-[hsl(var(--primary))] disabled:text-muted-foreground" disabled={cooldown > 0 || busy} onClick={resend}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      </AuthCard>
    );
  }

  const register = mode === 'register';
  return (
    <AuthCard
      title={register ? (setup?.needsSetup ? 'Set up RMW Analytics' : 'Create an account') : 'Sign in'}
      description={register ? 'Create the first Super Admin account and organisation.' : `Use your work email and password.${setup?.loginOtp === false ? '' : ' You will then get a code on your mobile.'}`}
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
        <Button type="submit" className="w-full" loading={busy}>{register ? 'Create account' : 'Continue'}</Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
