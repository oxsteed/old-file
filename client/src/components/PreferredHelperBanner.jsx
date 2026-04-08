import React from 'react';
import { useAuth } from '../hooks/useAuth';

/**
 * Task 6: Preferred-helper context banner for JobDetailPage.
 * Shows when the job was created from a planned need and the viewer is the preferred helper.
 * Import and render at the top of the job detail card in JobDetailPage.jsx:
 *   <PreferredHelperBanner job={job} />
 */
export default function PreferredHelperBanner({ job }) {
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
          <strong style={{ color: '#1d4ed8' }}>You are the preferred helper for this job.</strong>
          <p style={{ margin: '4px 0 0', color: '#374151' }}>
            This job was scheduled in advance by the customer and you were their preferred helper.
            {hoursRemaining > 0 && (
              <> You have <strong>{Math.round(hoursRemaining)}h</strong> remaining to respond.</>            )}
          </p>
        </>
      ) : (
        <>
          <strong style={{ color: '#15803d' }}>Planned Need</strong>
          <p style={{ margin: '4px 0 0', color: '#374151' }}>
            This job was auto-posted from a planned need.
          </p>
        </>
      )}
    </div>
  );
}
