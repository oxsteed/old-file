import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Recovery routes must remain reachable even when a work route explicitly
// requires onboarding. General account/workspace pages do not require helper
// onboarding; listing, bidding and starting work enforce it on the server.
const ONBOARDING_ALLOWED_PATHS = [
  '/helper-dashboard',
  '/dashboard',
  '/verify-identity',
  '/media/verification',
  '/media/verify-identity',
];

// Paths that are themselves part of the identity-verification flow and must
// NOT trigger the Didit redirect (would create an infinite loop). Media keeps
// its verification center available so users can choose the right path.
const DIDIT_EXEMPT_PATHS = [
  '/verify-identity',
  '/media/verification',
  '/media/verify-identity',
];

// Paths that are part of email verification flow.
const EMAIL_VERIFICATION_EXEMPT_PATHS = [
  '/verify-email',
];

function diditGateSatisfied(user) {
  if (!user?.email_verified) return true;
  const ds = user.didit_status || 'pending';
  if (user.didit_enforcement_required) {
    return ds === 'verified';
  }
  return ds === 'verified' || ds === 'skipped';
}

export default function ProtectedRoute({ children, requiredRole, requireOnboarded = false, requireIdentityVerification = false }) {
  const { user, loading, isOnboardingComplete } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  // Email verification gate.
  // All authenticated users must have a verified email before accessing protected routes.
  if (
    !user.email_verified &&
    !EMAIL_VERIFICATION_EXEMPT_PATHS.includes(location.pathname)
  ) {
    return <Navigate to="/verify-email" replace />;
  }

  // Customer accounts can use the product before identity verification.
  // Two separate opt-ins, because they guard different things:
  // - requireIdentityVerification restores the legacy home redirect for a
  //   Didit-pending account on the rollback path (ModeHomeRoute). It fires
  //   the identity gate only, never the onboarding-completeness redirect.
  // - requireOnboarded is for helper activation routes (/helper-dashboard,
  //   /helper/payouts). It implies identity verification AND onboarding
  //   completeness. Listing, bidding and starting work enforce identity on
  //   the server as well; this is the client-side redirect layer.
  // A user with didit_enforcement_required is gated on every protected
  // route, with no opt-in needed: the server 403s their Didit-unsatisfied
  // API calls, so the client must not render the page behind a dead end.
  // "Verify later" sets didit_status to 'skipped', which satisfies the gate
  // unless enforcement is required, so deferring verification never traps
  // an ordinary user in a redirect loop.
  if (
    (requireOnboarded || requireIdentityVerification || user.didit_enforcement_required) &&
    user.email_verified &&
    !diditGateSatisfied(user) &&
    !DIDIT_EXEMPT_PATHS.includes(location.pathname)
  ) {
    return <Navigate to="/verify-identity" replace />;
  }

  // Work-route opt-in only. An incomplete helper profile must not block
  // Settings, authorized statements, Support, or business workspace pages.
  // Skipping Didit never marks helper work eligibility complete.
  if (
    requireOnboarded &&
    ['helper', 'helper_pro', 'broker'].includes(user.role) &&
    !isOnboardingComplete &&
    !ONBOARDING_ALLOWED_PATHS.includes(location.pathname)
  ) {
    return <Navigate to="/helper-dashboard" replace />;
  }

  return children;
}
