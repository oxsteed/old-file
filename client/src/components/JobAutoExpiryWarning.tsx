/**
 * JobAutoExpiryWarning.tsx
 * Shows a warning banner when a job is in 'accepted' status and nearing auto-expiry
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock } from 'lucide-react';

interface JobAutoExpiryWarningProps {
  acceptedAt?: string | null;
  status?: string;
  daysUntilExpiry?: number;
}

const JobAutoExpiryWarning: React.FC<JobAutoExpiryWarningProps> = ({
  acceptedAt,
  status,
  daysUntilExpiry = 0,
}) => {
  const { t } = useTranslation();

  // Only show if job is accepted and has < 7 days until expiry
  if (status !== 'accepted' || !acceptedAt || daysUntilExpiry >= 7) {
    return null;
  }

  const isUrgent = daysUntilExpiry <= 2;

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border ${
        isUrgent
          ? 'bg-red-900/20 border-red-700/50'
          : 'bg-amber-900/20 border-amber-700/50'
      }`}
    >
      {isUrgent ? (
        <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      ) : (
        <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
      )}

      <div className="flex-1 space-y-1">
        <p className={`font-semibold ${isUrgent ? 'text-red-200' : 'text-amber-200'}`}>
          {t('jobAutoExpiry.title')}
        </p>
        <p className={`text-sm ${isUrgent ? 'text-red-300' : 'text-amber-300'}`}>
          {t('jobAutoExpiry.message', {
            days: daysUntilExpiry,
          })}
        </p>
        <p className={`text-xs ${isUrgent ? 'text-red-400' : 'text-amber-400'}`}>
          {t('jobAutoExpiry.note')}
        </p>
      </div>
    </div>
  );
};

export default JobAutoExpiryWarning;
