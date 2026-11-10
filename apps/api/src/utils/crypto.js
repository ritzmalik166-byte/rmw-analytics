import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const hmacSha256 = (secret, value) => crypto.createHmac('sha256', secret).update(String(value)).digest('hex');

/** Lower-case alphanumeric random id (for siteId etc.). */
export function randomId(length = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// AES-256-GCM for recoverable PII (lead fields, identity ids). Key derived from PII_ENCRYPTION_KEY.
const piiKey = crypto.createHash('sha256').update(env.PII_ENCRYPTION_KEY).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', piiKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload) {
  const [v, iv, tag, data] = String(payload).split('.');
  if (v !== 'v1') throw new Error('Unsupported ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', piiKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export const encryptJson = (obj) => encrypt(JSON.stringify(obj));
export function decryptJson(payload) {
  try { return JSON.parse(decrypt(payload)); } catch { return null; }
}

/** Deterministic keyed hash for lookups (email dedupe, identity linking) without storing plaintext. */
export const lookupHash = (value) => hmacSha256(env.IDENTITY_HASH_SECRET, String(value).trim().toLowerCase());
