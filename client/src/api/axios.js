import axios from 'axios';
import { existingPromotionVisitorId, isPromotionConversionRequest } from '../utils/promotionVisitor';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  // Review P1-114: tells the server this is the cookie-based web client, so
  // session responses omit raw tokens.
  headers: { 'X-OxSteed-Client': 'web' },
});

function getPreferredLanguage() {
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem('oxs:language')
    : null;
  if (stored) return stored.trim().toLowerCase().split(/[-_]/)[0] || 'en';

  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return browserLanguage.trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

// Review P2-6-F12: stable device fingerprint for abuse detection (referral
// farming). A random id persisted in localStorage; the server treats it as
// an opaque, non-PII signal and only uses it to spot many signups from one
// device. Fail silent: registration must never break on storage errors.
function getDeviceFingerprint() {
  try {
    if (typeof localStorage === 'undefined') return null;
    let id = localStorage.getItem('ox_device_id');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('ox_device_id', id);
    }
    return id;
  } catch {
    return null;
  }
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

  // Review P2-6-F12: device fingerprint for abuse detection.
  const deviceFingerprint = getDeviceFingerprint();
  if (deviceFingerprint) config.headers['X-Device-Fingerprint'] = deviceFingerprint;

  // Growth Center attribution: a checkout POST carries the tracked-visit
  // device id, if one exists, so the server can credit that visit.
  if (isPromotionConversionRequest(config)) {
    const promoVisitor = existingPromotionVisitorId();
    if (promoVisitor) config.headers['X-Promo-Visitor'] = promoVisitor;
  }

  return config;
});

// NOTE: Token refresh on 401 is handled by the response interceptor in
// api/auth.js (which imports this same `api` instance and adds its own
// interceptor that uses the HttpOnly refresh cookie, with one-time migration
// of legacy browser credentials only when the server reports no cookie).
// Do NOT add a response interceptor here - it would fire first and break
// the refresh flow by sending an empty body to /auth/refresh.

export default api;
