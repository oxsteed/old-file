import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api, { clearStoredSession, persistSessionPayload } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';
import { isLogisticsOperator } from '../../utils/logisticsWorkspaces';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getLoginMode(pathname) {
  if (pathname.startsWith('/logistics/compliance-workspace/login')) return 'compliance';
  if (pathname.startsWith('/logistics/admin-control/login')) return 'admin_control';
  return 'operations';
}

function getSafeNextPath(rawNext, mode) {
  const fallback = mode === 'compliance'
    ? '/logistics/compliance-workspace'
    : mode === 'admin_control'
      ? '/logistics/admin-control'
      : '/logistics/operations';
  if (!rawNext || typeof rawNext !== 'string') return fallback;
  return rawNext.startsWith('/logistics/') ? rawNext : fallback;
}

function loginCopy(mode) {
  if (mode === 'compliance') {
    return {
      title: 'Compliance Workspace Login',
      subtitle: 'Internal compliance access requires your assigned name and security key before password sign-in.',
      route: 'compliance',
    };
  }
  if (mode === 'admin_control') {
    return {
      title: 'Admin Control Login',
      subtitle: 'Internal admin control remains operator-only. Use your linked admin account to continue.',
      route: null,
    };
  }
  return {
    title: 'Operations Workspace Login',
    subtitle: 'Internal operations access requires your assigned name and security key before password sign-in.',
    route: 'operations',
  };
}

export default function LogisticsOperatorLoginPage() {
  const { login, setUser, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = useMemo(() => getLoginMode(location.pathname), [location.pathname]);
  const copy = useMemo(() => loginCopy(mode), [mode]);
  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return getSafeNextPath(params.get('next'), mode);
  }, [location.search, mode]);
  const requiresInternalKey = mode === 'operations' || mode === 'compliance';

  const [email, setEmail] = useState('');
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
    if (!authLoading && user && isLogisticsOperator(user)) {
      navigate(nextPath, { replace: true });
    }
  }, [authLoading, user, nextPath, navigate]);

  const resetToFirstStep = () => {
    setPassword('');
    setError('');
    setRequires2FA(false);
    setTwoFACode('');
    setMfaToken(null);
    setInternalAccessToken(null);
    setApprovedIdentity(null);
  };

  async function handleInternalAccessSubmit(e) {
    e.preventDefault();
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
        route: copy.route,
        internal_name: internalName.trim(),
        security_key: securityKey,
      });
      setInternalAccessToken(data.internalAccessToken);
      setApprovedIdentity(data.user);
      setAttempts(0);
      setLockedUntil(null);
      setError('');
    } catch (err) {
      const status = err.response?.status;
      const payload = err.response?.data || {};
      if (status === 423 && payload.lockedUntil) {
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError(payload.message || 'Access temporarily locked. Request a recovery email or contact a super-admin.');
      } else if (status === 401 && payload.lockedUntil) {
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError('Too many failed attempts. Locked until the timer expires.');
      } else if (status === 401 && typeof payload.attemptsLeft === 'number') {
        setAttempts(MAX_ATTEMPTS - payload.attemptsLeft);
        setError(`Invalid credentials. ${payload.attemptsLeft} attempt${payload.attemptsLeft === 1 ? '' : 's'} remaining before lockout.`);
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setError(payload.error || 'Internal access verification failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRecovery() {
    setError('');
    const email = (window.prompt('Enter the recovery email on file:') || '').trim();
    if (!email) return;
    try {
      await api.post('/auth/internal-access/recovery/request', {
        email,
        internal_name: internalName.trim() || undefined,
      });
      setError('If that email is authorised for recovery, a one-time link has been sent. Check your inbox.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not request recovery email.');
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');

    if (isLocked) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      setError(`Too many failed attempts. Try again in ${mins} minute(s).`);
      return;
    }

    if (requiresInternalKey) {
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
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          const lockTime = Date.now() + LOCKOUT_MS;
          setLockedUntil(lockTime);
          setError('Access temporarily locked due to too many failed attempts.');
        } else {
          setError(err.response?.data?.error || 'Login failed. Please check your password.');
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      const data = await login({ email: email.trim().toLowerCase(), password });

      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setMfaToken(data.mfaToken);
        setLoading(false);
        return;
      }

      const loggedInUser = data.user;
      if (!isLogisticsOperator(loggedInUser)) {
        setError('Access denied. Logistics operator privileges required.');
        clearStoredSession();
        setUser(null);
        setLoading(false);
        return;
      }

      setAttempts(0);
      navigate(nextPath, { replace: true });
    } catch (err) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockTime = Date.now() + LOCKOUT_MS;
        setLockedUntil(lockTime);
        setError('Account temporarily locked due to too many failed attempts.');
      } else {
        setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handle2FASubmit(e) {
    e.preventDefault();
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

      if (!isLogisticsOperator(data.user)) {
        setError('Access denied. Logistics operator privileges required.');
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
      setError(err.response?.data?.error || 'Invalid 2FA code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500">OxSteed Logistics</h1>
          <p className="text-gray-400 mt-2">{copy.title}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-2">
            {requires2FA ? 'Two-Factor Authentication' : copy.title}
          </h2>
          <p className="text-sm text-gray-400 mb-6">{copy.subtitle}</p>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {requires2FA ? (
            <form onSubmit={handle2FASubmit} className="space-y-4">
              <p className="text-sm text-gray-400 mb-2">
                Enter the 6-digit code from your authenticator app, or a backup code.
              </p>
              <div>
                <label className="block text-sm text-gray-400 mb-1">2FA Code</label>
                <input
                  type="text"
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition text-center tracking-widest text-lg"
                  placeholder="000000"
                  maxLength={20}
                  autoComplete="one-time-code"
                  disabled={loading}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setRequires2FA(false); setTwoFACode(''); setMfaToken(null); }}
                className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
              >
                Back
              </button>
            </form>
          ) : requiresInternalKey && !approvedIdentity ? (
            <form onSubmit={handleInternalAccessSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Internal name</label>
                <input
                  type="text"
                  value={internalName}
                  onChange={(e) => setInternalName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder="Your assigned internal name"
                  autoComplete="username"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Security key</label>
                <input
                  type="password"
                  value={securityKey}
                  onChange={(e) => setSecurityKey(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder="Security key provided by super-admin"
                  autoComplete="one-time-code"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || isLocked}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition mt-2"
              >
                {loading ? 'Checking...' : isLocked ? 'Access Locked' : 'Continue'}
              </button>
              {isLocked && (
                <button
                  type="button"
                  onClick={handleRequestRecovery}
                  className="w-full mt-2 text-sm text-orange-400 hover:text-orange-300 underline"
                >
                  Request a recovery email
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {requiresInternalKey ? (
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Approved account</div>
                  <div className="text-white font-medium">{approvedIdentity?.email_masked || approvedIdentity?.email}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    This login can only continue with the OxSteed account linked to <strong>{approvedIdentity?.internal_name}</strong>.
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                    placeholder="operator@oxsteed.com"
                    autoComplete="email"
                    disabled={loading || isLocked}
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || isLocked}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition mt-2"
              >
                {loading ? 'Signing in...' : isLocked ? 'Account Locked' : 'Sign In'}
              </button>
              {requiresInternalKey && (
                <button
                  type="button"
                  onClick={resetToFirstStep}
                  className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
                >
                  Use a different internal access identity
                </button>
              )}
            </form>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-gray-500 space-y-2">
          <p>
            {requiresInternalKey
              ? 'Operations and Compliance access now require a super-admin-issued internal name and security key.'
              : 'Only users with admin or super-admin roles can enter this portal.'}
          </p>
          <Link to="/login" className="text-orange-400 hover:text-orange-300 transition-colors">
            Go to the standard OxSteed sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
