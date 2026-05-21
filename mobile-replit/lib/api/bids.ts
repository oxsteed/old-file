import { getApiClient } from "./client";

export interface Bid {
  id: string;
  jobId: string;
  amount: number;
  note?: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  createdAt: string;
  [key: string]: unknown;
}

export async function getMyBids(): Promise<Bid[]> {
  const { data } = await getApiClient().get("/bids/me");
  return Array.isArray(data) ? data : (data.bids ?? data.data ?? []);
}

export async function submitBid(payload: { jobId: string; amount: number; note?: string }): Promise<Bid> {
  const { data } = await getApiClient().post("/bids", payload);
  return data;
}

export async function withdrawBid(bidId: string): Promise<void> {
  await getApiClient().post(`/bids/${bidId}/withdraw`);
}
