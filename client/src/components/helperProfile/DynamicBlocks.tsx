/**
 * DynamicBlocks.tsx
 *
 * Client-side dynamic blocks for the helper profile page (Issue #35).
 * These components are fetched AFTER the static shell renders,
 * showing skeleton loading states until data arrives.
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Zap } from 'lucide-react';
import type { HelperPricingData } from '../../api/helpers';
import { fetchHelperPricing } from '../../api/helpers';

// ── Skeleton primitives ─────────────────────────────────────────────────────
const SkeletonLine: React.FC<{ width?: string }> = ({ width = 'w-full' }) => (
  <div className={`h-4 bg-gray-800 rounded ${width} animate-pulse`} />
);

const SkeletonBlock: React.FC<{ lines?: number; title: string }> = ({ lines = 3, title }) => (
  <section
    className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5 space-y-3"
    aria-label={title}
  >
    <div className="h-5 bg-gray-800 rounded w-1/3 animate-pulse" />
    {Array.from({ length: lines }).map((_, i) => (
      <SkeletonLine key={i} width={i === lines - 1 ? 'w-2/3' : 'w-full'} />
    ))}
  </section>
);

// ── Pricing Block ───────────────────────────────────────────────────────────
export const PricingBlock: React.FC<{ helperId: string }> = ({ helperId }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<HelperPricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchHelperPricing(helperId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((err) => { if (!controller.signal.aborted && err?.code !== 'ERR_CANCELED') setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [helperId]);

  if (loading) return <SkeletonBlock title={t('helperProfile.chat.loadingPricing')} lines={3} />;
  if (error || !data) return null;
  if (data.contactForPricing && !data.hourlyRateMin) {
    return (
      <section
        id="dynamic-pricing"
        className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
        aria-label={t('helperProfile.chat.pricing')}
      >
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4 text-brand-400" aria-hidden />
          <h3 className="text-sm font-semibold text-white">{t('helperProfile.chat.pricing')}</h3>
        </div>
        <p className="text-sm text-gray-400">{t('helperProfile.chat.contactForPricing')}</p>
      </section>
    );
  }

  return (
    <section
      id="dynamic-pricing"
      className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
      aria-label={t('helperProfile.chat.pricing')}
    >
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-4 h-4 text-brand-400" aria-hidden />
        <h3 className="text-sm font-semibold text-white">{t('helperProfile.chat.pricing')}</h3>
      </div>
      {(data.hourlyRateMin || data.hourlyRateMax) && (
        <div className="mb-3">
          <span className="text-lg font-bold text-white">
            ${data.hourlyRateMin ?? '?'}
            {data.hourlyRateMax && data.hourlyRateMax !== data.hourlyRateMin
              ? `–$${data.hourlyRateMax}`
              : ''}
          </span>
          <span className="text-sm text-gray-400 ms-1">{t('helperProfile.chat.perHour')}</span>
          {data.flatRateAvailable && (
            <span className="ms-2 text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
              {t('helperProfile.chat.flatRatesAvailable')}
            </span>
          )}
        </div>
      )}
      {data.servicePricing.length > 0 && (
        <ul className="space-y-1.5">
          {data.servicePricing.slice(0, 5).map((svc) => (
            <li key={svc.name} className="flex justify-between text-sm">
              <span className="text-gray-300">{svc.name}</span>
              <span className="text-gray-400">
                {svc.hourlyRate ? `$${svc.hourlyRate}${t('helperProfile.chat.perHour')}` : svc.flatRate ? `$${svc.flatRate}` : t('helperProfile.chat.contact')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
