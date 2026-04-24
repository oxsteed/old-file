import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Clock, Star } from 'lucide-react';
import type { HelperProfile } from '../../types/helperProfile';

interface TrustSignalsProps {
  helper: HelperProfile;
}

/**
 * TrustSignals — renders real backend data about helper status.
 * Maps enum values and structured data to user-friendly labels.
 * Gracefully handles missing values with "Not available" fallbacks.
 */
const TrustSignals: React.FC<TrustSignalsProps> = ({ helper }) => {
  const { t } = useTranslation();

  // Signal item type
  interface SignalItem {
    icon: React.ReactNode;
    label: string;
    value: string;
    variant: 'verified' | 'response' | 'jobs';
  }

  const signals: SignalItem[] = [];

  // 1. Background check / ID verification
  signals.push({
    icon: <ShieldCheck className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.backgroundCheck', { defaultValue: 'Background check' }),
    value: helper.verified
      ? t('helperProfile.trust.verified', { defaultValue: 'Verified' })
      : t('helperProfile.trust.notVerified', { defaultValue: 'Not verified' }),
    variant: 'verified',
  });

  // 2. Response time
  const responseTimeLabel = helper.responseTime
    ? helper.responseTime.toLowerCase() !== 'varies'
      ? t('helperProfile.trust.respondTime', { time: helper.responseTime, defaultValue: `Usually ${helper.responseTime}` })
      : t('helperProfile.trust.responseVaries', { defaultValue: 'Varies' })
    : t('helperProfile.trust.notAvailable', { defaultValue: 'Not available' });

  signals.push({
    icon: <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.responseTime', { defaultValue: 'Response time' }),
    value: responseTimeLabel,
    variant: 'response',
  });

  // 3. Jobs completed
  const jobsLabel = helper.jobsCompleted > 0
    ? t('helperProfile.trust.jobsCompletedCount', { count: helper.jobsCompleted, defaultValue: `${helper.jobsCompleted} completed` })
    : t('helperProfile.trust.noJobsYet', { defaultValue: 'No jobs yet' });

  signals.push({
    icon: <Star className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.jobsCompleted', { defaultValue: 'Jobs completed' }),
    value: jobsLabel,
    variant: 'jobs',
  });

  const iconColorMap = {
    verified: 'text-emerald-400',
    response: 'text-sky-400',
    jobs: 'text-orange-400',
  };

  return (
    <ul
      className="px-5 pb-5 space-y-3"
      aria-label={t('helperProfile.trust.trustSignalsAria', { defaultValue: 'Trust & Reliability' })}
    >
      {signals.map((signal, idx) => (
        <li key={idx} className="flex items-start gap-3">
          <div className={`${iconColorMap[signal.variant]} mt-0.5`}>{signal.icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 font-medium mb-0.5">
              {signal.label}
            </p>
            <p className="text-sm text-gray-300 truncate">
              {signal.value}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
};

export default TrustSignals;
