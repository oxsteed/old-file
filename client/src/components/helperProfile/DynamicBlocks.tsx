/**
 * DynamicBlocks.tsx
 *
 * Client-side dynamic blocks for the helper profile page (Issue #35).
 * These components are fetched AFTER the static shell renders,
 * showing skeleton loading states until data arrives.
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, DollarSign, Calendar, Zap, Circle } from 'lucide-react';
import type { HelperAvailabilityData, HelperPricingData, HelperSlotData } from '../../api/helpers';
import { fetchHelperAvailability, fetchHelperPricing, fetchHelperSlots } from '../../api/helpers';

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

// ── Availability Block ──────────────────────────────────────────────────────
export const AvailabilityBlock: React.FC<{ helperId: string }> = ({ helperId }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<HelperAvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchHelperAvailability(helperId)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [helperId]);

  if (loading) return <SkeletonBlock title={t('helperProfile.chat.loadingAvailability')} lines={2} />;
  if (error || !data) return null;

  return (
    <section
      id="dynamic-availability"
      className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
      aria-label={t('helperProfile.chat.availabilityAria')}
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-brand-400" aria-hidden />
        <h3 className="text-sm font-semibold text-white">{t('helperProfile.chat.availability')}</h3>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <span className="flex items-center gap-1.5">
          <Circle
            className={`w-2.5 h-2.5 fill-current ${
              data.isOnline ? 'text-green-400' : data.isAvailableNow ? 'text-yellow-400' : 'text-gray-500'
            }`}
            aria-hidden
          />
          <span className="text-sm text-gray-300">
            {data.isOnline
              ? t('helperProfile.chat.onlineNow')
              : data.isAvailableNow
              ? t('helperProfile.chat.availableToday')
              : t('helperProfile.chat.offline')}
          </span>
        </span>
        {data.responseTime && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Zap className="w-3 h-3" aria-hidden />
            {t('helperProfile.chat.respondsIn', { time: data.responseTime })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {data.schedule.map((day) => (
          <div key={day.day} className="text-xs">
            <div className="text-gray-500 font-medium mb-1">{day.day.slice(0, 3)}</div>
            <div className={day.closed ? 'text-gray-600' : 'text-gray-300'}>
              {day.closed ? t('helperProfile.chat.off') : day.open?.replace(':00', '')}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// ── Pricing Block ───────────────────────────────────────────────────────────
export const PricingBlock: React.FC<{ helperId: string }> = ({ helperId }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<HelperPricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchHelperPricing(helperId)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
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
          <span className="text-sm text-gray-400 ml-1">{t('helperProfile.chat.perHour')}</span>
          {data.flatRateAvailable && (
            <span className="ml-2 text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
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

// ── Slots This Week Block ───────────────────────────────────────────────────
export const SlotsBlock: React.FC<{ helperId: string }> = ({ helperId }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<HelperSlotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchHelperSlots(helperId)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [helperId]);

  if (loading) return <SkeletonBlock title={t('helperProfile.chat.loadingSlots')} lines={4} />;
  if (error || !data || data.slots.length === 0) return null;

  return (
    <section
      id="dynamic-slots"
      className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
      aria-label={t('helperProfile.chat.slotsAria')}
    >
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-brand-400" aria-hidden />
        <h3 className="text-sm font-semibold text-white">{t('helperProfile.chat.slotsThisWeek')}</h3>
        <span className="ml-auto text-xs text-gray-500">
          {t('helperProfile.chat.openDays', { count: data.totalOpenDays })}
        </span>
      </div>
      <div className="space-y-2">
        {data.slots.map((slot) => {
          const dateObj = new Date(slot.date + 'T12:00:00');
          const dayLabel = dateObj.toLocaleDateString(i18n.resolvedLanguage || i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });
          return (
            <div
              key={slot.date}
              className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm ${
                slot.hasOpenings
                  ? 'bg-gray-800/50 border border-gray-700/50'
                  : 'bg-gray-800/20 border border-gray-800/30 opacity-60'
              }`}
            >
              <span className="text-gray-300 font-medium">{dayLabel}</span>
              <span className="text-gray-400 text-xs">{slot.open} – {slot.close}</span>
              <span className={`text-xs font-medium ${
                slot.hasOpenings ? 'text-green-400' : 'text-gray-500'
              }`}>
                {slot.hasOpenings ? t('helperProfile.chat.open') : t('helperProfile.chat.full')}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};
