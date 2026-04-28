import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { toolRentalsApi } from '../api/toolRentals';
import ToolReviewForm from './ToolReviewForm';
import './ToolReviewsList.css';

interface Review {
  id: number;
  rating: number;
  review_text?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  created_at: string;
}

interface ToolReviewsListProps {
  toolId: number;
  avgRating?: number;
  reviewCount?: number;
}

const ToolReviewsList: React.FC<ToolReviewsListProps> = ({ toolId, avgRating = 0, reviewCount = 0 }) => {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadReviews();
  }, [toolId]);

  const loadReviews = async () => {
    try {
      const data = await toolRentalsApi.getToolReviews(toolId);
      setReviews(data);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewSubmitted = () => {
    setShowForm(false);
    loadReviews();
  };

  return (
    <div className="tool-reviews-list">
      <div className="tool-reviews-header">
        <h3>{t('toolRentals.reviews')}</h3>
        {avgRating > 0 && (
          <div className="tool-reviews-summary">
            <div className="tool-reviews-rating">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span>{avgRating.toFixed(1)}</span>
              <span className="text-muted">({reviewCount})</span>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => setShowForm(!showForm)}
        className="tool-reviews-button"
      >
        {t('toolRentals.leaveReview')}
      </button>

      {showForm && (
        <ToolReviewForm toolId={toolId} onSubmitted={handleReviewSubmitted} />
      )}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : reviews.length > 0 ? (
        <div className="tool-reviews-items">
          {reviews.map((review) => (
            <div key={review.id} className="tool-review-item">
              <div className="tool-review-header">
                <div className="tool-review-rater">
                  {review.avatar_url ? (
                    <img src={review.avatar_url} alt={review.first_name} className="tool-review-avatar" />
                  ) : (
                    <div className="tool-review-avatar-placeholder">
                      {review.first_name?.[0]}{review.last_name?.[0]}
                    </div>
                  )}
                  <span className="tool-review-name">{review.first_name || 'Anonymous'} {review.last_name || ''}</span>
                </div>
                <div className="tool-review-rating-stars">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                    />
                  ))}
                </div>
              </div>
              {review.review_text && <p className="tool-review-text">{review.review_text}</p>}
              <small className="tool-review-date">{new Date(review.created_at).toLocaleDateString()}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted">{t('toolRentals.noResults')}</p>
      )}
    </div>
  );
};

export default React.memo(ToolReviewsList);
