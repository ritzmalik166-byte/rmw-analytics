/**
 * RMW Analytics session recorder (dist/replay.js). Loaded on demand by tracker.js only for websites with
 * recordings enabled. Uses rrweb to capture DOM snapshots + mutations; uploads compressed chunks.
 * Privacy: every form input is masked in the browser before anything is sent; `maskText` masks all text;
 * elements with class "rmwa-block" are never recorded.
 */
import { record } from 'rrweb';

const FLUSH_MS = 4000;
const MAX_EVENTS = 400;
const MAX_BEACON = 60000;

function start(o) {
  const w = window;
  const url = `${o.api.replace(/\/$/, '')}/api/v1/replay`;
  let buf = [];
  let seq = 0;
  let sid = o.getIds().sid;
  let stop = null;
  let timer = null;

  const payload = (events) => {
    const ids = o.getIds();
    return JSON.stringify({ siteId: o.siteId, vid: ids.vid, sid, seq: seq++, t: Date.now(), events });
  };

  async function send(body) {
    try {
      if (w.CompressionStream && w.Response) {
        const gz = await new w.Response(new w.Blob([body]).stream().pipeThrough(new w.CompressionStream('gzip'))).arrayBuffer();
        await w.fetch(`${url}?z=1`, { method: 'POST', body: gz, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } });
      } else {
        await w.fetch(url, { method: 'POST', body, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } });
      }
    } catch (e) { /* network hiccup: drop this chunk */ }
  }

  function flush(unloading) {
    if (!buf.length) return;
    const body = payload(buf);
    buf = [];
    // While the page unloads, async compression may never finish: send plainly via beacon when small enough.
    if (unloading && body.length < MAX_BEACON && w.navigator.sendBeacon) {
      w.navigator.sendBeacon(url, new w.Blob([body], { type: 'text/plain' }));
    } else {
      send(body);
    }
  }

  stop = record({
    emit(e) {
      // The tracker starts a new session after 30 min idle: close the old recording and begin a fresh one.
      const cur = o.getIds().sid;
      if (cur && cur !== sid) {
        flush(false);
        sid = cur;
        seq = 0;
        w.setTimeout(() => { try { record.takeFullSnapshot(true); } catch (err) { /* ignore */ } }, 0);
      }
      buf.push(e);
      if (buf.length >= MAX_EVENTS || e.type === 2) flush(false);
    },
    maskAllInputs: true,
    maskTextSelector: o.maskText ? '*' : undefined,
    blockClass: 'rmwa-block',
    ignoreClass: 'rmwa-ignore',
    sampling: { mousemove: 50, mouseInteraction: true, scroll: 150, media: 800, input: 'last' },
    slimDOMOptions: 'all',
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    checkoutEveryNms: 5 * 60 * 1000,
  });

  timer = w.setInterval(() => flush(false), FLUSH_MS);
  const onHide = () => { if (w.document.visibilityState === 'hidden') flush(true); };
  w.document.addEventListener('visibilitychange', onHide);
  w.addEventListener('pagehide', () => flush(true));

  return () => {
    flush(false);
    if (stop) stop();
    w.clearInterval(timer);
    w.document.removeEventListener('visibilitychange', onHide);
  };
}

if (!window.__rmwaReplay) {
  let stopFn = null;
  window.__rmwaReplay = {
    start(o) { if (!stopFn) { try { stopFn = start(o); } catch (e) { stopFn = null; } } },
    stop() { if (stopFn) { stopFn(); stopFn = null; } },
  };
}
