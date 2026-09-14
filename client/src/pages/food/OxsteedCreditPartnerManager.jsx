import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldCheck, Store, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  formatFoodMoney,
  downloadFoodRestaurantOxsteedCreditReport,
  listFoodRestaurantOxsteedCreditSettlements,
  listFoodRestaurantOxsteedCreditTransactions,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function displayDate(value, language, unavailableText) {
  if (!value) return unavailableText;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? unavailableText
    : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function label(value, t) {
  const normalized = String(value || 'activity').toLowerCase();
  const translated = {
    activity: 'partnerLabelActivity',
    purchase: 'partnerLabelPurchase',
    refund: 'partnerLabelRefund',
    pending: 'partnerLabelPending',
    approved: 'partnerLabelApproved',
    paid: 'partnerLabelPaid',
    disputed: 'partnerLabelDisputed',
    voided: 'partnerLabelVoided',
  }[normalized];
  return translated ? t(translated) : normalized.replaceAll('_', ' ');
}

function statusClass(value) {
  return `fd-ox-credit-status fd-ox-credit-status--${String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '')}`;
}

export default function OxsteedCreditPartnerManager({ restaurant }) {
  const { t, i18n } = useTranslation('credit');
  const [transactions, setTransactions] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [partnerStatus, setPartnerStatus] = useState(null);
  const [transactionPagination, setTransactionPagination] = useState({ limit: 100, offset: 0, hasMore: false, nextOffset: null });
  const [settlementPagination, setSettlementPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [settlementStatus, setSettlementStatus] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(async ({ quiet = false, appendTransactions = false, appendSettlements = false, transactionOffset = 0, settlementOffset = 0, settlementStatusOverride } = {}) => {
    const requestId = ++requestIdRef.current;
    if (quiet) setRefreshing(true);
    else if (appendTransactions || appendSettlements) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const effectiveSettlementStatus = settlementStatusOverride === undefined ? settlementStatus : settlementStatusOverride;
      const [transactionResult, settlementResult] = await Promise.all([
        appendSettlements ? Promise.resolve(null) : listFoodRestaurantOxsteedCreditTransactions(restaurant.id, { limit: 100, offset: transactionOffset }),
        appendTransactions ? Promise.resolve(null) : listFoodRestaurantOxsteedCreditSettlements(restaurant.id, { limit: 50, offset: settlementOffset, ...(effectiveSettlementStatus ? { status: effectiveSettlementStatus } : {}) }),
      ]);
      if (requestId !== requestIdRef.current) return;
      const nextTransactions = Array.isArray(transactionResult?.transactions) ? transactionResult.transactions : [];
      const nextSettlements = Array.isArray(settlementResult?.settlements) ? settlementResult.settlements : [];
      const fullLoad = !appendTransactions && !appendSettlements;
      if (appendTransactions) setTransactions((current) => [...current, ...nextTransactions]);
      else if (fullLoad) setTransactions(nextTransactions);
      if (appendSettlements) setSettlements((current) => [...current, ...nextSettlements]);
      else if (fullLoad) setSettlements(nextSettlements);
      if (appendTransactions || fullLoad) {
        setTransactionPagination(transactionResult?.pagination || { limit: 100, offset: transactionOffset, hasMore: false, nextOffset: null });
      }
      if (appendSettlements || fullLoad) {
        setSettlementPagination(settlementResult?.pagination || { limit: 50, offset: settlementOffset, hasMore: false, nextOffset: null });
      }
      setPartnerStatus(transactionResult?.partnerStatus || settlementResult?.partnerStatus || null);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, t('partnerActivityError')));
    } finally {
      if (appendTransactions || appendSettlements) setLoadingMore(false);
      else setLoading(false);
      setRefreshing(false);
    }
  }, [restaurant.id, settlementStatus, t]);

  useEffect(() => { load({ quiet: Boolean(settlementStatus) }); }, [load, settlementStatus]);

  const currency = restaurant.currency_code || 'USD';
  const pendingSettlementCents = settlements
    .filter((settlement) => ['pending', 'approved'].includes(settlement.status))
    .reduce((total, settlement) => total + Number(settlement.netCents || 0), 0);

  const downloadReport = async () => {
    setDownloading(true);
    setError('');
    try {
      const response = await downloadFoodRestaurantOxsteedCreditReport(restaurant.id);
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError, t('partnerReportError')));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="fd-section fd-ox-credit-partner">
      <div className="fd-ox-credit-partner-head">
        <div>
          <p className="fd-credit-manager-kicker">{t('partnerOperations')}</p>
          <h2>OxSteed Credit</h2>
          <p className="fd-card-meta">{t('partnerActivityDescription')}</p>
        </div>
        <div className="fd-ox-credit-partner-actions">
          {partnerStatus && <span className={statusClass(partnerStatus)}>{label(partnerStatus, t)}</span>}
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={downloadReport} disabled={loading || refreshing || downloading}>
            <Download size={14} /> {downloading ? t('preparingReport') : t('downloadReport')}
          </button>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => load({ quiet: true })} disabled={loading || refreshing}>
            <RefreshCw size={14} className={refreshing ? 'fd-ox-credit-spin' : ''} /> {t('refresh')}
          </button>
        </div>
      </div>

      {error && <div className="fd-ox-credit-error" role="alert">{error} <button type="button" onClick={() => load()}>{t('retry')}</button></div>}

      {loading ? <div className="fd-empty">{t('loadingPartnerActivity')}</div> : (
        <>
          <div className="fd-ox-credit-summary" aria-label={t('partnerSummaryLabel')}>
            <div><WalletCards size={17} /><strong>{transactions.length}</strong><span>{t('creditEvents')}</span></div>
            <div><Store size={17} /><strong>{settlements.length}</strong><span>{t('settlementRecords')}</span></div>
            <div><ShieldCheck size={17} /><strong>{formatFoodMoney(pendingSettlementCents, currency)}</strong><span>{t('pendingSettlementValue')}</span></div>
          </div>

          <div className="fd-ox-credit-columns">
            <div className="fd-ox-credit-panel">
              <div className="fd-ox-credit-panel-title"><h3>{t('recentCreditActivity')}</h3><span>{t('loadedCount', { count: transactions.length })}</span></div>
              {transactions.length === 0 ? <p className="fd-card-meta">{t('noPartnerActivity')}</p> : (
                <div className="fd-ox-credit-list">
                  {transactions.map((transaction) => (
                    <div key={transaction.id} className="fd-ox-credit-row">
                      <div><strong>{label(transaction.transactionType, t)}</strong><span>{transaction.description || transaction.referenceType || t('ledgerEvent')}</span><small>{displayDate(transaction.postedAt || transaction.createdAt, i18n.language, t('notAvailable'))}</small></div>
                      <div className="fd-ox-credit-row-amount"><strong>{formatFoodMoney(transaction.amountCents, transaction.currencyCode || currency)}</strong><span className={statusClass(transaction.status)}>{label(transaction.status, t)}</span></div>
                    </div>
                  ))}
                </div>
              )}
              {transactionPagination.hasMore && <button type="button" className="fd-ox-credit-load-more" onClick={() => load({ appendTransactions: true, transactionOffset: transactionPagination.nextOffset || 0 })} disabled={loadingMore || loading || refreshing}>{loadingMore ? t('loading') : t('loadOlderActivity')}</button>}
            </div>

            <div className="fd-ox-credit-panel">
              <div className="fd-ox-credit-panel-title">
                <div>
                  <h3>{t('settlementRecords')}</h3>
                  <span>{t('loadedCount', { count: settlements.length })}</span>
                </div>
                <label className="fd-ox-credit-filter">
                  <span className="sr-only">{t('filterSettlementStatus')}</span>
                  <select value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)} disabled={loading || refreshing || loadingMore}>
                    <option value="">{t('allStatuses')}</option>
                    <option value="pending">{t('partnerLabelPending')}</option>
                    <option value="approved">{t('partnerLabelApproved')}</option>
                    <option value="paid">{t('partnerLabelPaid')}</option>
                    <option value="disputed">{t('partnerLabelDisputed')}</option>
                    <option value="voided">{t('partnerLabelVoided')}</option>
                  </select>
                </label>
              </div>
              {settlements.length === 0 ? <p className="fd-card-meta">{t('noSettlementRecords')}</p> : (
                <div className="fd-ox-credit-list">
                  {settlements.map((settlement) => (
                    <div key={settlement.id} className="fd-ox-credit-row">
                      <div><strong>{displayDate(settlement.periodStart, i18n.language, t('notAvailable'))} – {displayDate(settlement.periodEnd, i18n.language, t('notAvailable'))}</strong><span>{t('settlementAmounts', { gross: formatFoodMoney(settlement.grossCents, settlement.currencyCode || currency), fees: formatFoodMoney(settlement.feeCents, settlement.currencyCode || currency) })}</span><small>{settlement.paymentReference || t('noPaymentReference')}</small></div>
                      <div className="fd-ox-credit-row-amount"><strong>{formatFoodMoney(settlement.netCents, settlement.currencyCode || currency)}</strong><span className={statusClass(settlement.status)}>{label(settlement.status, t)}</span></div>
                    </div>
                  ))}
                </div>
              )}
              {settlementPagination.hasMore && <button type="button" className="fd-ox-credit-load-more" onClick={() => load({ appendSettlements: true, settlementOffset: settlementPagination.nextOffset || 0 })} disabled={loadingMore || loading || refreshing}>{loadingMore ? t('loading') : t('loadOlderSettlements')}</button>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
