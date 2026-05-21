import { getApiClient } from "./client";

export interface Conversation {
  id: string;
  contactName?: string;
  participant?: { name: string; id: string };
  lastMessage?: string;
  lastMessageAt?: string;
  updatedAt?: string;
  unreadCount?: number;
  jobTitle?: string;
  job?: { title: string };
  [key: string]: unknown;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  [key: string]: unknown;
}

export async function getConversations(): Promise<Conversation[]> {
  const { data } = await getApiClient().get("/messages/conversations");
  return Array.isArray(data) ? data : (data.conversations ?? data.data ?? []);
}

export async function getConversation(id: string): Promise<{ messages: Message[]; conversation: Conversation }> {
  const { data } = await getApiClient().get(`/messages/conversations/${id}`);
  return data;
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
  const { data } = await getApiClient().post(`/messages/conversations/${conversationId}`, { content });
  return data;
}

export async function startConversation(payload: {
  recipientId: string;
  jobId?: string;
  message?: string;
}): Promise<Conversation> {
  const { data } = await getApiClient().post("/messages/conversations", payload);
  return data;
}
