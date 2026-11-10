import express from 'express';
import { env } from '../config/env.js';
import { col } from '../config/db.js';
import { limiters } from '../middleware/security.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, ok, validate, clientIp } from '../utils/http.js';
import { registerSchema, loginSchema, changePasswordSchema, acceptInviteSchema } from '../validators/schemas.js';
import * as auth from '../services/authService.js';
import { audit } from '../services/auditService.js';
import { sha256 } from '../utils/crypto.js';

const router = express.Router();

const cookieOpts = (expires) => ({ httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/', expires, ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}) });

async function startSession(req, res, user) {
  const { token, expiresAt } = await auth.createSession(user._id, { userAgent: req.get('user-agent'), ip: clientIp(req) });
  res.cookie(env.SESSION_COOKIE_NAME, token, cookieOpts(expiresAt));
}

/** Shape of the signed-in context consumed by the dashboard. */
export function presentMe(req) {
  return {
    user: { id: String(req.user._id), email: req.user.email, fullName: req.user.fullName },
    org: { id: String(req.org._id), name: req.org.name, slug: req.org.slug, settings: req.org.settings || {} },
    role: req.role,
    permissions: req.permissions,
    organizations: req.memberships.map((m) => ({ id: String(m.org._id), name: m.org.name, role: m.role })),
  };
}

/** First-run detection: the login screen offers "create the first account" when no users exist. */
router.get('/setup-status', asyncHandler(async (_req, res) => {
  const users = await col('users').estimatedDocumentCount();
  ok(res, { needsSetup: users === 0, signupOpen: env.ALLOW_SIGNUP || users === 0 });
}));

router.post('/register', limiters.register, asyncHandler(async (req, res) => {
  const body = validate(registerSchema, req.body);
  const { user, org } = await auth.register(body);
  await startSession(req, res, user);
  await audit({ ...req, user, org }, 'auth.register', { target: user.email });
  ok(res, { userId: String(user._id), orgId: String(org._id) }, 'Account created', 201);
}));

router.post('/login', limiters.login, asyncHandler(async (req, res) => {
  const body = validate(loginSchema, req.body);
  try {
    const user = await auth.verifyCredentials(body.email, body.password);
    await startSession(req, res, user);
    await audit({ ...req, user }, 'auth.login');
    ok(res, { userId: String(user._id) }, 'Signed in');
  } catch (err) {
    await audit(req, 'auth.login_failed', { meta: { emailHash: sha256(body.email).slice(0, 16) } });
    throw err;
  }
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (token) await auth.revokeSession(token);
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieOpts(new Date(0)));
  ok(res, null, 'Signed out');
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => ok(res, presentMe(req))));

router.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const body = validate(changePasswordSchema, req.body);
  await auth.changePassword(req.user._id, body.currentPassword, body.newPassword, req.session._id);
  await audit(req, 'auth.password_changed');
  ok(res, null, 'Password updated. Other sessions were signed out.');
}));

router.post('/accept-invite', limiters.register, asyncHandler(async (req, res) => {
  const body = validate(acceptInviteSchema, req.body);
  const user = await auth.acceptInvite(body);
  await startSession(req, res, user);
  await audit({ ...req, user }, 'auth.invite_accepted');
  ok(res, { userId: String(user._id) }, 'Welcome aboard');
}));

export default router;
