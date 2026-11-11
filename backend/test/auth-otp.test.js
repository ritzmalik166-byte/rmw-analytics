import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, client } from './helpers.js';

let ctx;
let sms;
let owner;
const sent = []; // { number, otp }

before(async () => {
  // Fake SMS provider: records the number and code from the query string.
  sms = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://sms.test');
    const otp = (u.searchParams.get('message') || '').match(/\d{6}/)?.[0];
    sent.push({ number: u.searchParams.get('number'), otp });
    res.end('ok');
  });
  await new Promise((r) => sms.listen(0, r));
  Object.assign(process.env, {
    SMS_API_URL: `http://127.0.0.1:${sms.address().port}/send`, SMS_API_KEY: 'k', SMS_SENDER_ID: 'TEST',
    SMS_OTP_TEMPLATE: '{otp} is your code', OTP_RESEND_COOLDOWN_SECONDS: '0',
  });
  ctx = await setup();
  owner = client(ctx.base);
  const reg = await owner.post('/auth/register', { fullName: 'Super One', email: 'super@example.com', password: 'Sup3rSecretPass', organization: 'RMW' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
});

after(async () => { sms?.close(); await ctx?.teardown(); });

const lastOtp = () => sent[sent.length - 1].otp;

test('super admin sets own mobile with OTP, then login needs an SMS code', async () => {
  const me0 = await owner.get('/auth/me');
  assert.equal(me0.data.roleLabel, 'Super Admin');
  const req = await owner.post('/auth/mobile/request', { mobile: '9876543210', currentPassword: 'Sup3rSecretPass' });
  assert.equal(req.status, 200, JSON.stringify(req.json));
  assert.equal(sent.at(-1).number, '9876543210');
  const bad = await owner.post('/auth/mobile/verify', { challenge: req.data.challenge, otp: '000000' === lastOtp() ? '111111' : '000000' });
  assert.equal(bad.status, 400);
  const ok = await owner.post('/auth/mobile/verify', { challenge: req.data.challenge, otp: lastOtp() });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  const anon = client(ctx.base);
  const step1 = await anon.post('/auth/login', { email: 'super@example.com', password: 'Sup3rSecretPass' });
  assert.equal(step1.status, 200);
  assert.equal(step1.data.otpRequired, true);
  assert.equal(anon.cookie(), '', 'no session before the code is verified');
  assert.equal((await anon.get('/auth/me')).status, 401);
  const step2 = await anon.post('/auth/login/verify', { challenge: step1.data.challenge, otp: lastOtp() });
  assert.equal(step2.status, 200, JSON.stringify(step2.json));
  assert.equal((await anon.get('/auth/me')).status, 200);
  const replay = await client(ctx.base).post('/auth/login/verify', { challenge: step1.data.challenge, otp: lastOtp() });
  assert.equal(replay.status, 400, 'a code works only once');
});

test('wrong codes are limited per challenge', async () => {
  const anon = client(ctx.base);
  const s = await anon.post('/auth/login', { email: 'super@example.com', password: 'Sup3rSecretPass' });
  for (let i = 0; i < 5; i += 1) await anon.post('/auth/login/verify', { challenge: s.data.challenge, otp: '123450' === lastOtp() ? '123451' : '123450' });
  const blocked = await anon.post('/auth/login/verify', { challenge: s.data.challenge, otp: lastOtp() });
  assert.equal(blocked.status, 429);
});

test('super admin creates an admin; admin can create analysts but not admins', async () => {
  const mk = await owner.post('/org/members', { fullName: 'Admin A', email: 'admin@example.com', mobile: '9811111111', password: 'AdminPass1234', role: 'admin' });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const dup = await owner.post('/org/members', { fullName: 'Dup', email: 'dup@example.com', mobile: '9811111111', password: 'AdminPass1234', role: 'viewer' });
  assert.equal(dup.json.errorCode, 'MOBILE_TAKEN');

  const admin = client(ctx.base);
  const s = await admin.post('/auth/login', { email: 'admin@example.com', password: 'AdminPass1234' });
  assert.equal(s.data.otpRequired, true);
  await admin.post('/auth/login/verify', { challenge: s.data.challenge, otp: lastOtp() });
  const me = await admin.get('/auth/me');
  assert.equal(me.data.roleLabel, 'Admin');

  const analyst = await admin.post('/org/members', { fullName: 'Ana Lyst', email: 'analyst@example.com', mobile: '9822222222', password: 'AnalystPass1', role: 'analyst' });
  assert.equal(analyst.status, 201);
  const noAdmin = await admin.post('/org/members', { fullName: 'Admin B', email: 'admin2@example.com', mobile: '9833333333', password: 'AdminPass1234', role: 'admin' });
  assert.equal(noAdmin.status, 403);

  const members = await owner.get('/org/members');
  const a = members.data.members.find((m) => m.email === 'admin@example.com');
  assert.equal(a.maskedMobile, '******1111');
  // Super admin resets the admin password without the old one; the admin is signed out.
  const reset = await owner.patch(`/org/members/${a.userId}/profile`, { newPassword: 'BrandNewPass99' });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.equal((await admin.get('/auth/me')).status, 401);
  const relog = await client(ctx.base).post('/auth/login', { email: 'admin@example.com', password: 'BrandNewPass99' });
  assert.equal(relog.data.otpRequired, true);
});
