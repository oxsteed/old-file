import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Protected routes a helper may visit before onboarding is complete.
// All entries here must correspond to actual <ProtectedRoute>-wrapped routes
// in App.jsx — public paths never reach this gate.
// '/helper-dashboard' is required: HelperRegister navigates there after OTP
// verification, before onboarding_completed is set to true.
const ONBOARDING_ALLOWED_PATHS = [
  '/helper-dashboard',
  '/dashboard',
];

export default function ProtectedRoute({ children, requiredRole, requireOnboarded = true }) {
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
