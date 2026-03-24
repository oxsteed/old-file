import { useState, useCallback } from 'react';
import api from '../api/axios';

export default function useReviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Get all reviews for a specific user (public)
  const fetchUserReviews = useCallback(async (userId) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/reviews/users/${userId}`);
      setReviews(data.reviews || data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch reviews');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Check if the current user is eligible to review a job
  const checkReviewEligibility = useCallback(async (jobId) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/reviews/jobs/${jobId}/eligibility`);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check review eligibility');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Submit a review for a completed job
  const submitReview = useCallback(async (jobId, reviewData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/reviews/jobs/${jobId}`, reviewData);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit review');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Respond to a review left on the current user's profile
  const respondToReview = useCallback(async (reviewId, response) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.put(`/reviews/${reviewId}/respond`, { response });
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to respond to review');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    reviews,
    loading,
    error,
    fetchUserReviews,
    checkReviewEligibility,
    submitReview,
    respondToReview,
  };
}
