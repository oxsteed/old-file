import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { normalizeLaunchDashboardMode } from '../utils/launchScope';
import { dashboardKeyForMode } from '../utils/modeAccess';
import { projectionActive, resolveHomeMode, modeBackedByAccess } from '../utils/accessProjection';
import useAccessProjection from '../hooks/useAccessProjection';
import ProtectedRoute from './ProtectedRoute';
import RouteErrorBoundary from './RouteErrorBoundary';

// Choose before importing either page: providers should not download or run
// customer discovery/location effects on the way to their working homepage.
// WP-015: with the access projection on, the saved dashboard preference is
// honoured only while access still backs it; otherwise the personal Home
// renders with a polite notice (no focus move, no redirect loop).
export default function ModeHomeRoute({ DiscoveryPage, DashboardPage, LoadingState }) {
  const { user, loading } = useAuth();
  const projection = useAccessProjection(user);
  const { t: accessT } = useTranslation('common');
  if (loading) return <LoadingState />;
  const preferred = user && normalizeLaunchDashboardMode(user.default_mode || user.role, user.role);
  // The projection owns the landing experience. Approved capabilities add
  // links inside the customer workspace; they do not redirect the account to
  // a separate mode dashboard. A saved preference that lost its backing
  // still falls back to personal Home with a notice (WP-015).
  const { mode, fallback } = projection?.flags?.accessProjection === false
    ? resolveHomeMode(user, preferred, projection)
    : { mode: 'customer', fallback: projectionActive(projection) && !modeBackedByAccess(preferred, projection.access) };
  if (user && dashboardKeyForMode(mode) !== 'customer') {
    // Legacy path only: the projection-active branch above always resolves
    // to 'customer', so this wrapper is reached only while the projection is
    // off (rollback). Restore the legacy home identity redirect here: a
    // Didit-pending account that would have landed on a work dashboard is
    // sent to /verify-identity, exactly as before the cutover. The narrower
    // requireIdentityVerification opt-in fires the identity gate only, not
    // the onboarding-completeness redirect below.
    return <ProtectedRoute requireIdentityVerification><RouteErrorBoundary><DashboardPage /></RouteErrorBoundary></ProtectedRoute>;
  }
  if (fallback) {
    return (
      <>
        <p role="status" className="mx-auto max-w-5xl px-4 pt-3 text-sm text-gray-700 dark:text-gray-300">
          {accessT('progressiveAccess.home.accessChanged')}
        </p>
        <DiscoveryPage />
      </>
    );
  }
  return <DiscoveryPage />;
}
