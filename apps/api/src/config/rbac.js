/**
 * Organisation roles → permissions. Every dashboard route declares the permission it needs;
 * data access is additionally scoped to the caller's organisation websites.
 */
export const ROLES = ['owner', 'admin', 'analyst', 'viewer'];

export const PERMISSIONS = {
  'analytics:read': ['owner', 'admin', 'analyst', 'viewer'],
  'visitors:read': ['owner', 'admin', 'analyst'],
  'visitors:delete': ['owner', 'admin'],
  'visitors:export': ['owner', 'admin'],
  'leads:read': ['owner', 'admin', 'analyst'],
  'leads:pii': ['owner', 'admin'],
  'leads:write': ['owner', 'admin', 'analyst'],
  'leads:export': ['owner', 'admin'],
  'funnels:write': ['owner', 'admin', 'analyst'],
  'reports:export': ['owner', 'admin', 'analyst'],
  'reports:schedule': ['owner', 'admin'],
  'alerts:write': ['owner', 'admin'],
  'websites:write': ['owner', 'admin'],
  'websites:keys': ['owner', 'admin'],
  'members:manage': ['owner', 'admin'],
  'org:manage': ['owner'],
  'audit:read': ['owner', 'admin'],
};

export const can = (role, permission) => Boolean(PERMISSIONS[permission]?.includes(role));

export const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));

/** Owners can manage anyone; admins can manage analysts/viewers only. */
export function canManageRole(actorRole, targetRole) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return ['analyst', 'viewer'].includes(targetRole);
  return false;
}
