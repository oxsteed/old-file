import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const ONBOARDING_ALLOWED_PATHS = [
  '/helper/onboarding',
  '/login',
  '/register',
  '/register/helper',
  '/register/customer',
  '/helper-register',
];

export default function ProtectedRoute({ children, requiredRole, requiredTier }) {
  const { user, loading } = useAuth();
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

  // Helper onboarding gate: redirect incomplete helpers unless on allowed paths
  const helperOnboardingComplete = user.onboarding_step === 'active'
    || user.onboarding_completed
    || user.onboarding_status === 'onboarding_complete';
  if (
    user.role === 'helper' &&
    !helperOnboardingComplete &&
    !ONBOARDING_ALLOWED_PATHS.some(p => location.pathname.startsWith(p))
  ) {
    return <Navigate to="/register/helper" replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredTier && user.tier !== requiredTier) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
