import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import api, { clearStoredSession, persistSessionPayload } from '../../api/auth';
import { startAuthentication } from '@simplewebauthn/browser';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export default function AdminLogin() {
  const { t } = useTranslation();
  const { login, setUser, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
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
  const [gateEnforced, setGateEnforced] = useState(false);
  const [gateReady, setGateReady] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const isLocked = lockedUntil && Date.now() < lockedUntil;

  useEffect(() => {
    if (!authLoading && user && ['admin', 'super_admin'].includes(user.role)) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [authLoading, navigate, user]);

  useEffect(() => {
    let active = true;
    api.get('/auth/internal-access/config', { params: { route: 'admin_portal' } })
      .then(({ data }) => {
        if (!active) return;
        setGateEnforced(!!data?.enforced);
      })
      .catch(() => {
        if (!active) return;
        setGateEnforced(false);
      })
      .finally(() => {
        if (active) setGateReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const resetToFirstStep = () => {
    setPassword('');
    setEmail('');
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
      setError(t('adminLogin.tooManyAttempts', { mins }));
      return;
    }

    if (!internalName.trim() || !securityKey.trim()) {
      setError(t('adminLogin.nameAndKeyRequired'));
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/internal-access/verify', {
        route: 'admin_portal',
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
      // Server-side 24h lockout (423) — authoritative across page reloads.
      if (status === 423 && payload.lockedUntil) {
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError(payload.message || t('adminLogin.lockedRecovery'));
      } else if (status === 401 && payload.lockedUntil) {
        // We were just locked on this attempt.
        setLockedUntil(new Date(payload.lockedUntil).getTime());
        setError(t('adminLogin.lockedUntilTimer'));
      } else if (status === 401 && typeof payload.attemptsLeft === 'number') {
        // Surface server's remaining count instead of the local one.
        setAttempts(MAX_ATTEMPTS - payload.attemptsLeft);
        setError(t('adminLogin.invalidCredentials', { left: payload.attemptsLeft }));
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setError(payload.error || t('adminLogin.internalAccessFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRecovery() {
    setError('');
    const email = (window.prompt(t('adminLogin.recoveryPrompt')) || '').trim();
    if (!email) return;
    try {
      await api.post('/auth/internal-access/recovery/request', {
        email,
        internal_name: internalName.trim() || undefined,
      });
      setError(t('adminLogin.recoverySent'));
    } catch (err) {
      setError(err.response?.data?.error || t('adminLogin.recoveryFailed'));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (isLocked) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      setError(t('adminLogin.tooManyAttempts', { mins }));
      return;
    }

    if (gateEnforced) {
      if (!internalAccessToken || !approvedIdentity) {
        setError(t('adminLogin.completeInternalAccess'));
        return;
      }
      if (!password) {
        setError(t('adminLogin.passwordRequired'));
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
        navigate('/admin/dashboard', { replace: true });
      } catch (err) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          const lockTime = Date.now() + LOCKOUT_MS;
          setLockedUntil(lockTime);
          setError(t('adminLogin.lockedTooManyAttempts'));
        } else {
          setError(err.response?.data?.error || t('adminLogin.loginFailedPassword'));
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email || !password) {
      setError(t('adminLogin.emailPasswordRequired'));
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
      if (!['admin', 'super_admin'].includes(loggedInUser.role)) {
        setError(t('adminLogin.accessDenied'));
        clearStoredSession();
        setUser(null);
        setLoading(false);
        return;
      }

      setAttempts(0);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockTime = Date.now() + LOCKOUT_MS;
        setLockedUntil(lockTime);
        setError(t('adminLogin.accountLocked'));
      } else {
        setError(err.response?.data?.error || t('adminLogin.loginFailedCredentials'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handle2FASubmit(e) {
    e.preventDefault();
    setError('');

    if (!twoFACode || !mfaToken) {
      setError(!mfaToken ? t('adminLogin.sessionExpired') : t('adminLogin.enter2FACode'));
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/login/2fa', {
        mfaToken,
        token: twoFACode,
        isBackupCode: twoFACode.length > 6,
      });

      if (!['admin', 'super_admin'].includes(data.user.role)) {
        setError(t('adminLogin.accessDenied'));
        clearStoredSession();
        setUser(null);
        setLoading(false);
        return;
      }

      persistSessionPayload(data);
      setUser(data.user);
      setAttempts(0);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || t('adminLogin.invalid2FACode'));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeySubmit() {
    if (!mfaToken || passkeyBusy || !window.PublicKeyCredential) return;
    setError('');
    setPasskeyBusy(true);
    try {
      const { data: optionsData } = await api.post('/auth/login/passkey/options', { mfaToken });
      const response = await startAuthentication({ optionsJSON: optionsData.options });
      const { data } = await api.post('/auth/login/passkey', { mfaToken, response });
      if (!['admin', 'super_admin'].includes(data.user?.role)) {
        clearStoredSession();
        setUser(null);
        throw new Error(t('adminLogin.accessDenied'));
      }
      persistSessionPayload(data);
      setUser(data.user);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        setError(err.response?.data?.error || err.message || t('adminLogin.passkeyFailed'));
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  if (!gateReady || authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500">OxSteed</h1>
          <p className="text-gray-400 mt-2">{t('adminLogin.portalTitle')}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-2">
            {requires2FA ? t('adminLogin.twoFactor') : t('adminLogin.signIn')}
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            {gateEnforced ? t('adminLogin.gateEnforcedDesc') : t('adminLogin.gateOpenDesc')}
          </p>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {requires2FA ? (
            <form onSubmit={handle2FASubmit} className="space-y-4">
              <p className="text-sm text-gray-400 mb-2">
                {t('adminLogin.twoFactorHelp')}
              </p>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('adminLogin.twoFactorLabel')}</label>
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
                {loading ? t('adminLogin.verifying') : t('adminLogin.verify')}
              </button>
              {typeof window !== 'undefined' && window.PublicKeyCredential && (
                <button
                  type="button"
                  onClick={handlePasskeySubmit}
                  disabled={loading || passkeyBusy}
                  className="w-full border border-orange-500/60 text-orange-400 hover:bg-orange-500/10 disabled:opacity-50 font-semibold py-3 rounded-lg transition"
                >
                  {passkeyBusy ? t('adminLogin.checkingPasskey') : t('adminLogin.usePasskey')}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setRequires2FA(false); setTwoFACode(''); setMfaToken(null); setError(''); }}
                className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
              >
                {t('adminLogin.backToLogin')}
              </button>
            </form>
          ) : gateEnforced && !approvedIdentity ? (
            <form onSubmit={handleInternalAccessSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('adminLogin.internalNameLabel')}</label>
                <input
                  type="text"
                  value={internalName}
                  onChange={(e) => setInternalName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder={t('adminLogin.internalNamePlaceholder')}
                  autoComplete="username"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('adminLogin.securityKeyLabel')}</label>
                <input
                  type="password"
                  value={securityKey}
                  onChange={(e) => setSecurityKey(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder={t('adminLogin.securityKeyPlaceholder')}
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
                {loading ? t('adminLogin.checking') : isLocked ? t('adminLogin.accessLocked') : t('adminLogin.continue')}
              </button>
              {isLocked && (
                <button
                  type="button"
                  onClick={handleRequestRecovery}
                  className="w-full mt-2 text-sm text-orange-400 hover:text-orange-300 underline"
                >
                  {t('adminLogin.requestRecovery')}
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {gateEnforced ? (
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{t('adminLogin.approvedAccount')}</div>
                  <div className="text-white font-medium">{approvedIdentity?.email_masked || approvedIdentity?.email}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {t('adminLogin.linkedAccountNote', { name: approvedIdentity?.internal_name })}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">{t('adminLogin.emailLabel')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                    placeholder="admin@oxsteed.com"
                    autoComplete="email"
                    disabled={loading || isLocked}
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('adminLogin.passwordLabel')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder={t('adminLogin.passwordPlaceholder')}
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
                {loading ? t('adminLogin.signingIn') : isLocked ? t('adminLogin.accountLockedBtn') : t('adminLogin.signIn')}
              </button>
              {gateEnforced && (
                <button
                  type="button"
                  onClick={resetToFirstStep}
                  className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
                >
                  {t('adminLogin.useDifferentIdentity')}
                </button>
              )}
            </form>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          {t('adminLogin.footerNote')}
        </p>
      </div>
    </div>
  );
}
