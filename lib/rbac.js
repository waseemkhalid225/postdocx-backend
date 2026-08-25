// lib/rbac.js — role-based access control.
// A permission-based model layered on the existing profiles.role column.
// Backward compatible: 'admin' and 'super_admin' keep full access; 'staff' maps to
// operations; 'user' has none of the admin permissions. New granular roles let the
// owner delegate safely (e.g. a finance admin who cannot touch AI rules or user docs).

// Every admin capability is a named permission. Endpoints require one of these.
const PERMISSIONS = [
  'settings.read', 'settings.write',
  'packages.read', 'packages.write',
  'countries.read', 'countries.write',
  'content.read', 'content.write',
  'reviews.read', 'reviews.write',
  'support.read', 'support.write',
  'payments.read', 'payments.write',
  'aicost.read',
  'audit.read',
  'users.read', 'users.write',
  'overview.read'
];

// Role -> permissions. '*' means all permissions.
const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  admin: ['*'], // legacy full admin stays full
  content_admin: ['overview.read', 'content.read', 'content.write', 'reviews.read', 'reviews.write', 'settings.read'],
  support_admin: ['overview.read', 'support.read', 'support.write', 'users.read'],
  finance_admin: ['overview.read', 'payments.read', 'payments.write', 'packages.read', 'packages.write', 'aicost.read'],
  operations_admin: ['overview.read', 'countries.read', 'countries.write', 'settings.read', 'settings.write', 'audit.read'],
  opportunity_admin: ['overview.read', 'countries.read', 'countries.write'],
  ai_admin: ['overview.read', 'aicost.read', 'settings.read', 'settings.write'],
  security_admin: ['overview.read', 'audit.read', 'users.read', 'users.write'],
  // legacy 'staff' behaves like an operations person plus support
  staff: ['overview.read', 'support.read', 'support.write', 'payments.read', 'payments.write', 'packages.read', 'countries.read', 'countries.write', 'content.read', 'aicost.read', 'audit.read', 'settings.read'],
  user: []
};

function permissionsFor(role) {
  const set = ROLE_PERMISSIONS[role] || [];
  if (set.includes('*')) return new Set(PERMISSIONS);
  return new Set(set);
}

function roleHas(role, permission) {
  const perms = permissionsFor(role);
  return perms.has(permission);
}

function isAdminRole(role) {
  return role && role !== 'user' && (ROLE_PERMISSIONS[role] || []).length > 0;
}

// Express middleware factory. Usage: app.get('/x', auth, requirePermission('packages.read', admin), handler)
// `adminClient` is the supabase admin() function, passed in to avoid a circular require.
function requirePermission(permission, adminClient) {
  return async function (req, res, next) {
    try {
      const { data } = await adminClient().from('profiles').select('role').eq('id', req.userId).single();
      const role = (data && data.role) || 'user';
      if (roleHas(role, permission)) { req.userRole = role; return next(); }
      return res.status(403).json({ error: 'You do not have permission for this action (' + permission + ')' });
    } catch (e) {
      return res.status(403).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, permissionsFor, roleHas, isAdminRole, requirePermission };
