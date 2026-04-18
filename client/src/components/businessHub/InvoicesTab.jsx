import { memo } from 'react';
import { useTranslation } from 'react-i18next';

function InvoicesTab({ data, onNew, onEdit, onPay, onDelete }) {
  const { t } = useTranslation();
  if (!data) return null;

  return (
    <div className="bh-invoices-tab">
      <button className="bh-btn primary" onClick={onNew}>{t('businessHub.btnNewInvoice')}</button>
      <p>{t('businessHub.invoicesPlaceholder')}</p>
    </div>
  );
}

export default memo(InvoicesTab);
