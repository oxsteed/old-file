import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Paths a helper is allowed to visit while in onboarding gate.
// '/helper/onboarding' was removed — no matching <Route> exists in App.jsx.
const ONBOARDING_ALLOWED_PATHS = [
  '/register/helper',
  '/register/helper/onboarding',
  '/onboarding',
  '/logout',
];

export default function ProtectedRoute({ children, requiredRole, requireOnboarded = true }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  if (
    requireOnboarded &&
    user.role === 'helper' &&
    !user.onboarding_complete &&
    !ONBOARDING_ALLOWED_PATHS.includes(location.pathname)
  ) {
    return <Navigate to="/register/helper" replace />;
  }

  return children;
}
