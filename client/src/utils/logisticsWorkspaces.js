import { canManageBusinesses } from './modeAccess';

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

export function isLogisticsOperator(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

export function canAccessBusinessProcurementWorkspace(user) {
  return !!user && canManageBusinesses(user);
}

export function canAccessOperationsWorkspace(user) {
  return isLogisticsOperator(user);
}

export function canAccessComplianceWorkspace(user) {
  return isLogisticsOperator(user);
}

export function canAccessAdminControlWorkspace(user) {
  return isLogisticsOperator(user);
}

export function workspaceAvailabilityForUser(user) {
  return {
    buyer: true,
    organizer: !!user,
    business_procurement: canAccessBusinessProcurementWorkspace(user),
    distributor: !!user,
    operations: canAccessOperationsWorkspace(user),
    compliance: canAccessComplianceWorkspace(user),
    admin_control: canAccessAdminControlWorkspace(user),
  };
}

export function recommendedLogisticsWorkspace(user) {
  if (!user) return '/logistics/buyer';
  if (canAccessOperationsWorkspace(user)) return '/logistics/operations';
  if (canAccessBusinessProcurementWorkspace(user)) return '/logistics/business-procurement';
  return '/logistics/buyer';
}

