import { create } from "zustand";
import { api, clearSession, getStoredUser, OxSteedApiError } from "../api/client";
import type { AuthUser, RegisterPayload } from "../api/types";

type AuthState = {
  user: AuthUser | null;
  isHydrating: boolean;
  isWorking: boolean;
  error: string | null;
  pendingMfaToken: string | null;
  hydrate: () => Promise<void>;
  login: (email: string, password: string, agreementName: string) => Promise<void>;
  completeTwoFactor: (token: string, isBackupCode: boolean) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  switchRole: (role: "customer" | "helper") => Promise<void>;
  resendVerification: () => Promise<void>;
  signOut: () => Promise<void>;
};

function friendlyError(error: unknown, fallback: string) {
  if (error instanceof OxSteedApiError) {
    const field = error.fields ? Object.values(error.fields)[0] : null;
    return field || error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isHydrating: true,
  isWorking: false,
  error: null,
  pendingMfaToken: null,

  async hydrate() {
    set({ isHydrating: true, error: null });
    try {
      const storedUser = await getStoredUser();
      if (!storedUser) {
        set({ user: null, isHydrating: false });
        return;
      }

      const user = await api.me();
      set({ user, isHydrating: false });
    } catch {
      await clearSession();
      set({ user: null, isHydrating: false });
    }
  },

  async login(email, password, agreementName) {
    set({ isWorking: true, error: null, pendingMfaToken: null });
    try {
      const payload = await api.login(email, password, agreementName);
      if (payload.requiresTwoFactor) {
        set({
          pendingMfaToken: payload.mfaToken ?? null,
          error: "Enter your two-factor code to finish signing in.",
          isWorking: false
        });
        return;
      }
      const user = payload.user ?? (await api.me());
      set({ user, isWorking: false, error: null });
    } catch (error) {
      set({ error: friendlyError(error, "Could not sign in."), isWorking: false });
    }
  },

  async completeTwoFactor(token, isBackupCode) {
    const pendingMfaToken = get().pendingMfaToken;
    if (!pendingMfaToken) {
      set({ error: "Start sign in again before entering a two-factor code." });
      return;
    }

    set({ isWorking: true, error: null });
    try {
      const payload = await api.completeTwoFactor(pendingMfaToken, token, isBackupCode);
      const user = payload.user ?? (await api.me());
      set({ user, pendingMfaToken: null, isWorking: false, error: null });
    } catch (error) {
      set({ error: friendlyError(error, "Could not verify that code."), isWorking: false });
    }
  },

  async register(payload) {
    set({ isWorking: true, error: null });
    try {
      const response = await api.register(payload);
      const user = response.user ?? (await api.me());
      set({ user, isWorking: false });
    } catch (error) {
      set({ error: friendlyError(error, "Could not create account."), isWorking: false });
    }
  },

  async forgotPassword(email) {
    set({ isWorking: true, error: null, pendingMfaToken: null });
    try {
      const response = await api.forgotPassword(email);
      set({
        error: response.message ?? "If that email exists, a reset link has been sent.",
        isWorking: false
      });
    } catch (error) {
      set({ error: friendlyError(error, "Could not request a password reset."), isWorking: false });
    }
  },

  async resetPassword(token, password) {
    set({ isWorking: true, error: null, pendingMfaToken: null });
    try {
      const response = await api.resetPassword(token, password);
      set({
        error: response.message ?? "Password reset successful. You can sign in now.",
        isWorking: false
      });
    } catch (error) {
      set({ error: friendlyError(error, "Could not reset password."), isWorking: false });
    }
  },

  async switchRole(role) {
    set({ isWorking: true, error: null });
    try {
      const response = await api.switchRole(role);
      const user = response.user ?? (await api.me());
      set({ user, isWorking: false });
    } catch (error) {
      set({ error: friendlyError(error, "Could not switch role."), isWorking: false });
    }
  },

  async resendVerification() {
    set({ isWorking: true, error: null });
    try {
      const response = await api.resendVerification();
      set({ error: response.message ?? "Verification email sent.", isWorking: false });
    } catch (error) {
      set({ error: friendlyError(error, "Could not send verification email."), isWorking: false });
    }
  },

  async signOut() {
    await clearSession();
    set({ user: null, pendingMfaToken: null, error: null });
  }
}));
