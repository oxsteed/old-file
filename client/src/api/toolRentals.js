import api from './axios';

export const toolRentalsApi = {
  // Get all available tool categories
  getCategories: async () => {
    const response = await api.get('/tool-rentals/categories');
    return response.data.categories || [];
  },

  // Browse available tools with optional filters
  getPublicTool: async (toolId) => {
    const response = await api.get(`/tool-rentals/public/${toolId}`);
    return response.data.tool;
  },

  browseTools: async (filters = {}) => {
    const params = {};
    if (filters.category) params.category = filters.category;
    if (filters.city) params.city = filters.city;
    if (filters.name) params.name = filters.name;
    if (filters.priceMin) params.priceMin = filters.priceMin;
    if (filters.priceMax) params.priceMax = filters.priceMax;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.capacityMin !== null && filters.capacityMin !== undefined) params.capacityMin = filters.capacityMin;
    if (filters.capacityUnit) params.capacityUnit = filters.capacityUnit;
    if (filters.weightMax !== null && filters.weightMax !== undefined) params.weightMax = filters.weightMax;
    if (filters.lengthMax !== null && filters.lengthMax !== undefined) params.lengthMax = filters.lengthMax;
    if (filters.widthMax !== null && filters.widthMax !== undefined) params.widthMax = filters.widthMax;
    if (filters.heightMax !== null && filters.heightMax !== undefined) params.heightMax = filters.heightMax;
    if (filters.radius !== null && filters.radius !== undefined) params.radius = filters.radius;
    if (filters.lat !== null && filters.lat !== undefined) params.lat = filters.lat;
    if (filters.lng !== null && filters.lng !== undefined) params.lng = filters.lng;
    if (filters.ids) params.ids = filters.ids;
    if (filters.sort) params.sort = filters.sort;
    if (filters.limit) params.limit = filters.limit;
    if (filters.offset) params.offset = filters.offset;

    const response = await api.get('/tool-rentals/browse', { params });
    return response.data.tools || [];
  },

  // Get user's own tools (authenticated)
  getMyTools: async () => {
    const response = await api.get('/tool-rentals/me');
    return response.data.tools || [];
  },

  // Create a new tool listing (authenticated)
  createTool: async (toolData) => {
    const response = await api.post('/tool-rentals', toolData);
    return response.data;
  },

  // Update an existing tool (authenticated)
  updateTool: async (toolId, toolData) => {
    const response = await api.put(`/tool-rentals/${toolId}`, toolData);
    return response.data;
  },

  // Delete a tool listing (authenticated)
  deleteTool: async (toolId) => {
    const response = await api.delete(`/tool-rentals/${toolId}`);
    return response.data;
  },

  // FAVORITES
  getFavorites: async () => {
    const response = await api.get('/tool-rentals/favorites');
    return response.data || [];
  },

  toggleFavorite: async (toolId) => {
    const response = await api.post(`/tool-rentals/${toolId}/favorite`);
    return response.data;
  },

  isFavorited: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/is-favorited`);
    return response.data.favorited;
  },

  // REVIEWS
  getToolReviews: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/reviews`);
    return response.data || [];
  },

  submitReview: async (toolId, rating, reviewText) => {
    const response = await api.post(`/tool-rentals/${toolId}/review`, { rating, review_text: reviewText });
    return response.data;
  },

  // BOOKINGS
  createBooking: async (toolId, startDate, endDate, totalPrice, renterAgreementAccepted = false, equipmentVersion, fulfillment = 'pickup', pickupTime = null, returnTime = null) => {
    const response = await api.post(`/tool-rentals/bookings`, {
      toolId,
      startDate,
      endDate,
      totalPrice,
      renterAgreementAccepted,
      equipmentVersion,
      fulfillment,
      pickupTime,
      returnTime,
    });
    return response.data;
  },

  // Group 11 item 584: replacement listing suggestions for a tool that
  // is unavailable for the requested dates.
  getAlternatives: async (toolId, { startDate, endDate, lat, lng, radius, limit } = {}) => {
    const params = { startDate, endDate };
    if (lat !== undefined && lat !== null) params.lat = lat;
    if (lng !== undefined && lng !== null) params.lng = lng;
    if (radius !== undefined && radius !== null) params.radius = radius;
    if (limit) params.limit = limit;
    const response = await api.get(`/tool-rentals/${toolId}/alternatives`, { params });
    return response.data.tools || [];
  },

  getAvailability: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/availability`);
    return response.data;
  },

  getMyBookings: async () => {
    const response = await api.get('/tool-rentals/bookings/my');
    return response.data || [];
  },

  getBookingsByOwner: async () => {
    const response = await api.get('/tool-rentals/bookings/owner');
    return response.data || [];
  },

  // Review P3-1068: owner returns or withholds a held deposit.
  resolveDeposit: async (bookingId, body) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/deposit/resolve`, body);
    return response.data;
  },

  // Group 11 item 570: in-app confirmation receipt.
  getBookingReceipt: async (bookingId) => {
    const response = await api.get(`/tool-rentals/bookings/${bookingId}/receipt`);
    return response.data;
  },

  downloadInvoicePdf: async (invoiceId, invoiceNumber) => {
    const response = await api.get(`/tool-rentals/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoiceNumber || `invoice-${invoiceId}`}.pdf`;
    link.click();
    window.URL.revokeObjectURL(url);
  },

  // Group 11 item 575: checkout acknowledgment at pickup.
  acknowledgeCheckout: async (bookingId) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/checkout-acknowledge`);
    return response.data;
  },

  // Group 11 item 568: explicit owner approve/decline, distinct from invoicing.
  approveBooking: async (bookingId) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/approve`);
    return response.data;
  },

  declineBooking: async (bookingId, reason) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/decline`, { reason });
    return response.data;
  },

  // Group 11 item 576: return reschedule (renter proposes, owner decides).
  proposeReturnReschedule: async (bookingId, { proposedEndDate, proposedTime }) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/return-reschedule`, { proposedEndDate, proposedTime });
    return response.data;
  },

  approveReturnReschedule: async (bookingId) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/return-reschedule/approve`);
    return response.data;
  },

  declineReturnReschedule: async (bookingId, reason) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/return-reschedule/decline`, { reason });
    return response.data;
  },

  // Group 11 item 583: cancellation recovery (record-only refund agreement).
  getCancellationRecovery: async (bookingId) => {
    const response = await api.get(`/tool-rentals/bookings/${bookingId}/recovery`);
    return response.data;
  },

  proposeRefundSettlement: async (bookingId, { amount, direction, note }) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/recovery/refund`, { amount, direction, note });
    return response.data;
  },

  confirmRefundSettlement: async (bookingId) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/recovery/confirm`);
    return response.data;
  },

  settleRefundSettlement: async (bookingId) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/recovery/settle`);
    return response.data;
  },

  updateBookingStatus: async (bookingId, status, extra = {}) => {
    const response = await api.put(`/tool-rentals/bookings/${bookingId}`, { status, ...extra });
    return response.data;
  },

  // Group 11 Slice 2e: disputes + maintain + review (586, 587, 589, 590,
  // 591, 594, 595, 597, 600). Record-only money (D-257).
  getDamageClaims: async (bookingId) => {
    const response = await api.get(`/tool-rentals/bookings/${bookingId}/damage-claims`);
    return response.data;
  },

  fileDamageClaim: async (bookingId, body) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/damage-claims`, body);
    return response.data;
  },

  resolveDamageClaim: async (bookingId, claimId, body) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/damage-claims/${claimId}/resolve`, body);
    return response.data;
  },

  acknowledgeDamageClaim: async (bookingId, claimId, decision) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/damage-claims/${claimId}/acknowledge`, { decision });
    return response.data;
  },

  getEscalations: async (bookingId) => {
    const response = await api.get(`/tool-rentals/bookings/${bookingId}/escalations`);
    return response.data;
  },

  openEscalation: async (bookingId, body) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/escalations`, body);
    return response.data;
  },

  postEscalationMessage: async (escalationId, message) => {
    const response = await api.post(`/tool-rentals/escalations/${escalationId}/messages`, { message });
    return response.data;
  },

  acknowledgeMissingResolution: async (bookingId, reportId, decision) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/missing/${reportId}/acknowledge`, { decision });
    return response.data;
  },

  acknowledgeDepositResolution: async (bookingId, decision) => {
    const response = await api.post(`/tool-rentals/bookings/${bookingId}/deposit/acknowledge`, { decision });
    return response.data;
  },

  getMaintenanceEvents: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/maintenance`);
    return response.data;
  },

  createMaintenanceEvent: async (toolId, body) => {
    const response = await api.post(`/tool-rentals/${toolId}/maintenance`, body);
    return response.data;
  },

  completeMaintenanceEvent: async (toolId, eventId, body = {}) => {
    const response = await api.post(`/tool-rentals/${toolId}/maintenance/${eventId}/complete`, body);
    return response.data;
  },

  cancelMaintenanceEvent: async (toolId, eventId) => {
    const response = await api.post(`/tool-rentals/${toolId}/maintenance/${eventId}/cancel`);
    return response.data;
  },

  getSafetyDocuments: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/safety-documents`);
    return response.data;
  },

  getPublicSafetyDocuments: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/safety-documents/public`);
    return response.data;
  },

  uploadSafetyDocument: async (toolId, file, title) => {
    const form = new FormData();
    form.append('document', file);
    form.append('title', title);
    const response = await api.post(`/tool-rentals/${toolId}/safety-documents`, form);
    return response.data;
  },

  deleteSafetyDocument: async (toolId, docId) => {
    const response = await api.delete(`/tool-rentals/${toolId}/safety-documents/${docId}`);
    return response.data;
  },

  getAvailabilityChecklist: async (toolId, cleaningConfirmed = false) => {
    const response = await api.get(`/tool-rentals/${toolId}/availability-checklist`, { params: { cleaning_confirmed: cleaningConfirmed } });
    return response.data;
  },

  getUtilization: async ({ startDate, endDate } = {}) => {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const response = await api.get('/tool-rentals/analytics/utilization', { params });
    return response.data;
  },

  getRepeatRenters: async () => {
    const response = await api.get('/tool-rentals/renters/repeat');
    return response.data;
  },

  recordRenterFollowup: async (body) => {
    const response = await api.post('/tool-rentals/renters/followups', body);
    return response.data;
  },

  // ANALYTICS
  trackEvent: async (toolId, eventType, metadata) => {
    return api.post('/tool-rentals/analytics/track', { toolId, eventType, metadata }).catch(() => null);
  },

  getAnalytics: async (toolId) => {
    const response = await api.get(`/tool-rentals/${toolId}/analytics`);
    return response.data || [];
  },

  getTopTools: async () => {
    const response = await api.get('/tool-rentals/analytics/top');
    return response.data || [];
  },

  // NOTIFICATIONS
  getNotificationPrefs: async () => {
    const response = await api.get('/tool-rentals/notifications/prefs');
    return response.data;
  },

  updateNotificationPrefs: async (prefs) => {
    const response = await api.put('/tool-rentals/notifications/prefs', prefs);
    return response.data;
  },
};
