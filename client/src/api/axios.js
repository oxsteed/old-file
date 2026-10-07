import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

function getPreferredLanguage() {
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem('oxs:language')
    : null;
  if (stored) return stored.trim().toLowerCase().split(/[-_]/)[0] || 'en';

  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return browserLanguage.trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

// Attach token to every request.
// The access token lives in the httpOnly oxsteed_access cookie (sent
// automatically via withCredentials). JS never reads it from localStorage
// (XSS vector). Impersonation sessions store a short-lived token in
// sessionStorage so the admin's normal session is never disturbed.
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('oxs:impersonation_token');

  // Only add Authorization header for impersonation; the normal session
  // authenticates via the httpOnly cookie.
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Audit L11: no console logging of request URLs here. URLs can carry
  // tokens/ids in query strings, and console output is visible to anyone
  // with the devtools open (plus some extensions scrape it).

  config.headers = config.headers || {};
  const preferredLanguage = getPreferredLanguage();
  config.headers['Accept-Language'] = preferredLanguage;
  config.headers['X-OxSteed-Language'] = preferredLanguage;

  return config;
});

// NOTE: Token refresh on 401 is handled by the response interceptor in
// api/auth.js (which imports this same `api` instance and adds its own
// interceptor that correctly sends the refresh token from localStorage).
// Do NOT add a response interceptor here - it would fire first and break
// the refresh flow by sending an empty body to /auth/refresh.

export default api;
