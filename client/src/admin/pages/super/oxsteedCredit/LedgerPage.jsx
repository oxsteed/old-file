import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  AdminActionDialog,
  Badge,
  CreditSubNav,
  DEFAULT_CURRENCY_OPTIONS,
  Section,
  creditTransactionLabel,
  dateTime,
  dollarsToCents,
  money,
  transactionPartyLabel,
  useCreditDialog,
  useCreditDialogFocusTrap,
  useCreditPageState,
} from './shared';

function AdminCreditTransactionDetail({ transaction, onClose, onRefund, refundForm, setRefundForm, busy }) {
  const { t } = useTranslation('credit');
  const dialogRef = useRef(null);
  useCreditDialogFocusTrap(dialogRef, Boolean(transaction), onClose);
  if (!transaction) return null;
  const accountLabel = (account) => account?.customerEmail || account?.customerId || account?.partnerId || account?.accountType || t('adminUnknownAccount');
  const isPostedPurchase = transaction.transactionType === 'purchase' && transaction.status === 'posted';
  const canRefund = isPostedPurchase && Number(transaction.remainingRefundableCents || 0) > 0;
  return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" aria-label={t('adminTransactionDetail')}>
    <section className="my-2 w-full max-w-5xl rounded-2xl border border-gray-700 bg-[#111318] p-4 shadow-2xl sm:my-8 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-800 pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminTransactionDetail')}</p><h2 className="mt-1 text-xl font-semibold text-white">{creditTransactionLabel(transaction, t)}</h2><p className="mt-1 break-all font-mono text-[11px] text-gray-600">{transaction.id}</p></div><button type="button" onClick={onClose} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">{t('adminClose')}</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4"><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminAmount', { currency: transaction.currencyCode })}</span><strong className="mt-1 block text-lg text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</strong></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminStatus')}</span><div className="mt-2"><Badge status={transaction.status} /></div></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminPosted')}</span><strong className="mt-1 block text-sm text-gray-300">{dateTime(transaction.postedAt || transaction.createdAt)}</strong></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminRestaurant')}</span><strong className="mt-1 block break-words text-sm text-gray-300">{transaction.restaurantName || t('adminPlatformMovement')}</strong></div></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminJournalAccounts')}</p><div className="mt-3 space-y-3 text-xs"><div><span className="text-gray-600">{t('adminDebit')}</span><p className="mt-1 break-all text-gray-300">{accountLabel(transaction.debitAccount)} <span className="text-gray-600">· {transaction.debitAccount?.accountType || t('adminAccount')}</span></p></div><div><span className="text-gray-600">{t('adminCredit')}</span><p className="mt-1 break-all text-gray-300">{accountLabel(transaction.creditAccount)} <span className="text-gray-600">· {transaction.creditAccount?.accountType || t('adminAccount')}</span></p></div><div><span className="text-gray-600">{t('adminReference')}</span><p className="mt-1 break-all text-gray-300">{transaction.referenceType || t('adminNone')}{transaction.referenceId ? ` · ${transaction.referenceId}` : ''}</p></div><div><span className="text-gray-600">{t('adminIdempotencyKey')}</span><p className="mt-1 break-all font-mono text-[10px] text-gray-500">{transaction.idempotencyKey || t('adminNotRecorded')}</p></div></div></div><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminImmutableEntries')}</p><div className="mt-3 space-y-2">{!transaction.entries?.length ? <p className="text-xs text-gray-600">{t('adminNoJournalEntries')}</p> : transaction.entries.map((entry) => <div key={entry.id} className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold uppercase tracking-[0.12em] text-sky-300">{entry.side}</span><strong className="text-emerald-300">{money(entry.amountCents, transaction.currencyCode)}</strong></div><p className="mt-1 break-all text-gray-600">{entry.accountType || t('adminAccount')} · {t('adminBalanceAfter')} {money(entry.balanceAfterCents, transaction.currencyCode)} · {t('adminSequence')} {entry.sequence}</p><p className="mt-1 break-all font-mono text-[10px] text-gray-700">{t('adminHash')} {entry.entryHash || t('adminNotRecorded')} · {t('adminKeyVersion')} {entry.hashKeyVersion || 'v1'}</p></div>)}</div></div></div>
      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminRelatedAuditEvents')}</p><div className="mt-3 space-y-2">{!transaction.auditEvents?.length ? <p className="text-xs text-gray-600">{t('adminNoTransactionAuditEvents')}</p> : transaction.auditEvents.map((event) => <div key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2 text-xs"><div><strong className="font-mono text-orange-300">{event.actionType}</strong><p className="mt-1 text-gray-500">{event.reason || t('adminNoReasonRecorded')}</p></div><span className="text-gray-600">{dateTime(event.createdAt)}</span></div>)}</div></div>
      {isPostedPurchase && !canRefund && <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4 text-xs text-gray-500">{t('adminNoRefundableBalance')} {money(transaction.refundedCents, transaction.currencyCode)}.</div>}
      {canRefund && <form onSubmit={onRefund} className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">{t('adminOperatorAction')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminRefundPurchase')}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{t('adminRefundDescription')}</p></div><span className="text-xs font-semibold text-amber-200">{t('adminRemaining')} {money(transaction.remainingRefundableCents, transaction.currencyCode)}</span></div><div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto] "><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRefundAmount', { currency: transaction.currencyCode })}</span><input required inputMode="decimal" autoComplete="off" value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" aria-label={t('adminRefundAmount', { currency: transaction.currencyCode })} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredReason')}</span><input required maxLength={500} value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t('adminRefundReasonPlaceholder')} aria-label={t('adminRequiredReason')} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={busy} className="self-end rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{busy ? t('adminPosting') : t('adminPostRefund')}</button></div></form>}
    </section>
  </div>;
}

export default function OxsteedCreditLedgerPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [overview, setOverview] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [transactionType, setTransactionType] = useState('');
  const [transactionStatus, setTransactionStatus] = useState('');
  const [transactionCurrency, setTransactionCurrency] = useState('all');
  const [transactionPagination, setTransactionPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [transactionDetail, setTransactionDetail] = useState(null);
  const [loadingTransactionId, setLoadingTransactionId] = useState('');
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const currencyOptions = overview?.supportedCurrencies?.length ? overview.supportedCurrencies : DEFAULT_CURRENCY_OPTIONS;

  const load = useCallback(async ({ quiet = false, appendTransactions = false, transactionOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendTransactions) setLoading(true);
    if (appendTransactions) setLoadingMoreTransactions(true);
    setError('');
    try {
      const transactionParams = { limit: 50, offset: appendTransactions ? transactionOffset : 0 };
      if (transactionType) transactionParams.transactionType = transactionType;
      if (transactionStatus) transactionParams.status = transactionStatus;
      if (transactionCurrency !== 'all') transactionParams.currencyCode = transactionCurrency;
      const [overviewResponse, transactionsResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/transactions', { params: transactionParams }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
      const loadedTransactions = transactionsResponse.data?.transactions || [];
      if (appendTransactions) setTransactions((current) => [...current, ...loadedTransactions]);
      else setTransactions(loadedTransactions);
      setTransactionPagination(transactionsResponse.data?.pagination || { limit: transactionParams.limit, offset: transactionParams.offset, hasMore: false, nextOffset: null });
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendTransactions) setLoadingMoreTransactions(false);
      }
    }
  }, [transactionType, transactionStatus, transactionCurrency, t]);

  useEffect(() => { load(); }, [load]);

  const inspectTransaction = async (transaction) => {
    setRefundForm({ amount: '', reason: '' });
    setLoadingTransactionId(transaction.id);
    setError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/transactions/${transaction.id}`);
      setTransactionDetail(response.data?.transaction || null);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminTransactionDetailOpenFailed')));
    } finally {
      setLoadingTransactionId('');
    }
  };
  const refundAdminCredit = async (event) => {
    event.preventDefault();
    if (!transactionDetail?.id || transactionDetail.transactionType !== 'purchase' || transactionDetail.status !== 'posted') {
      setError(t('adminPostedPurchaseOnly'));
      return;
    }
    const amountCents = dollarsToCents(refundForm.amount, transactionDetail.currencyCode);
    const reason = String(refundForm.reason || '').trim();
    if (!amountCents) {
      setError(t('adminRefundAmountRequired', { currency: transactionDetail.currencyCode }));
      return;
    }
    if (!reason) {
      setError(t('adminRefundReasonRequired'));
      return;
    }
    const confirmed = await requestDialog({ kind: 'confirm', title: t('adminConfirmCreditRefund'), description: t('adminCreditRefundDescription', { amount: refundForm.amount, currency: transactionDetail.currencyCode }) });
    if (!confirmed) return;
    setBusy(true); setNotice(''); setError('');
    const payload = { amountCents, reason };
    const keyPayload = { transactionId: transactionDetail.id, ...payload };
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/transactions/${transactionDetail.id}/refund`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-refund', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-refund', keyPayload);
      setRefundForm({ amount: '', reason: '' });
      // Phase 7 (gap 9): 202 means the refund queued as a pending action for
      // a second admin instead of posting immediately.
      setNotice(response.status === 202 ? t('adminMakerCheckerQueued') : (response.data?.replayed ? t('adminCreditRefundAlreadyRecorded') : t('adminCreditRefundPosted')));
      await inspectTransaction(transactionDetail);
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCreditRefundFailed')));
    } finally { setBusy(false); }
  };
  const downloadTransactionHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (transactionType) params.transactionType = transactionType;
      if (transactionStatus) params.status = transactionStatus;
      if (transactionCurrency !== 'all') params.currencyCode = transactionCurrency;
      const response = await adminApi.get('/admin/super/oxsteed-credit/transactions.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminTransactionCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminTransactionCsvFailed')));
    } finally { setBusy(false); }
  };
  return (
    <>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
            <AdminCreditTransactionDetail transaction={transactionDetail} onClose={() => { setTransactionDetail(null); setRefundForm({ amount: '', reason: '' }); }} onRefund={refundAdminCredit} refundForm={refundForm} setRefundForm={setRefundForm} busy={busy} />
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminLedgerActivity')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminCreditTransactionHistoryDetail')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <Section eyebrow={t('adminLedgerActivity')} title={t('adminTransactionHistory')} detail={t('adminTransactionHistoryDescription')} action={<button type="button" onClick={downloadTransactionHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}>
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3">
          <label className="min-w-[160px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminMovementType')}</span><select aria-label={t('adminMovementTypeFilter')} value={transactionType} onChange={(event) => setTransactionType(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllMovementTypes')}</option><option value="load">{t('adminLoad')}</option><option value="purchase">{t('adminPurchase')}</option><option value="refund">{t('adminRefund')}</option><option value="transfer">{t('adminTransfer')}</option><option value="adjustment">{t('adminAdjustment')}</option><option value="settlement">{t('adminSettlement')}</option><option value="fee">{t('adminFee')}</option><option value="expiration">{t('adminExpiration')}</option><option value="chargeback">{t('adminChargeback')}</option></select></label>
          <label className="min-w-[150px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminStatus')}</span><select aria-label={t('adminStatusFilter')} value={transactionStatus} onChange={(event) => setTransactionStatus(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="pending">{t('adminPendingStatus')}</option><option value="posted">{t('adminPostedStatus')}</option><option value="reversed">{t('adminReversedStatus')}</option><option value="voided">{t('adminVoidedStatus')}</option></select></label>
          <label className="min-w-[140px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrency')}</span><select aria-label={t('adminCurrencyFilter')} value={transactionCurrency} onChange={(event) => setTransactionCurrency(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">{t('adminAllCurrencies')}</option>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          {transactionPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendTransactions: true, transactionOffset: transactionPagination.nextOffset || 0 })} disabled={loadingMoreTransactions || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreTransactions ? t('adminLoading') : t('adminLoadOlder')}</button>}
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
          {!transactions.length ? <div className="py-10 text-center text-sm text-gray-500">{t('adminNoCreditMovements')}</div> : <table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminTransaction')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantParty')}</th><th className="px-3 py-3 font-medium">{t('adminReference')}</th><th className="px-3 py-3 font-medium">{t('adminAmount')}</th><th className="px-3 py-3 font-medium">{t('adminStatus')}</th><th className="px-3 py-3 font-medium">{t('adminWhen')}</th><th className="px-3 py-3 font-medium">{t('adminInspect')}</th></tr></thead><tbody className="divide-y divide-gray-800">{transactions.map((transaction) => <tr key={transaction.id}><td className="px-3 py-3"><strong className="capitalize text-white">{creditTransactionLabel(transaction, t)}</strong><p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.id}</p>{transaction.direction && <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-gray-600">{t('adminDirectionAccount', { direction: transaction.direction })}</span>}</td><td className="max-w-[260px] break-all px-3 py-3 text-gray-400">{transaction.restaurantName || t('adminPlatformMovement')}<p className="mt-1 text-[10px] text-gray-600">{transactionPartyLabel(transaction, t)}</p></td><td className="max-w-[240px] break-all px-3 py-3 text-gray-500">{transaction.referenceType || t('adminNoReference')}{transaction.referenceId ? <p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.referenceId}</p> : null}{transaction.description ? <p className="mt-1 text-[10px] text-gray-600">{transaction.description}</p> : null}</td><td className="px-3 py-3 font-semibold text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</td><td className="px-3 py-3"><Badge status={transaction.status} /></td><td className="px-3 py-3 text-gray-500">{dateTime(transaction.postedAt || transaction.createdAt)}</td><td className="px-3 py-3"><button type="button" onClick={() => inspectTransaction(transaction)} disabled={busy || Boolean(loadingTransactionId)} className="rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingTransactionId === transaction.id ? t('adminLoading') : t('adminOpen')}</button></td></tr>)}</tbody></table>}
        </div>
      </Section>
      </main>
    </>
  );
}
