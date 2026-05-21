import { getApiClient } from "./client";

export interface Booking {
  id: string;
  helperId: string;
  jobId?: string;
  status: "pending" | "accepted" | "declined" | "completed" | "cancelled";
  scheduledAt?: string;
  [key: string]: unknown;
}

export async function createBooking(payload: {
  helperId: string;
  jobId?: string;
  scheduledAt?: string;
  notes?: string;
}): Promise<Booking> {
  const { data } = await getApiClient().post("/bookings", payload);
  return data;
}

export async function getIncomingBookings(): Promise<Booking[]> {
  const { data } = await getApiClient().get("/bookings/incoming");
  return Array.isArray(data) ? data : (data.bookings ?? data.data ?? []);
}

export async function acceptBooking(bookingId: string): Promise<void> {
  await getApiClient().post(`/bookings/${bookingId}/accept`);
}

export async function declineBooking(bookingId: string): Promise<void> {
  await getApiClient().post(`/bookings/${bookingId}/decline`);
}

export async function getAvailableSlots(helperId: string): Promise<unknown[]> {
  const { data } = await getApiClient().get(`/bookings/helper/${helperId}/available-slots`);
  return Array.isArray(data) ? data : (data.slots ?? []);
}
