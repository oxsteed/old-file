import axios from 'axios';

/** API root for admin requests (must end with `/api` - same convention as `client/src/api/axios.js`). */
function adminApiBaseURL() {
  const raw = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  if (!raw) return '/api';
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

const adminApi = axios.create({
    baseURL: adminApiBaseURL(),
    withCredentials: true
});

// Attach token automatically.
// Impersonation sessions store a short-lived token in sessionStorage to avoid
// overwriting the admin's normal localStorage token in their original tab.
adminApi.interceptors.request.use(config => {
    const token =
        sessionStorage.getItem('oxs:impersonation_token') ||
        localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Redirect to admin login on 401/403
adminApi.interceptors.response.use(
    res => res,
    err => {
        if ([401, 403].includes(err.response?.status)) {
            window.location.href = '/admin/login';
        }
        return Promise.reject(err);
    }
);

export default adminApi;
