import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Loader, ChevronDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { marketplaceApi } from '../api/marketplaceApi';
import { useAuth } from '../hooks/useAuth';
import '../styles/ProductReviewsSection.css';

const REVIEW_FORM_MODAL = 'review_form';

function getRelativeDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
  return `${Math.floor(seconds / 31536000)}y ago`;
}

function renderStars(rating, size = 16) {
  const stars = [];
  const roundedRating = Math.round(rating * 2) / 2;
  for (let i = 1; i <= 5; i++) {
    const fill = i <= roundedRating ? 'full' : i - roundedRating === 0.5 ? 'half' : 'none';
    stars.push(
      <Star
        key={i}
        size={size}
        className={`prs-star ${fill === 'full' ? 'prs-star-full' : fill === 'half' ? 'prs-star-half' : 'prs-star-empty'}`}
      />
    );
  }
  return stars;
}

interface Review {
  id: string;
  product_id: string;
  helper_id: string;
  helper_name: string;
  helper_avatar?: string;
  rating: number;
  review_text: string;
  created_at: string;
}

interface ProductReviewsSectionProps {
  productId: string;
  averageRating?: number;
  reviewCount?: number;
  onSubmitReview?: () => void;
}

export default function ProductReviewsSection({
  productId,
  averageRating = 0,
  reviewCount = 0,
  onSubmitReview,
}: ProductReviewsSectionProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    rating: 5,
    reviewText: '',
  });

  // Fetch reviews
  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setLoading(true);
        const response = await marketplaceApi.getProductReviews(productId, currentPage);
        if (response.data) {
          const data = response.data;
          if (currentPage === 1) {
            setReviews(data.reviews || []);
          } else {
            setReviews((prev) => [...prev, ...(data.reviews || [])]);
          }
          setTotalPages(data.totalPages || 1);
          setHasMore((data.reviews?.length || 0) > 0 && currentPage < (data.totalPages || 1));
        }
      } catch (err) {
        console.error('Failed to fetch reviews:', err);
        toast.error(t('common.errorLoading'));
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, [productId, currentPage, t]);

  const isHelper = user && ['helper', 'helper_pro', 'broker'].includes(user.role);

  const handleLoadMore = () => {
    if (hasMore) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const handleRatingChange = (newRating: number) => {
    setFormData((prev) => ({
      ...prev,
      rating: newRating,
    }));
  };

  const handleReviewTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 500) {
      setFormData((prev) => ({
        ...prev,
        reviewText: value,
      }));
    }
  };

  const handleSubmitReview = async () => {
    if (!formData.reviewText.trim()) {
      toast.error(t('common.fillRequiredFields'));
      return;
    }

    try {
      setSubmitting(true);
      const response = await marketplaceApi.submitProductReview(productId, {
        rating: formData.rating,
        reviewText: formData.reviewText.trim(),
      });

      if (response.data) {
        toast.success(t('marketplace.reviewSubmittedSuccess'));
        setFormData({ rating: 5, reviewText: '' });
        setShowReviewForm(false);
        setCurrentPage(1);
        if (onSubmitReview) {
          onSubmitReview();
        }
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.error || t('common.errorUpdating');
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="prs-container">
      <h3 className="prs-title">{t('marketplace.reviews')}</h3>

      {/* Rating Summary */}
      <div className="prs-rating-summary">
        <div className="prs-rating-display">
          <div className="prs-big-rating">{averageRating.toFixed(1)}</div>
          <div className="prs-star-row">{renderStars(averageRating, 20)}</div>
          <div className="prs-review-count">
            {reviewCount} {reviewCount === 1 ? t('marketplace.review') : t('marketplace.reviews')}
          </div>
        </div>

        {isHelper && (
          <button
            onClick={() => setShowReviewForm(!showReviewForm)}
            className="prs-write-review-btn"
          >
            {t('marketplace.leaveReview')}
          </button>
        )}
      </div>

      {/* Review Form Modal */}
      {showReviewForm && isHelper && (
        <div className="prs-form-overlay" onClick={() => setShowReviewForm(false)}>
          <div className="prs-form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="prs-form-header">
              <h4 className="prs-form-title">{t('marketplace.leaveReview')}</h4>
              <button
                onClick={() => setShowReviewForm(false)}
                className="prs-form-close"
                aria-label={t('common.close')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="prs-form-content">
              {/* Rating Selector */}
              <div className="prs-form-group">
                <label className="prs-form-label">{t('marketplace.rating')}</label>
                <div className="prs-rating-selector">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => handleRatingChange(star)}
                      className={`prs-rating-btn ${formData.rating >= star ? 'active' : ''}`}
                      aria-label={`${star} stars`}
                    >
                      <Star
                        size={28}
                        className={formData.rating >= star ? 'prs-star-full' : 'prs-star-empty'}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Review Text */}
              <div className="prs-form-group">
                <label htmlFor="prs-review-text" className="prs-form-label">
                  {t('marketplace.reviewText')}
                </label>
                <textarea
                  id="prs-review-text"
                  value={formData.reviewText}
                  onChange={handleReviewTextChange}
                  placeholder={t('marketplace.reviewTextPlaceholder')}
                  className="prs-form-textarea"
                  rows={4}
                />
                <div className="prs-char-count">
                  {formData.reviewText.length}/500
                </div>
              </div>

              {/* Submit Button */}
              <div className="prs-form-actions">
                <button
                  onClick={() => setShowReviewForm(false)}
                  className="prs-form-cancel-btn"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSubmitReview}
                  disabled={submitting}
                  className="prs-form-submit-btn"
                >
                  {submitting ? (
                    <>
                      <Loader size={16} className="prs-spinner" />
                      {t('common.submitting')}
                    </>
                  ) : (
                    t('common.submit')
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reviews List */}
      <div className="prs-reviews-list">
        {loading && currentPage === 1 ? (
          <div className="prs-loading">
            <Loader className="prs-spinner" />
            <p>{t('common.loading')}</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="prs-empty-state">
            <p>{t('marketplace.noReviews')}</p>
          </div>
        ) : (
          <>
            {reviews.map((review) => (
              <div key={review.id} className="prs-review-item">
                <div className="prs-review-header">
                  <div className="prs-reviewer-info">
                    {review.helper_avatar && (
                      <img
                        src={review.helper_avatar}
                        alt={review.helper_name}
                        className="prs-reviewer-avatar"
                      />
                    )}
                    {!review.helper_avatar && (
                      <div className="prs-reviewer-avatar-placeholder">
                        {review.helper_name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="prs-reviewer-details">
                      <div className="prs-reviewer-name">{review.helper_name}</div>
                      <div className="prs-review-date">{getRelativeDate(review.created_at)}</div>
                    </div>
                  </div>
                  <div className="prs-review-rating">{renderStars(review.rating, 16)}</div>
                </div>

                <div className="prs-review-text">{review.review_text}</div>
              </div>
            ))}

            {/* Load More Button */}
            {hasMore && (
              <button onClick={handleLoadMore} className="prs-load-more-btn" disabled={loading}>
                {loading ? (
                  <>
                    <Loader size={16} className="prs-spinner" />
                    {t('common.loading')}
                  </>
                ) : (
                  <>
                    {t('common.loadMore')}
                    <ChevronDown size={16} />
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
