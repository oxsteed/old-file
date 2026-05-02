/**
 * ImpersonatePage — /impersonate?token=<jwt>
 *
 * A super-admin who clicks "Login as User" lands here in a new tab.
 * The page reads the impersonation JWT from the URL, stores it in
 * sessionStorage (isolated to this tab), then redirects to the home page.
 * The ImpersonationBanner component (rendered globally in App.jsx) detects
 * the sessionStorage key and shows the orange "You are viewing as …" bar.
 */
import { useEffect, useState } from 'react';
import { useNavigate }         from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

export const IMPERSONATION_TOKEN_KEY = 'oxs:impersonation_token';
export const IMPERSONATION_USER_KEY  = 'oxs:impersonation_user';
export const IMPERSONATION_JTI_KEY   = 'oxs:impersonation_jti';

/** Decode the payload of a JWT without verifying the signature (client-side only). */
function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export default function ImpersonatePage() {
  const navigate = useNavigate();
  const [error,  setError]  = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');

    if (!token) {
      setError('No impersonation token found in URL.');
      return;
    }

    const payload = decodeJwtPayload(token);
    if (!payload?.impersonation) {
      setError('Invalid or non-impersonation token.');
      return;
    }

    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      setError('Impersonation token has expired. Please generate a new one.');
      return;
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

    // Redirect to the homepage as the impersonated user
    navigate('/', { replace: true });
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-gray-900 border border-red-800 rounded-2xl p-8 text-center">
          <AlertCircle className="mx-auto mb-4 text-red-400" size={40} />
          <h1 className="text-white font-bold text-xl mb-2">Impersonation Error</h1>
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => window.close()}
            className="mt-6 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition"
          >
            Close Tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loader2 className="animate-spin" size={32} />
        <p className="text-sm">Starting impersonation session…</p>
      </div>
    </div>
  );
}
