import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Building2, KeyRound, ShieldCheck } from 'lucide-react';
import api, { clearStoredSession, persistSessionPayload } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';
import { canAccessInternalWorkspace, getInternalWorkspaceMeta } from '../../utils/internalWorkspaces';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getSafeNextPath(rawNext, workspaceSlug) {
  const fallback = `/internal/${workspaceSlug}`;
  if (!rawNext || typeof rawNext !== 'string') return fallback;
  return rawNext.startsWith(`/internal/${workspaceSlug}`) ? rawNext : fallback;
}

export default function InternalWorkspaceLoginPage() {
  const { user, setUser, loading: authLoading } = useAuth();
  const { workspace } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const meta = useMemo(() => getInternalWorkspaceMeta(workspace), [workspace]);
  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return getSafeNextPath(params.get('next'), meta.slug);
  }, [location.search, meta.slug]);

  const [password, setPassword] = useState('');
  const [internalName, setInternalName] = useState('');
  const [securityKey, setSecurityKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFACode, setTwoFACode] = useState('');
  const [mfaToken, setMfaToken] = useState(null);
  const [internalAccessToken, setInternalAccessToken] = useState(null);
  const [approvedIdentity, setApprovedIdentity] = useState(null);

  const isLocked = lockedUntil && Date.now() < lockedUntil;

  useEffect(() => {
    if (!authLoading && user && canAccessInternalWorkspace(user, meta.code)) {
      navigate(nextPath, { replace: true });
    }
  }, [authLoading, user, meta.code, navigate, nextPath]);

  async function handleInternalAccessSubmit(event) {
    event.preventDefault();
    setError('');

    if (isLocked) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      setError(`Too many failed attempts. Try again in ${mins} minute(s).`);
      return;
    }

    if (!internalName.trim() || !securityKey.trim()) {
      setError('Name and security key are required.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/internal-access/verify', {
        route: meta.code,
        internal_name: internalName.trim(),
        security_key: securityKey,
      });
      setInternalAccessToken(data.internalAccessToken);
      setApprovedIdentity(data.user);
      setAttempts(0);
      setLockedUntil(null);
    } catch (err) {
      const status = err.response?.status;
      const payload = err.response?.data || {};
      if (status === 423 && payload.lockedUntil) {
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError(payload.message || 'Access temporarily locked.');
      } else if (status === 401 && payload.lockedUntil) {
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError('Too many failed attempts. Locked until the timer expires.');
      } else if (status === 401 && typeof payload.attemptsLeft === 'number') {
        setAttempts(MAX_ATTEMPTS - payload.attemptsLeft);
        setError(`Invalid credentials. ${payload.attemptsLeft} attempt${payload.attemptsLeft === 1 ? '' : 's'} remaining before lockout.`);
      } else {
        setAttempts((current) => current + 1);
        setError(payload.error || 'Internal access verification failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setError('');

    if (isLocked) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      setError(`Too many failed attempts. Try again in ${mins} minute(s).`);
      return;
    }

    if (!internalAccessToken || !approvedIdentity) {
      setError('Complete the internal access verification first.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/internal-access/login', {
        internalAccessToken,
        password,
      });

      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setMfaToken(data.mfaToken);
        setLoading(false);
        return;
      }

      persistSessionPayload(data);
      setUser(data.user);
      setAttempts(0);
      navigate(nextPath, { replace: true });
    } catch (err) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (nextAttempts >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setError('Access temporarily locked due to too many failed attempts.');
      } else {
        setError(err.response?.data?.error || 'Login failed. Please check your password.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handle2FASubmit(event) {
    event.preventDefault();
    setError('');

    if (!twoFACode || !mfaToken) {
      setError(!mfaToken ? 'Your 2FA session expired. Please sign in again.' : 'Please enter your 2FA code.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/login/2fa', {
        mfaToken,
        token: twoFACode,
        isBackupCode: twoFACode.length > 6,
      });

      if (!canAccessInternalWorkspace(data.user, meta.code)) {
        setError('Access denied for this internal workspace.');
        clearStoredSession();
        setUser(null);
        setLoading(false);
        return;
      }

      persistSessionPayload(data);
      setUser(data.user);
      setAttempts(0);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid authentication code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-stretch">
        <section className="flex-1 rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-8 shadow-2xl shadow-black/30">
          <div className={`inline-flex rounded-full bg-gradient-to-r ${meta.accent} px-4 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-slate-950`}>
            OxSteed Internal
          </div>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-white">
            {meta.label} dashboard access
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            {meta.mission}
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <Building2 className="mb-3 h-5 w-5 text-slate-200" />
              <div className="text-sm font-medium text-white">Department route</div>
              <div className="mt-2 text-sm text-slate-400">{meta.dashboardPath}</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <KeyRound className="mb-3 h-5 w-5 text-slate-200" />
              <div className="text-sm font-medium text-white">Access pattern</div>
              <div className="mt-2 text-sm text-slate-400">Assigned internal name + security key, then password / 2FA.</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <ShieldCheck className="mb-3 h-5 w-5 text-slate-200" />
              <div className="text-sm font-medium text-white">Routing rule</div>
              <div className="mt-2 text-sm text-slate-400">Department titles unlock department dashboards. Admin roles stay separate.</div>
            </div>
          </div>
        </section>

        <section className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-900/90 p-8 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="mb-6">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-500">Secure sign-in</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">{meta.label} workspace login</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Use the internal identity assigned to your department workspace before your account password.
            </p>
          </div>

          {!approvedIdentity ? (
            <form onSubmit={handleInternalAccessSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Internal name</label>
                <input
                  value={internalName}
                  onChange={(event) => setInternalName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-white/30"
                  placeholder="Assigned internal identity"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Security key</label>
                <input
                  type="password"
                  value={securityKey}
                  onChange={(event) => setSecurityKey(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-white/30"
                  placeholder="Internal access key"
                />
              </div>
              {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-60"
              >
                {loading ? 'Verifying…' : 'Verify internal access'}
              </button>
            </form>
          ) : requires2FA ? (
            <form onSubmit={handle2FASubmit} className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Internal access approved for {approvedIdentity.email_masked || approvedIdentity.email}.
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">2FA code</label>
                <input
                  value={twoFACode}
                  onChange={(event) => setTwoFACode(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-white/30"
                  placeholder="Authenticator or backup code"
                />
              </div>
              {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-60"
              >
                {loading ? 'Checking…' : 'Complete sign-in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Internal identity approved for {approvedIdentity.email_masked || approvedIdentity.email}.
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Account password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-white/30"
                  placeholder="OxSteed account password"
                />
              </div>
              {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Continue to dashboard'}
              </button>
            </form>
          )}

          <div className="mt-6 text-sm text-slate-500">
            Global control staff still use <Link to="/admin/login" className="text-slate-300 underline underline-offset-4">/admin/login</Link>.
          </div>
        </section>
      </div>
    </div>
  );
}
