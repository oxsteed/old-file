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
  createBooking: async (toolId, startDate, endDate, totalPrice) => {
    const response = await api.post(`/tool-rentals/bookings`, { toolId, startDate, endDate, totalPrice });
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

  updateBookingStatus: async (bookingId, status) => {
    const response = await api.put(`/tool-rentals/bookings/${bookingId}`, { status });
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
