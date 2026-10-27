import { useAuth } from '../context/AuthContext';
import { normalizeLaunchDashboardMode } from '../utils/launchScope';
import { dashboardKeyForMode } from '../utils/modeAccess';
import ProtectedRoute from './ProtectedRoute';
import RouteErrorBoundary from './RouteErrorBoundary';

// Choose before importing either page: providers should not download or run
// customer discovery/location effects on the way to their working homepage.
export default function ModeHomeRoute({ DiscoveryPage, DashboardPage, LoadingState }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState />;
  const mode = user && normalizeLaunchDashboardMode(user.default_mode || user.role, user.role);
  if (user && dashboardKeyForMode(mode) !== 'customer') {
    return <ProtectedRoute><RouteErrorBoundary><DashboardPage /></RouteErrorBoundary></ProtectedRoute>;
  }
  return <DiscoveryPage />;
}
