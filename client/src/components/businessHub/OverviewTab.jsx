import { memo } from 'react';
import { useTranslation } from 'react-i18next';

function OverviewTab({ analytics }) {
  const { t } = useTranslation();
  if (!analytics) return null;

  return (
    <div className="bh-overview-tab">
      <p>{t('businessHub.overviewPlaceholder')}</p>
      <pre>{JSON.stringify(analytics, null, 2)}</pre>
    </div>
  );
}

export default memo(OverviewTab);
