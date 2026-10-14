import api from './axios';

export async function createBookingRequest(payload) {
  const { data } = await api.post('/bookings', payload);
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
