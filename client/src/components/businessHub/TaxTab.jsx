import { memo } from 'react';
import { useTranslation } from 'react-i18next';

function TaxTab({ data, onRefresh, onPay }) {
  const { t } = useTranslation();
  if (!data) return null;

  return (
    <div className="bh-tax-tab">
      <button className="bh-btn primary" onClick={onRefresh}>{t('businessHub.btnRefreshTax')}</button>
      <p>{t('businessHub.taxPlaceholder')}</p>
    </div>
  );
}

export default memo(TaxTab);
