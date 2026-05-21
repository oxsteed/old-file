import { getApiClient } from "./client";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  [key: string]: unknown;
}

export async function getNotifications(): Promise<Notification[]> {
  const { data } = await getApiClient().get("/notifications");
  return Array.isArray(data) ? data : (data.notifications ?? data.data ?? []);
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  await getApiClient().post("/notifications/mark-read", ids ? { ids } : {});
}
