import express from 'express';
import { col, oid } from '../config/db.js';
import { canManageRole } from '../config/rbac.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler, ok, validate, parsePagination, pageMeta } from '../utils/http.js';
import { inviteSchema, memberRoleSchema, orgSettingsSchema, memberCreateSchema, memberUpdateSchema } from '../validators/schemas.js';
import { createInvite, createUser, addMembership, assertMobileFree, hashPassword } from '../services/authService.js';
import { maskMobile } from '../services/otpService.js';
import { ROLE_LABELS } from '../config/rbac.js';
import { audit } from '../services/auditService.js';
import { sendMail } from '../services/mailer.js';
import { forbidden, notFound, badRequest } from '../utils/errors.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => ok(res, { id: String(req.org._id), name: req.org.name, slug: req.org.slug, settings: req.org.settings || {} })));

router.patch('/', requirePermission('org:manage'), asyncHandler(async (req, res) => {
  const body = validate(orgSettingsSchema, req.body);
  if (body.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { throw badRequest('Unknown timezone', 'BAD_TZ'); }
  }
  const $set = {};
  if (body.name) $set.name = body.name;
  if (body.timezone) $set['settings.timezone'] = body.timezone;
  await col('organizations').updateOne({ _id: req.org._id }, { $set });
  await audit(req, 'org.updated', { meta: body });
  ok(res, null, 'Organisation updated');
}));

router.get('/members', asyncHandler(async (req, res) => {
  const ms = await col('memberships').find({ orgId: req.org._id }).toArray();
  const users = await col('users').find({ _id: { $in: ms.map((m) => m.userId) } }, { projection: { passwordHash: 0 } }).toArray();
  const invites = await col('invites').find({ orgId: req.org._id, usedAt: null, expiresAt: { $gt: new Date() } }).toArray();
  ok(res, {
    members: ms.map((m) => {
      const u = users.find((x) => x._id.equals(m.userId));
      return u && { userId: String(u._id), email: u.email, fullName: u.fullName, mobile: u.mobile || null, maskedMobile: maskMobile(u.mobile), role: m.role, roleLabel: ROLE_LABELS[m.role] || m.role, isActive: u.isActive, lastLoginAt: u.lastLoginAt, joinedAt: m.createdAt };
    }).filter(Boolean),
    invites: invites.map((i) => ({ id: String(i._id), email: i.email, role: i.role, expiresAt: i.expiresAt })),
  });
}));

/** Create an account directly (no invite link). Super Admin can create any role; Admin only Analyst / Viewer. */
router.post('/members', requirePermission('members:manage'), asyncHandler(async (req, res) => {
  const body = validate(memberCreateSchema, req.body);
  if (!canManageRole(req.role, body.role)) throw forbidden(`You cannot create ${ROLE_LABELS[body.role] || body.role} accounts`);
  const user = await createUser({ email: body.email, password: body.password, fullName: body.fullName, mobile: body.mobile });
  await addMembership(req.org._id, user._id, body.role);
  await audit(req, 'member.created', { target: user.email, meta: { role: body.role } });
  ok(res, { userId: String(user._id) }, `${ROLE_LABELS[body.role]} account created`, 201);
}));

router.post('/invites', requirePermission('members:manage'), asyncHandler(async (req, res) => {
  const body = validate(inviteSchema, req.body);
  if (!canManageRole(req.role, body.role)) throw forbidden('You cannot invite users with this role');
  const { url } = await createInvite({ orgId: req.org._id, email: body.email, role: body.role, invitedBy: req.user._id });
  const emailed = await sendMail({ to: body.email, subject: `You're invited to ${req.org.name} on RMW Analytics`, text: `${req.user.fullName} invited you to join ${req.org.name} as ${body.role}.\n\nAccept the invite (valid for 7 days):\n${url}` });
  await audit(req, 'member.invited', { target: body.email, meta: { role: body.role } });
  // The link is returned so admins can share it manually when SMTP is not configured.
  ok(res, { url, emailed }, emailed ? 'Invite sent' : 'Invite created — share the link with the user', 201);
}));

router.delete('/invites/:id', requirePermission('members:manage'), asyncHandler(async (req, res) => {
  await col('invites').deleteOne({ _id: oid(req.params.id), orgId: req.org._id });
  ok(res, null, 'Invite revoked');
}));

async function targetMembership(req) {
  const userId = oid(req.params.userId);
  const m = userId && (await col('memberships').findOne({ orgId: req.org._id, userId }));
  if (!m) throw notFound('Member not found');
  if (m.userId.equals(req.user._id)) throw forbidden('You cannot change your own membership');
  if (!canManageRole(req.role, m.role)) throw forbidden('You cannot manage this member');
  return m;
}

/** Edit a member's name, mobile, active state, or set a new password (no old password needed). */
router.patch('/members/:userId/profile', requirePermission('members:manage'), asyncHandler(async (req, res) => {
  const body = validate(memberUpdateSchema, req.body);
  const m = await targetMembership(req);
  const $set = {};
  if (body.fullName) $set.fullName = body.fullName;
  if (body.mobile) { await assertMobileFree(body.mobile, m.userId); $set.mobile = body.mobile; }
  if (body.isActive !== undefined) $set.isActive = body.isActive;
  if (body.newPassword) { $set.passwordHash = await hashPassword(body.newPassword); $set.passwordChangedAt = new Date(); }
  if (!Object.keys($set).length) throw badRequest('Nothing to update');
  await col('users').updateOne({ _id: m.userId }, { $set });
  if (body.newPassword || body.isActive === false) await col('authSessions').updateMany({ userId: m.userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await audit(req, 'member.updated', { target: String(m.userId), meta: { fields: Object.keys(body).filter((k) => k !== 'newPassword'), passwordReset: Boolean(body.newPassword) } });
  ok(res, null, 'Member updated');
}));

router.patch('/members/:userId', requirePermission('members:manage'), asyncHandler(async (req, res) => {
  const { role } = validate(memberRoleSchema, req.body);
  const m = await targetMembership(req);
  if (!canManageRole(req.role, role)) throw forbidden('You cannot assign this role');
  await col('memberships').updateOne({ _id: m._id }, { $set: { role } });
  await audit(req, 'member.role_changed', { target: String(m.userId), meta: { from: m.role, to: role } });
  ok(res, null, 'Role updated');
}));

router.delete('/members/:userId', requirePermission('members:manage'), asyncHandler(async (req, res) => {
  const m = await targetMembership(req);
  if (m.role === 'owner' && (await col('memberships').countDocuments({ orgId: req.org._id, role: 'owner' })) <= 1) throw forbidden('An organisation needs at least one owner');
  await col('memberships').deleteOne({ _id: m._id });
  await col('authSessions').updateMany({ userId: m.userId }, { $set: { revokedAt: new Date() } });
  await audit(req, 'member.removed', { target: String(m.userId) });
  ok(res, null, 'Member removed');
}));

router.get('/audit-logs', requirePermission('audit:read'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
  const filter = { orgId: req.org._id, ...(req.query.action ? { action: { $regex: `^${String(req.query.action).replace(/[^a-z_.]/gi, '')}` } } : {}) };
  const [rows, total] = await Promise.all([
    col('auditLogs').find(filter).sort({ ts: -1 }).skip(skip).limit(limit).toArray(),
    col('auditLogs').countDocuments(filter),
  ]);
  ok(res, { rows: rows.map(({ _id, orgId, ipHash, ...r }) => ({ id: String(_id), ...r, userId: r.userId ? String(r.userId) : null })), meta: pageMeta(page, limit, total) });
}));

export default router;
