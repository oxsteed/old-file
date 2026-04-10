import React from 'react';
import { CalendarCheck, MessageCircle, ShieldCheck, Clock, Star } from 'lucide-react';
import type { HelperProfile } from '../../types/helperProfile';
import StarRating from './ui/StarRating';

interface CTASectionProps {
  helper: HelperProfile;
  onBookNow: () => void;
  onOpenChat: () => void;
  hasServices?: boolean;
}

const CTASection: React.FC<CTASectionProps> = ({ helper, onBookNow, onOpenChat, hasServices = true }) => (
  <aside
    className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
    aria-label="Book this helper"
  >
    {/* Price hint */}
    <div className="px-5 pt-5 pb-4 border-b border-gray-800">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">
        Starting from
      </p>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-white">$45</span>
        <span className="text-gray-400 text-sm">/hr</span>
      </div>
      {helper.reviewCount > 0 ? (
        <div className="flex items-center gap-2 mt-1.5">
          <StarRating rating={helper.rating} size="sm" />
          <span className="text-sm font-semibold text-white">{helper.rating.toFixed(1)}</span>
          <span className="text-gray-500 text-sm">({helper.reviewCount})</span>
        </div>
      ) : (
        <p className="text-sm text-gray-500 mt-1.5">No reviews yet</p>
      )}
    </div>

    {/* CTAs */}
    <div className="px-5 py-4 space-y-3">
      <button
        onClick={hasServices ? onBookNow : undefined}
        disabled={!hasServices}
        title={!hasServices ? 'This helper hasn\'t listed services yet — send them a message' : undefined}
        className={`w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl text-white font-semibold text-sm transition-colors active:scale-[0.98] ${
          hasServices
            ? 'bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/20 cursor-pointer'
            : 'bg-gray-700 cursor-not-allowed opacity-60'
        }`}
        aria-label={hasServices ? 'Book this helper now' : 'Booking unavailable — no services listed'}
      >
        <CalendarCheck className="w-4 h-4" aria-hidden="true" />
        Book Now
      </button>
      <button
        onClick={onOpenChat}
        className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl border border-gray-700 hover:bg-gray-800 text-gray-200 font-medium text-sm transition-colors active:scale-[0.98]"
        aria-label="Send a message to this helper"
      >
        <MessageCircle className="w-4 h-4" aria-hidden="true" />
        Message Helper
      </button>
    </div>

    {/* Trust signals */}
    <ul className="px-5 pb-5 space-y-2.5" aria-label="Trust signals">
      <li className="flex items-center gap-2.5 text-xs text-gray-400">
        <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
        Background checked & verified
      </li>
      <li className="flex items-center gap-2.5 text-xs text-gray-400">
        <Clock className="w-4 h-4 text-sky-400 flex-shrink-0" aria-hidden="true" />
        {helper.responseTime && helper.responseTime.toLowerCase() !== 'varies'
            ? `Responds in ${helper.responseTime}`
            : 'Response time varies'}
          {helper.jobsCompleted > 0 && ` · ${helper.responseRate}% response rate`}
      </li>
      <li className="flex items-center gap-2.5 text-xs text-gray-400">
        <Star className="w-4 h-4 text-orange-400 flex-shrink-0" aria-hidden="true" />
        {helper.jobsCompleted} jobs completed on OxSteed
      </li>
      <li className="flex items-center gap-2.5 text-xs text-gray-400">
        <ShieldCheck className="w-4 h-4 text-violet-400 flex-shrink-0" aria-hidden="true" />
        Protected by OxSteed Guarantee
      </li>
    </ul>

    {/* Fine print */}
    <div className="px-5 pb-4 border-t border-gray-800 pt-3">
      <p className="text-xs text-gray-600 leading-relaxed text-center">
        Secure payments · Free cancellation 24 hrs before service
      </p>
    </div>
  </aside>
);

export default CTASection;
