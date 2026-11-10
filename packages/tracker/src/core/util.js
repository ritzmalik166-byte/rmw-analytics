export const now = () => Date.now();

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random lower-case alphanumeric string (crypto when available). */
export function rid(len) {
  let bytes = null;
  try { bytes = globalThis.crypto.getRandomValues(new Uint8Array(len)); } catch (e) { /* fallback below */ }
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[(bytes ? bytes[i] : Math.floor(Math.random() * 256)) % 36];
  return s;
}

export const eventId = (t) => `e_${t.toString(36)}${rid(8)}`;

/** Safe wrapper around Web Storage (throws in private modes / sandboxed iframes). */
export function store(win, name) {
  try {
    const s = win[name];
    s.setItem('__rmwa', '1');
    s.removeItem('__rmwa');
    return {
      get: (k) => { try { return s.getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { s.setItem(k, v); } catch (e) { /* quota */ } },
      del: (k) => { try { s.removeItem(k); } catch (e) { /* ignore */ } },
    };
  } catch (e) {
    return null;
  }
}

export const clip = (v, n) => (v == null ? v : String(v).slice(0, n));

/** FNV-1a 32-bit hash (sampling). */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const NAME_RE = /^[a-z0-9_.:-]{1,64}$/i;

/** Prefix ("/admin") or glob ("/account/*") path match. */
export function pathMatch(path, pattern) {
  if (!pattern) return false;
  if (pattern.indexOf('*') !== -1) {
    const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(path);
  }
  return path === pattern || path.indexOf(pattern.charAt(pattern.length - 1) === '/' ? pattern : `${pattern}/`) === 0;
}

/** Run a function, swallowing errors: the tracker must never break the host page. */
export function safe(fn) {
  return function wrapped() {
    try { return fn.apply(this, arguments); } catch (e) { return undefined; }
  };
}
