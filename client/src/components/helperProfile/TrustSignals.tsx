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
    label: t('helperProfile.trust.idVerification'),
    value: helper.verified
      ? t('helperProfile.trust.verified')
      : t('helperProfile.trust.notVerified'),
    variant: 'verified',
  });

  // 2. Professional License (self-reported)
  signals.push({
    icon: <FileCheck className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.professionalLicense'),
    value: helper.hasLicense
      ? t('helperProfile.trust.licenseClaimed')
      : t('helperProfile.trust.noLicense'),
    variant: 'license',
  });

  // 3. Insurance (self-reported)
  signals.push({
    icon: <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.insurance'),
    value: helper.hasInsurance
      ? t('helperProfile.trust.insuranceClaimed')
      : t('helperProfile.trust.noInsurance'),
    variant: 'insurance',
  });

  // 4. Years in Business
  const yearsLabel = helper.yearsInBusiness
    ? helper.yearsInBusiness > 0
      ? t('helperProfile.trust.yearsInBusiness', { years: helper.yearsInBusiness })
      : t('helperProfile.trust.justStarted')
    : t('helperProfile.trust.notAvailable');

  signals.push({
    icon: <Briefcase className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.yearsLabel'),
    value: yearsLabel,
    variant: 'years',
  });

  // 5. Availability Status
  const availabilityLabel = helper.isAvailableNow
    ? t('helperProfile.trust.currentlyAvailable')
    : t('helperProfile.trust.notCurrentlyAvailable');

  signals.push({
    icon: <Zap className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.availabilityStatus'),
    value: availabilityLabel,
    variant: 'availability',
  });

  // 6. Response Time
  const responseTimeLabel = helper.responseTime
    ? helper.responseTime.toLowerCase() !== 'varies'
      ? t('helperProfile.trust.respondTime', { time: helper.responseTime })
      : t('helperProfile.trust.responseVaries')
    : t('helperProfile.trust.notAvailable');

  signals.push({
    icon: <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.responseTime'),
    value: responseTimeLabel,
    variant: 'response',
  });

  // 7. Jobs Completed
  const jobsLabel = helper.jobsCompleted > 0
    ? t('helperProfile.trust.jobsCompletedCount', { count: helper.jobsCompleted })
    : t('helperProfile.trust.noJobsYet');

  signals.push({
    icon: <Star className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.jobsCompleted'),
    value: jobsLabel,
    variant: 'jobs',
  });

  // 8. Completion Rate
  const completionRateLabel = helper.completionRate !== undefined && helper.completionRate > 0
    ? t('helperProfile.trust.completionRate', { rate: helper.completionRate })
    : t('helperProfile.trust.noCompletionData');

  signals.push({
    icon: <CheckCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />,
    label: t('helperProfile.trust.completionRateLabel'),
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
      aria-label={t('helperProfile.trust.trustSignalsAria')}
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
