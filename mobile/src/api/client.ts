import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import type {
  AuthResponse,
  AuthUser,
  AvailabilityBlock,
  AvailableSlot,
  BookingPaymentIntent,
  ConnectStatus,
  Conversation,
  HelperBid,
  HelperDirectoryItem,
  HelperPayment,
  HelperProfile,
  HelperProfileLite,
  Invoice,
  InvoicePaymentIntent,
  JobPostPayload,
  Message,
  MobileAppointment,
  MobileBooking,
  MobileFeed,
  MobileJob,
  PlannedNeed,
  PlannedNeedPayload,
  RegisterPayload,
  ReviewEligibility
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

  async createBookingPaymentIntent(bookingId: string | number, amountCents: number, paymentRequirement: "deposit" | "full") {
    const response = await request<{ success: boolean; data: BookingPaymentIntent }>(`mobile/bookings/${bookingId}/payment-intent`, {
      method: "POST",
      authenticated: true,
      body: { amountCents, paymentRequirement }
    });
    return response.data;
  },

  async confirmBookingPayment(bookingId: string | number, paymentIntentId: string) {
    const response = await request<{ success: boolean; data: { booking: MobileBooking; status?: string } }>(
      `mobile/bookings/${bookingId}/confirm-payment`,
      {
        method: "POST",
        authenticated: true,
        body: { paymentIntentId }
      }
    );
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
    const response = await request<{ success?: boolean; data?: MobileBooking; booking?: MobileBooking; id?: string }>("bookings", {
      method: "POST",
      authenticated: true,
      body: payload
    });
    return response.data || response.booking || response;
  },

  async availableSlots(helperId: string | number, date: string) {
    const response = await request<{ success: boolean; data: { date: string; dayOfWeek: string; slots: AvailableSlot[] } }>(
      `bookings/helper/${helperId}/available-slots?date=${encodeURIComponent(date)}`
    );
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
  },

  async listJobs(params: {
    q?: string;
    category?: string;
    city?: string;
    state?: string;
    radius?: string | number;
    sort?: "newest" | "urgent" | "budget_high" | "budget_low" | "nearest";
    page?: number;
    limit?: number;
  } = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        search.set(key, String(value));
      }
    });
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return request<{ jobs: MobileJob[]; total: number; page: number; limit: number }>(`jobs${suffix}`);
  },

  async listMyBids(status?: string) {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<HelperBid[]>(`bids/me${suffix}`, {
      authenticated: true
    });
  },

  async submitBid(payload: { job_id: string | number; amount: number; message: string; eta_hours?: number }) {
    return request<HelperBid>("bids", {
      method: "POST",
      authenticated: true,
      body: payload
    });
  },

  async withdrawBid(id: string | number) {
    return request<{ message?: string }>(`bids/${id}/withdraw`, {
      method: "POST",
      authenticated: true
    });
  },

  async listIncomingBookings() {
    const response = await request<{ success: boolean; data: MobileBooking[] }>("bookings/incoming", {
      authenticated: true
    });
    return response.data;
  },

  async acceptBooking(id: string | number) {
    return request<{ success?: boolean; data?: MobileBooking; booking?: MobileBooking; appointment?: MobileAppointment; message?: string }>(`bookings/${id}/accept`, {
      method: "POST",
      authenticated: true
    });
  },

  async declineBooking(id: string | number, reason?: string) {
    return request<{ message?: string }>(`bookings/${id}/decline`, {
      method: "POST",
      authenticated: true,
      body: reason ? { reason } : {}
    });
  },

  async listAppointments() {
    const response = await request<{ success?: boolean; data?: { appointments: MobileAppointment[] } }>(
      "calendar/appointments?role=helper&limit=50",
      {
        authenticated: true
      }
    );
    return response.data?.appointments ?? [];
  },

  async requestAppointmentReschedule(appointmentId: string | number, payload: { proposed_start: string; proposed_end: string; message?: string }) {
    const response = await request<{ success?: boolean; data?: unknown }>(`calendar/appointments/${appointmentId}/reschedule-request`, {
      method: "POST",
      authenticated: true,
      body: payload
    });
    return response.data;
  },

  async listRescheduleRequests(appointmentId: string | number) {
    const response = await request<{ success?: boolean; data?: unknown[] }>(`calendar/appointments/${appointmentId}/reschedule-requests`, {
      authenticated: true
    });
    return response.data ?? [];
  },

  async respondToReschedule(appointmentId: string | number, requestId: string | number, action: "accept" | "decline") {
    const response = await request<{ success?: boolean; data?: unknown }>(
      `calendar/appointments/${appointmentId}/reschedule-request/${requestId}`,
      {
        method: "PUT",
        authenticated: true,
        body: { action }
      }
    );
    return response.data;
  },

  async listAvailabilityBlocks() {
    const response = await request<{ blocks: AvailabilityBlock[] }>("calendar/availability/mine?limit=50", {
      authenticated: true
    });
    return response.blocks;
  },

  async createAvailabilityBlock(payload: {
    start_time: string;
    end_time: string;
    type: "available" | "unavailable" | "busy";
    title?: string;
    notes?: string;
  }) {
    return request<AvailabilityBlock>("calendar/availability", {
      method: "POST",
      authenticated: true,
      body: payload
    });
  },

  async deleteAvailabilityBlock(id: string | number) {
    return request<{ message?: string }>(`calendar/availability/${id}`, {
      method: "DELETE",
      authenticated: true
    });
  },

  async helperProfileMe() {
    return request<HelperProfileLite>("helper-profile/me", {
      authenticated: true
    });
  },

  async updateHelperProfileCore(payload: Partial<HelperProfileLite>) {
    return request<{ ok: boolean }>("helper-profile/core", {
      method: "PUT",
      authenticated: true,
      body: payload
    });
  },

  async addHelperService(payload: {
    name: string;
    description?: string;
    price?: number;
    price_unit?: "flat" | "hour" | "starting_at" | "quote";
    duration?: string;
    category?: string;
  }) {
    return request<HelperProfileLite["services"][number]>("helper-profile/services", {
      method: "POST",
      authenticated: true,
      body: payload
    });
  },

  async addHelperPolicy(payload: { title: string; content: string }) {
    return request<HelperProfileLite["policies"][number]>("helper-profile/policies", {
      method: "POST",
      authenticated: true,
      body: payload
    });
  },

  async uploadHelperGallery(asset: MobileAsset, caption?: string) {
    const formData = new FormData();
    appendAsset(formData, "file", asset, 0);
    if (caption) formData.append("caption", caption);
    const response = await authenticatedFormDataRequest<{ success: boolean; data: HelperProfileLite["gallery"][number] }>(
      "mobile/helper/gallery",
      formData
    );
    return response.data;
  },

  async helperProfileQrCode(helperId: string | number) {
    return request<{ success: boolean; qr_code: string; profile_url?: string }>(
      `helper-profile/${helperId}/qr-code?size=medium&format=dataurl`
    );
  },

  async connectStatus() {
    return request<ConnectStatus>("payments/connect/status", {
      authenticated: true
    });
  },

  async createConnectAccount() {
    return request<{ url?: string; account_id?: string; message?: string }>("payments/connect", {
      method: "POST",
      authenticated: true
    });
  },

  async listPayeePayments() {
    return request<{ payments: HelperPayment[]; total: number }>("payments/me?role=payee&limit=50", {
      authenticated: true
    });
  },

  async reviewEligibility(jobId: string | number) {
    return request<ReviewEligibility>(`reviews/jobs/${jobId}/eligibility`, {
      authenticated: true
    });
  },

  async submitJobReview(jobId: string | number, payload: { rating: number; title?: string; body?: string }) {
    return request<{ review: unknown }>(`reviews/jobs/${jobId}`, {
      method: "POST",
      authenticated: true,
      body: payload
    });
  }
};
