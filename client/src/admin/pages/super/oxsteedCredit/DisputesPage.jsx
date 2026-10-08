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
import useDestructiveConfirm from '../../../hooks/useDestructiveConfirm';

// Published error-resolution policy: 10 business days to investigate.
const DISPUTE_SLA_BUSINESS_DAYS = 10;

function businessDaysOpen(openedAt) {
  if (!openedAt) return 0;
  const start = new Date(openedAt);
  if (Number.isNaN(start.getTime())) return 0;
  const end = new Date();
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let days = 0;
  while (cursor < endDay) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function mediaPaymentLabel(referenceType, t) {
  if (referenceType === 'media_creator_tip') return t('adminMediaCreatorTip');
  if (referenceType === 'media_creator_sponsorship') return t('adminMediaCreatorSponsorship');
  if (referenceType === 'media_post_boost') return t('adminMediaPostBoost');
  return null;
}

function CreditDisputeQueue({
  disputes,
  disputeStatus,
  setDisputeStatus,
  mediaOnly,
  setMediaOnly,
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
  disputeProvisionalDrafts,
  setDisputeProvisionalDrafts,
  inspectDisputeCustomer,
  resolveDispute,
  issueProvisionalCredit,
}) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Disputes" title="Credit dispute queue" detail="Disputes preserve the original journal transaction. Filter by lifecycle state and load older cases from the server; resolve with a documented outcome and use a separate compensating refund or adjustment rather than editing history." action={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={downloadDisputeHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button><label className="flex items-center gap-2 rounded-lg border border-orange-500/30 px-3 py-2 text-xs font-semibold text-orange-200"><input type="checkbox" checked={mediaOnly} onChange={(event) => setMediaOnly(event.target.checked)} disabled={loading || busy} className="h-4 w-4 accent-orange-500" />{t('adminMediaOnly')}</label><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminStatus')}</span><select aria-label={t('adminDisputeStatusFilter')} value={disputeStatus} onChange={(event) => setDisputeStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="open">{t('openStatus')}</option><option value="in_review">{t('underReviewStatus')}</option><option value="resolved_customer">{t('adminDisputeResolvedCustomer')}</option><option value="resolved_merchant">{t('adminDisputeResolvedMerchant')}</option><option value="resolved">{t('resolvedStatus')}</option><option value="rejected">{t('rejectedStatus')}</option></select></label>{disputePagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendDisputes: true, disputeOffset: disputePagination.nextOffset || 0 })} disabled={loadingMoreDisputes || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreDisputes ? t('adminLoading') : t('adminLoadOlder')}</button>}</div>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomerRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminTransaction')}</th><th className="px-3 py-3 font-medium">{t('adminReason')}</th><th className="px-3 py-3 font-medium">{t('adminDescription')}</th><th className="px-3 py-3 font-medium">{t('adminOpened')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!disputes.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{t('adminNoDisputesForStatus')}</td></tr> : disputes.map((dispute) => <tr key={dispute.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{dispute.customerId}</span><p className="mt-1 text-gray-600">{dispute.restaurantName || t('adminCredit')}</p><button type="button" disabled={busy} onClick={() => inspectDisputeCustomer(dispute)} className="mt-2 rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{t('adminOpenCustomer360')}</button></td><td className="px-3 py-3 text-gray-400">{dispute.amountCents !== null && dispute.amountCents !== undefined ? <strong className="block text-emerald-300">{money(dispute.amountCents, dispute.currencyCode || 'USD')}</strong> : <strong className="block text-gray-600">{t('adminAmountUnavailable')}</strong>}<span className="mt-1 block font-mono text-[10px] text-gray-600">{creditTransactionLabel({ transactionType: dispute.transactionType }, t)} · {dispute.transactionId}</span>{mediaPaymentLabel(dispute.referenceType, t) && <span className="mt-1 block text-[10px] font-semibold text-orange-300">{mediaPaymentLabel(dispute.referenceType, t)}</span>}{dispute.referenceId && <span className="mt-1 block break-all font-mono text-[10px] text-gray-700">{t('adminReference')} {dispute.referenceId}</span>}</td><td className="px-3 py-3"><Badge status={dispute.status} /><p className="mt-1 text-gray-500">{disputeReasonLabel(dispute.reasonCode, t)}</p></td><td className="max-w-[280px] px-3 py-3 text-gray-400">{dispute.description}<textarea aria-label={t('adminResolution')} value={disputeResolutionDrafts[dispute.id] || ''} onChange={(event) => setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))} maxLength={4000} rows={2} placeholder={t('adminResolutionNotePlaceholder')} className="mt-3 w-full min-w-[220px] resize-y rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-400" /><label className="mt-2 block"><span className="mb-1 block text-[10px] font-semibold text-gray-600">{t('adminDisputeCompensationLabel')}</span><input inputMode="numeric" value={disputeCompensationDrafts[dispute.id] || ''} onChange={(event) => setDisputeCompensationDrafts((current) => ({ ...current, [dispute.id]: event.target.value.replace(/[^\d]/g, '').slice(0, 10) }))} placeholder={t('adminDisputeCompensationPlaceholder')} className="w-full min-w-[140px] rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 font-mono text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /></label></td><td className="px-3 py-3 text-gray-500">{dateTime(dispute.openedAt)}{dispute.postedAt && <p className="mt-1 text-gray-600">{t('adminPosted')} {dateTime(dispute.postedAt)}</p>}{['open', 'in_review'].includes(dispute.status) && (() => { const daysOpen = businessDaysOpen(dispute.openedAt); const breached = daysOpen > DISPUTE_SLA_BUSINESS_DAYS; const nearing = !breached && daysOpen >= DISPUTE_SLA_BUSINESS_DAYS - 2; return <p className="mt-1"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${breached ? 'bg-red-500/15 text-red-300' : nearing ? 'bg-amber-500/15 text-amber-300' : 'bg-gray-500/15 text-gray-400'}`}>{t('adminDisputeBusinessDays', { count: daysOpen })}{breached ? ` · ${t('adminDisputeSlaBreach')}` : ''}</span></p>; })()}{Number(dispute.provisionalCreditCents || 0) > 0 && <p className="mt-1 text-[10px] text-sky-400">{t('adminDisputeProvisionalIssued', { amount: money(dispute.provisionalCreditCents, dispute.currencyCode || 'USD') })}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => resolveDispute(dispute, 'in_review')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminReview')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved_customer')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminDisputeResolveCustomer')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved_merchant')} className="rounded-lg bg-teal-600 px-2.5 py-2 font-semibold text-white hover:bg-teal-500 disabled:opacity-50">{t('adminDisputeResolveMerchant')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'rejected')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div>{dispute.status === 'in_review' && <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5"><p className="text-[10px] font-semibold text-sky-300">{t('adminDisputeProvisionalTitle')}</p><div className="mt-2 flex flex-wrap items-center gap-2"><input inputMode="numeric" aria-label={t('adminDisputeProvisionalAmount')} value={disputeProvisionalDrafts[dispute.id] || ''} onChange={(event) => setDisputeProvisionalDrafts((current) => ({ ...current, [dispute.id]: event.target.value.replace(/[^\d]/g, '').slice(0, 10) }))} placeholder={t('adminDisputeProvisionalPlaceholder')} className="w-32 rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 font-mono text-xs text-white outline-none placeholder:text-gray-600 focus:border-sky-400" /><button type="button" disabled={busy || !String(disputeProvisionalDrafts[dispute.id] || '').trim() || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => issueProvisionalCredit(dispute)} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminDisputeProvisionalIssue')}</button></div><p className="mt-1.5 text-[10px] text-gray-500">{t('adminDisputeProvisionalHint')}</p></div>}</td></tr>)}</tbody></table></div>
  </Section>;
}

export default function OxsteedCreditDisputesPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [disputes, setDisputes] = useState([]);
  const [disputeStatus, setDisputeStatus] = useState('');
  const [mediaOnly, setMediaOnly] = useState(false);
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
  const [disputeProvisionalDrafts, setDisputeProvisionalDrafts] = useState({});
  const { confirmDestructive, dialog: destructiveDialog } = useDestructiveConfirm();

  const load = useCallback(async ({ quiet = false, appendDisputes = false, disputeOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendDisputes) setLoading(true);
    if (appendDisputes) setLoadingMoreDisputes(true);
    setError('');
    try {
      const disputeParams = { limit: 50, offset: appendDisputes ? disputeOffset : 0 };
      if (disputeStatus) disputeParams.status = disputeStatus;
      if (mediaOnly) disputeParams.mediaOnly = true;
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
  }, [disputeStatus, mediaOnly, t]);

  useEffect(() => { load(); }, [load]);

  const downloadDisputeHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (disputeStatus) params.status = disputeStatus;
      if (mediaOnly) params.mediaOnly = true;
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
  const issueProvisionalCredit = async (dispute) => {
    const resolution = String(disputeResolutionDrafts[dispute.id] || '').trim();
    if (!resolution) {
      setError(t('adminDisputeResolutionRequired'));
      return;
    }
    const rawAmount = String(disputeProvisionalDrafts[dispute.id] ?? '').trim();
    const amountCents = Number.parseInt(rawAmount, 10);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setError(t('adminDisputeProvisionalInvalid'));
      return;
    }
    const confirmed = await confirmDestructive({
      title: t('adminDisputeProvisionalTitle'),
      description: t('adminDisputeProvisionalConfirm', { amount: money(amountCents, dispute.currencyCode || 'USD') }),
      confirmLabel: t('adminDisputeProvisionalIssue'),
    });
    if (!confirmed) return;
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/disputes/${dispute.id}/provisional-credit`, {
        amountCents,
        reason: resolution,
      });
      setNotice(t('adminDisputeProvisionalNotice', { id: dispute.id.slice(0, 8), amount: money(amountCents, dispute.currencyCode || 'USD') }));
      setDisputeProvisionalDrafts((current) => ({ ...current, [dispute.id]: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminDisputeProvisionalFailed')));
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
      {destructiveDialog}
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
        mediaOnly={mediaOnly}
        setMediaOnly={setMediaOnly}
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
        disputeProvisionalDrafts={disputeProvisionalDrafts}
        setDisputeProvisionalDrafts={setDisputeProvisionalDrafts}
        inspectDisputeCustomer={inspectDisputeCustomer}
        resolveDispute={resolveDispute}
        issueProvisionalCredit={issueProvisionalCredit}
      />
      {customerDetailAccount && <OxsteedCreditCustomerDetail account={customerDetailAccount} busy={busy} onClose={() => setCustomerDetailAccount(null)} />}
      </main>
    </>
  );
}
