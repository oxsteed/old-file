import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// NOTE: Token refresh on 401 is handled by the response interceptor in
// api/auth.js (which imports this same `api` instance and adds its own
// interceptor that correctly sends the refresh token from localStorage).
// Do NOT add a response interceptor here — it would fire first and break
// the refresh flow by sending an empty body to /auth/refresh.

export default api;
