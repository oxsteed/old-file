import api from './axios';

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USER_KEY = 'user';

function setStoredAccessToken(token) {
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  }
}

function setStoredRefreshToken(token) {
  if (token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  }
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
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

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

api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    const isRefreshRequest = originalRequest.url?.includes('/auth/refresh');
    const isMeRequest = originalRequest.url?.includes('/auth/me');

    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      isRefreshRequest ||
      isMeRequest
    ) {
      return Promise.reject(error);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearStoredSession();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      refreshPromise =
        refreshPromise ||
        api.post('/auth/refresh', { refreshToken });

      const response = await refreshPromise;
      refreshPromise = null;

      persistSessionPayload(response.data);

      const newAccessToken = response.data?.accessToken;
      if (newAccessToken) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      }

      return api(originalRequest);
    } catch (refreshError) {
      refreshPromise = null;
      clearStoredSession();
      return Promise.reject(refreshError);
    }
  },
);

export const authAPI = {
  register: async (userData) => {
    const response = await api.post('/auth/register', userData);
    persistSessionPayload(response.data);
    return response;
  },

  login: async (credentials) => {
    const response = await api.post('/auth/login', credentials);
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
