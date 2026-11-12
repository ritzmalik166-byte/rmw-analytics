import { redactText, cleanUrl } from '@rmw-analytics/shared/privacy';
import { now, safe, clip, NAME_RE } from '../core/util.js';

const INTERACTIVE = 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary,label,select,[data-track]';
const DOWNLOAD_RE = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|mp3|mp4|dmg|exe|apk|rar|7z)$/i;
const RAGE_COUNT = 3;
const RAGE_MS = 700;
const RAGE_PX = 30;
const CONTACT = { 'tel:': 'phone_click', 'sms:': 'phone_click', 'mailto:': 'email_click', 'whatsapp:': 'whatsapp_click' };

/** Short, stable-ish CSS selector: tag#id or tag.c1.c2, prefixed with the nearest ancestor id. */
export function selector(el) {
  if (!el || !el.tagName) return null;
  const part = (n) => {
    const tag = n.tagName.toLowerCase();
    if (n.id && !/\d{4,}/.test(n.id)) return `${tag}#${n.id}`;
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter((c) => c && !/\d{3,}|^(css|sc|jsx|svelte)-/.test(c)).slice(0, 2) : [];
    return tag + (cls.length ? `.${cls.join('.')}` : '');
  };
  let s = part(el);
  if (!/#/.test(s)) {
    let p = el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      if (p.id && !/\d{4,}/.test(p.id)) { s = `#${p.id} ${s}`; break; }
    }
  }
  return clip(s, 200);
}

export function elementText(el) {
  const tag = el.tagName;
  let txt = tag === 'INPUT' ? el.value : el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '';
  txt = String(txt).replace(/\s+/g, ' ').trim();
  return txt ? clip(redactText(txt), 80) : null;
}

/** Classify a link: outbound / download / contact / internal. */
export function classifyLink(href, loc) {
  let u;
  try { u = new URL(href, loc.href); } catch (e) { return null; }
  if (/^(mailto|tel|sms):/.test(u.protocol)) return { type: 'contact', scheme: u.protocol };
  if (/^(wa\.me|api\.whatsapp\.com)$/.test(u.hostname)) return { type: 'contact', scheme: 'whatsapp:' };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const m = u.pathname.match(DOWNLOAD_RE);
  if (m) return { type: 'download', href: cleanUrl(u.href), ext: m[1].toLowerCase() };
  const strip = (h) => h.replace(/^www\./, '');
  if (strip(u.hostname) !== strip(loc.hostname)) return { type: 'outbound', href: cleanUrl(u.href), domain: strip(u.hostname) };
  return { type: 'internal', href: u.pathname };
}

export function installClicks(t) {
  const { win } = t;
  const doc = win.document;
  let recent = [];
  let watching = false;

  const coords = (e) => {
    const w = Math.max(doc.documentElement.scrollWidth || 0, win.innerWidth || 0) || 1;
    return { x: Math.round(((e.pageX || 0) / w) * 1000), y: Math.round(e.pageY || 0) };
  };

  /** Dead click: no DOM change or navigation within 1 s of clicking a non-interactive element. */
  function watchDead(e, el) {
    if (watching || !win.MutationObserver) return;
    watching = true;
    const href = win.location.href;
    let changed = false;
    const mo = new win.MutationObserver(() => { changed = true; });
    mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    win.setTimeout(safe(() => {
      mo.disconnect();
      watching = false;
      if (!changed && win.location.href === href) t.track('dead_click', Object.assign({ sel: selector(el), tag: el.tagName.toLowerCase() }, coords(e)));
    }), 1000);
  }

  doc.addEventListener('click', safe((e) => {
    const target = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (!target) return;
    const heat = t.cfg.heatmaps && !t.disabled.heatmaps;
    const el = target.closest(INTERACTIVE);
    const xy = heat ? coords(e) : null;

    // Rage clicks: ≥3 clicks within 700 ms and 30 px.
    const ts = now();
    recent = recent.filter((c) => ts - c.t < RAGE_MS);
    recent.push({ t: ts, x: e.clientX, y: e.clientY });
    if (recent.length >= RAGE_COUNT && recent.every((c) => Math.abs(c.x - e.clientX) < RAGE_PX && Math.abs(c.y - e.clientY) < RAGE_PX)) {
      recent = [];
      t.track('rage_click', Object.assign({ sel: selector(el || target), text: elementText(el || target), count: RAGE_COUNT }, coords(e)));
    }

    if (!el) {
      if (heat) {
        t.track('click', Object.assign({ hm: 1, sel: selector(target), tag: target.tagName.toLowerCase() }, xy));
        watchDead(e, target);
      }
      return;
    }

    // Declarative custom events: <button data-track="contact_click" data-track-project="sky">
    const custom = el.getAttribute('data-track');
    if (custom && NAME_RE.test(custom)) {
      const props = {};
      for (const a of el.attributes) {
        if (a.name.indexOf('data-track-') === 0) props[a.name.slice(11).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = clip(a.value, 200);
      }
      t.track(custom, props);
    }

    if (t.disabled.clicks) return;
    const base = Object.assign({ tag: el.tagName.toLowerCase(), text: elementText(el), sel: selector(el) }, xy);
    const a = el.closest('a[href]');
    if (a) {
      const link = classifyLink(a.getAttribute('href'), win.location);
      if (link && (link.type === 'download' || a.hasAttribute('download'))) {
        t.track('file_download', Object.assign(base, { href: link.href || clip(a.href, 500), ext: link.ext || 'file' }), { urgent: true });
        return;
      }
      if (link && link.type === 'outbound') {
        t.track('outbound_click', Object.assign(base, { href: link.href, domain: link.domain }), { urgent: true });
        return;
      }
      if (link && link.type === 'contact') {
        // tel:/mailto:/WhatsApp get their own events so they can be counted as conversions.
        // Only the link type is sent, never the number or address itself.
        base.href = link.scheme;
        t.track(CONTACT[link.scheme] || 'contact_click', base, { urgent: true });
        return;
      }
      if (link) base.href = clip(link.href, 300);
    }
    t.track('click', base);
  }), { capture: true, passive: true });
}
