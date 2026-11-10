import { JSDOM } from 'jsdom';
import { createTracker, boot } from '../src/tracker.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * jsdom page + tracker with mocked network. `sent` collects every POSTed batch (fetch or beacon).
 * config: site config returned by GET /api/v1/sites/:id/config.
 */
export async function setup({ url = 'https://example.com/', html = '', config = {}, opts = {}, before, useBoot = false, script } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Home</title>${script || ''}</head><body>${html}</body></html>`, { url, pretendToBeVisual: true, runScripts: useBoot ? 'outside-only' : undefined, referrer: 'https://www.google.com/' });
  const win = dom.window;
  const sent = [];
  const configCalls = [];
  win.fetch = async (u, init) => {
    if (!init || init.method !== 'POST') {
      configCalls.push(u);
      return { ok: true, status: 200, json: async () => ({ success: true, data: config }) };
    }
    sent.push({ url: u, via: 'fetch', body: JSON.parse(init.body) });
    return { ok: true, status: 202 };
  };
  win.navigator.sendBeacon = (u, blob) => {
    sent.push({ url: u, via: 'beacon', blobPromise: new Promise((res) => { const fr = new win.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(blob); }) });
    return true;
  };
  if (before) before(win);
  const api = useBoot ? boot(win) : createTracker(win, { siteId: 'site_testsite0001', api: 'https://api.test', navDelay: 0, ...opts });
  if (api) await api.ready();
  const batches = async () => {
    for (const s of sent) if (s.blobPromise && !s.body) s.body = JSON.parse(await s.blobPromise);
    return sent.map((s) => s.body);
  };
  const events = async () => (await batches()).flatMap((b) => b.events);
  return { dom, win, api, sent, batches, events, configCalls, close: () => { api && api.destroy(); win.close(); } };
}
