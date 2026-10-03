import api from './axios';

export const marketplaceApi = {
  // Product browsing
  browseProducts: (options = {}) => {
    const params = new URLSearchParams();
    const {
      skillIds,
      minPrice,
      maxPrice,
      category,
      sortBy,
      page = 1,
      limit = 20,
    } = options;

    if (Array.isArray(skillIds) && skillIds.length > 0) {
      params.append('skillIds', skillIds.join(','));
    } else if (skillIds) {
      params.append('skillIds', skillIds);
    }
    if (minPrice) params.append('minPrice', minPrice);
    if (maxPrice) params.append('maxPrice', maxPrice);
    if (category) params.append('category', category);
    if (sortBy) params.append('sortBy', sortBy);
    params.append('page', String(page));
    params.append('limit', String(limit));
    return api.get(`/marketplace/products/browse?${params.toString()}`);
  },

  getProduct: (productId) => api.get(`/marketplace/products/${productId}`),

  getProductsBySkill: (skillId, limit = 50) =>
    api.get(`/marketplace/products/by-skill/${skillId}?limit=${limit}`),

  searchProducts: (query, skillIds, minPrice, maxPrice, page = 1, limit = 20, sortBy = 'best_match', category) => {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (Array.isArray(skillIds) && skillIds.length > 0) {
      params.append('skillIds', skillIds.join(','));
    } else if (skillIds) {
      params.append('skillIds', skillIds);
    }
    if (minPrice) params.append('minPrice', minPrice);
    if (maxPrice) params.append('maxPrice', maxPrice);
    if (category) params.append('category', category);
    params.append('page', String(page));
    params.append('limit', String(limit));
    params.append('sortBy', sortBy);
    return api.get(`/marketplace/products/search?${params.toString()}`);
  },

  searchSuggestions: (query) => {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    return api.get(`/marketplace/products/suggestions?${params.toString()}`);
  },

  getCategories: () => api.get('/marketplace/products/categories'),

  getRecommendedProducts: (limit = 20) =>
    api.get(`/marketplace/products/recommended?limit=${limit}`),

  syncFromHomeDepot: () => api.post('/marketplace/products/sync-homedepot'),

  // Match Learn kit tool names to in-house products (best match per name, or null)
  matchTools: (names) => api.post('/marketplace/products/match-tools', { names }),

  // Product reviews
  getProductReviews: (productId, page = 1) =>
    api.get(`/marketplace/products/${productId}/reviews?page=${page}&limit=5`),

  submitProductReview: (productId, data) =>
    api.post(`/marketplace/products/${productId}/reviews`, data),
};

export const cartApi = {
  // Cart CRUD operations
  createCart: (jobId, name, description) =>
    api.post('/carts', { jobId, name, description }),

  getCarts: (templateOnly = false) =>
    api.get(`/carts?templateOnly=${templateOnly}`),

  getCart: (cartId) => api.get(`/carts/${cartId}`),

  updateCart: (cartId, name, description, status) =>
    api.put(`/carts/${cartId}`, { name, description, status }),

  deleteCart: (cartId) => api.delete(`/carts/${cartId}`),

  // Cart items
  addItem: (cartId, productId, quantity = 1, notes) =>
    api.post(`/carts/${cartId}/items`, { productId, quantity, notes }),

  updateItem: (cartId, itemId, quantity, notes) =>
    api.put(`/carts/${cartId}/items/${itemId}`, { quantity, notes }),

  removeItem: (cartId, itemId) => api.delete(`/carts/${cartId}/items/${itemId}`),

  // Templates
  saveAsTemplate: (cartId, templateName) =>
    api.post(`/carts/${cartId}/save-as-template`, { templateName }),

  createFromTemplate: (templateId, name, jobId) =>
    api.post(`/carts/from-template/${templateId}`, { name, jobId }),

  getTemplates: () => api.get('/carts?templateOnly=true'),
};

export const shareApi = {
  // Share a cart
  shareCart: (cartId, customerId, canModify = true, expiresInDays, conversationId, clientMessageId) => {
    const body = { cartId, customerId, canModify, expiresInDays };
    if (conversationId) body.conversationId = conversationId;
    if (clientMessageId) body.clientMessageId = clientMessageId;
    return api.post('/shared-carts', body);
  },

  // View shared cart (no auth)
  viewSharedCart: (shareToken) => api.get(`/shared-carts/${shareToken}`),

  // Modify shared cart
  updateSharedItem: (shareToken, itemId, quantity, notes) =>
    api.put(`/shared-carts/${shareToken}/items/${itemId}`, { quantity, notes }),

  addItemToSharedCart: (shareToken, productId, quantity = 1) =>
    api.post(`/shared-carts/${shareToken}/items`, { productId, quantity }),

  removeItemFromSharedCart: (shareToken, itemId) =>
    api.delete(`/shared-carts/${shareToken}/items/${itemId}`),

  // Approve cart
  approveCart: (shareToken, notes) =>
    api.post(`/shared-carts/${shareToken}/approve`, { notes }),

  // Analytics and management
  getShareAnalytics: (sharedCartId) =>
    api.get(`/shared-carts/${sharedCartId}/stats`),

  revokeShare: (sharedCartId) => api.delete(`/shared-carts/${sharedCartId}`),
};

export const jobKitsApi = {
  // List available job kits for the helper copilot parts-list flow
  listKits: () => api.get('/job-kits'),

  // Build a kit into a draft cart; prices are live DB prices
  buildKit: (jobType, { name, jobId } = {}) =>
    api.post(`/job-kits/${jobType}/build`, { name, jobId }),
};

export default {
  marketplaceApi,
  cartApi,
  shareApi,
  jobKitsApi,
};
