import React, { useState } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import './ReviewForm.css';

export default function ReviewForm({ jobId, revieweeId, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rating === 0) {
      toast.error('Please select a rating');
      return;
    }
    try {
      setSubmitting(true);
      await api.post('/reviews', {
        job_id: jobId,
        reviewee_id: revieweeId,
        rating,
        comment,
      });
      toast.success('Review submitted successfully');
      setRating(0);
      setComment('');
      if (onSubmitted) onSubmitted();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="review-form">
      <h3>Leave a Review</h3>
      <div className="star-rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`star ${star <= (hoverRating || rating) ? 'filled' : ''}`}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
          >
            &#9733;
          </button>
        ))}
        <span className="rating-text">{rating > 0 ? `${rating}/5` : 'Select rating'}</span>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Share your experience..."
        rows={4}
        className="review-textarea"
      />
      <button type="submit" disabled={submitting || rating === 0} className="btn-submit-review">
        {submitting ? 'Submitting...' : 'Submit Review'}
      </button>
    </form>
  );
}
