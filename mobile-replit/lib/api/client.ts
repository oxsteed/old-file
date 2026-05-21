import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BASE_URL = "https://oxsteed.com/api";

const ACCESS_TOKEN_KEY = "oxsteed_access_token";
const REFRESH_TOKEN_KEY = "oxsteed_refresh_token";

// SecureStore fallback for web (not supported on web)
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try { localStorage.setItem(key, value); } catch {}
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try { localStorage.removeItem(key); } catch {}
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const tokenStore = {
  getAccessToken: () => storage.getItem(ACCESS_TOKEN_KEY),
  getRefreshToken: () => storage.getItem(REFRESH_TOKEN_KEY),
  setTokens: async (accessToken: string, refreshToken: string) => {
    await Promise.all([
      storage.setItem(ACCESS_TOKEN_KEY, accessToken),
      storage.setItem(REFRESH_TOKEN_KEY, refreshToken),
    ]);
  },
  clearTokens: async () => {
    await Promise.all([
      storage.removeItem(ACCESS_TOKEN_KEY),
      storage.removeItem(REFRESH_TOKEN_KEY),
    ]);
  },
};

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function drainQueue(token: string | null) {
  refreshQueue.forEach((cb) => cb(token));
  refreshQueue = [];
}

export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

  // Attach access token on every request
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const token = await tokenStore.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // Handle 401 → refresh → retry
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config;
      if (error.response?.status !== 401 || original._retry) {
        return Promise.reject(error);
      }
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push((token) => {
            if (!token) return reject(error);
            original.headers.Authorization = `Bearer ${token}`;
            resolve(client(original));
          });
        });
      }

      isRefreshing = true;
      try {
        const refreshToken = await tokenStore.getRefreshToken();
        if (!refreshToken) throw new Error("No refresh token");

        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const newAccess: string = data.accessToken;
        const newRefresh: string = data.refreshToken ?? refreshToken;

        await tokenStore.setTokens(newAccess, newRefresh);
        drainQueue(newAccess);

        original.headers.Authorization = `Bearer ${newAccess}`;
        return client(original);
      } catch (refreshError) {
        await tokenStore.clearTokens();
        drainQueue(null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
  );

  return client;
}

// Singleton — never cache the result; call fresh per-request in hooks
export function getApiClient() {
  return createApiClient();
}
