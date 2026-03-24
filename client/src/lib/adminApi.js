import axios from 'axios';

const adminApi = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
});

// Attach token automatically
adminApi.interceptors.request.use(config => {
  const token = localStorage.getItem('oxsteed_token');
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
