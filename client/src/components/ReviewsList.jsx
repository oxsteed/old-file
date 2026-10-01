import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getBusinessReviews, deleteReview } from '../api/businessReviews';

export default function ReviewsList({ businessId, maxReviews = 10 }) {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('recent');
  const [pagination, setPagination] = useState({});
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadReviews();
  }, [page, sortBy]);

  const loadReviews = async () => {
    setLoading(true);
    try {
      const data = await getBusinessReviews(businessId, { page, limit: maxReviews, sortBy });
      setReviews(data.reviews || []);
      setPagination(data.pagination || {});
      setStats(data.stats || null);
    } catch (err) {
      toast.error(t('reviews.errorLoadReviews'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteReview = async (reviewId) => {
    if (!window.confirm(t('reviews.confirmDelete'))) return;
    try {
      await deleteReview(reviewId);
      toast.success(t('reviews.successDeleted'));
      await loadReviews();
    } catch (err) {
      toast.error(t('reviews.errorDelete'));
    }
  };

  const StarRating = ({ rating }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <span
          key={star}
          className={`text-sm ${rating >= star ? 'text-yellow-500' : 'text-gray-600'}`}
        >
          ★
        </span>
      ))}
    </div>
  );

  const RatingDistribution = ({ distribution }) => {
    const total = Object.values(distribution).reduce((a, b) => a + b, 0) || 1;
    return (
      <div className="space-y-1">
        {[5, 4, 3, 2, 1].map(stars => {
          const count = distribution[`${stars}_star`] || 0;
          const percent = Math.round((count / total) * 100);
          return (
            <div key={stars} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-8">{stars}★</span>
              <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-6 text-end">{count}</span>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading && reviews.length === 0) {
    return <p className="text-gray-400 text-center py-8">{t('common.loading')}</p>;
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">{t('reviews.noReviews')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Summary */}
      {stats && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-sm text-gray-400">{t('reviews.averageRating')}</div>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">{stats.avg_rating}</span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(star => (
                    <span
                      key={star}
                      className={`text-lg ${stats.avg_rating >= star ? 'text-yellow-500' : 'text-gray-600'}`}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">{t('reviews.totalReviews')}</div>
              <div className="text-3xl font-bold text-white">{stats.total_reviews}</div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-4">
            <RatingDistribution distribution={stats.distribution} />
          </div>
        </div>
      )}

      {/* Sort Controls */}
      <div className="flex gap-2">
        <select
          value={sortBy}
          onChange={e => {
            setSortBy(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="recent">{t('reviews.sortRecent')}</option>
          <option value="rating-high">{t('reviews.sortHighestRated')}</option>
          <option value="rating-low">{t('reviews.sortLowestRated')}</option>
        </select>
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {reviews.map(review => (
          <div key={review.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-white">
                  {review.first_name} {review.last_name}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(review.created_at).toLocaleDateString()}
                </div>
              </div>
              <StarRating rating={review.rating} />
            </div>

            {/* Testimonial */}
            <p className="text-gray-300 text-sm mb-3">{review.testimonial}</p>

            {/* Response */}
            {review.response && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 mb-3">
                <div className="text-xs font-medium text-brand-400 mb-1">{t('reviews.businessResponse')}</div>
                <p className="text-sm text-gray-300">{review.response}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pagination.total > maxReviews && (
        <div className="flex justify-center items-center gap-2 pt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 text-gray-300 rounded text-sm transition-colors"
          >
            {t('common.previous')}
          </button>
          <span className="text-sm text-gray-400">
            {page} / {Math.ceil(pagination.total / pagination.limit)}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= Math.ceil(pagination.total / pagination.limit)}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 text-gray-300 rounded text-sm transition-colors"
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}
