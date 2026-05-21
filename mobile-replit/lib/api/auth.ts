import { getApiClient, tokenStore } from "./client";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  verified: boolean;
  avatar?: string;
}

export async function login(payload: LoginPayload): Promise<{ tokens: AuthTokens; user: User }> {
  const { data } = await getApiClient().post("/auth/login", payload);
  await tokenStore.setTokens(data.accessToken, data.refreshToken);
  return { tokens: data, user: data.user ?? data };
}

export async function register(payload: RegisterPayload): Promise<{ tokens: AuthTokens; user: User }> {
  const { data } = await getApiClient().post("/auth/register", payload);
  await tokenStore.setTokens(data.accessToken, data.refreshToken);
  return { tokens: data, user: data.user ?? data };
}

export async function getMe(): Promise<User> {
  const { data } = await getApiClient().get("/auth/me");
  return data;
}

export async function logout() {
  await tokenStore.clearTokens();
}

export async function switchRole(role: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { data } = await getApiClient().post("/auth/switch-role", { role });
  await tokenStore.setTokens(data.accessToken, data.refreshToken);
  return data;
}

export async function forgotPassword(email: string) {
  const { data } = await getApiClient().post("/auth/forgot-password", { email });
  return data;
}
