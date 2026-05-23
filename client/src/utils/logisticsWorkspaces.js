export const LOGISTICS_WORKSPACES = [
  {
    key: 'buyer',
    label: 'Buyer',
    description: 'Source products, watch shipments, and manage claims or refunds.',
    path: '/logistics/buyer',
    icon: '🧾',
  },
  {
    key: 'organizer',
    label: 'Organizer',
    description: 'Run pooled campaigns, grow MOQ participation, and coordinate handoffs.',
    path: '/logistics/organizer',
    icon: '🧭',
  },
  {
    key: 'business_procurement',
    label: 'Business Procurement',
    description: 'Manage recurring procurement, restock planning, and lane-aware purchasing.',
    path: '/logistics/business-procurement',
    icon: '🏢',
  },
  {
    key: 'distributor',
    label: 'Distributor / Reseller',
    description: 'Track assigned inventory, outbound deliveries, and final-mile fulfillment.',
    path: '/logistics/distributor',
    icon: '📤',
  },
  {
    key: 'operations',
    label: 'Operations',
    description: 'Watch sourcing intake, active freight, warehouse flow, and exception posture.',
    path: '/logistics/operations',
    icon: '⚙️',
  },
  {
    key: 'compliance',
    label: 'Compliance',
    description: 'Review market restrictions, customs-sensitive movement, and approval gates.',
    path: '/logistics/compliance-workspace',
    icon: '🛡️',
  },
  {
    key: 'admin_control',
    label: 'Admin / Super Admin Control',
    description: 'Manage pricing, restrictions, supplier approvals, and profitability controls.',
    path: '/logistics/admin-control',
    icon: '👑',
  },
];

export const LOGISTICS_END_USER_WORKSPACE_KEYS = [
  'buyer',
  'organizer',
  'business_procurement',
  'distributor',
];

export const LOGISTICS_FAVORITE_STORAGE_KEY = 'oxsteed.logistics.favoriteWorkspace';

export function getLogisticsWorkspaceByKey(key) {
  return LOGISTICS_WORKSPACES.find((workspace) => workspace.key === key) || null;
}

export function getLogisticsEndUserWorkspaces() {
  return LOGISTICS_WORKSPACES.filter((workspace) => LOGISTICS_END_USER_WORKSPACE_KEYS.includes(workspace.key));
}

export function getFavoriteLogisticsWorkspaceKey() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(LOGISTICS_FAVORITE_STORAGE_KEY);
    return LOGISTICS_END_USER_WORKSPACE_KEYS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function getFavoriteLogisticsWorkspacePath() {
  const key = getFavoriteLogisticsWorkspaceKey();
  return getLogisticsWorkspaceByKey(key)?.path || null;
}

export function setFavoriteLogisticsWorkspaceKey(key) {
  if (typeof window === 'undefined') return;
  try {
    if (!key || !LOGISTICS_END_USER_WORKSPACE_KEYS.includes(key)) {
      window.localStorage.removeItem(LOGISTICS_FAVORITE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LOGISTICS_FAVORITE_STORAGE_KEY, key);
  } catch {
    // ignore localStorage failures
  }
}

export function isLogisticsOperator(user, workspace = null) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') {
    if (!workspace) return true;
    if (workspace === 'admin_control') return true;
    return user.internal_access_route === workspace || user.internal_access_route === 'admin_portal';
  }
  if (user.role !== 'employee') return false;
  if (!workspace) return false;
  if (workspace === 'operations') {
    return (
      user.internal_access_route === 'operations' &&
      ['sourcing_operator', 'logistics_coordinator', 'warehouse_operator'].includes(user.logistics_role)
    );
  }
  if (workspace === 'compliance') {
    return user.internal_access_route === 'compliance' && user.logistics_role === 'compliance_reviewer';
  }
  return false;
}

const PROCUREMENT_PERMISSION_CODES = new Set([
  'analytics.view_ops',
  'products.manage',
  'settings.general',
  'team.assign_permissions',
]);

export function isBusinessProcurementEligibleMembership(entry) {
  if (!entry || entry.status !== 'active') return false;
  if (entry.is_owner) return true;
  if (entry.role === 'manager') return true;
  const permissions = Array.isArray(entry.permissions) ? entry.permissions : [];
  return permissions.some((code) => PROCUREMENT_PERMISSION_CODES.has(code));
}

export function canAccessBusinessProcurementWorkspace(user, businessAccess = null) {
  if (user?.role === 'admin' || user?.role === 'super_admin') return true;
  if (!user) return false;
  const eligibleBusinesses = businessAccess?.eligibleBusinesses;
  return Array.isArray(eligibleBusinesses) && eligibleBusinesses.length > 0;
}

export function canAccessOperationsWorkspace(user) {
  return isLogisticsOperator(user, 'operations');
}

export function canAccessComplianceWorkspace(user) {
  return isLogisticsOperator(user, 'compliance');
}

export function canAccessAdminControlWorkspace(user) {
  return isLogisticsOperator(user, 'admin_control');
}

export function workspaceAvailabilityForUser(user, businessAccess = null) {
  return {
    buyer: true,
    organizer: !!user,
    business_procurement: canAccessBusinessProcurementWorkspace(user, businessAccess),
    distributor: !!user,
    operations: canAccessOperationsWorkspace(user),
    compliance: canAccessComplianceWorkspace(user),
    admin_control: canAccessAdminControlWorkspace(user),
  };
}

export function recommendedLogisticsWorkspace(user, businessAccess = null) {
  if (!user) return '/logistics/buyer';
  const favoritePath = getFavoriteLogisticsWorkspacePath();
  if (favoritePath) return favoritePath;
  if (canAccessOperationsWorkspace(user)) return '/logistics/operations';
  if (canAccessBusinessProcurementWorkspace(user, businessAccess)) return '/logistics/business-procurement';
  return '/logistics/buyer';
}
