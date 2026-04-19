import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { toolRentalsApi } from '../api/toolRentals';
import toast from 'react-hot-toast';

interface ToolReviewFormProps {
  toolId: number;
  onSubmitted: () => void;
}

const ToolReviewForm: React.FC<ToolReviewFormProps> = ({ toolId, onSubmitted }) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await toolRentalsApi.submitReview(toolId, rating, reviewText);
      toast.success(t('toolRentals.reviewSubmitted'));
      setRating(5);
      setReviewText('');
      onSubmitted();
    } catch (err) {
      toast.error('Failed to submit review');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="tool-review-form">
      <div className="tool-review-form-group">
        <label>{t('toolRentals.rating')}</label>
        <div className="tool-review-rating-selector">
          {Array.from({ length: 5 }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setRating(i + 1)}
              className="tool-review-star-btn"
            >
              <Star className={`w-6 h-6 ${i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="tool-review-form-group">
        <label htmlFor="review-text">{t('toolRentals.yourReview')}</label>
        <textarea
          id="review-text"
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          placeholder="Share your experience..."
          maxLength={500}
          rows={4}
        />
        <small>{reviewText.length}/500</small>
      </div>

      <button type="submit" disabled={loading} className="tool-review-submit-btn">
        {loading ? t('common.sending') : t('common.submit')}
      </button>
    </form>
  );
};

export default ToolReviewForm;
