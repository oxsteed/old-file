import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Paths a helper is allowed to visit while in the onboarding gate.
// '/helper/onboarding' was removed — no matching <Route> exists in App.jsx.
const ONBOARDING_ALLOWED_PATHS = [
  '/register/helper',
  '/register/helper/onboarding',
  '/onboarding',
  '/logout',
];

export default function ProtectedRoute({ children, requiredRole, requireOnboarded = true }) {
  const { user, loading, isOnboardingComplete } = useAuth();
  const location = useLocation();

  // Return null while auth state is resolving — avoids a flash of the login
  // redirect before the token is verified. The parent Suspense / skeleton
  // handles the loading UI.
  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  // Helper onboarding gate: redirect helpers who haven't completed onboarding
  // unless they're already on an allowed path.
  if (
    requireOnboarded &&
    user.role === 'helper' &&
    !isOnboardingComplete &&
    !ONBOARDING_ALLOWED_PATHS.includes(location.pathname)
  ) {
    return <Navigate to="/register/helper" replace />;
  }

  return children;
}
