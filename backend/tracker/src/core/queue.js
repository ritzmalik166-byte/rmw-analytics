import { now } from './util.js';

const MAX_BATCH = 50;
const MAX_BODY = 60000;
const MAX_ATTEMPTS = 5;
const OFFLINE_MAX_EVENTS = 200;

/**
 * Batching queue. Items are { v: visitorId, s: sessionId, e: event }; a flush groups them so every
 * request carries exactly one visitor session (the API's batch contract). Failed sends are retried with
 * exponential backoff; when offline or out of attempts, batches are parked in localStorage (≤200 events)
 * and replayed on `online` / next page load.
 *
 * deps: { win, siteId, send(body, beacon) → status, ctxFor(v, s), canSend(), keep(event), offlineStore, log }
 */
export function createQueue(deps) {
  const { win, siteId, send, ctxFor, canSend, keep, offlineStore, log } = deps;
  const KEY = `rmwa_q_${siteId}`;
  let items = [];

  function park(batch) {
    if (!offlineStore()) return;
    const st = offlineStore();
    let saved = [];
    try { saved = JSON.parse(st.get(KEY) || '[]'); } catch (e) { saved = []; }
    saved.push({ ctx: batch.ctx, events: batch.events });
    // Keep the newest events: drop whole oldest batches beyond the cap.
    while (saved.length > 1 && saved.reduce((n, b) => n + b.events.length, 0) > OFFLINE_MAX_EVENTS) saved.shift();
    saved[0].events = saved[0].events.slice(-OFFLINE_MAX_EVENTS);
    st.set(KEY, JSON.stringify(saved));
  }

  async function sendBatch(batch, beacon, attempt) {
    const payload = { siteId, v: 1, sentAt: now(), ctx: batch.ctx, events: batch.events };
    const body = JSON.stringify(payload);
    if (body.length > MAX_BODY && batch.events.length > 1) {
      const mid = Math.ceil(batch.events.length / 2);
      await sendBatch({ ctx: batch.ctx, events: batch.events.slice(0, mid) }, beacon, attempt);
      await sendBatch({ ctx: batch.ctx, events: batch.events.slice(mid) }, beacon, attempt);
      return;
    }
    if (win.navigator.onLine === false) { park(batch); return; }
    const status = await send(body, beacon);
    log('send', status, payload);
    if (status >= 200 && status < 300) return;
    if (status >= 400 && status < 500 && status !== 429) return; // invalid: retrying will not help
    if (beacon || attempt + 1 >= MAX_ATTEMPTS) { park(batch); return; }
    win.setTimeout(() => { sendBatch(batch, false, attempt + 1); }, (status === 429 ? 30000 : 1000) * 2 ** attempt);
  }

  function take() {
    const groups = {};
    const order = [];
    for (const it of items) {
      if (!keep(it.e)) continue;
      const k = `${it.v}|${it.s}`;
      if (!groups[k]) { groups[k] = { v: it.v, s: it.s, events: [] }; order.push(k); }
      groups[k].events.push(it.e);
    }
    items = [];
    const batches = [];
    for (const k of order) {
      const g = groups[k];
      for (let i = 0; i < g.events.length; i += MAX_BATCH) batches.push({ ctx: ctxFor(g.v, g.s), events: g.events.slice(i, i + MAX_BATCH) });
    }
    return batches;
  }

  return {
    get size() { return items.length; },
    add(item) { items.push(item); if (items.length > 500) items.shift(); }, // bounded while waiting for consent
    clear() { items = []; },
    /** Session ids currently waiting in the queue. */
    sessions() { return items.map((i) => i.s); },
    flush(beacon) {
      if (!items.length || !canSend()) return Promise.resolve();
      return Promise.all(take().map((b) => sendBatch(b, beacon, 0))).then(() => undefined);
    },
    /** Replay batches parked while offline (each keeps its original ctx and timestamps). */
    drainOffline() {
      const st = offlineStore();
      if (!st || !canSend()) return Promise.resolve();
      let saved = [];
      try { saved = JSON.parse(st.get(KEY) || '[]'); } catch (e) { saved = []; }
      st.del(KEY);
      return Promise.all(saved.filter((b) => b && b.ctx && b.events && b.events.length).map((b) => sendBatch(b, false, 0))).then(() => undefined);
    },
  };
}
