// client/src/utils/modeAccess.js
//
// WP-104: the legacy gates `canPostJobs` and `canAccessBusinessHub` are
// deleted. Posting a job is open to any signed-in account (the customer
// workspace action); Business Hub access comes from the access projection
// (`hasBusinessHubAccess`).
//
// Domain 6 cleanup: the mode-based visibility predicates (`canBidOnJobs`,
// `canListTools`, `canManageBusinesses`, `canOfferConsulting`,
// `canSeeLifeFeatures`, `canSeeFranchiseApplications`,
// `canSeeSupportAgentPortal`, `settingsTabsForMode`, `navLinksForMode`) are
// deleted — they had zero consumers and answered visibility from
// `user.default_mode`, so reuse would have reintroduced mode-based gating.
// Visibility now comes from the access projection / entitlements only. The
// mode-class helpers they used (`isHelperClassMode`, `isCustomerClassMode`)
// went with them for the same reason.

import { projectionActive } from './accessProjection.js';

// ── Dashboard selection ──────────────────────────────────────────────────────
// Used by SmartDashboard / DashboardRouter to pick which child page to render.
export function dashboardKeyForMode(mode) {
  switch (mode) {
    case 'helper':                  return 'helper';
    case 'investor':                return 'investor';
    case 'logistics':               return 'logistics';
    case 'business_owner':          return 'business_owner';
    case 'consultant':              return 'consultant';
    case 'tool_owner':              return 'tool_owner';
    case 'franchise_applicant':     return 'franchise_applicant';
    case 'life_only':               return 'life';
    case 'business_manager':        return 'business_manager';
    case 'business_representative': return 'business_representative';
    case 'business_employee':       return 'business_employee';
    case 'business_support_agent':  return 'support_agent';
    case 'admin':                   return 'admin';
    case 'customer':
    default:                        return 'customer';
  }
}

// Pro entitlement is granted by an active first-year trial or a paid legacy
// tier. Role checks remain separate because some Pro tools are intentionally
// limited to helper-class accounts.
export function hasProAccess(user) {
  if (!user) return false;
  const status = String(user.subscription_status || '').toLowerCase();
  const subscriptionCurrent = !status || ['active', 'trialing'].includes(status);
  if (['helper_pro', 'broker'].includes(user.role) && subscriptionCurrent) return true;
  const legacyTier = String(user.membership_tier || '').toLowerCase();
  if (['pro', 'tier2'].includes(legacyTier)) return true;
  if (user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now()) return true;
  if (status && !['active', 'trialing'].includes(status)) return false;
  const tier = String(user.effective_tier || user.tier || '').toLowerCase();
  if (['pro', 'tier2', 'premium', 'elite'].includes(tier)) return true;
  return false;
}

// Business Hub gate, projection-only (WP-104): an organization membership
// opens the hub. An active customer with an open access request can prepare
// private drafts; the API enforces owner approval when they publish. A
// missing projection opens nothing — the hub needs the projection to know
// which organizations the account belongs to.
export function hasBusinessHubAccess(projection) {
  if (!projectionActive(projection)) return false;
  const { access, flags } = projection;
  if ((access.organizations || []).length > 0) return true;
  return Boolean(flags?.accessRequests && (access.personal || []).includes('customer'));
}

// QR code creation and saved-code storage are Pro features on the API.
// Keep the client entitlement check aligned with server/routes/qrCodes.js so
// users without access do not see a page that can only fail with 403.
export function canUseQrGenerator(user) {
  return Boolean(user && hasProAccess(user));
}

export default {
  dashboardKeyForMode,
  hasProAccess,
  hasBusinessHubAccess,
  canUseQrGenerator,
};
