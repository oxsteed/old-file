import { getApiClient } from "./client";

export interface Helper {
  id: string;
  name?: string;
  displayName?: string;
  rating?: number;
  reviewCount?: number;
  skills?: string[];
  hourlyRate?: number;
  distance?: string;
  verified?: boolean;
  bio?: string;
  completedJobs?: number;
  responseTime?: string;
  [key: string]: unknown;
}

export async function getHelpers(params?: { search?: string; category?: string }): Promise<Helper[]> {
  const { data } = await getApiClient().get("/helpers", { params });
  return Array.isArray(data) ? data : (data.helpers ?? data.data ?? []);
}

export async function getHelperProfile(id: string): Promise<Helper> {
  const { data } = await getApiClient().get(`/helpers/${id}/profile`);
  return data;
}

export async function getMyHelperProfile() {
  const { data } = await getApiClient().get("/helper-profile/me");
  return data;
}
