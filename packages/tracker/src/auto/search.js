import { redactText } from '@rmw-analytics/shared/privacy';
import { now, safe, store, clip } from '../core/util.js';

const DEFAULT_PARAMS = ['q', 's', 'search', 'query', 'keyword', 'keywords', 'term', 'k'];
const DEDUPE_MS = 10000;

export function installSearch(t) {
  const { win } = t;
  const ss = store(win, 'sessionStorage');
  let last = null;

  const params = () => DEFAULT_PARAMS.concat(t.cfg.searchParams || [], t.extraSearchParams || []).map((p) => String(p).toLowerCase());

  /** The search input of a form, or null when it is not a search form. */
  t.searchInput = (form) => {
    if (!form || !form.querySelector) return null;
    const typed = form.querySelector('input[type=search]');
    if (typed) return typed;
    const names = params();
    const els = form.elements || [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const n = String(el.getAttribute && (el.getAttribute('name') || el.getAttribute('id')) || '').toLowerCase();
      if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search' || !el.type) && names.indexOf(n) !== -1) return el;
    }
    return null;
  };

  /** analytics.trackSearch(query, { category, filters, results }) */
  t.trackSearch = safe((query, opts) => {
    const o = opts || {};
    const q = clip(redactText(String(query == null ? '' : query).trim()), 200);
    if (!q) return;
    const key = q.toLowerCase();
    const ts = now();
    if (!last && ss) { try { last = JSON.parse(ss.get('rmwa_ls') || 'null'); } catch (e) { last = null; } }
    if (last && last.q === key && ts - last.t < DEDUPE_MS) return;
    last = { q: key, t: ts };
    if (ss) ss.set('rmwa_ls', JSON.stringify(last));
    const pr = { query: q };
    if (o.category != null) pr.category = clip(o.category, 80);
    if (o.filters && typeof o.filters === 'object') pr.filters = o.filters;
    if (typeof o.results === 'number') pr.results = o.results;
    if (o.auto) pr.auto = true;
    t.track('search', pr);
  });

  // Automatic: search form submits…
  win.document.addEventListener('submit', safe((e) => {
    if (!t.cfg.autoSearch || t.disabled.search) return;
    const input = t.searchInput(e.target);
    if (input && input.value) {
      const form = e.target;
      const cat = form.querySelector('select[name=category],select[name=type],select[name=cat]');
      t.trackSearch(input.value, { auto: true, category: cat && cat.value ? cat.value : undefined });
    }
  }), true);

  // …and result pages reached with a query parameter.
  t.on('pv', safe(() => {
    if (!t.cfg.autoSearch || t.disabled.search) return;
    const sp = new win.URLSearchParams(win.location.search);
    const names = params();
    let found = null;
    sp.forEach((v, k) => { if (!found && v && names.indexOf(k.toLowerCase()) !== -1) found = v; });
    if (found) t.trackSearch(found, { auto: true });
  }));
}
