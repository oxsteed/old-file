import api from './axios';

// Customer: Submit a review for a completed lead
export const submitReview = (businessId, data) =>
  api.post(`/reviews/business/${businessId}/submit`, data).then(r => r.data);

// Customer: Delete a review
export const deleteReview = (reviewId) =>
  api.delete(`/reviews/business/${reviewId}`).then(r => r.data);

// Public: Get reviews for a business (paginated, with sorting)
export const getBusinessReviews = (businessId, { page = 1, limit = 10, sortBy = 'recent' } = {}) =>
  api.get(`/reviews/business/${businessId}`, { params: { page, limit, sortBy } }).then(r => r.data);

// Public: Get review stats (avg rating, distribution, count)
export const getReviewStats = (businessId) =>
  api.get(`/reviews/business/${businessId}/stats`).then(r => r.data);

// Business owner: Respond to a review
export const respondToReview = (reviewId, data) =>
  api.put(`/reviews/business/${reviewId}/respond`, data).then(r => r.data);
