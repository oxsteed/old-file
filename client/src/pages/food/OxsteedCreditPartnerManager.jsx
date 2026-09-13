import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldCheck, Store, WalletCards } from 'lucide-react';
import {
  formatFoodMoney,
  downloadFoodRestaurantOxsteedCreditReport,
  listFoodRestaurantOxsteedCreditSettlements,
  listFoodRestaurantOxsteedCreditTransactions,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function displayDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function label(value) {
  return String(value || 'activity').replaceAll('_', ' ');
}

function statusClass(value) {
  return `fd-ox-credit-status fd-ox-credit-status--${String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '')}`;
}

export default function OxsteedCreditPartnerManager({ restaurant }) {
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
      setError(apiErrorMessage(loadError, 'OxSteed Credit partner activity could not be loaded.'));
    } finally {
      if (appendTransactions || appendSettlements) setLoadingMore(false);
      else setLoading(false);
      setRefreshing(false);
    }
  }, [restaurant.id, settlementStatus]);

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
      setError(apiErrorMessage(downloadError, 'OxSteed Credit report could not be downloaded.'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="fd-section fd-ox-credit-partner">
      <div className="fd-ox-credit-partner-head">
        <div>
          <p className="fd-credit-manager-kicker">Partner operations</p>
          <h2>OxSteed Credit</h2>
          <p className="fd-card-meta">Review restricted-credit purchases and settlement records for this restaurant. Customer identity stays private.</p>
        </div>
        <div className="fd-ox-credit-partner-actions">
          {partnerStatus && <span className={statusClass(partnerStatus)}>{label(partnerStatus)}</span>}
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={downloadReport} disabled={loading || refreshing || downloading}>
            <Download size={14} /> {downloading ? 'Preparing…' : 'Download report'}
          </button>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => load({ quiet: true })} disabled={loading || refreshing}>
            <RefreshCw size={14} className={refreshing ? 'fd-ox-credit-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="fd-ox-credit-error" role="alert">{error} <button type="button" onClick={() => load()}>Retry</button></div>}

      {loading ? <div className="fd-empty">Loading partner credit activity…</div> : (
        <>
          <div className="fd-ox-credit-summary" aria-label="OxSteed Credit summary">
            <div><WalletCards size={17} /><strong>{transactions.length}</strong><span>Credit events</span></div>
            <div><Store size={17} /><strong>{settlements.length}</strong><span>Settlement records</span></div>
            <div><ShieldCheck size={17} /><strong>{formatFoodMoney(pendingSettlementCents, currency)}</strong><span>Pending settlement value</span></div>
          </div>

          <div className="fd-ox-credit-columns">
            <div className="fd-ox-credit-panel">
              <div className="fd-ox-credit-panel-title"><h3>Recent credit activity</h3><span>{transactions.length} loaded</span></div>
              {transactions.length === 0 ? <p className="fd-card-meta">No OxSteed Credit activity has posted for this restaurant.</p> : (
                <div className="fd-ox-credit-list">
                  {transactions.map((transaction) => (
                    <div key={transaction.id} className="fd-ox-credit-row">
                      <div><strong>{label(transaction.transactionType)}</strong><span>{transaction.description || transaction.referenceType || 'OxSteed Credit ledger event'}</span><small>{displayDate(transaction.postedAt || transaction.createdAt)}</small></div>
                      <div className="fd-ox-credit-row-amount"><strong>{formatFoodMoney(transaction.amountCents, transaction.currencyCode || currency)}</strong><span className={statusClass(transaction.status)}>{label(transaction.status)}</span></div>
                    </div>
                  ))}
                </div>
              )}
              {transactionPagination.hasMore && <button type="button" className="fd-ox-credit-load-more" onClick={() => load({ appendTransactions: true, transactionOffset: transactionPagination.nextOffset || 0 })} disabled={loadingMore || loading || refreshing}>{loadingMore ? 'Loading…' : 'Load older activity'}</button>}
            </div>

            <div className="fd-ox-credit-panel">
              <div className="fd-ox-credit-panel-title">
                <div>
                  <h3>Settlement records</h3>
                  <span>{settlements.length} loaded</span>
                </div>
                <label className="fd-ox-credit-filter">
                  <span className="sr-only">Filter settlements by status</span>
                  <select value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)} disabled={loading || refreshing || loadingMore}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="paid">Paid</option>
                    <option value="disputed">Disputed</option>
                    <option value="voided">Voided</option>
                  </select>
                </label>
              </div>
              {settlements.length === 0 ? <p className="fd-card-meta">No settlement records have been created yet.</p> : (
                <div className="fd-ox-credit-list">
                  {settlements.map((settlement) => (
                    <div key={settlement.id} className="fd-ox-credit-row">
                      <div><strong>{displayDate(settlement.periodStart)} – {displayDate(settlement.periodEnd)}</strong><span>Gross {formatFoodMoney(settlement.grossCents, settlement.currencyCode || currency)} · Fees {formatFoodMoney(settlement.feeCents, settlement.currencyCode || currency)}</span><small>{settlement.paymentReference || 'No payment reference'}</small></div>
                      <div className="fd-ox-credit-row-amount"><strong>{formatFoodMoney(settlement.netCents, settlement.currencyCode || currency)}</strong><span className={statusClass(settlement.status)}>{label(settlement.status)}</span></div>
                    </div>
                  ))}
                </div>
              )}
              {settlementPagination.hasMore && <button type="button" className="fd-ox-credit-load-more" onClick={() => load({ appendSettlements: true, settlementOffset: settlementPagination.nextOffset || 0 })} disabled={loadingMore || loading || refreshing}>{loadingMore ? 'Loading…' : 'Load older settlements'}</button>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
