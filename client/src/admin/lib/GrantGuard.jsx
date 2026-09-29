import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import adminApi from './adminApi';
import AdminErrorState from './AdminErrorState';

/**
 * GrantGuard — grant-based gate for admin pages (replaces blanket superOnly).
 *
 * Super-admins hold every permission implicitly and bypass the check
 * entirely (mirrors requirePermission's req.isSuper bypass in adminAuth.js).
 * Regular admins are allowed when their active permission grants include at
 * least one of the required scopes; otherwise they see an access-denied
 * panel instead of being silently redirected.
 *
 * The client's own grants are learned from GET /api/admin/permission-grants/me
 * (self-lookup only; never another admin's grants). The result is cached per
 * admin id for the session so multiple guarded pages don't refetch.
 *
 * Props:
 *  - grant:  single required permission scope (e.g. "view_financials")
 *  - grants: array of required scopes (allowed when ANY matches)
 *  - children: page to render when allowed
 */
function LoadingSpinner() {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-orange-500
        border-t-transparent rounded-full" />
    </div>
  );
}

// Session cache keyed by admin id: { scopes: string[] }
const scopesCache = new Map();
const inflightByUser = new Map();

function fetchMyScopes(userId) {
  const cached = scopesCache.get(userId);
  if (cached) return Promise.resolve(cached);
  const inflight = inflightByUser.get(userId);
  if (inflight) return inflight;
  const request = adminApi.get('/admin/permission-grants/me')
    .then(({ data }) => {
      const scopes = [...new Set((data.scopes || []).filter(s => typeof s === 'string'))];
      const entry = { scopes };
      scopesCache.set(userId, entry);
      return entry;
    })
    .catch(() => {
      // Fail closed: if we cannot learn the admin's grants, treat as no
      // grants. Do not cache the failure, so a later navigation retries.
      return { scopes: [] };
    })
    .finally(() => {
      if (inflightByUser.get(userId) === request) inflightByUser.delete(userId);
    });
  inflightByUser.set(userId, request);
  return request;
}

/** Hook: does the signed-in admin hold at least one of the required scopes? */
export function useHasGrant(required) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ loading: true, allowed: false });

  useEffect(() => {
    if (authLoading) return;
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      setState({ loading: false, allowed: false });
      return;
    }
    if (user.role === 'super_admin') {
      // Explicit super-admin bypass: implicit all-grants status.
      setState({ loading: false, allowed: true });
      return;
    }
    const need = (Array.isArray(required) ? required : [required]).filter(Boolean);
    if (!need.length) {
      setState({ loading: false, allowed: false });
      return;
    }
    let cancelled = false;
    setState({ loading: true, allowed: false });
    fetchMyScopes(user.id).then(({ scopes }) => {
      if (cancelled) return;
      setState({ loading: false, allowed: need.some(s => scopes.includes(s)) });
    });
    return () => { cancelled = true; };
  }, [authLoading, user, required && JSON.stringify(required)]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

/** Hook: the signed-in admin's own permission scopes (empty for super_admin;
 *  callers bypass via isSuper, and empty while loading for everyone else). */
export function useMyScopes() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ loading: true, scopes: [] });

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'admin') {
      setState({ loading: false, scopes: [] });
      return;
    }
    let cancelled = false;
    setState({ loading: true, scopes: [] });
    fetchMyScopes(user.id).then(({ scopes }) => {
      if (cancelled) return;
      setState({ loading: false, scopes });
    });
    return () => { cancelled = true; };
  }, [authLoading, user]);

  return state;
}

export default function GrantGuard({ grant, grants, children }) {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const required = grants && grants.length ? grants : (grant ? [grant] : []);
  const { loading: grantLoading, allowed } = useHasGrant(required);

  if (authLoading || grantLoading) return <LoadingSpinner />;

  if (!user) return <Navigate to="/admin/login" replace />;
  if (!['admin', 'super_admin'].includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-950 p-6 flex items-start justify-center">
        <div className="w-full max-w-xl mt-16">
          <AdminErrorState
            title={t('adminGrantGuard.title')}
            message={t('adminGrantGuard.message', { grant: required.join(', ') })}
          />
        </div>
      </div>
    );
  }

  return children;
}
