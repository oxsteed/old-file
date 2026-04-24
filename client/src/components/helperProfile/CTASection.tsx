import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, MessageCircle } from 'lucide-react';
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

  return (
    <aside
      className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
      aria-label={t('helperProfile.cta.bookNowAria')}
    >
      {/* Price hint */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">
          {t('helperProfile.cta.startingFrom')}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-white">$45</span>
          <span className="text-gray-400 text-sm">{t('helperProfile.cta.perHour')}</span>
        </div>
        {helper.reviewCount > 0 ? (
          <div className="flex items-center gap-2 mt-1.5">
            <StarRating rating={helper.rating} size="sm" />
            <span className="text-sm font-semibold text-white">{helper.rating.toFixed(1)}</span>
            <span className="text-gray-500 text-sm">({helper.reviewCount})</span>
          </div>
        ) : (
          <p className="text-sm text-gray-500 mt-1.5">{t('helperProfile.cta.noReviews')}</p>
        )}
      </div>

      {/* CTAs */}
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

      {/* Trust signals — rendered from real backend data */}
      <TrustSignals helper={helper} />

      {/* Fine print */}
      <div className="px-5 pb-4 border-t border-gray-800 pt-3">
        <p className="text-xs text-gray-600 leading-relaxed text-center">
          {t('helperProfile.cta.securePayments')}
        </p>
      </div>
    </aside>
  );
};

export default CTASection;
