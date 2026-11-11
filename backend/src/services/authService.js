import bcrypt from 'bcryptjs';
import { col, ObjectId } from '../config/db.js';
import { env } from '../config/env.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { badRequest, conflict, unauthorized, forbidden } from '../utils/errors.js';
import { DEFAULT_TZ } from '../utils/dates.js';

const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 4);

export const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS);

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';

async function uniqueSlug(name) {
  const base = slugify(name);
  for (let i = 0; i < 20; i += 1) {
    const slug = i ? `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}` : base;
    if (!(await col('organizations').findOne({ slug }))) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createOrganization(name, { timezone = DEFAULT_TZ } = {}) {
  const doc = { name, slug: await uniqueSlug(name), settings: { timezone }, createdAt: new Date() };
  const { insertedId } = await col('organizations').insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function assertMobileFree(mobile, exceptUserId) {
  if (!mobile) return;
  const clash = await col('users').findOne({ mobile, ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}) });
  if (clash) throw conflict('This mobile number is already used by another account', 'MOBILE_TAKEN');
}

export async function createUser({ email, password, fullName, mobile = null }) {
  const normalized = String(email).trim().toLowerCase();
  if (await col('users').findOne({ email: normalized })) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
  await assertMobileFree(mobile);
  const doc = { email: normalized, passwordHash: await hashPassword(password), fullName, isActive: true, createdAt: new Date(), lastLoginAt: null, ...(mobile ? { mobile } : {}) };
  const { insertedId } = await col('users').insertOne(doc);
  return { _id: insertedId, ...doc };
}

export const addMembership = (orgId, userId, role) => col('memberships').updateOne(
  { orgId, userId },
  { $set: { role }, $setOnInsert: { orgId, userId, createdAt: new Date() } },
  { upsert: true },
);

/** Sign-up: allowed when ALLOW_SIGNUP or when the platform has no users yet (first-run bootstrap). */
export async function register({ email, password, fullName, organization, mobile }) {
  const anyUser = await col('users').estimatedDocumentCount();
  if (!env.ALLOW_SIGNUP && anyUser > 0) throw forbidden('Self-service sign-up is disabled. Ask an administrator for an invite.', 'SIGNUP_DISABLED');
  const user = await createUser({ email, password, fullName, mobile });
  const org = await createOrganization(organization || `${fullName}'s organisation`);
  await addMembership(org._id, user._id, 'owner');
  return { user, org };
}

export async function verifyCredentials(email, password) {
  const user = await col('users').findOne({ email: String(email).trim().toLowerCase() });
  // Always run bcrypt so response time does not reveal whether the email exists.
  const okPw = await bcrypt.compare(String(password), user?.passwordHash || DUMMY_HASH);
  if (!user || !okPw) throw unauthorized('Incorrect email or password', 'BAD_CREDENTIALS');
  if (!user.isActive) throw forbidden('This account is disabled', 'ACCOUNT_DISABLED');
  return user;
}

/** Create a login session; only the SHA-256 of the token is stored. */
export async function createSession(userId, { userAgent, ip } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  await col('authSessions').insertOne({
    tokenHash: sha256(token), userId, createdAt: new Date(), lastUsedAt: new Date(), expiresAt,
    userAgent: String(userAgent || '').slice(0, 200), ipHash: ip ? sha256(ip).slice(0, 16) : null,
  });
  await col('users').updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export async function resolveSession(token) {
  if (!token || token.length > 200) return null;
  const s = await col('authSessions').findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() }, revokedAt: null });
  if (!s) return null;
  const user = await col('users').findOne({ _id: s.userId, isActive: true }, { projection: { passwordHash: 0 } });
  if (!user) return null;
  // Touch at most once a minute to avoid a write per request.
  if (Date.now() - new Date(s.lastUsedAt).getTime() > 60_000) {
    col('authSessions').updateOne({ _id: s._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { session: s, user };
}

export const revokeSession = (token) => col('authSessions').updateOne({ tokenHash: sha256(token) }, { $set: { revokedAt: new Date() } });
export const revokeAllSessions = (userId, exceptId) => col('authSessions').updateMany({ userId, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { $set: { revokedAt: new Date() } });

export async function changePassword(userId, currentPassword, newPassword, currentSessionId) {
  const user = await col('users').findOne({ _id: userId });
  if (!user || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) throw badRequest('Current password is incorrect', 'BAD_PASSWORD');
  await col('users').updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } });
  await revokeAllSessions(userId, currentSessionId);
}

/** Organisations the user belongs to, with their role. */
export async function membershipsFor(userId) {
  const ms = await col('memberships').find({ userId }).toArray();
  if (!ms.length) return [];
  const orgs = await col('organizations').find({ _id: { $in: ms.map((m) => m.orgId) } }).toArray();
  return ms.map((m) => ({ role: m.role, org: orgs.find((o) => o._id.equals(m.orgId)) })).filter((m) => m.org);
}

// ─── Invites ────────────────────────────────────────────────────────────────
export async function createInvite({ orgId, email, role, invitedBy }) {
  const token = randomToken(24);
  await col('invites').insertOne({ orgId, email: String(email).trim().toLowerCase(), role, invitedBy, tokenHash: sha256(token), createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400_000) });
  return { token, url: `${env.APP_URL}/accept-invite?token=${token}` };
}

export async function acceptInvite({ token, fullName, password }) {
  const invite = await col('invites').findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() }, usedAt: null });
  if (!invite) throw badRequest('This invite link is invalid or has expired', 'INVITE_INVALID');
  let user = await col('users').findOne({ email: invite.email });
  if (!user) user = await createUser({ email: invite.email, password, fullName });
  await addMembership(invite.orgId, user._id, invite.role);
  await col('invites').updateOne({ _id: invite._id }, { $set: { usedAt: new Date(), userId: user._id } });
  return user;
}

export const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));
