import { useEffect, useState }  from 'react';
import { Star, ChevronDown }    from 'lucide-react';
import { formatDistanceToNow }  from 'date-fns';
import api                      from '../../api/axios';

export default function ReviewsList({ userId }) {
  const [reviews, setReviews]  = useState([]);
  const [stats,   setStats]    = useState(null);
  const [page,    setPage]     = useState(1);
  const [hasMore, setHasMore]  = useState(true);
  const [loading, setLoading]  = useState(true);

  const fetchReviews = async (reset = false) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/reviews/users/${userId}`, {
        params: { page: reset ? 1 : page, limit: 10 }
      });
      if (reset) {
        setReviews(data.reviews);
        setPage(2);
      } else {
        setReviews(prev => [...prev, ...data.reviews]);
        setPage(p => p + 1);
      }
      setStats(data.stats);
      setHasMore(data.reviews.length === 10);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReviews(true); }, [userId]);

  if (!stats) return null;

  const totalReviews = parseInt(stats.total_reviews || 0);
  const avgRating    = parseFloat(stats.average_rating || 0);

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      {totalReviews > 0 && (
        <div className="bg-gray-50 rounded-2xl p-5 flex gap-6
                        items-center flex-wrap">
          {/* Average */}
          <div className="text-center">
            <p className="text-4xl font-extrabold text-gray-900">
              {avgRating.toFixed(1)}
            </p>
            <div className="flex justify-center gap-0.5 mt-1">
              {[1,2,3,4,5].map(s => (
                <Star
                  key={s}
                  size={14}
                  className={s <= Math.round(avgRating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-300'
                  }
                />
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {totalReviews} review{totalReviews !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Breakdown bars */}
          <div className="flex-1 min-w-48 space-y-1.5">
            {[5,4,3,2,1].map(star => {
              const count = parseInt(stats[`${['one','two','three',
                'four','five'][star-1]}_star`] || 0);
              const pct   = totalReviews > 0
                ? (count / totalReviews) * 100 : 0;
              return (
                <div key={star}
                     className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 w-6 text-right shrink-0">
                    {star}
                  </span>
                  <Star size={10}
                        className="fill-yellow-400 text-yellow-400 shrink-0" />
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-yellow-400 h-1.5 rounded-full
                                 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-gray-400 w-6 shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Review cards */}
      {reviews.length === 0 && !loading ? (
        <div className="text-center py-10 text-gray-400">
          <Star size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No reviews yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map(review => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
            )}

      {/* Load more */}
      {hasMore && !loading && (
        <button
          onClick={() => fetchReviews(false)}
          className="w-full py-3 border border-gray-200 text-gray-500
                     text-sm font-medium rounded-xl hover:bg-gray-50
                     transition flex items-center justify-center gap-2"
        >
          <ChevronDown size={16} />
          Load more reviews
        </button>
      )}

      {loading && (
        <div className="text-center py-6 text-gray-400 text-sm">
          Loading...
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }) {
  const [showResponse, setShowResponse] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      {/* Reviewer info + rating */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <img
            src={review.reviewer_avatar || '/default-avatar.png'}
            alt=""
            loading="lazy"
            className="w-9 h-9 rounded-full object-cover
                       border border-gray-200"
          />
          <div>
            <p className="font-medium text-gray-800 text-sm">
              {review.reviewer_name}
            </p>
            <p className="text-xs text-gray-400">
              {formatDistanceToNow(
                new Date(review.created_at), { addSuffix: true }
              )}
            </p>
          </div>
        </div>

        {/* Stars */}
        <div className="flex gap-0.5 shrink-0">
          {[1,2,3,4,5].map(s => (
            <Star
              key={s}
              size={14}
              className={s <= review.rating
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-gray-200'
              }
            />
          ))}
        </div>
      </div>

      {/* Title */}
      {review.title && (
        <p className="font-semibold text-gray-800 text-sm mb-1">
          {review.title}
        </p>
      )}

      {/* Body */}
      {review.body && (
        <p className="text-sm text-gray-600 leading-relaxed">
          {review.body}
        </p>
      )}

      {/* Job reference */}
      <p className="text-xs text-gray-400 mt-2">
        Job: {review.job_title}
      </p>

      {/* Response from reviewee */}
      {review.response && (
        <div className="mt-3 bg-orange-50 border border-orange-100
                        rounded-lg p-3">
          <p className="text-xs font-semibold text-orange-700 mb-1">
            Response from owner
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            {review.response}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {formatDistanceToNow(
              new Date(review.responded_at), { addSuffix: true }
            )}
          </p>
        </div>
      )}
    </div>
  );
}
