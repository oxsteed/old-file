import api from './axios';

export const marketplaceApi = {
  // Product browsing
  browseProducts: (skillId, search, category, page = 1, limit = 20) => {
    const params = new URLSearchParams();
    if (skillId) params.append('skill', skillId);
    if (search) params.append('search', search);
    if (category) params.append('category', category);
    params.append('page', page);
    params.append('limit', limit);
    return api.get(`/marketplace/products/browse?${params.toString()}`);
  },

  getProduct: (productId) => api.get(`/marketplace/products/${productId}`),

  getProductsBySkill: (skillId, limit = 50) =>
    api.get(`/marketplace/products/by-skill/${skillId}?limit=${limit}`),

  searchProducts: (query, skillId, minPrice, maxPrice, page = 1, limit = 20, sortBy = 'best_match', category) => {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (skillId) params.append('skill', skillId);
    if (minPrice) params.append('minPrice', minPrice);
    if (maxPrice) params.append('maxPrice', maxPrice);
    if (category) params.append('category', category);
    params.append('page', page);
    params.append('limit', limit);
    params.append('sortBy', sortBy);
    return api.get(`/marketplace/products/search?${params.toString()}`);
  },

  searchSuggestions: (query) => {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    return api.get(`/marketplace/products/suggestions?${params.toString()}`);
  },

  getCategories: () => api.get('/marketplace/products/categories'),

  syncFromHomeDepot: () => api.post('/marketplace/products/sync-homedepot'),

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
  shareCart: (cartId, customerId, canModify = true, expiresInDays) =>
    api.post('/shared-carts', { cartId, customerId, canModify, expiresInDays }),

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

export default {
  marketplaceApi,
  cartApi,
  shareApi,
};
