/**
 * Network layer. Bodies are sent as text/plain (a CORS-safelisted type → no preflight) and never carry
 * custom headers or credentials. Large regular flushes are gzip-compressed (`?z=1`) when the browser
 * supports CompressionStream; unload flushes use sendBeacon (fire-and-forget, survives navigation).
 * Resolves to an HTTP status (0 = network failure).
 */
export function createTransport(win, url) {
  const nav = win.navigator;

  async function gzip(body) {
    const stream = new win.Blob([body]).stream().pipeThrough(new win.CompressionStream('gzip'));
    return new win.Blob([await new win.Response(stream).blob()], { type: 'text/plain' });
  }

  return async function send(body, beacon) {
    if (beacon && nav.sendBeacon) {
      try {
        if (nav.sendBeacon(url, new win.Blob([body], { type: 'text/plain' }))) return 202;
      } catch (e) { /* fall back to fetch */ }
    }
    if (!win.fetch) return 0;
    let target = url;
    let payload = body;
    if (!beacon && body.length > 1024 && win.CompressionStream && win.Response) {
      try { payload = await gzip(body); target = `${url}?z=1`; } catch (e) { payload = body; target = url; }
    }
    try {
      const res = await win.fetch(target, { method: 'POST', body: payload, keepalive: Boolean(beacon) && body.length < 60000, credentials: 'omit', mode: 'cors' });
      return res.status;
    } catch (e) {
      return 0;
    }
  };
}
