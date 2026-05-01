import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Clock, Star, FileCheck, AlertCircle, Briefcase, Zap, CheckCircle } from 'lucide-react';
import type { HelperProfile } from '../../types/helperProfile';

interface TrustSignalsProps {
  helper: HelperProfile;
}

/**
 * TrustSignals - renders 8 self-reported trust indicators.
 * All data is helper-provided (not verified by OxSteed, no liability).
 * Graceful fallbacks for missing values.
 */
const TrustSignals: React.FC<TrustSignalsProps> = ({ helper }) => {
  const { t } = useTranslation();

  // Signal item type
  interface SignalItem {
    icon: React.ReactNode;
    label: string;
    value: string;
    variant: 'verified' | 'license' | 'insurance' | 'years' | 'availability' | 'response' | 'jobs' | 'completion';
  }

  const signals: SignalItem[] = [];

  // 1. ID Verification
  signals.push({
    icon: <ShieldCheck className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.idVerification', { defaultValue: 'ID Verification' }),
    value: helper.verified
      ? t('helperProfile.trust.verified', { defaultValue: 'Verified' })
      : t('helperProfile.trust.notVerified', { defaultValue: 'Not verified' }),
    variant: 'verified',
  });

  // 2. Professional License (self-reported)
  signals.push({
    icon: <FileCheck className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.professionalLicense', { defaultValue: 'Professional License' }),
    value: helper.hasLicense
      ? t('helperProfile.trust.licenseClaimed', { defaultValue: 'License on file' })
      : t('helperProfile.trust.noLicense', { defaultValue: 'Not provided' }),
    variant: 'license',
  });

  // 3. Insurance (self-reported)
  signals.push({
    icon: <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.insurance', { defaultValue: 'Insurance' }),
    value: helper.hasInsurance
      ? t('helperProfile.trust.insuranceClaimed', { defaultValue: 'Insurance on file' })
      : t('helperProfile.trust.noInsurance', { defaultValue: 'Not provided' }),
    variant: 'insurance',
  });

  // 4. Years in Business
  const yearsLabel = helper.yearsInBusiness
    ? helper.yearsInBusiness > 0
      ? t('helperProfile.trust.yearsInBusiness', { years: helper.yearsInBusiness, defaultValue: `${helper.yearsInBusiness}+ years` })
      : t('helperProfile.trust.justStarted', { defaultValue: 'New member' })
    : t('helperProfile.trust.notAvailable', { defaultValue: 'Not available' });

  signals.push({
    icon: <Briefcase className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.yearsLabel', { defaultValue: 'Time on Platform' }),
    value: yearsLabel,
    variant: 'years',
  });

  // 5. Availability Status
  const availabilityLabel = helper.isAvailableNow
    ? t('helperProfile.trust.currentlyAvailable', { defaultValue: 'Available now' })
    : t('helperProfile.trust.notCurrentlyAvailable', { defaultValue: 'Not currently available' });

  signals.push({
    icon: <Zap className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.availabilityStatus', { defaultValue: 'Availability' }),
    value: availabilityLabel,
    variant: 'availability',
  });

  // 6. Response Time
  const responseTimeLabel = helper.responseTime
    ? helper.responseTime.toLowerCase() !== 'varies'
      ? t('helperProfile.trust.respondTime', { time: helper.responseTime, defaultValue: `Usually ${helper.responseTime}` })
      : t('helperProfile.trust.responseVaries', { defaultValue: 'Varies' })
    : t('helperProfile.trust.notAvailable', { defaultValue: 'Not available' });

  signals.push({
    icon: <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.responseTime', { defaultValue: 'Response Time' }),
    value: responseTimeLabel,
    variant: 'response',
  });

  // 7. Jobs Completed
  const jobsLabel = helper.jobsCompleted > 0
    ? t('helperProfile.trust.jobsCompletedCount', { count: helper.jobsCompleted, defaultValue: `${helper.jobsCompleted} completed` })
    : t('helperProfile.trust.noJobsYet', { defaultValue: 'No jobs yet' });

  signals.push({
    icon: <Star className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.jobsCompleted', { defaultValue: 'Jobs Completed' }),
    value: jobsLabel,
    variant: 'jobs',
  });

  // 8. Completion Rate
  const completionRateLabel = helper.completionRate !== undefined && helper.completionRate > 0
    ? t('helperProfile.trust.completionRate', { rate: helper.completionRate, defaultValue: `${helper.completionRate}% completion` })
    : t('helperProfile.trust.noCompletionData', { defaultValue: 'No data yet' });

  signals.push({
    icon: <CheckCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.completionRateLabel', { defaultValue: 'Completion Rate' }),
    value: completionRateLabel,
    variant: 'completion',
  });

  const iconColorMap = {
    verified: 'text-emerald-400',
    license: 'text-sky-400',
    insurance: 'text-amber-400',
    years: 'text-purple-400',
    availability: 'text-pink-400',
    response: 'text-cyan-400',
    jobs: 'text-orange-400',
    completion: 'text-green-400',
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
