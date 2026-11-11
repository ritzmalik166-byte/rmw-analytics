'use client';
import { useCallback, useEffect, useState } from 'react';

const PING = '/api/v1/auth/setup-status';
const RETRY_SECONDS = 20;

/** Full-screen maintenance notice, shown when the API answers 502/503/504. Re-checks and hides itself once the API is back. */
export function MaintenanceGate({ appName = 'RMW Analytics', logo = '/rmw-mark.png' }) {
  const [down, setDown] = useState(false);
  const [message, setMessage] = useState('');
  const [left, setLeft] = useState(RETRY_SECONDS);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const show = (msg) => { setDown(true); if (msg) setMessage(msg); setLeft(RETRY_SECONDS); };
    const on = (e) => show(e.detail?.message);
    window.addEventListener('app:maintenance', on);
    // A request may have failed before this listener existed.
    if (window.__appMaintenance) show(window.__appMaintenance.message);
    // Check directly on load and whenever the tab becomes visible again (cached pages make no requests).
    const probe = async () => {
      try {
        const res = await fetch(PING, { cache: 'no-store', credentials: 'include' });
        if (res.status === 502 || res.status === 504) return show();
        if (res.status === 503) {
          const j = await res.json().catch(() => null);
          if (!j || j.errorCode === 'MAINTENANCE') show(j?.message);
        }
      } catch { /* offline: leave it to the normal error handling */ }
    };
    probe();
    const onVisible = () => { if (document.visibilityState === 'visible') probe(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', probe);
    return () => {
      window.removeEventListener('app:maintenance', on);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', probe);
    };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(PING, { cache: 'no-store', credentials: 'include' });
      if (res.ok) { window.__appMaintenance = null; setDown(false); window.location.reload(); return; }
    } catch { /* still down */ }
    setChecking(false);
    setLeft(RETRY_SECONDS);
  }, []);

  useEffect(() => {
    if (!down) return undefined;
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) { check(); return RETRY_SECONDS; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [down, check]);

  if (!down) return null;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Scheduled maintenance"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'linear-gradient(160deg,#0f2a4a 0%,#13355c 60%,#1b4677 100%)', color: '#fff', fontFamily: 'inherit' }}>
      <div style={{ width: '100%', maxWidth: 460, textAlign: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: '36px 28px' }}>
        <img src={logo} alt="" width={56} height={56} style={{ margin: '0 auto 18px', borderRadius: 12, background: '#fff', padding: 6 }} />
        <div style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#f6a623', marginBottom: 10 }}>Under maintenance</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 10px' }}>{appName} will be back shortly</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.8)', margin: '0 0 24px' }}>
          {message || 'We are carrying out scheduled maintenance to improve the system. Your data is safe. Please check back in a few minutes.'}
        </p>
        <button type="button" onClick={check} disabled={checking}
          style={{ background: '#f6a623', color: '#0f2a4a', border: 0, borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.7 : 1 }}>
          {checking ? 'Checking…' : 'Try again now'}
        </button>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', margin: '14px 0 0' }}>Checking again automatically in {left}s</p>
      </div>
    </div>
  );
}
