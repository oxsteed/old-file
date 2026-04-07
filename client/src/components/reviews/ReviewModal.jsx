import { useState }   from 'react';
import { Star }       from 'lucide-react';
import api            from '../../api/axios';

export default function ReviewModal({ jobId, revieweeName, onComplete }) {
  const [open,    setOpen]    = useState(false);
  const [rating,  setRating]  = useState(0);
  const [hovered, setHovered] = useState(0);
  const [title,   setTitle]   = useState('');
  const [body,    setBody]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [done,    setDone]    = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setError('Please select a star rating.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post(`/reviews/jobs/${jobId}`, { rating, title, body });
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        onComplete?.();
      }, 1800);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit review.');
    } finally {
      setLoading(false);
    }
  };

  const RATING_LABELS = {
    1: 'Poor',
    2: 'Fair',
    3: 'Good',
    4: 'Great',
    5: 'Excellent!'
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 bg-orange-500 text-white font-semibold
                   rounded-xl hover:bg-orange-600 transition"
      >
        Leave a Review
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        bg-black/50 px-4"
          role="dialog" aria-modal="true" aria-labelledby="review-modal-title">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">

            {done ? (
              <div className="text-center py-8">
                <p className="text-5xl mb-3">⭐</p>
                <p className="text-lg font-bold text-gray-900">
                  Review submitted!
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Thank you for your feedback.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h3 id="review-modal-title" className="font-bold text-gray-900 text-lg">
                    Review {revieweeName}
                  </h3>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-gray-400 hover:text-gray-600 transition"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Star rating */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2" id="rating-label">
                      Overall Rating
                    </label>
                    <div className="flex items-center gap-1">
                      {[1,2,3,4,5].map(star => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHovered(star)}
                          onMouseLeave={() => setHovered(0)}
                          className="p-0.5 transition-transform hover:scale-110"
                        >
                          <Star
                            size={32}
                            className={`transition-colors ${
                              star <= (hovered || rating)
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-gray-300'
                            }`}
                          />
                        </button>
                      ))}
                      {(hovered || rating) > 0 && (
                        <span className="ml-2 text-sm font-semibold
                                         text-gray-700">
                          {RATING_LABELS[hovered || rating]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label htmlFor="review-title" className="block text-sm font-medium text-gray-700 mb-1">
                      Headline
                      <span className="text-gray-400 font-normal ml-1">
                        (optional)
                      </span>
                    </label>
                    <input
                      id="review-title"
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      maxLength={100}
                      placeholder="Summarize your experience..."
                      className="w-full px-3 py-2.5 border border-gray-300
                                 rounded-lg text-sm focus:ring-2
                                 focus:ring-orange-400 focus:outline-none"
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label htmlFor="review-body" className="block text-sm font-medium text-gray-700 mb-1">
                      Written Review
                      <span className="text-gray-400 font-normal ml-1">
                        (optional)
                      </span>
                    </label>
                    <textarea
                      id="review-body"
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      rows={4}
                      maxLength={1000}
                      placeholder="Share details about your experience..."
                      className="w-full px-3 py-2.5 border border-gray-300
                                 rounded-lg text-sm focus:ring-2
                                 focus:ring-orange-400 focus:outline-none
                                 resize-none"
                    />
                    <p className="text-xs text-gray-400 text-right mt-1">
                      {body.length}/1000
                    </p>
                  </div>

                  {error && (
                    <div id="review-error"
                      role="alert"
                      className="bg-red-50 border border-red-200
                                    text-red-700 text-sm rounded-lg
                                    px-4 py-3">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="flex-1 py-2.5 border border-gray-200
                                 text-gray-600 rounded-xl text-sm
                                 font-medium hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !rating}
                      className="flex-1 py-2.5 bg-orange-500 text-white
                                 rounded-xl text-sm font-semibold
                                 hover:bg-orange-600 disabled:opacity-50
                                 disabled:cursor-not-allowed transition"
                    >
                      {loading ? 'Submitting...' : 'Submit Review'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
