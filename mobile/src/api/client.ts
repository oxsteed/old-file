import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import type { AuthResponse, AuthUser, JobPostPayload, MobileFeed, RegisterPayload } from "./types";

const ACCESS_TOKEN_KEY = "oxsteed.mobile.accessToken";
const REFRESH_TOKEN_KEY = "oxsteed.mobile.refreshToken";
const USER_KEY = "oxsteed.mobile.user";

const apiBaseUrl =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ||
  "https://oxsteed.com/api";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  authenticated?: boolean;
  retryOnUnauthorized?: boolean;
};

export class OxSteedApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.name = "OxSteedApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function persistSession(payload: AuthResponse) {
  if (payload.accessToken) {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, payload.accessToken);
  }
  if (payload.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, payload.refreshToken);
  }
  if (payload.user) {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(payload.user));
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (options.authenticated) {
    const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }

  const url = `${apiBaseUrl}/${path.replace(/^\/+/, "")}`;
  if (__DEV__) {
    console.info("[OxSteed API]", method, url);
  }

  const response = await fetch(url, { method, headers, body });
  const payload = await readJson(response);

  if (response.status === 401 && options.authenticated && options.retryOnUnauthorized !== false) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return request<T>(path, { ...options, retryOnUnauthorized: false });
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload
        ? (payload.error as string | undefined) ||
          (payload.message as string | undefined) ||
          Object.values((payload.fields as Record<string, string> | undefined) ?? {})[0]
        : undefined;
    throw new OxSteedApiError(
      response.status,
      message || `OxSteed request failed (${response.status})`,
      typeof payload === "object" && payload ? (payload.code as string | undefined) : undefined,
      typeof payload === "object" && payload ? (payload.fields as Record<string, string> | undefined) : undefined
    );
  }

  return payload as T;
}

export async function refreshTokens() {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  try {
    const payload = await request<AuthResponse>("auth/refresh", {
      method: "POST",
      body: { refreshToken },
      retryOnUnauthorized: false
    });
    await persistSession(payload);
    return Boolean(payload.accessToken);
  } catch {
    await clearSession();
    return false;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export const api = {
  async login(email: string, password: string, agreementName: string) {
    const payload = await request<AuthResponse>("auth/login", {
      method: "POST",
      body: {
        email: email.trim().toLowerCase(),
        password,
        rememberMe: true,
        termsAgreed: true,
        agreementName: agreementName.trim()
      }
    });
    if (!payload.requiresTwoFactor) await persistSession(payload);
    return payload;
  },

  async completeTwoFactor(mfaToken: string, token: string, isBackupCode: boolean) {
    const payload = await request<AuthResponse>("auth/login/2fa", {
      method: "POST",
      body: { mfaToken, token: token.trim(), isBackupCode }
    });
    await persistSession(payload);
    return payload;
  },

  async register(payload: RegisterPayload) {
    const response = await request<AuthResponse>("auth/register", {
      method: "POST",
      body: payload
    });
    await persistSession(response);
    return response;
  },

  async me() {
    const response = await request<{ success?: boolean; user: AuthUser }>("auth/me", {
      authenticated: true
    });
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(response.user));
    return response.user;
  },

  async resendVerification() {
    return request<{ message?: string }>("auth/resend-verification", {
      method: "POST",
      authenticated: true
    });
  },

  async switchRole(targetRole: "customer" | "helper") {
    const payload = await request<AuthResponse>("auth/switch-role", {
      method: "POST",
      authenticated: true,
      body: { target_role: targetRole }
    });
    await persistSession(payload);
    return payload;
  },

  async mobileFeed() {
    const response = await request<{ success: boolean; data: MobileFeed }>("mobile/feed", {
      authenticated: true
    });
    return response.data;
  },

  async registerPushToken(input: {
    token: string;
    provider: "apns" | "fcm";
    platform: "ios" | "android";
    device_id?: string;
    app_version?: string;
    device?: Record<string, unknown>;
  }) {
    return request<{ success: boolean }>("mobile/push-token", {
      method: "POST",
      authenticated: true,
      body: input
    });
  },

  async postJob(payload: JobPostPayload) {
    return request<{ id?: string; title?: string }>("jobs", {
      method: "POST",
      authenticated: true,
      body: payload
    });
  }
};
