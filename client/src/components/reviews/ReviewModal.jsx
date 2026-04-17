import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

export default function ReviewModal({ jobId, revieweeName, onComplete }) {
  const { t } = useTranslation();
  const [open,    setOpen]    = useState(false);
  const [rating,  setRating]  = useState(0);
  const [hovered, setHovered] = useState(0);
  const [title,   setTitle]   = useState('');
  const [body,    setBody]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [done,    setDone]    = useState(false);

  // Lock body scroll and handle Escape while modal is open
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const RATING_LABELS = {
    1: t('jobDetail.ratingPoor'),
    2: t('jobDetail.ratingFair'),
    3: t('jobDetail.ratingGood'),
    4: t('jobDetail.ratingGreat'),
    5: t('jobDetail.ratingExcellent'),
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setError(t('jobDetail.ratingRequired'));
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
      setError(err.response?.data?.error || t('jobDetail.reviewFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 bg-orange-500 text-white font-semibold
                   rounded-xl hover:bg-orange-600 transition"
      >
        {t('jobDetail.reviewBtn')}
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
                  {t('jobDetail.reviewSubmitted')}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {t('jobDetail.reviewThanks')}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h3 id="review-modal-title" className="font-bold text-gray-900 text-lg">
                    {t('jobDetail.reviewTitle', { name: revieweeName })}
                  </h3>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="p-2 -mr-1 text-gray-400 hover:text-gray-600 transition rounded-lg"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Star rating */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2" id="rating-label">
                      {t('jobDetail.overallRating')}
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
                        <span className="ml-2 text-sm font-semibold text-gray-700">
                          {RATING_LABELS[hovered || rating]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label htmlFor="review-title" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('jobDetail.headline')}
                      <span className="text-gray-400 font-normal ml-1">
                        ({t('common.optional')})
                      </span>
                    </label>
                    <input
                      id="review-title"
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      maxLength={100}
                      placeholder={t('jobDetail.headlinePlaceholder')}
                      className="w-full px-3 py-2.5 border border-gray-300
                                 rounded-lg text-sm focus:ring-2
                                 focus:ring-orange-400 focus:outline-none"
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label htmlFor="review-body" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('jobDetail.writtenReview')}
                      <span className="text-gray-400 font-normal ml-1">
                        ({t('common.optional')})
                      </span>
                    </label>
                    <textarea
                      id="review-body"
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      rows={4}
                      maxLength={1000}
                      placeholder={t('jobDetail.writtenReviewPlaceholder')}
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
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !rating}
                      className="flex-1 py-2.5 bg-orange-500 text-white
                                 rounded-xl text-sm font-semibold
                                 hover:bg-orange-600 disabled:opacity-50
                                 disabled:cursor-not-allowed transition"
                    >
                      {loading ? t('jobDetail.submitting') : t('jobDetail.submitReview')}
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
