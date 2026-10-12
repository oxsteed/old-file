import api from './axios';
import { createAdminChallengeHandler } from './adminChallenge.mjs';
import { withCrossTabRefreshLock } from './authRefreshCoordinator';
import { isTransientRefreshFailure } from './authRefreshPolicy';

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

function clearStoredSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  delete api.defaults.headers.common.Authorization;
}

function persistSessionPayload(data = {}) {
  if (data.accessToken) {
    setStoredAccessToken(data.accessToken);
  }

  if (data.refreshToken) {
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

let refreshPromise = null;
const handleAdminChallenge = typeof window === 'undefined'
  ? () => {}
  : createAdminChallengeHandler(window.location);

async function requestSessionRefresh() {
  return withCrossTabRefreshLock(performSessionRefresh);
}

async function performSessionRefresh() {
  let response;
  try {
    // The current HttpOnly cookie is authoritative. A legacy body token can
    // otherwise shadow it and revoke a perfectly valid newly signed-in session.
    response = await api.post('/auth/refresh', {});
  } catch (error) {
    const legacyToken = getRefreshToken();
    // Migrate an old browser only when the server explicitly has no cookie.
    // Never fall back after expiry, reuse, revocation, throttling or an outage.
    if (error.response?.status !== 401 || error.response?.data?.code !== 'no_token' || !legacyToken) {
      throw error;
    }
    response = await api.post('/auth/refresh', { refreshToken: legacyToken });
  }
  persistSessionPayload(response.data);
  return response;
}

api.interceptors.response.use(
  (response) => response,
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
      isRefreshRequest
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      refreshPromise =
        refreshPromise ||
        requestSessionRefresh();

      const response = await refreshPromise;
      const newAccessToken = response.data?.accessToken;

      if (!newAccessToken) {
        clearStoredSession();
        return Promise.reject(error);
      }

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
      if (!isTransientRefreshFailure(refreshError)) {
        clearStoredSession();
      }
      // Don't hard-redirect - let ProtectedRoute handle navigation
      return Promise.reject(refreshError);
    } finally {
      refreshPromise = null;
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
    const response = await api.post('/auth/refresh', { refreshToken });
    persistSessionPayload(response.data);
    return response;
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
