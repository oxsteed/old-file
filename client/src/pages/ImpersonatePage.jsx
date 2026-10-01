/**
 * ImpersonatePage — /impersonate?code=<one-time-code> (or legacy ?token=<jwt>)
 *
 * H8b: the impersonation JWT no longer travels in the URL. The admin console
 * opens this page with a short-lived, single-use exchange code; the page
 * swaps it for the JWT via an authenticated POST, then stores the token in
 * sessionStorage (isolated to this tab) and redirects home. The legacy
 * ?token= path is kept until the server stops issuing raw tokens (see the
 * workstream-1 report for the server patch).
 */
import { useEffect, useState } from 'react';
import { useNavigate }         from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import {
  IMPERSONATION_TOKEN_KEY,
  IMPERSONATION_USER_KEY,
  IMPERSONATION_JTI_KEY,
} from '../lib/impersonationStorage';

/** Decode the payload of a JWT without verifying the signature (client-side only). */
function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function storeImpersonationSession(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.impersonation) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // Store in sessionStorage (tab-isolated — does NOT overwrite the admin's
  // localStorage access token in the original tab).
  sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
  sessionStorage.setItem(IMPERSONATION_USER_KEY,  JSON.stringify({
    id:         payload.id,
    email:      payload.email,
    role:       payload.role,
    impersonated_by: payload.impersonated_by,
  }));
  if (payload.jti) {
    sessionStorage.setItem(IMPERSONATION_JTI_KEY, payload.jti);
  }
  return { ok: true };
}

export default function ImpersonatePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error,  setError]  = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function redeem() {
      const params = new URLSearchParams(window.location.search);
      const code  = params.get('code');
      const token = params.get('token');

      if (code) {
        // H8b: one-time exchange-code flow. The admin's own Bearer token is
        // attached automatically; the code is single-use and short-lived.
        try {
          const { data } = await api.post('/admin/users/impersonate/exchange', { code });
          if (cancelled) return;
          if (!data?.impersonationToken) {
            setError(t('impersonatePage.errors.invalidToken'));
            return;
          }
          const stored = storeImpersonationSession(data.impersonationToken);
          if (!stored.ok) {
            setError(stored.reason === 'expired'
              ? t('impersonatePage.errors.expiredToken')
              : t('impersonatePage.errors.invalidToken'));
            return;
          }
          navigate('/', { replace: true });
        } catch (err) {
          if (cancelled) return;
          const status = err?.response?.status;
          setError(status === 410
            ? t('impersonatePage.errors.expiredToken')
            : (err?.response?.data?.error || t('impersonatePage.errors.invalidToken')));
        }
        return;
      }

      if (!token) {
        setError(t('impersonatePage.errors.noToken'));
        return;
      }

      // Legacy ?token= path (pre-exchange-flow servers).
      const stored = storeImpersonationSession(token);
      if (!stored.ok) {
        setError(stored.reason === 'expired'
          ? t('impersonatePage.errors.expiredToken')
          : t('impersonatePage.errors.invalidToken'));
        return;
      }
      navigate('/', { replace: true });
    }

    redeem();
    return () => { cancelled = true; };
  }, [navigate, t]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-gray-900 border border-red-800 rounded-2xl p-8 text-center">
        <AlertCircle className="mx-auto mb-4 text-red-400" size={40} />
        <h1 className="text-white font-bold text-xl mb-2">{t('impersonatePage.title')}</h1>
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => window.close()}
          className="mt-6 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition"
        >
          {t('impersonatePage.actions.closeTab')}
        </button>
      </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loader2 className="animate-spin" size={32} />
        <p className="text-sm">{t('impersonatePage.loading')}</p>
      </div>
    </div>
  );
}
