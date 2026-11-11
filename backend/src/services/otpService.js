/**
 * Mobile OTP for sign-in. Same SMS provider contract as the RMW CRM:
 *   GET SMS_API_URL?apikey=&senderid=&number=<10-digit IN number>&message=<DLT template with {otp}>
 * Only an HMAC of the code is stored; challenges expire after OTP_TTL_SECONDS.
 */
import crypto from 'node:crypto';
import { col } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { hmacSha256, randomToken, safeEqual, sha256 } from '../utils/crypto.js';
import { AppError, badRequest, tooMany } from '../utils/errors.js';

export const isSmsConfigured = () => Boolean(env.SMS_API_URL && env.SMS_API_KEY && env.SMS_SENDER_ID && env.SMS_OTP_TEMPLATE);

export const normalizeMobile = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return d.length >= 10 && d.length <= 15 ? d : null;
};
export const maskMobile = (m) => (m ? `******${String(m).slice(-4)}` : '');
const providerNumber = (m) => (m.length === 12 && m.startsWith('91') ? m.slice(2) : m);
const hashOtp = (challengeId, otp) => hmacSha256(env.SESSION_SECRET, `otp:${challengeId}:${otp}`);
const randomDigits = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');

async function sendSms(mobile, otp) {
  if (!isSmsConfigured()) throw new AppError('SMS service is not configured. Contact your administrator.', { status: 503, errorCode: 'OTP_PROVIDER_NOT_CONFIGURED' });
  const url = new URL(env.SMS_API_URL);
  url.searchParams.set('apikey', env.SMS_API_KEY);
  url.searchParams.set('senderid', env.SMS_SENDER_ID);
  url.searchParams.set('number', providerNumber(mobile));
  url.searchParams.set('message', env.SMS_OTP_TEMPLATE.replace('{otp}', otp));
  if (env.SMS_TEMPLATE_ID) url.searchParams.set('templateid', env.SMS_TEMPLATE_ID);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const body = (await res.text().catch(() => '')).split(otp).join('******').slice(0, 200);
    if (!res.ok) logger.error({ status: res.status, body, number: maskMobile(mobile) }, 'SMS provider error');
    return res.ok;
  } catch (err) {
    logger.error({ err: err.message, number: maskMobile(mobile) }, 'SMS provider request failed');
    return false;
  }
}

async function assertCanSend(mobile) {
  const last = await col('otpChallenges').find({ mobile }).sort({ createdAt: -1 }).limit(1).next();
  if (last) {
    const wait = Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - (Date.now() - last.createdAt.getTime()) / 1000);
    if (wait > 0) { const e = tooMany(`Please wait ${wait}s before requesting another code`, 'OTP_COOLDOWN'); e.details = { retryAfter: wait }; throw e; }
  }
  const recent = await col('otpChallenges').countDocuments({ mobile, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
  if (recent >= env.OTP_MAX_SENDS_PER_HOUR) throw tooMany('Too many codes requested for this number. Try again later.', 'OTP_SEND_LIMIT');
}

/** Send a code to `mobile` (purpose 'login' or 'mobile_change'). Returns the opaque challenge token. */
export async function startChallenge({ userId, mobile, purpose }) {
  await assertCanSend(mobile);
  const token = randomToken(24);
  const otp = randomDigits(env.OTP_LENGTH);
  const { insertedId } = await col('otpChallenges').insertOne({
    tokenHash: sha256(token), userId, mobile, purpose, otpHash: '', attempts: 0,
    createdAt: new Date(), expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000), consumedAt: null,
  });
  await col('otpChallenges').updateOne({ _id: insertedId }, { $set: { otpHash: hashOtp(insertedId, otp) } });
  if (!(await sendSms(mobile, otp))) {
    await col('otpChallenges').updateOne({ _id: insertedId }, { $set: { consumedAt: new Date(), sendFailed: true } });
    throw new AppError('We could not send the verification code. Please try again shortly.', { status: 502, errorCode: 'OTP_SEND_FAILED' });
  }
  return { challenge: token, maskedMobile: maskMobile(mobile), expiresIn: env.OTP_TTL_SECONDS, resendIn: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export const startLoginChallenge = (user) => startChallenge({ userId: user._id, mobile: user.mobile, purpose: 'login' });

const findChallenge = (token, purpose) => col('otpChallenges').findOne({ tokenHash: sha256(String(token || '')), consumedAt: null, purpose });

/** Resend: issues a fresh code on a new challenge for the same user and number. */
export async function resendChallenge(token, purpose = 'login') {
  const c = await findChallenge(token, purpose);
  if (!c) throw badRequest('This request has expired. Start again.', 'CHALLENGE_EXPIRED');
  const user = await col('users').findOne({ _id: c.userId, isActive: true });
  if (!user) throw badRequest('This request has expired. Start again.', 'CHALLENGE_EXPIRED');
  const next = await startChallenge({ userId: c.userId, mobile: c.mobile, purpose });
  await col('otpChallenges').updateOne({ _id: c._id }, { $set: { consumedAt: new Date(), superseded: true } });
  return next;
}

/** Verify a code; returns the challenge ({ userId, mobile }) on success. */
export async function verifyChallenge(token, otp, purpose = 'login') {
  const c = await findChallenge(token, purpose);
  if (!c) throw badRequest('This request has expired. Start again.', 'CHALLENGE_EXPIRED');
  if (c.expiresAt < new Date()) throw badRequest('This code has expired. Request a new one.', 'OTP_EXPIRED');
  if (c.attempts >= env.OTP_MAX_ATTEMPTS) throw tooMany('Too many incorrect attempts. Request a new code.', 'OTP_ATTEMPTS_EXCEEDED');
  const candidate = String(otp || '').replace(/\D/g, '');
  if (!candidate || !safeEqual(hashOtp(c._id, candidate), c.otpHash)) {
    await col('otpChallenges').updateOne({ _id: c._id }, { $inc: { attempts: 1 } });
    throw badRequest('Invalid or expired code', 'OTP_INVALID');
  }
  const done = await col('otpChallenges').updateOne({ _id: c._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  if (!done.modifiedCount) throw badRequest('This code was already used. Start again.', 'CHALLENGE_EXPIRED');
  return c;
}
