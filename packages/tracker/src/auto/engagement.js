import { now, safe } from '../core/util.js';

const IDLE_MS = 30000;
const MILESTONES = [25, 50, 75, 90, 100];

/**
 * Engagement per page view: active time (tab visible + focused + interaction in the last 30 s),
 * scroll depth milestones and max scroll. Sent as page_leave { pvid, engaged, delta, scroll }:
 *   engaged = cumulative active ms for the view, delta = active ms since the previous page_leave
 *   (a view can "leave" several times when the tab is hidden and shown again).
 */
export function installEngagement(t) {
  const { win } = t;
  const doc = win.document;
  let engaged = 0;
  let sentEngaged = 0;
  let sentScroll = -1;
  let maxScroll = 0;
  let hit = {};
  let lastInput = now();
  let pending = false;

  const depth = () => {
    const el = doc.documentElement;
    const body = doc.body || el;
    const h = Math.max(el.scrollHeight, body.scrollHeight || 0);
    const vh = win.innerHeight || el.clientHeight;
    if (!h || h <= vh) return 100;
    return Math.min(100, Math.round((((win.scrollY || el.scrollTop || 0) + vh) / h) * 100));
  };

  const onScroll = safe(() => {
    pending = false;
    const d = depth();
    if (d > maxScroll) maxScroll = d;
    for (const m of MILESTONES) {
      if (d >= m && !hit[m]) { hit[m] = 1; t.track('scroll', { depth: m }); }
    }
  });

  const input = () => { lastInput = now(); };
  ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'wheel'].forEach((e) => doc.addEventListener(e, input, { passive: true, capture: true }));
  win.addEventListener('scroll', () => {
    input();
    if (pending) return;
    pending = true;
    (win.requestAnimationFrame || ((f) => win.setTimeout(f, 50)))(onScroll);
  }, { passive: true });

  t.timers.push(win.setInterval(() => {
    if (doc.visibilityState === 'hidden') return;
    if (doc.hasFocus && !doc.hasFocus() && now() - lastInput > 5000) return;
    if (now() - lastInput < IDLE_MS) engaged += 1000;
  }, 1000));

  t.on('pv', () => {
    engaged = 0;
    sentEngaged = 0;
    sentScroll = -1;
    hit = {};
    lastInput = now();
    maxScroll = 0;
    win.setTimeout(safe(() => { const d = depth(); if (d > maxScroll) maxScroll = d; }), 0);
  });

  /** Emit page_leave for the current view when something new is worth reporting. */
  t.leave = safe((force) => {
    const cur = t.current && t.current();
    if (!cur) return;
    const delta = engaged - sentEngaged;
    if (!force && delta < 1000 && maxScroll === sentScroll) return;
    if (force && sentScroll !== -1 && delta < 1000 && maxScroll === sentScroll) return;
    t.track('page_leave', { pvid: cur.id, engaged, delta, scroll: maxScroll }, { pa: cur.key });
    sentEngaged = engaged;
    sentScroll = maxScroll;
  });
}
