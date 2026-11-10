import { env } from '../config/env.js';
import { can, permissionsFor } from '../config/rbac.js';
import { resolveSession, membershipsFor } from '../services/authService.js';
import { unauthorized, forbidden } from '../utils/errors.js';

/**
 * Require a signed-in user and resolve the active organisation:
 * `X-Org-Id` header (validated against memberships) or the user's first organisation.
 * Sets req.user, req.session, req.org, req.role, req.memberships.
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = req.cookies?.[env.SESSION_COOKIE_NAME];
    const resolved = await resolveSession(token);
    if (!resolved) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
    req.user = resolved.user;
    req.session = resolved.session;
    req.memberships = await membershipsFor(resolved.user._id);
    if (!req.memberships.length) throw forbidden('Your account is not a member of any organisation', 'NO_ORG');
    const wanted = req.get('x-org-id');
    const m = (wanted && req.memberships.find((x) => String(x.org._id) === wanted)) || req.memberships[0];
    req.org = m.org;
    req.role = m.role;
    req.permissions = permissionsFor(m.role);
    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard: `requirePermission('leads:pii')` */
export const requirePermission = (permission) => (req, _res, next) => {
  if (!can(req.role, permission)) return next(forbidden());
  return next();
};
