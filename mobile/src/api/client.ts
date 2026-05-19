import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import type {
  AuthResponse,
  AuthUser,
  Conversation,
  HelperDirectoryItem,
  HelperProfile,
  Invoice,
  InvoicePaymentIntent,
  JobPostPayload,
  Message,
  MobileFeed,
  PlannedNeed,
  PlannedNeedPayload,
  RegisterPayload
} from "./types";

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

type MobileAsset = {
  uri: string;
  name?: string;
  mimeType?: string;
  type?: string;
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

async function authenticatedFormDataRequest<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const url = `${apiBaseUrl}/${path.replace(/^\/+/, "")}`;
  if (__DEV__) {
    console.info("[OxSteed API]", "POST", url);
  }

  const response = await fetch(url, { method: "POST", headers, body: formData });
  const payload = await readJson(response);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload
        ? (payload.error as string | undefined) ||
          (payload.message as string | undefined) ||
          Object.values((payload.fields as Record<string, string> | undefined) ?? {})[0]
        : undefined;
    throw new OxSteedApiError(response.status, message || `OxSteed upload failed (${response.status})`);
  }
  return payload as T;
}

function appendAsset(formData: FormData, fieldName: string, asset: MobileAsset, index: number) {
  const name = asset.name || `oxsteed-upload-${index}.jpg`;
  const type = asset.mimeType || asset.type || "image/jpeg";
  formData.append(fieldName, { uri: asset.uri, name, type } as unknown as Blob);
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

  async forgotPassword(email: string) {
    return request<{ message?: string }>("auth/forgot-password", {
      method: "POST",
      body: { email: email.trim().toLowerCase() }
    });
  },

  async resetPassword(token: string, password: string) {
    return request<{ message?: string }>("auth/reset-password", {
      method: "POST",
      body: { token: token.trim(), password }
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

  async listHelpers(params: { query?: string; page?: number; limit?: number; sort?: string } = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        search.set(key, String(value));
      }
    });
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return request<{ helpers: HelperDirectoryItem[]; total?: number; page?: number }>(`helpers${suffix}`);
  },

  async helperProfile(id: string | number) {
    return request<HelperProfile>(`helpers/${id}/profile`);
  },

  async createConversation(input: { helperId: string | number; jobId?: string | number; businessId?: string | number }) {
    return request<Conversation>("messages/conversations", {
      method: "POST",
      authenticated: true,
      body: input
    });
  },

  async listConversations() {
    return request<Conversation[]>("messages/conversations", {
      authenticated: true
    });
  },

  async getMessages(conversationId: string | number) {
    return request<Message[]>(`messages/conversations/${conversationId}`, {
      authenticated: true
    });
  },

  async sendMessage(conversationId: string | number, content: string) {
    return request<Message>(`messages/conversations/${conversationId}`, {
      method: "POST",
      authenticated: true,
      body: { content }
    });
  },

  async uploadMessageAttachment(conversationId: string | number, asset: MobileAsset) {
    const formData = new FormData();
    appendAsset(formData, "file", asset, 0);
    return authenticatedFormDataRequest<{ url: string; name: string; mimeType: string }>(
      `messages/conversations/${conversationId}/attachments`,
      formData
    );
  },

  async listPlannedNeeds() {
    const response = await request<{ planned_needs: PlannedNeed[] }>("planned-needs?status=planned,funding,activating_soon&limit=50", {
      authenticated: true
    });
    return response.planned_needs;
  },

  async createPlannedNeed(payload: PlannedNeedPayload) {
    return request<PlannedNeed>("planned-needs", {
      method: "POST",
      authenticated: true,
      body: payload
    });
  },

  async listInvoices() {
    const response = await request<{ success: boolean; invoices: Invoice[] }>("invoices?limit=50", {
      authenticated: true
    });
    return response.invoices;
  },

  async paymentConfig() {
    const response = await request<{ success: boolean; data: { publishableKey: string } }>("mobile/payment-config", {
      authenticated: true
    });
    return response.data;
  },

  async createInvoicePaymentIntent(invoiceId: string | number) {
    const response = await request<{ success: boolean; data: InvoicePaymentIntent }>(`mobile/invoices/${invoiceId}/payment-intent`, {
      method: "POST",
      authenticated: true
    });
    return response.data;
  },

  async confirmInvoicePayment(invoiceId: string | number, paymentIntentId: string) {
    const response = await request<{ success: boolean; data: { invoice: Invoice; status?: string } }>(
      `mobile/invoices/${invoiceId}/confirm-payment`,
      {
        method: "POST",
        authenticated: true,
        body: { paymentIntentId }
      }
    );
    return response.data;
  },

  async createBookingRequest(payload: {
    helperId: string | number;
    serviceName: string;
    requestedDate: string;
    requestedStartTime: string;
    requestedEndTime: string;
    serviceLocation?: string;
    description?: string;
  }) {
    return request<{ booking?: unknown; id?: string }>("bookings", {
      method: "POST",
      authenticated: true,
      body: payload
    });
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
  },

  async postJobWithPhotos(payload: JobPostPayload, photos: MobileAsset[]) {
    if (photos.length === 0) return api.postJob(payload);

    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });
    photos.forEach((photo, index) => appendAsset(formData, "media", photo, index));
    return authenticatedFormDataRequest<{ id?: string; title?: string }>("jobs", formData);
  }
};
