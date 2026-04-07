import React, { useState } from 'react';
import { ThumbsUp, CheckCircle2, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import type { Review } from '../../types/helperProfile';
import StarRating from './ui/StarRating';
import SectionCard from './ui/SectionCard';

interface ReviewsSectionProps {
  reviews: Review[];
  overallRating: number;
  totalCount: number;
}

const INITIAL_DISPLAY = 3;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

const RatingDistribution: React.FC<{ reviews: Review[] }> = ({ reviews }) => {
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => Math.round(r.rating) === star).length,
  }));
  const max = Math.max(...dist.map((d) => d.count), 1);

  return (
    <div className="space-y-1.5" aria-label="Rating distribution">
      {dist.map(({ star, count }) => (
        <div key={star} className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 w-3 text-right">{star}</span>
          <svg className="w-3 h-3 text-orange-400 flex-shrink-0" viewBox="0 0 20 20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
            />
          </svg>
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-400 rounded-full transition-all"
              style={{ width: `${(count / max) * 100}%` }}
              role="presentation"
            />
          </div>
          <span className="text-gray-500 w-4 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
};

const ReviewCard: React.FC<{ review: Review }> = ({ review }) => {
  const [replyOpen, setReplyOpen] = useState(false);

  return (
    <article className="border border-gray-700/50 rounded-xl p-4 bg-gray-800/30 space-y-3">
      {/* Author row */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {review.authorAvatar ? (
            <img
              src={review.authorAvatar}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-gray-700"
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0"
              aria-hidden="true"
            >
              <span className="text-gray-400 text-sm font-semibold">
                {review.authorName[0]}
              </span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-white">{review.authorName}</p>
              {review.verified && (
                <CheckCircle2
                  className="w-3.5 h-3.5 text-emerald-400"
                  aria-label="Verified purchase"
                />
              )}
            </div>
            <p className="text-xs text-gray-500">{formatDate(review.date)}</p>
          </div>
        </div>
        <StarRating rating={review.rating} size="sm" />
      </header>

      {/* Service used */}
      <p className="text-xs text-brand-400 font-medium">{review.serviceUsed}</p>

      {/* Review body */}
      <p className="text-sm text-gray-300 leading-relaxed">{review.content}</p>

      {/* Helpful */}
      <footer className="flex items-center justify-between pt-1">
        <button
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          aria-label={`Mark as helpful (${review.helpfulCount} found helpful)`}
        >
          <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
          {review.helpfulCount} found helpful
        </button>

        {review.helperReply && (
          <button
            onClick={() => setReplyOpen((p) => !p)}
            className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            aria-expanded={replyOpen}
            aria-controls={`reply-${review.id}`}
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            Helper replied
            {replyOpen ? (
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            )}
          </button>
        )}
      </footer>

      {/* Helper reply */}
      {review.helperReply && replyOpen && (
        <div
          id={`reply-${review.id}`}
          className="mt-1 pl-3 border-l-2 border-brand-500/50 space-y-1"
        >
          <p className="text-xs font-semibold text-brand-400">Response from the helper</p>
          <p className="text-xs text-gray-400 leading-relaxed">{review.helperReply.content}</p>
          <p className="text-xs text-gray-600">{formatDate(review.helperReply.date)}</p>
        </div>
      )}
    </article>
  );
};

const ReviewsSection: React.FC<ReviewsSectionProps> = ({
  reviews,
  overallRating,
  totalCount,
}) => {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? reviews : reviews.slice(0, INITIAL_DISPLAY);

  return (
    <SectionCard
      id="reviews"
      title="Reviews"
      subtitle={`${totalCount} verified reviews`}
    >
      {/* Summary row */}
      <div className="flex flex-col sm:flex-row gap-6 mb-6 p-4 bg-gray-800/40 rounded-xl border border-gray-700/50">
        <div className="flex flex-col items-center justify-center sm:border-r border-gray-700 sm:pr-6 sm:min-w-[96px]">
          <p className="text-5xl font-bold text-white">{overallRating.toFixed(1)}</p>
          <StarRating rating={overallRating} size="md" className="mt-1" />
          <p className="text-xs text-gray-500 mt-1">{totalCount} reviews</p>
        </div>
        <div className="flex-1">
          <RatingDistribution reviews={reviews} />
        </div>
      </div>

      {/* Review cards */}
      <div className="space-y-4">
        {displayed.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>

      {reviews.length > INITIAL_DISPLAY && (
        <button
          onClick={() => setShowAll((p) => !p)}
          className="mt-4 w-full py-2.5 rounded-xl border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors flex items-center justify-center gap-2"
          aria-expanded={showAll}
        >
          {showAll ? (
            <>Show fewer <ChevronUp className="w-4 h-4" aria-hidden="true" /></>
          ) : (
            <>Show all {totalCount} reviews <ChevronDown className="w-4 h-4" aria-hidden="true" /></>
          )}
        </button>
      )}
    </SectionCard>
  );
};

export default ReviewsSection;
