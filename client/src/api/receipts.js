import api from './axios';

// Group 1 (Customer), item 23 — receipt vault (G1-A2, checkpoint 3).
// Read-only: the customer's own paid receipts (tool rentals + helper-job
// payments). Every read is scoped server-side to the requesting customer.
export const receiptsApi = {
  listReceipts: async () => {
    const response = await api.get('/receipts');
    return Array.isArray(response.data?.data) ? response.data.data : [];
  },

  getHelperBookingReceipt: async (bookingId) => {
    const response = await api.get(`/receipts/helper-bookings/${bookingId}`);
    return response.data?.data;
  },
};
