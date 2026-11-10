import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveField, redactText, maskPhone, maskEmail, cleanUrl, classifyChannel, normalizeQuery, batchSchema, sourceName, maskLeadFields } from '../src/index.js';

test('sensitive fields are detected by type, name and autocomplete', () => {
  assert.ok(isSensitiveField({ type: 'password', name: 'x' }));
  for (const name of ['otp', 'cvv', 'card_number', 'ccnum', 'api_key', 'aadhaar', 'pan_no', 'pin', 'auth_token', 'user_password']) {
    assert.ok(isSensitiveField({ type: 'text', name }), name);
  }
  assert.ok(isSensitiveField({ type: 'text', name: 'x', autocomplete: 'cc-number' }));
  for (const name of ['name', 'email', 'phone', 'city', 'company', 'message', 'budget']) {
    assert.ok(!isSensitiveField({ type: 'text', name }), name);
  }
});

test('free text is scrubbed of emails, phones and card numbers', () => {
  assert.equal(redactText('call me 9876543210 or a@b.com'), 'call me [phone] or [email]');
  assert.equal(redactText('card 4111 1111 1111 1111'), 'card [number]');
  assert.equal(redactText('3 BHK in Sector 150 under 2 crore'), '3 BHK in Sector 150 under 2 crore');
});

test('masking', () => {
  assert.equal(maskPhone('+91 98765 43221'), '**********21');
  assert.equal(maskEmail('rahul@example.com'), 'r****@example.com');
  assert.deepEqual(maskLeadFields({ email: 'rahul@example.com', phone: '9876543221', city: 'Noida' }), { email: 'r****@example.com', phone: '********21', city: 'Noida' });
});

test('cleanUrl redacts sensitive params and keeps utm', () => {
  const u = cleanUrl('https://x.com/p?utm_source=google&token=abc&email=a@b.com&q=3bhk');
  assert.match(u, /utm_source=google/);
  assert.match(u, /q=3bhk/);
  assert.doesNotMatch(u, /abc|a@b\.com|a%40b/);
});

test('channel classification', () => {
  assert.equal(classifyChannel({}), 'direct');
  assert.equal(classifyChannel({ referrer: 'https://www.google.co.in/' }), 'organic_search');
  assert.equal(classifyChannel({ referrer: 'https://www.google.com/', clickIds: ['gclid'] }), 'paid_search');
  assert.equal(classifyChannel({ utm: { source: 'facebook', medium: 'cpc' } }), 'paid_social');
  assert.equal(classifyChannel({ utm: { source: 'google', medium: 'cpc' } }), 'paid_search');
  assert.equal(classifyChannel({ referrer: 'https://l.instagram.com/' }), 'organic_social');
  assert.equal(classifyChannel({ referrer: 'https://chatgpt.com/' }), 'ai_assistant');
  assert.equal(classifyChannel({ utm: { medium: 'email' } }), 'email');
  assert.equal(classifyChannel({ referrer: 'https://blog.example.org/post' }), 'referral');
  assert.equal(classifyChannel({ referrer: 'https://shop.mysite.com/', host: 'mysite.com' }), 'internal');
});

test('source names', () => {
  assert.equal(sourceName('google.co.in'), 'Google');
  assert.equal(sourceName('t.co'), 'X (Twitter)');
  assert.equal(sourceName(null), 'Direct');
  assert.equal(sourceName('example.org'), 'example.org');
  assert.equal(sourceName('google.com', 'newsletter'), 'newsletter');
});

test('query normalisation groups variants', () => {
  assert.equal(normalizeQuery('  3 BHK   Noida!! '), '3 bhk noida');
});

test('batch schema validates and rejects junk', () => {
  const ok = batchSchema.safeParse({ siteId: 'site_abc12345', ctx: { vid: 'v_abc12345', sid: 's_abc123' }, events: [{ id: 'e_abc123', n: 'page_view', t: Date.now(), p: { pa: '/' }, pr: { a: 1, b: ['x'], c: { d: 'e' } } }] });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
  assert.ok(!batchSchema.safeParse({ siteId: 'x', ctx: {}, events: [] }).success);
  assert.ok(!batchSchema.safeParse({ siteId: 'site_abc12345', ctx: { vid: 'v_abc12345', sid: 's_abc123' }, events: [{ id: 'e_abc123', n: 'bad name!', t: 1 }] }).success);
  assert.ok(!batchSchema.safeParse({ siteId: 'site_abc12345', ctx: { vid: 'v_abc12345', sid: 's_abc123', evil: 1 }, events: [{ id: 'e_abc123', n: 'x', t: 1 }] }).success);
});
