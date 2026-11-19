import api from './axios';

export async function createBookingRequest(payload) {
  const { data } = await api.post('/bookings', payload);
  return data?.data ?? data;
}

export async function getPublicBookingStatus(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}`);
  return data?.data ?? data;
}

// G-6: recipient accept/decline via their invite token (public link).
export async function respondToRecipientInvite(token, decision) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/respond`, { decision });
  return data?.data ?? data;
}

// G-6: account-linked recipient accept/decline.
export async function respondAsRecipient(bookingId, decision) {
  const { data } = await api.post(`/bookings/${bookingId}/recipient/respond`, { decision });
  return data?.data ?? data;
}

// G-6/G-7: booker revokes the invite/status links before acceptance.
export async function revokeBookingStatusLink(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/status-link/revoke`);
  return data?.data ?? data;
}

export async function getBookingRequest(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}`);
  return data;
}

export async function cancelBookingRequest(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/cancel`);
  return data;
}

// G-37: hand an accepted booking to another eligible provider. The
// booking, its deposit, and its appointment are preserved.
export async function transferBookingRequest(bookingId, { newHelperId, reason } = {}) {
  const { data } = await api.post(`/bookings/${bookingId}/transfer`, {
    newHelperId,
    ...(reason ? { reason } : {}),
  });
  return data?.data ?? data;
}

export async function fetchBookingPrefillForJob(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/convert-to-job`);
  return data?.data ?? data;
}

export async function getAvailableSlots(helperId, dateStr) {
  const { data } = await api.get(`/bookings/helper/${helperId}/available-slots`, {
    params: { date: dateStr },
  });
  return data;
}

export async function getBusinessAvailableSlots(businessId, dateStr, serviceId, staffId) {
  const { data } = await api.get(`/bookings/business/${businessId}/available-slots`, {
    params: {
      date: dateStr,
      ...(serviceId ? { serviceId } : {}),
      // Review P2-3-F08: when a staff member is chosen, the listing subtracts
      // their personal availability blocks, matching the booking gate.
      ...(staffId ? { staffId } : {}),
    },
  });
  return data;
}
