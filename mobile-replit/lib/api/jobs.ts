import { getApiClient } from "./client";

export interface Job {
  id: string;
  title: string;
  category: string;
  description: string;
  budget: string;
  location: string;
  status: "open" | "in_progress" | "completed";
  createdAt?: string;
  postedAt?: string;
  bidCount?: number;
  bids?: number;
  urgent?: boolean;
  [key: string]: unknown;
}

export interface CreateJobPayload {
  title: string;
  category: string;
  description: string;
  budget: string;
  location: string;
  urgent?: boolean;
}

export async function getJobs(params?: { category?: string; search?: string }): Promise<Job[]> {
  const { data } = await getApiClient().get("/jobs", { params });
  // Handle both array and { jobs: [] } response shapes
  return Array.isArray(data) ? data : (data.jobs ?? data.data ?? []);
}

export async function getJob(id: string): Promise<Job> {
  const { data } = await getApiClient().get(`/jobs/${id}`);
  return data;
}

export async function createJob(payload: CreateJobPayload): Promise<Job> {
  const { data } = await getApiClient().post("/jobs", payload);
  return data;
}
