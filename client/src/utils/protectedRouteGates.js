// Pure predicates behind ProtectedRoute's redirects (Domain 6 B4,
// 2026-11-17). Kept out of the component so they are unit-testable with
// node --test, the runner CI uses for client src tests; no jsdom or
// testing-library harness exists for client components in this repo.
//
// Recovery routes must remain reachable even when a work route explicitly
// requires onboarding. General account/workspace pages do not require helper
// onboarding; listing, bidding and starting work enforce it on the server.
export const ONBOARDING_ALLOWED_PATHS = [
  '/helper-dashboard',
  '/dashboard',
  '/verify-identity',
  '/media/verification',
  '/media/verify-identity',
];

// Roles that carried helper work before the access projection. They keep
// the old behavior even when the projection is off or has not granted
// helper.offer_services yet: they were redirected before, and dropping
// them would silently un-gate legacy helpers.
const LEGACY_HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

// B4: the requireOnboarded arm used to fire only for legacy helper roles
// and read the summary isOnboardingComplete flag, so it was dead for
// new-model helpers (role=customer with helper access) and read the wrong
// flag for everyone else — general registration stamps
// onboarding_completed at OTP verification, so the summary claims helper
// completion before identity verification lands. The caller passes the
// already-resolved isHelperOnboardingComplete value from AuthContext,
// which is the derived helper truth for helper-access users and the
// summary for everyone else.
export function isHelperOnboardingRedirectRequired({
  requireOnboarded = false,
  hasHelperAccess = false,
  role = null,
  isHelperOnboardingComplete = false,
  pathname = '',
} = {}) {
  if (!requireOnboarded) return false;
  const isHelper = hasHelperAccess || LEGACY_HELPER_ROLES.includes(role);
  if (!isHelper) return false;
  if (isHelperOnboardingComplete) return false;
  return !ONBOARDING_ALLOWED_PATHS.includes(pathname);
}
