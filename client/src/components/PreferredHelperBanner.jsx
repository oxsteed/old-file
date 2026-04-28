import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

export default function PreferredHelperBanner({ job }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!job) return null;

  const isPreferredHelper = job.held_for_helper_id && user?.id === job.held_for_helper_id;
  const isFromPlannedNeed = job.planned_need_id || job.metadata?.planned_need_id;
  const holdExpiresAt = job.hold_expires_at ? new Date(job.hold_expires_at) : null;
  const hoursRemaining = holdExpiresAt
    ? Math.max(0, (holdExpiresAt - new Date()) / (1000 * 60 * 60))
    : 0;

  if (!isFromPlannedNeed && !isPreferredHelper) return null;

  return (
    <div style={{
      background: isPreferredHelper ? '#eef6ff' : '#f0fdf4',
      border: `1px solid ${isPreferredHelper ? '#bfdbfe' : '#bbf7d0'}`,
      borderRadius: '8px',
      padding: '12px 16px',
      marginBottom: '16px',
      fontSize: '14px',
    }}>
      {isPreferredHelper ? (
        <>
          <strong style={{ color: '#1d4ed8' }}>{t('preferredHelper.preferredTitle')}</strong>
          <p style={{ margin: '4px 0 0', color: '#374151' }}>
            {t('preferredHelper.preferredDesc')}
            {hoursRemaining > 0 && (
              <> {t('preferredHelper.hoursRemaining', { hours: Math.round(hoursRemaining) })}</>
            )}
          </p>
        </>
      ) : (
        <>
          <strong style={{ color: '#15803d' }}>{t('preferredHelper.plannedNeedTitle')}</strong>
          <p style={{ margin: '4px 0 0', color: '#374151' }}>
            {t('preferredHelper.plannedNeedDesc')}
          </p>
        </>
      )}
    </div>
  );
}
