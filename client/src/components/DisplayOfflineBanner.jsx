// Visible offline banner for the public restaurant display pages. The feed
// keeps rendering its last-known state underneath while the poller retries
// with backoff, so the banner is informational, not an error screen.
import React from 'react';
import { useTranslation } from 'react-i18next';

export default function DisplayOfflineBanner({ offline }) {
  const { t } = useTranslation();
  if (!offline) return null;
  return (
    <div className="fd-display-offline-banner" role="status" aria-live="polite">
      <span>{t('display.offline.banner')}</span>
      <span className="fd-display-offline-retry">{t('display.offline.reconnecting')}</span>
    </div>
  );
}
