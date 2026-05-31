import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
      titleKey: 'logistics.operatorLogin.copy.compliance.title',
      subtitleKey: 'logistics.operatorLogin.copy.compliance.subtitle',
      route: 'compliance',
    };
  }
  if (mode === 'admin_control') {
    return {
      titleKey: 'logistics.operatorLogin.copy.adminControl.title',
      subtitleKey: 'logistics.operatorLogin.copy.adminControl.subtitle',
      route: null,
    };
  }
  return {
    titleKey: 'logistics.operatorLogin.copy.operations.title',
    subtitleKey: 'logistics.operatorLogin.copy.operations.subtitle',
    route: 'operations',
  };
}

export default function LogisticsOperatorLoginPage() {
  const { t } = useTranslation();
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
      setError(t('logistics.operatorLogin.errors.tooManyAttempts', { minutes: mins }));
      return;
    }

    if (!internalName.trim() || !securityKey.trim()) {
      setError(t('logistics.operatorLogin.errors.internalNameAndKeyRequired'));
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
        setError(payload.message || t('logistics.operatorLogin.errors.lockedRecovery'));
      } else if (status === 401 && payload.lockedUntil) {
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError(t('logistics.operatorLogin.errors.tooManyAttemptsLocked'));
      } else if (status === 401 && typeof payload.attemptsLeft === 'number') {
        setAttempts(MAX_ATTEMPTS - payload.attemptsLeft);
        setError(t('logistics.operatorLogin.errors.invalidCredentialsRemaining', {
          attemptsLeft: payload.attemptsLeft,
        }));
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setError(payload.error || t('logistics.operatorLogin.errors.internalAccessFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRecovery() {
    setError('');
    const email = (window.prompt(t('logistics.operatorLogin.recoveryPrompt')) || '').trim();
    if (!email) return;
    try {
      await api.post('/auth/internal-access/recovery/request', {
        email,
        internal_name: internalName.trim() || undefined,
      });
      setError(t('logistics.operatorLogin.errors.recoveryEmailSent'));
    } catch (err) {
      setError(err.response?.data?.error || t('logistics.operatorLogin.errors.recoveryEmailFailed'));
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');

    if (isLocked) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      setError(t('logistics.operatorLogin.errors.tooManyAttempts', { minutes: mins }));
      return;
    }

    if (requiresInternalKey) {
      if (!internalAccessToken || !approvedIdentity) {
        setError(t('logistics.operatorLogin.errors.internalAccessRequired'));
        return;
      }
      if (!password) {
        setError(t('logistics.operatorLogin.errors.passwordRequired'));
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
          setError(t('logistics.operatorLogin.errors.passwordLocked'));
        } else {
          setError(err.response?.data?.error || t('logistics.operatorLogin.errors.passwordFailed'));
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email || !password) {
      setError(t('logistics.operatorLogin.errors.emailAndPasswordRequired'));
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
        setError(t('logistics.operatorLogin.errors.operatorPrivilegesRequired'));
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
        setError(t('logistics.operatorLogin.errors.accountLocked'));
      } else {
        setError(err.response?.data?.error || t('logistics.operatorLogin.errors.credentialsFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handle2FASubmit(e) {
    e.preventDefault();
    setError('');

    if (!twoFACode || !mfaToken) {
      setError(!mfaToken ? t('logistics.operatorLogin.errors.twoFaExpired') : t('logistics.operatorLogin.errors.twoFaCodeRequired'));
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
        setError(t('logistics.operatorLogin.errors.operatorPrivilegesRequired'));
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
      setError(err.response?.data?.error || t('logistics.operatorLogin.errors.invalid2Fa'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500">OxSteed Logistics</h1>
          <p className="text-gray-400 mt-2">{t(copy.titleKey)}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-2">
            {requires2FA ? t('logistics.operatorLogin.twoFaTitle') : t(copy.titleKey)}
          </h2>
          <p className="text-sm text-gray-400 mb-6">{t(copy.subtitleKey)}</p>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {requires2FA ? (
            <form onSubmit={handle2FASubmit} className="space-y-4">
              <p className="text-sm text-gray-400 mb-2">{t('logistics.operatorLogin.twoFaPrompt')}</p>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('logistics.operatorLogin.labels.twoFaCode')}</label>
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
                {loading ? t('logistics.operatorLogin.verifying') : t('logistics.operatorLogin.verify')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRequires2FA(false);
                  setTwoFACode('');
                  setMfaToken(null);
                }}
                className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
              >
                {t('common.back')}
              </button>
            </form>
          ) : requiresInternalKey && !approvedIdentity ? (
            <form onSubmit={handleInternalAccessSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('logistics.operatorLogin.labels.internalName')}</label>
                <input
                  type="text"
                  value={internalName}
                  onChange={(e) => setInternalName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder={t('logistics.operatorLogin.placeholders.internalName')}
                  autoComplete="username"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('logistics.operatorLogin.labels.securityKey')}</label>
                <input
                  type="password"
                  value={securityKey}
                  onChange={(e) => setSecurityKey(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder={t('logistics.operatorLogin.placeholders.securityKey')}
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
                {loading ? t('logistics.operatorLogin.checking') : isLocked ? t('logistics.operatorLogin.locked') : t('logistics.operatorLogin.continue')}
              </button>
              {isLocked && (
                <button
                  type="button"
                  onClick={handleRequestRecovery}
                  className="w-full mt-2 text-sm text-orange-400 hover:text-orange-300 underline"
                >
                  {t('logistics.operatorLogin.requestRecoveryEmail')}
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {requiresInternalKey ? (
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{t('logistics.operatorLogin.approvedAccountLabel')}</div>
                  <div className="text-white font-medium">{approvedIdentity?.email_masked || approvedIdentity?.email}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {t('logistics.operatorLogin.approvedAccountNote')}
                    {approvedIdentity?.internal_name ? (
                      <strong> {approvedIdentity.internal_name}</strong>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">{t('logistics.operatorLogin.labels.email')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                    placeholder={t('logistics.operatorLogin.placeholders.email')}
                    autoComplete="email"
                    disabled={loading || isLocked}
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('logistics.operatorLogin.labels.password')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder={t('logistics.operatorLogin.placeholders.password')}
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
                {loading
                  ? t('logistics.operatorLogin.signingIn')
                  : isLocked ? t('logistics.operatorLogin.locked') : t('logistics.operatorLogin.signIn')}
              </button>
              {requiresInternalKey && (
                <button
                  type="button"
                  onClick={resetToFirstStep}
                  className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
                >
                  {t('logistics.operatorLogin.resetIdentity')}
                </button>
              )}
            </form>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-gray-500 space-y-2">
          <p>
            {requiresInternalKey
              ? t('logistics.operatorLogin.footer.internalKeyRequired')
              : t('logistics.operatorLogin.footer.adminOnly')}
          </p>
          <Link to="/login" className="text-orange-400 hover:text-orange-300 transition-colors">
            {t('logistics.operatorLogin.footer.standardSignIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}
