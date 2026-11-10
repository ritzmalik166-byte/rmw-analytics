import { isSensitiveField, maskEmail, maskPhone, maskValue } from '@rmw-analytics/shared/privacy';
import { now, safe, clip } from '../core/util.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function formKey(form, doc) {
  return clip(form.getAttribute('id') || form.getAttribute('name') || form.getAttribute('data-analytics-form') || `form_${Array.prototype.indexOf.call(doc.forms, form)}`, 120);
}

export function formName(form) {
  const h = form.querySelector('legend,h1,h2,h3,h4');
  const n = form.getAttribute('aria-label') || form.getAttribute('data-analytics-form') || form.getAttribute('name') || form.getAttribute('id') || (h && h.textContent);
  return n ? clip(String(n).replace(/\s+/g, ' ').trim(), 80) : null;
}

function maskFor(name, v) {
  if (/mail/i.test(name)) return maskEmail(v);
  if (/phone|mobile|tel|whatsapp/i.test(name)) return maskPhone(v);
  return maskValue(v);
}

/**
 * Collect allowlisted field values for lead capture. Only fields named in the allowlist (form attribute
 * or trackForm options) AND in the site's configured leadFields are read; sensitive fields never are.
 */
export function collectFields(form, allow, siteFields, mask) {
  const site = (siteFields || []).map(norm);
  const allowed = allow.map(norm).filter((n) => !site.length || site.indexOf(n) !== -1);
  const masked = (mask || []).map(norm);
  const out = {};
  const els = form.elements || [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const name = el.getAttribute && (el.getAttribute('name') || el.getAttribute('id'));
    if (!name || allowed.indexOf(norm(name)) === -1 || isSensitiveField(el)) continue;
    if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
    if (el.tagName === 'BUTTON' || el.type === 'submit' || el.type === 'button') continue;
    const v = String(el.value == null ? '' : el.value).trim();
    if (!v) continue;
    out[name] = clip(masked.indexOf(norm(name)) !== -1 ? maskFor(name, v) : v, /message/i.test(name) ? 2000 : 200);
  }
  return out;
}

export function installForms(t) {
  const { win } = t;
  const doc = win.document;
  const registered = new WeakMap(); // form → { fields, mask } from analytics.trackForm()
  let started = {};
  let viewed = {};
  let errored = {};
  let observer = null;
  const seen = new WeakSet();

  const enabled = () => t.cfg.autoForms && !t.disabled.forms;
  const props = (form) => ({ form: formKey(form, doc), formName: formName(form) });
  const skip = (form) => !form || form.tagName !== 'FORM' || form.hasAttribute('data-analytics-ignore') || (t.searchInput && t.searchInput(form));

  const scan = safe(() => {
    if (!win.IntersectionObserver) return;
    if (!observer) {
      observer = new win.IntersectionObserver(safe((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting || !enabled() || skip(en.target)) continue;
          const p = props(en.target);
          if (viewed[p.form]) continue;
          viewed[p.form] = 1;
          t.track('form_view', p);
        }
      }), { threshold: 0.3 });
    }
    for (const f of doc.forms) if (!seen.has(f)) { seen.add(f); observer.observe(f); }
  });

  t.on('pv', () => {
    started = {};
    viewed = {};
    errored = {};
    if (observer) { observer.disconnect(); observer = null; }
    win.setTimeout(() => { for (const f of doc.forms) seen.delete(f); scan(); }, 300);
  });

  doc.addEventListener('focusin', safe((e) => {
    const el = e.target;
    const form = el && el.form;
    if (!enabled() || skip(form) || !/INPUT|SELECT|TEXTAREA/.test(el.tagName)) return;
    const p = props(form);
    if (started[p.form]) return;
    started[p.form] = now();
    t.track('form_start', p);
  }), true);

  doc.addEventListener('invalid', safe((e) => {
    const el = e.target;
    const form = el && el.form;
    if (!enabled() || skip(form)) return;
    const p = props(form);
    const field = clip(el.getAttribute('name') || el.getAttribute('id') || el.tagName.toLowerCase(), 64);
    if (errored[`${p.form}|${field}`]) return;
    errored[`${p.form}|${field}`] = 1;
    t.track('form_error', Object.assign(p, { field }));
  }), true);

  doc.addEventListener('submit', safe((e) => {
    const form = e.target;
    if (skip(form)) return;
    const reg = registered.get(form);
    const declared = form.hasAttribute('data-analytics-lead');
    if (!enabled() && !reg && !declared) return;
    const p = props(form);
    p.dur = started[p.form] ? now() - started[p.form] : 0;
    p.fieldCount = form.elements ? form.elements.length : 0;
    if (t.cfg.leadCapture && (declared || reg)) {
      const allow = reg && reg.fields ? reg.fields : list(form.getAttribute('data-analytics-fields'));
      const mask = (reg && reg.mask) || list(form.getAttribute('data-analytics-mask'));
      const fields = collectFields(form, allow, t.cfg.leadFields, mask);
      if (Object.keys(fields).length) p.fields = fields;
    }
    delete started[p.form];
    t.track('form_submit', p, { urgent: true, beacon: true });
  }), true);

  /** analytics.trackForm(formOrSelector, { fields: [...], mask: [...] }) */
  t.trackForm = safe((target, opts) => {
    const form = typeof target === 'string' ? doc.querySelector(target) : target;
    if (!form || form.tagName !== 'FORM') return false;
    registered.set(form, { fields: (opts && opts.fields) || [], mask: (opts && opts.mask) || [] });
    return true;
  });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', scan);
  else scan();
}
