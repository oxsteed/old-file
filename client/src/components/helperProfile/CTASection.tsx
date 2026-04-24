import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { HelperProfile } from '../../types/helperProfile';
import StarRating from './ui/StarRating';
import TrustSignals from './TrustSignals';

interface CTASectionProps {
  helper: HelperProfile;
  onBookNow: () => void;
  onMessageHelper: () => void;
  onOpenChat?: () => void;
  hasServices?: boolean;
}

const CTASection: React.FC<CTASectionProps> = ({
  helper,
  onBookNow,
  onMessageHelper,
  onOpenChat,
  hasServices = true,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside
      className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col"
      aria-label={t('helperProfile.cta.bookNowAria')}
    >
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-3 flex items-center justify-between border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? t('helperProfile.cta.hideDetails') : t('helperProfile.cta.showDetails')}
      >
        <div className="flex items-baseline gap-1 text-left">
          <span className="text-2xl font-bold text-white">$45</span>
          <span className="text-gray-400 text-sm">{t('helperProfile.cta.perHour')}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" aria-hidden="true" />
        )}
      </button>

      {/* Expanded Content: Price Details & Rating */}
      {isExpanded && (
        <div className="px-5 py-4 border-b border-gray-800 space-y-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">
              {t('helperProfile.cta.startingFrom')}
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-white">$45</span>
              <span className="text-gray-400 text-sm">{t('helperProfile.cta.perHour')}</span>
            </div>
          </div>
          {helper.reviewCount > 0 ? (
            <div className="flex items-center gap-2">
              <StarRating rating={helper.rating} size="sm" />
              <span className="text-sm font-semibold text-white">{helper.rating.toFixed(1)}</span>
              <span className="text-gray-500 text-sm">({helper.reviewCount})</span>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('helperProfile.cta.noReviews')}</p>
          )}
        </div>
      )}

      {/* CTAs - Always Visible */}
      <div className="px-5 py-4 space-y-3">
        <button
          onClick={hasServices ? onBookNow : undefined}
          disabled={!hasServices}
          title={!hasServices ? t('helperProfile.cta.noServicesTitle') : undefined}
          className={`w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl text-white font-semibold text-sm transition-colors active:scale-[0.98] ${
            hasServices
              ? 'bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/20 cursor-pointer'
              : 'bg-gray-700 cursor-not-allowed opacity-60'
          }`}
          aria-label={hasServices ? t('helperProfile.cta.bookNowAria') : t('helperProfile.cta.bookingUnavailableAria')}
        >
          <CalendarCheck className="w-4 h-4" aria-hidden="true" />
          {t('helperProfile.cta.bookNow')}
        </button>
        <button
          onClick={onMessageHelper}
          className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl border border-gray-700 hover:bg-gray-800 text-gray-200 font-medium text-sm transition-colors active:scale-[0.98]"
          aria-label={t('helperProfile.cta.messageHelperAria')}
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          {t('helperProfile.cta.messageHelper')}
        </button>
      </div>

      {/* Trust signals — expanded only */}
      {isExpanded && (
        <>
          <TrustSignals helper={helper} />

          {/* Fine print */}
          <div className="px-5 pb-4 border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-600 leading-relaxed text-center">
              {t('helperProfile.cta.securePayments')}
            </p>
          </div>
        </>
      )}
    </aside>
  );
};

export default CTASection;
