import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import { localizeCreditOrderTypes, localizeCreditStatus } from '../../../../lib/creditStatus';
import {
  Badge,
  CreditSubNav,
  CUSTOMER_ACCOUNT_PAGE_SIZE,
  Section,
  creditTransactionLabel,
  dateTime,
  disputeReasonLabel,
  money,
  useCreditPageState,
} from './shared';
import OxsteedCreditCustomerDetail from '../OxsteedCreditCustomerDetail';

function CreditDisputeQueue({
  disputes,
  disputeStatus,
  setDisputeStatus,
  disputePagination,
  loadingMoreDisputes,
  loading,
  busy,
  downloadDisputeHistory,
  load,
  disputeResolutionDrafts,
  setDisputeResolutionDrafts,
  disputeCompensationDrafts,
  setDisputeCompensationDrafts,
  inspectDisputeCustomer,
  resolveDispute,
}) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Disputes" title="Credit dispute queue" detail="Disputes preserve the original journal transaction. Filter by lifecycle state and load older cases from the server; resolve with a documented outcome and use a separate compensating refund or adjustment rather than editing history." action={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={downloadDisputeHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminStatus')}</span><select aria-label={t('adminDisputeStatusFilter')} value={disputeStatus} onChange={(event) => setDisputeStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="open">{t('openStatus')}</option><option value="in_review">{t('underReviewStatus')}</option><option value="resolved_customer">{t('adminDisputeResolvedCustomer')}</option><option value="resolved_merchant">{t('adminDisputeResolvedMerchant')}</option><option value="resolved">{t('resolvedStatus')}</option><option value="rejected">{t('rejectedStatus')}</option></select></label>{disputePagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendDisputes: true, disputeOffset: disputePagination.nextOffset || 0 })} disabled={loadingMoreDisputes || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreDisputes ? t('adminLoading') : t('adminLoadOlder')}</button>}</div>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomerRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminTransaction')}</th><th className="px-3 py-3 font-medium">{t('adminReason')}</th><th className="px-3 py-3 font-medium">{t('adminDescription')}</th><th className="px-3 py-3 font-medium">{t('adminOpened')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!disputes.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{t('adminNoDisputesForStatus')}</td></tr> : disputes.map((dispute) => <tr key={dispute.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{dispute.customerId}</span><p className="mt-1 text-gray-600">{dispute.restaurantName || t('adminCredit')}</p><button type="button" disabled={busy} onClick={() => inspectDisputeCustomer(dispute)} className="mt-2 rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{t('adminOpenCustomer360')}</button></td><td className="px-3 py-3 text-gray-400">{dispute.amountCents !== null && dispute.amountCents !== undefined ? <strong className="block text-emerald-300">{money(dispute.amountCents, dispute.currencyCode || 'USD')}</strong> : <strong className="block text-gray-600">{t('adminAmountUnavailable')}</strong>}<span className="mt-1 block font-mono text-[10px] text-gray-600">{creditTransactionLabel({ transactionType: dispute.transactionType }, t)} · {dispute.transactionId}</span>{dispute.referenceId && <span className="mt-1 block break-all font-mono text-[10px] text-gray-700">{t('adminReference')} {dispute.referenceId}</span>}</td><td className="px-3 py-3"><Badge status={dispute.status} /><p className="mt-1 text-gray-500">{disputeReasonLabel(dispute.reasonCode, t)}</p></td><td className="max-w-[280px] px-3 py-3 text-gray-400">{dispute.description}<textarea aria-label={t('adminResolution')} value={disputeResolutionDrafts[dispute.id] || ''} onChange={(event) => setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))} maxLength={4000} rows={2} placeholder={t('adminResolutionNotePlaceholder')} className="mt-3 w-full min-w-[220px] resize-y rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-400" /><label className="mt-2 block"><span className="mb-1 block text-[10px] font-semibold text-gray-600">{t('adminDisputeCompensationLabel')}</span><input inputMode="numeric" value={disputeCompensationDrafts[dispute.id] || ''} onChange={(event) => setDisputeCompensationDrafts((current) => ({ ...current, [dispute.id]: event.target.value.replace(/[^\d]/g, '').slice(0, 10) }))} placeholder={t('adminDisputeCompensationPlaceholder')} className="w-full min-w-[140px] rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 font-mono text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /></label></td><td className="px-3 py-3 text-gray-500">{dateTime(dispute.openedAt)}{dispute.postedAt && <p className="mt-1 text-gray-600">{t('adminPosted')} {dateTime(dispute.postedAt)}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => resolveDispute(dispute, 'in_review')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminReview')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved_customer')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminDisputeResolveCustomer')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved_merchant')} className="rounded-lg bg-teal-600 px-2.5 py-2 font-semibold text-white hover:bg-teal-500 disabled:opacity-50">{t('adminDisputeResolveMerchant')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'rejected')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div></td></tr>)}</tbody></table></div>
  </Section>;
}

export default function OxsteedCreditDisputesPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [disputes, setDisputes] = useState([]);
  const [disputeStatus, setDisputeStatus] = useState('');
  const [disputePagination, setDisputePagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreDisputes, setLoadingMoreDisputes] = useState(false);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [customerAccountTotal, setCustomerAccountTotal] = useState(0);
  const [customerAccountOffset, setCustomerAccountOffset] = useState(0);
  const [customerAccountHasMore, setCustomerAccountHasMore] = useState(false);
  const [customerForm, setCustomerForm] = useState({ customerId: '', amount: '', currencyCode: 'USD', fundingReference: '', reason: '' });
  const [accountStatusForm, setAccountStatusForm] = useState({ customerId: '', currencyCode: 'USD', status: 'suspended', reason: '' });
  const [customerDetailAccount, setCustomerDetailAccount] = useState(null);
  const [disputeResolutionDrafts, setDisputeResolutionDrafts] = useState({});
  const [disputeCompensationDrafts, setDisputeCompensationDrafts] = useState({});

  const load = useCallback(async ({ quiet = false, appendDisputes = false, disputeOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendDisputes) setLoading(true);
    if (appendDisputes) setLoadingMoreDisputes(true);
    setError('');
    try {
      const disputeParams = { limit: 50, offset: appendDisputes ? disputeOffset : 0 };
      if (disputeStatus) disputeParams.status = disputeStatus;
      const [disputesResponse, accountResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/disputes', { params: disputeParams }),
        adminApi.get('/admin/super/oxsteed-credit/accounts', { params: { limit: CUSTOMER_ACCOUNT_PAGE_SIZE, offset: 0 } }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const loadedDisputes = disputesResponse.data?.disputes || [];
      if (appendDisputes) setDisputes((current) => [...current, ...loadedDisputes]);
      else setDisputes(loadedDisputes);
      setDisputePagination(disputesResponse.data?.pagination || { limit: disputeParams.limit, offset: disputeParams.offset, hasMore: false, nextOffset: null });
      const loadedCustomerAccounts = accountResponse.data?.accounts || [];
      setCustomerAccounts(loadedCustomerAccounts);
      setCustomerAccountTotal(Number(accountResponse.data?.total ?? loadedCustomerAccounts.length));
      setCustomerAccountOffset(Number(accountResponse.data?.offset ?? 0));
      setCustomerAccountHasMore(Boolean(accountResponse.data?.hasMore));
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendDisputes) setLoadingMoreDisputes(false);
      }
    }
  }, [disputeStatus, t]);

  useEffect(() => { load(); }, [load]);

  const downloadDisputeHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (disputeStatus) params.status = disputeStatus;
      const response = await adminApi.get('/admin/super/oxsteed-credit/disputes.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-disputes-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminDisputeCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminDisputeCsvFailed')));
    } finally { setBusy(false); }
  };
  const resolveDispute = async (dispute, status) => {
    const resolution = String(disputeResolutionDrafts[dispute.id] || '').trim();
    if (!resolution) {
      setError(t('adminDisputeResolutionRequired'));
      return;
    }
    const rawCompensation = String(disputeCompensationDrafts[dispute.id] ?? '').trim();
    const compensationCents = rawCompensation === '' ? 0 : Number.parseInt(rawCompensation, 10);
    if (status === 'resolved_customer' && (Number.isNaN(compensationCents) || compensationCents < 0)) {
      setError(t('adminDisputeCompensationInvalid'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/disputes/${dispute.id}/resolve`, {
        status,
        resolution: resolution || undefined,
        compensationCents: status === 'resolved_customer' ? compensationCents : undefined,
      });
      setNotice(t('adminDisputeStatusChanged', { id: dispute.id.slice(0, 8), status: localizeCreditStatus(status, t) }));
      setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: '' }));
      setDisputeCompensationDrafts((current) => ({ ...current, [dispute.id]: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminDisputeUpdateFailed')));
    } finally { setBusy(false); }
  };
  const selectCustomerAccount = (account) => {
    setCustomerForm((current) => ({ ...current, customerId: account.customerId, currencyCode: account.currencyCode }));
    setAccountStatusForm((current) => ({ ...current, customerId: account.customerId, currencyCode: account.currencyCode }));
    setNotice(t('adminCustomerWalletSelected', { customer: account.name || account.email || t('adminCustomer'), currency: account.currencyCode }));
  };
  const inspectCustomerAccount = (account) => {
    selectCustomerAccount(account);
    setCustomerDetailAccount(account);
  };
  const inspectDisputeCustomer = async (dispute) => {
    const matchingAccount = customerAccounts.find((account) => account.customerId === dispute.customerId && (!dispute.currencyCode || account.currencyCode === dispute.currencyCode));
    if (matchingAccount) return inspectCustomerAccount(matchingAccount);
    setBusy(true); setError(''); setNotice('');
    try {
      const params = dispute.currencyCode ? { currencyCode: dispute.currencyCode } : undefined;
      const response = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${dispute.customerId}`, { params });
      const account = response.data?.account;
      if (!account) throw new Error('Customer Credit wallet was not found.');
      inspectCustomerAccount(account);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCustomerProfileOpenFailed')));
    } finally { setBusy(false); }
  };
  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminCreditDisputes')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminDisputeQueueDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <CreditDisputeQueue
        disputes={disputes}
        disputeStatus={disputeStatus}
        setDisputeStatus={setDisputeStatus}
        disputePagination={disputePagination}
        loadingMoreDisputes={loadingMoreDisputes}
        loading={loading}
        busy={busy}
        downloadDisputeHistory={downloadDisputeHistory}
        load={load}
        disputeResolutionDrafts={disputeResolutionDrafts}
        setDisputeResolutionDrafts={setDisputeResolutionDrafts}
        disputeCompensationDrafts={disputeCompensationDrafts}
        setDisputeCompensationDrafts={setDisputeCompensationDrafts}
        setDisputeResolutionDrafts={setDisputeResolutionDrafts}
        inspectDisputeCustomer={inspectDisputeCustomer}
        resolveDispute={resolveDispute}
      />
      {customerDetailAccount && <OxsteedCreditCustomerDetail account={customerDetailAccount} busy={busy} onClose={() => setCustomerDetailAccount(null)} />}
      </main>
    </>
  );
}
