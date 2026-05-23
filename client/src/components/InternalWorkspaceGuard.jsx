import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { canAccessInternalWorkspace } from '../utils/internalWorkspaces';

export default function InternalWorkspaceGuard({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { workspace } = useParams();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-slate-300">
          Loading internal workspace…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/internal/${workspace}/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  if (!canAccessInternalWorkspace(user, workspace)) {
    return <Navigate to={`/internal/${workspace}/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  return children;
}
