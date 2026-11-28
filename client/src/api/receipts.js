import api from './axios';

// Group 1 (Customer), item 23 — receipt vault (G1-A2, checkpoint 3).
// Read-only: the customer's own paid receipts (tool rentals + helper-job
// payments). Every read is scoped server-side to the requesting customer.
//
// Group 14 Slice 5j (746, D-789): the vault is now an archive. listReceipts
// accepts the server's archive query (year, month, kind, q, limit, offset)
// and returns the page envelope { receipts, total, limit, offset }; callers
// that pass no params get the first page (limit 50) instead of the whole
// vault.
export const receiptsApi = {
  listReceipts: async (params = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await api.get(`/receipts${suffix}`);
    return {
      receipts: Array.isArray(response.data?.data) ? response.data.data : [],
      total: Number(response.data?.total ?? 0),
      limit: Number(response.data?.limit ?? 50),
      offset: Number(response.data?.offset ?? 0),
    };
  },

  getHelperBookingReceipt: async (bookingId) => {
    const response = await api.get(`/receipts/helper-bookings/${bookingId}`);
    return response.data?.data;
  },
};
