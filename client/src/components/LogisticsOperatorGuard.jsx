import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  canAccessAdminControlWorkspace,
  canAccessComplianceWorkspace,
  canAccessOperationsWorkspace,
} from '../utils/logisticsWorkspaces';

function loginRouteForPath(pathname) {
  if (pathname.startsWith('/logistics/compliance-workspace')) {
    return '/logistics/compliance-workspace/login';
  }
  if (pathname.startsWith('/logistics/admin-control')) {
    return '/logistics/admin-control/login';
  }
  return '/logistics/operations/login';
}

export default function LogisticsOperatorGuard({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`${loginRouteForPath(location.pathname)}?next=${next}`} replace />;
  }

  const pathname = location.pathname;
  const hasAccess = pathname.startsWith('/logistics/compliance-workspace')
    ? canAccessComplianceWorkspace(user)
    : pathname.startsWith('/logistics/admin-control')
      ? canAccessAdminControlWorkspace(user)
      : canAccessOperationsWorkspace(user);

  if (!hasAccess) {
    return <Navigate to={loginRouteForPath(location.pathname)} replace />;
  }

  return children;
}
