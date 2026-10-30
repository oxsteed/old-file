import api from './axios';
import { setCsrfToken, clearCsrfToken } from './csrfToken';
import { createAdminChallengeHandler } from './adminChallenge.mjs';
import { withCrossTabRefreshLock } from './authRefreshCoordinator';
import { isTransientRefreshFailure } from './authRefreshPolicy';
import { clearSupportChatStorage } from '../lib/supportChatStorage';
import { advanceAuthEpoch, currentAuthEpoch, isCurrentAuthEpoch, assertCurrentAuthEpoch, isCredentialRequest } from './authSessionEpoch';
import { broadcastAuthSession } from './authSessionSync';

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USER_KEY = 'user';

function setStoredAccessToken(_token) {
  // The access token is set as an httpOnly cookie by the server on
  // login/2FA/refresh. We intentionally do NOT store it in localStorage
  // to prevent XSS theft. The cookie is sent automatically with requests.
  // Remove pre-cookie credentials after a successful session handoff.
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

// H8d: the refresh token is no longer persisted to localStorage on web. The
// server sets it as an httpOnly + Secure + SameSite cookie on login/refresh,
// so XSS cannot steal it. Native clients receive the token in the JSON body
// as before; this web helper only removes superseded legacy credentials.
function setStoredRefreshToken(_token) {
  // Never leave a legacy token shadowing the freshly rotated cookie. Reusing
  // that invalidated token would trigger the server's session-reuse protection.
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function setStoredUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

function clearStoredSession({ broadcast = true, reason = 'session-cleared' } = {}) {
  clearCsrfToken();
  advanceAuthEpoch();
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Support chat history can quote balances and payouts; never leave it for
  // the next person on a shared device.
  clearSupportChatStorage();
  delete api.defaults.headers.common.Authorization;
  if (broadcast) broadcastAuthSession({ type: 'session-cleared', reason });
}

function persistSessionPayload(data = {}, { sessionTransition = true } = {}) {
  if (sessionTransition && (data.user || data.accessToken || data.refreshToken)) advanceAuthEpoch();
  // Web responses intentionally omit raw tokens. A verified cookie handoff
  // must still retire pre-cookie credentials, or a later no-cookie fallback
  // can reuse a revoked legacy token.
  const establishedSession = data.user || data.success || data.accessToken || data.refreshToken;
  if (establishedSession) {
    setStoredAccessToken(data.accessToken);
    setStoredRefreshToken(data.refreshToken);
  }

  if (data.user) {
    setStoredUser(data.user);
  }
}

export function getAccessToken() {
  // The access token lives in the httpOnly cookie and is not readable from
  // JS. Returns the impersonation token when one is active, else null.
  // Kept for API compatibility.
  return sessionStorage.getItem('oxs:impersonation_token');
}

// Returns a locally stored refresh token if one exists (pre-migration
// sessions). New sessions rely on the httpOnly cookie, which JS cannot read;
// the refresh interceptor sends the cookie automatically via withCredentials.
// A stored body token is a one-time fallback only for the explicit no_token code.
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let refreshFlight = null;
const REFRESH_TIMEOUT_MS = 10000;
function requireRefreshProof(response) {
  if (!response.data?.success && !response.data?.user && !response.data?.accessToken) {
    const error = new Error('Refresh response did not verify the session.');
    error.code = 'AUTH_REFRESH_UNVERIFIED';
    throw error;
  }
}
const handleAdminChallenge = typeof window === 'undefined'
  ? () => {}
  : createAdminChallengeHandler(window.location);

async function requestSessionRefresh() {
  const epoch = currentAuthEpoch();
  if (refreshFlight?.epoch === epoch) return refreshFlight.promise;
  const promise = withCrossTabRefreshLock(() => {
    assertCurrentAuthEpoch(epoch);
    return performSessionRefresh(epoch);
  });
  refreshFlight = { epoch, promise };
  const clear = () => { if (refreshFlight?.promise === promise) refreshFlight = null; };
  promise.then(clear, clear);
  return promise;
}

async function performSessionRefresh(epoch) {
  let response;
  try {
    // The current HttpOnly cookie is authoritative. A legacy body token can
    // otherwise shadow it and revoke a perfectly valid newly signed-in session.
    response = await api.post('/auth/refresh', {}, { timeout: REFRESH_TIMEOUT_MS });
  } catch (error) {
    assertCurrentAuthEpoch(epoch);
    const legacyToken = getRefreshToken();
    // Migrate an old browser only when the server explicitly has no cookie.
    // Never fall back after expiry, reuse, revocation, throttling or an outage.
    if (error.response?.status !== 401 || error.response?.data?.code !== 'no_token' || !legacyToken) {
      throw error;
    }
    response = await api.post('/auth/refresh', { refreshToken: legacyToken }, { timeout: REFRESH_TIMEOUT_MS });
  }
  assertCurrentAuthEpoch(epoch);
  requireRefreshProof(response);
  persistSessionPayload(response.data, { sessionTransition: false });
  return response;
}

api.interceptors.response.use(
  (response) => {
    // Pentest fix: capture the CSRF token the server attaches to
    // authenticated responses so the axios request interceptor can send
    // it on later state-changing requests.
    const token = response?.headers?.['x-csrf-token'];
    if (token) setCsrfToken(token);
    return response;
  },
  async (error) => {
    handleAdminChallenge(error);
    const originalRequest = error.config;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    const isRefreshRequest = originalRequest.url?.includes('/auth/refresh');

    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      isRefreshRequest || isCredentialRequest(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const epoch = originalRequest._authEpoch;
    if (!isCurrentAuthEpoch(epoch)) return Promise.reject(error);

    try {
      const response = await requestSessionRefresh();
      assertCurrentAuthEpoch(epoch);
      // The server rotated the httpOnly cookies (access + refresh). The retry
      // below authenticates via the cookie automatically (withCredentials);
      // nothing is written to localStorage (XSS vector).
      if (response.data?.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
      }

      // Rebuild the retry config without a stale Authorization header. The
      // httpOnly cookie carries the fresh access token.
      const { Authorization, ...restHeaders } = originalRequest.headers || {};
      originalRequest.headers = restHeaders;

      return api(originalRequest);
    } catch (refreshError) {
      // Keep the refresh token for transient outages so a visible retry can
      // recover the current page once the API/database is healthy again.
      if (isCurrentAuthEpoch(epoch) && !isTransientRefreshFailure(refreshError)) {
        clearStoredSession();
        // Tell the React auth state the session is dead. clearStoredSession
        // only wipes storage; without this the in-memory user survives and
        // the login page bounces straight back to the dashboard.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('oxsteed:session-expired'));
        }
      }
      // Don't hard-redirect - let ProtectedRoute handle navigation
      return Promise.reject(refreshError);
    }
  },
);

export const authAPI = {
  login: async (credentials) => {
    const response = await api.post('/auth/login', credentials);
    persistSessionPayload(response.data);
    return response;
  },

  loginWith2FA: async (payload) => {
    const response = await api.post('/auth/login/2fa', payload);
    persistSessionPayload(response.data);
    return response;
  },

  requestOTP: async (data) => {
    return api.post('/auth/request-otp', data);
  },

  verifyOTP: async (data) => {
    const response = await api.post('/auth/verify-otp', data);
    persistSessionPayload(response.data);
    return response;
  },

  refresh: async (refreshToken) => {
    if (!refreshToken) return requestSessionRefresh();
    const epoch = currentAuthEpoch();
    return withCrossTabRefreshLock(async () => {
      assertCurrentAuthEpoch(epoch);
      const response = await api.post('/auth/refresh', { refreshToken }, { timeout: REFRESH_TIMEOUT_MS });
      assertCurrentAuthEpoch(epoch);
      requireRefreshProof(response);
      persistSessionPayload(response.data, { sessionTransition: false });
      return response;
    });
  },

  me: async () => {
    const response = await api.get('/auth/me');
    const user = response.data?.user || response.data;
    if (user) {
      setStoredUser(user);
    }
    return response;
  },

  logout: async (refreshToken) => {
    try {
      return await api.post('/auth/logout', { refreshToken });
    } finally {
      clearStoredSession();
    }
  },

  forgotPassword: async (email) => {
    return api.post('/auth/forgot-password', { email });
  },

  resetPassword: async (payload) => {
    return api.post('/auth/reset-password', payload);
  },
};

export { persistSessionPayload, clearStoredSession };
export default api;
