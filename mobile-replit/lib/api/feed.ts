import { getApiClient } from "./client";

export interface FeedItem {
  id: string;
  type: "job" | "helper" | "booking" | "notification";
  data: Record<string, unknown>;
}

export interface FeedResponse {
  items?: FeedItem[];
  jobs?: unknown[];
  helpers?: unknown[];
  [key: string]: unknown;
}

export async function getMobileFeed(): Promise<FeedResponse> {
  const { data } = await getApiClient().get("/mobile/feed");
  return data;
}

export async function getNearby(): Promise<unknown> {
  const { data } = await getApiClient().get("/mobile/nearby");
  return data;
}
