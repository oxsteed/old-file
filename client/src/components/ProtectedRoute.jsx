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

export default function ProtectedRoute({ children, requiredRole, requireOnboarded = false }) {
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

  // Didit identity-verification gate (matches server authenticate middleware).
  if (
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
