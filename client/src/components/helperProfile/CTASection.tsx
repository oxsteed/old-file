import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { HelperProfile, Service } from '../../types/helperProfile';
import StarRating from './ui/StarRating';
import TrustSignals from './TrustSignals';

interface CTASectionProps {
  helper: HelperProfile;
  onBookNow: () => void;
  onMessageHelper: () => void;
  onOpenChat?: () => void;
  hasServices?: boolean;
  services?: Service[];
  primaryLabel?: string;
  secondaryLabel?: string;
  allowPrimaryWithoutServices?: boolean;
}

function formatPrice(t: (key: string, options?: any) => string, service?: Service): string {
  if (!service || !Number.isFinite(service.price) || service.price <= 0) {
    return t('helperProfile.cta.contactForPricing');
  }
  const amount = `$${service.price.toFixed(0)}`;
  if (service.priceUnit === 'flat') return amount;
  if (service.priceUnit === 'starting_at') {
    return t('helperProfile.cta.startingAtPrice', { amount });
  }
  if (service.priceUnit === 'quote') {
    return t('helperProfile.cta.contactForPricing');
  }
  return amount;
}

function formatPriceUnit(t: (key: string, options?: any) => string, service?: Service): string {
  if (!service || !Number.isFinite(service.price) || service.price <= 0 || service.priceUnit === 'quote') return '';
  if (service.priceUnit === 'flat') return t('helperProfile.cta.flatRate');
  if (service.priceUnit === 'starting_at') return '';
  return t('helperProfile.cta.perHour');
}

const CTASection: React.FC<CTASectionProps> = ({
  helper,
  onBookNow,
  onMessageHelper,
  onOpenChat,
  hasServices = true,
  services = [],
  primaryLabel,
  secondaryLabel,
  allowPrimaryWithoutServices = false,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const pricedServices = services.filter((service) => Number.isFinite(service.price) && service.price > 0 && service.priceUnit !== 'quote');
  const startingService = pricedServices.sort((a, b) => a.price - b.price)[0] || services[0];
  const priceLabel = formatPrice(t, startingService);
  const priceUnitLabel = formatPriceUnit(t, startingService);

  const primaryEnabled = hasServices || allowPrimaryWithoutServices;

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
          <span className="text-2xl font-bold text-white">{priceLabel}</span>
          {priceUnitLabel && <span className="text-gray-400 text-sm">{priceUnitLabel}</span>}
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
              <span className="text-3xl font-bold text-white">{priceLabel}</span>
              {priceUnitLabel && <span className="text-gray-400 text-sm">{priceUnitLabel}</span>}
            </div>
            {startingService?.name && (
              <p className="mt-1 text-xs text-gray-500">{startingService.name}</p>
            )}
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
          onClick={primaryEnabled ? onBookNow : undefined}
          disabled={!primaryEnabled}
          title={!primaryEnabled ? t('helperProfile.cta.noServicesTitle') : undefined}
          className={`w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl text-white font-semibold text-sm transition-colors active:scale-[0.98] ${
            primaryEnabled
              ? 'bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/20 cursor-pointer'
              : 'bg-gray-700 cursor-not-allowed opacity-60'
          }`}
          aria-label={primaryEnabled ? t('helperProfile.cta.bookNowAria') : t('helperProfile.cta.bookingUnavailableAria')}
        >
          <CalendarCheck className="w-4 h-4" aria-hidden="true" />
          {primaryLabel || t('helperProfile.cta.bookNow')}
        </button>
        <button
          onClick={onMessageHelper}
          className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl border border-gray-700 hover:bg-gray-800 text-gray-200 font-medium text-sm transition-colors active:scale-[0.98]"
          aria-label={t('helperProfile.cta.messageHelperAria')}
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          {secondaryLabel || t('helperProfile.cta.messageHelper')}
        </button>
      </div>

      {/* Trust signals - expanded only */}
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
