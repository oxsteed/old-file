import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// Attach token to every request.
// Impersonation sessions store a short-lived token in sessionStorage so the
// admin's normal access token in localStorage is never overwritten.
api.interceptors.request.use((config) => {
  const token =
    sessionStorage.getItem('oxs:impersonation_token') ||
    localStorage.getItem('accessToken');

  // Always add Authorization header if token exists
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    // Log missing token for debugging
    console.warn('[axios] No access token found for request:', {
      method: config.method,
      url: config.url,
    });
  }

  return config;
});

// NOTE: Token refresh on 401 is handled by the response interceptor in
// api/auth.js (which imports this same `api` instance and adds its own
// interceptor that correctly sends the refresh token from localStorage).
// Do NOT add a response interceptor here - it would fire first and break
// the refresh flow by sending an empty body to /auth/refresh.

export default api;
