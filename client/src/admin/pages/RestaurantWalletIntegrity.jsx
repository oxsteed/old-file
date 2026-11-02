import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import AdminErrorState from '../lib/AdminErrorState';
import { serverErrorMessage } from '../lib/RsdPager';
import { adminMoney } from '../lib/formatters';

// Admin wallet integrity (finding 27): integrity and reconciliation reads
// reusing the merchant handlers, plus a CSV statement download. The admin
// previously had only a PDF statement and no independent integrity check.
export default function RestaurantWalletIntegrity() {
  const { t } = useTranslation();
  const [restaurantId, setRestaurantId] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [integrity, setIntegrity] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const run = async (kind) => {
    if (!restaurantId.trim()) {
      setLoadError(t('adminWalletIntegrity.restaurantRequired'));
      return;
    }
    setLoading(true);
    setLoadError('');
    setActionError('');
    try {
      const params = {
        ...(customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
        ...(customerId.trim() ? { customerId: customerId.trim() } : {}),
      };
      if (kind === 'integrity') {
        const { data } = await adminApi.get(`/admin/super/restaurant-credit/restaurants/${restaurantId.trim()}/integrity`, { timeout: 15000, params });
        setIntegrity(data);
      } else {
        const { data } = await adminApi.get(`/admin/super/restaurant-credit/restaurants/${restaurantId.trim()}/reconciliation`, { timeout: 15000, params });
        setReconciliation(data);
      }
    } catch (err) {
      setLoadError(serverErrorMessage(err, t('adminWalletIntegrity.loadFailed')));
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = async () => {
    if (!restaurantId.trim() || !customerId.trim()) {
      setActionError(t('adminWalletIntegrity.csvRequiresCustomer'));
      return;
    }
    setActionError('');
    setNotice('');
    try {
      const { data } = await adminApi.get(
        `/admin/super/restaurant-credit/accounts/${customerId.trim()}/${restaurantId.trim()}/statements.csv`,
        { timeout: 15000, responseType: 'blob' }
      );
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `restaurant-credit-${customerId.trim()}-${restaurantId.trim()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(t('adminWalletIntegrity.csvDownloaded'));
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminWalletIntegrity.actionFailed')));
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminWalletIntegrity.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminWalletIntegrity.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <input value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)} placeholder={t('adminWalletIntegrity.restaurantIdPlaceholder')} inputMode="numeric" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder={t('adminWalletIntegrity.customerEmailPlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder={t('adminWalletIntegrity.customerIdPlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <button type="button" disabled={loading} onClick={() => run('integrity')} className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {t('adminWalletIntegrity.runIntegrity')}
        </button>
        <button type="button" disabled={loading} onClick={() => run('reconciliation')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200 disabled:opacity-50">
          {t('adminWalletIntegrity.runReconciliation')}
        </button>
        <button type="button" onClick={downloadCsv} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
          {t('adminWalletIntegrity.downloadCsv')}
        </button>
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && <AdminErrorState message={loadError} onRetry={() => run('integrity')} />}
      {actionError && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      )}

      {integrity && (
        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-semibold text-white">{t('adminWalletIntegrity.integrityTitle')}</h2>
          <p className="text-sm text-gray-300">
            {t('adminWalletIntegrity.integrityValid', { valid: String(integrity.audit?.valid ?? integrity.valid ?? '') })}
            {integrity.locked ? ` · ${t('adminWalletIntegrity.locked')}` : ''}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {t('adminWalletIntegrity.issueCodes', { codes: (integrity.audit?.issueCodes || integrity.audit?.issues?.map((issue) => issue.code) || []).join(', ') || t('common.na') })}
          </p>
          {integrity.customer && (
            <p className="mt-1 text-sm text-gray-400">{integrity.customer.email} · {integrity.customer.id}</p>
          )}
        </section>
      )}

      {reconciliation && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-semibold text-white">{t('adminWalletIntegrity.reconciliationTitle')}</h2>
          {(reconciliation.balances || []).length > 0 || (reconciliation.variances || []).length > 0 ? (
            <div className="space-y-2">
              {(reconciliation.balances || []).map((row, index) => (
                <p key={index} className="text-sm text-gray-300">
                  {row.currencyCode} · {t('adminWalletIntegrity.accounts', { total: row.totalAccounts, active: row.activeAccounts })}
                  {` · ${adminMoney(Number(row.totalBalanceCents || 0), row.currencyCode)}`}
                </p>
              ))}
              {(reconciliation.movements || []).map((row, index) => (
                <p key={`ledger-${index}`} className="text-sm text-gray-400">
                  {row.currencyCode} · {row.entryType} · {row.count} · {adminMoney(Number(row.amountCents || 0), row.currencyCode)}
                </p>
              ))}
              {(reconciliation.variances || []).map((row, index) => (
                <p key={`variance-${index}`} className="text-sm text-gray-300">
                  {row.currencyCode} · {row.balanced ? t('adminWalletIntegrity.balanced') : t('adminWalletIntegrity.unbalanced', { debit: adminMoney(Number(row.debitVarianceCents || 0), row.currencyCode), refund: adminMoney(Number(row.refundVarianceCents || 0), row.currencyCode) })}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('adminWalletIntegrity.reconciliationEmpty')}</p>
          )}
        </section>
      )}
      {!integrity && !reconciliation && !loading && !loadError && (
        <p className="text-gray-500">{t('adminWalletIntegrity.empty')}</p>
      )}
    </div>
  );
}
