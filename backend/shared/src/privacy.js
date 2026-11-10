/**
 * Privacy helpers shared by the tracker (bundled, so this stays dependency-free and small) and the API.
 * The API re-applies every check: the client is never trusted to have filtered.
 */

/** Field names / ids that must never be captured. */
export const SENSITIVE_FIELD_RE = /pass(word|wd|code)?|pwd|otp|one.?time|cvv|cvc|csc|security.?code|card.?(num|no)|cc.?(num|no|number)|credit.?card|cardnumber|expiry|exp.?(date|month|year)|iban|swift|routing|account.?(num|no)|ssn|social.?sec|aadh?aar|\bpan\b|pan.?(no|num|card)|passport|token|secret|api.?key|private.?key|\bpin\b|mpin|auth|session|csrf|xsrf|captcha/i;

const SENSITIVE_TYPES = ['password', 'hidden', 'file'];
const SENSITIVE_AUTOCOMPLETE = /cc-|one-time-code|current-password|new-password/i;

/** True when a form field must be ignored entirely. Accepts a DOM element or a plain descriptor. */
export function isSensitiveField(field) {
  if (!field) return true;
  const type = String(field.type || '').toLowerCase();
  if (SENSITIVE_TYPES.indexOf(type) !== -1) return true;
  const ac = String(field.autocomplete || (field.getAttribute && field.getAttribute('autocomplete')) || '');
  if (SENSITIVE_AUTOCOMPLETE.test(ac)) return true;
  const names = [field.name, field.id, field.key].filter(Boolean).join(' ');
  return SENSITIVE_FIELD_RE.test(names);
}

export const isSensitiveKey = (key) => SENSITIVE_FIELD_RE.test(String(key || ''));

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE_RE = /(?:\+?\d{1,3}[ -]?)?(?:\(?\d{2,5}\)?[ -]?)?\d{3,5}[ -]?\d{4,5}\b/g;
const digits = (m) => m.replace(/\D/g, '').length;

/** Scrub emails, card-like and phone-like numbers out of free text (search queries, error messages, props). */
export function redactText(value) {
  if (value == null) return value;
  return String(value)
    .replace(EMAIL_RE, '[email]')
    .replace(CARD_RE, (m) => (digits(m) >= 13 ? '[number]' : m))
    .replace(PHONE_RE, (m) => (digits(m) >= 8 ? '[phone]' : m));
}

/** Redact sensitive query parameters (tokens, emails…) from a URL while keeping UTM and normal params. */
export function cleanUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const keys = [];
    u.searchParams.forEach((_v, k) => keys.push(k));
    for (const k of keys) {
      const v = u.searchParams.get(k) || '';
      if (isSensitiveKey(k) || /email|phone|mobile|^code$|^key$/i.test(k) || /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v)) {
        u.searchParams.set(k, 'redacted');
      }
    }
    if (/token|access|id_token/i.test(u.hash)) u.hash = '';
    return u.toString();
  } catch {
    return String(url).slice(0, 2000);
  }
}

/** "9876543221" → "********21" */
export function maskPhone(phone) {
  if (!phone) return phone;
  const d = String(phone).replace(/\D/g, '');
  if (d.length <= 2) return '**';
  return '*'.repeat(d.length - 2) + d.slice(-2);
}

/** "rahul@example.com" → "r****@example.com" */
export function maskEmail(email) {
  if (!email) return email;
  if (!String(email).includes('@')) return '****';
  const [user, domain] = String(email).split('@');
  return `${user[0] || ''}${'*'.repeat(Math.max(3, user.length - 1))}@${domain}`;
}

/** Generic masking for other PII values. */
export function maskValue(v) {
  if (v == null || v === '') return v;
  const s = String(v);
  return s.length <= 2 ? '**' : `${s[0]}${'*'.repeat(Math.min(8, s.length - 2))}${s.slice(-1)}`;
}

const PLAIN_LEAD_FIELDS = /city|state|country|budget|project|property|bhk|interest|subject|source|requirement|type/i;

/** Mask a lead's fields for viewers without the `leads:pii` permission. */
export function maskLeadFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/mail/i.test(k)) out[k] = maskEmail(v);
    else if (/phone|mobile|tel|whatsapp/i.test(k)) out[k] = maskPhone(v);
    else if (PLAIN_LEAD_FIELDS.test(k)) out[k] = v;
    else out[k] = maskValue(v);
  }
  return out;
}
