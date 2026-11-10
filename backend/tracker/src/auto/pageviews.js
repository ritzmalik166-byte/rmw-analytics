import { safe } from '../core/util.js';

/** Path used for page identity: pathname plus the route of hash routers ("#/listing/42"). */
export function pathKey(loc) {
  const h = loc.hash || '';
  return loc.pathname + (h.indexOf('#/') === 0 ? h.split('?')[0] : '');
}

/**
 * Page views for classic and single-page apps. History API calls (React Router, Next.js, Vue Router,
 * Angular) and popstate/hashchange produce: page_leave (previous view) → route_change → page_view.
 */
export function installPageviews(t) {
  const { win } = t;
  const loc = win.location;
  let cur = null; // { id, key, url }

  const view = safe((nav, props) => {
    const key = pathKey(loc);
    if (cur && nav !== 'manual' && cur.key === key) return;
    const prev = cur;
    if (prev) t.leave(true);
    if (prev && nav === 'spa') t.track('route_change', { from: prev.key, to: key });
    const id = t.track('page_view', Object.assign({ nav: nav === 'manual' ? 'spa' : nav }, props), { full: true, ref: prev ? prev.url : win.document.referrer });
    if (!id) return;
    cur = { id, key, url: loc.href };
    t.emit('pv', cur);
  });

  const onNav = () => win.setTimeout(() => view('spa'), t.navDelay); // let frameworks update document.title

  const h = win.history;
  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = h[fn];
    if (typeof orig !== 'function') return;
    h[fn] = function patched() {
      const r = orig.apply(this, arguments);
      try { onNav(); } catch (e) { /* never break navigation */ }
      return r;
    };
  });
  win.addEventListener('popstate', onNav);
  win.addEventListener('hashchange', onNav);

  t.current = () => cur;
  t.view = view;
}
