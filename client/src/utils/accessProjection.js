// WP-015 / WP-016: Home and navigation read the access projection
// (GET /api/me/access → access.personal[] / organizations[]) instead of the
// legacy default_mode, when ACCESS_PROJECTION_ENABLED is on for the user.
//
// default_mode stays the person's *dashboard preference*; the projection
// decides whether that preference is still backed by access. A preference
// whose access was removed falls back to the personal Home with a notice.
// New approvals never replace the person's dashboard choice: they only add
// shortcuts. Mirrors MODE_CAPABILITY in server/services/access/modeGate.js.

export const MODE_CAPABILITY = Object.freeze({
  helper: ['helper.offer_services'],
  business_owner: ['business.own'],
  restaurant_owner: ['restaurant.own', 'business.own'],
  consultant: ['consultant.accept_paying_clients'],
  tool_owner: ['tool_owner.list_equipment'],
  logistics: ['logistics.ship'],
});

const STAFF_ROLES = new Set(['admin', 'super_admin', 'employee', 'support_agent']);

export function projectionActive(projection) {
  return !!(projection && projection.flags && projection.flags.accessProjection && projection.access);
}

export function hasCapability(access, capability) {
  if (!access) return false;
  if ((access.personal || []).includes(capability)) return true;
  if (capability === 'business.own' || capability === 'restaurant.own') {
    return (access.organizations || []).some((o) => o && o.role === 'owner');
  }
  return false;
}

export function modeBackedByAccess(mode, access) {
  const caps = MODE_CAPABILITY[mode];
  if (!caps) return true; // ungated views (customer, life_only, investor…) are unchanged
  return caps.some((c) => hasCapability(access, c));
}

/** @returns {{mode:string, fallback:boolean}} */
export function resolveHomeMode(user, preferredMode, projection) {
  if (!user || !projectionActive(projection) || STAFF_ROLES.has(user.role)) {
    return { mode: preferredMode, fallback: false };
  }
  if (modeBackedByAccess(preferredMode, projection.access)) return { mode: preferredMode, fallback: false };
  return { mode: 'customer', fallback: true };
}

/**
 * Extra entry points for capabilities the person holds but is not currently
 * viewing (e.g. an approved helper whose preference is still customer).
 */
export function capabilityShortcuts(mode, projection) {
  if (!projectionActive(projection)) return [];
  const out = [];
  if (mode !== 'helper' && hasCapability(projection.access, 'helper.offer_services')) {
    out.push({ id: 'browseJobs', to: '/jobs', labelKey: 'nav.browseJobs', primary: false });
    out.push({ id: 'myWork', to: '/helper-dashboard', labelKey: 'nav.myWork', primary: false });
  }
  if (!['business_owner', 'business_manager', 'business_representative', 'business_employee'].includes(mode)
      && (projection.access.organizations || []).length > 0) {
    out.push({ id: 'workspace', to: '/business-hub', labelKey: 'nav.businessWorkspace', primary: false });
  }
  if (mode !== 'logistics' && hasCapability(projection.access, 'logistics.ship')) {
    out.push({ id: 'logisticsBuyer', to: '/logistics/buyer', labelKey: 'logistics.nav.buyer', primary: false });
    out.push({ id: 'logisticsOrganizer', to: '/logistics/organizer', labelKey: 'logistics.nav.organizer', primary: false });
  }
  return out;
}
