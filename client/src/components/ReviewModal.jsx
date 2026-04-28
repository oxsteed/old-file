import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { submitReview } from '../api/businessReviews';

export default function ReviewModal({ businessId, leadId, onClose, onSuccess }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(5);
  const [testimonial, setTestimonial] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!rating || rating < 1 || rating > 5) {
      setError(t('reviews.errorRatingRequired'));
      return;
    }

    if (!testimonial.trim()) {
      setError(t('reviews.errorTestimonialRequired'));
      return;
    }

    if (testimonial.trim().length > 500) {
      setError(t('reviews.errorTestimonialTooLong'));
      return;
    }

    setLoading(true);
    try {
      await submitReview(businessId, {
        leadId,
        rating: parseInt(rating, 10),
        testimonial: testimonial.trim(),
      });
      toast.success(t('reviews.successSubmitted'));
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || t('reviews.errorSubmit'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t('reviews.submitReview')}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Rating */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              {t('reviews.rating')}
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`w-10 h-10 rounded-lg font-bold transition-colors ${
                    rating >= star
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {star}
                </button>
              ))}
            </div>
          </div>

          {/* Testimonial */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('reviews.testimonial')}
            </label>
            <textarea
              value={testimonial}
              onChange={e => setTestimonial(e.target.value)}
              placeholder={t('reviews.placeholderTestimonial')}
              rows={4}
              maxLength={500}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="text-xs text-gray-400 mt-1">
              {testimonial.length}/500 {t('reviews.characters')}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {loading ? t('reviews.submitting') : t('reviews.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
