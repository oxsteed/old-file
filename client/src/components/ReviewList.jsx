import React, { useState, useEffect } from 'react';
import api from '../api/axios';
import './ReviewList.css';

export default function ReviewList({ userId, jobId }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [averageRating, setAverageRating] = useState(0);

  useEffect(() => {
    fetchReviews();
  }, [userId, jobId]);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const params = {};
      if (userId) params.user_id = userId;
      if (jobId) params.job_id = jobId;
      const { data } = await api.get('/reviews', { params });
      setReviews(data);
      if (data.length > 0) {
        const avg = data.reduce((sum, r) => sum + r.rating, 0) / data.length;
        setAverageRating(avg.toFixed(1));
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderStars = (rating) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={`review-star ${i < rating ? 'filled' : ''}`}>
        ★
      </span>
    ));
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return <div className="review-list-loading">Loading reviews...</div>;
  }

  return (
    <div className="review-list">
      <div className="review-list-header">
        <h3>Reviews</h3>
        {reviews.length > 0 && (
          <div className="average-rating">
            <span className="avg-stars">{renderStars(Math.round(averageRating))}</span>
            <span className="avg-text">{averageRating} ({reviews.length} review{reviews.length !== 1 ? 's' : ''})</span>
          </div>
        )}
      </div>
      {reviews.length === 0 ? (
        <p className="no-reviews">No reviews yet</p>
      ) : (
        <div className="reviews-container">
          {reviews.map((review) => (
            <div key={review.id} className="review-card">
              <div className="review-header">
                <span className="reviewer-name">
                  {review.reviewer_first_name} {review.reviewer_last_name?.[0]}.
                </span>
                <span className="review-date">{formatDate(review.created_at)}</span>
              </div>
              <div className="review-stars">{renderStars(review.rating)}</div>
              {review.comment && (
                <p className="review-comment">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
