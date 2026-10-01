import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import { localizeCreditOrderTypes, localizeCreditStatus } from '../../../../lib/creditStatus';
import {
  AdminActionDialog,
  Badge,
  CreditSubNav,
  IntegritySummary,
  Section,
  dateTime,
  money,
  useCreditDialog,
  useCreditPageState,
} from './shared';

function SettlementControls({
  selectablePartners,
  settlementForm,
  setSettlementForm,
  loadSettlementAgreements,
  loadingSettlementAgreements,
  settlementAgreements,
  settlementAgreementOptionsError,
  busy,
  createSettlement,
  reconciliationReason,
  setReconciliationReason,
  runReconciliation,
  reconciliation,
  settlements,
  transitionSettlement,
}) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Settlement & controls" title="Partner payables and reconciliation" detail="Create a period snapshot, approve it only after review, and mark it paid only with a traceable external payment reference. The reconciliation compares every account balance to its immutable journal entries; its integrity scope is always the all-time ledger for the selected currency.">
    <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <form onSubmit={createSettlement} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSettlementPartner')}</span>
          <select required value={settlementForm.partnerId} onChange={(event) => { const nextPartner = selectablePartners.find((partner) => String(partner.partnerId) === event.target.value); setSettlementForm({ ...settlementForm, partnerId: event.target.value, agreementId: '', currencyCode: nextPartner?.settlementCurrencyCode || 'USD' }); loadSettlementAgreements(event.target.value); }} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">{t('adminSelectPartner')}</option>
            {selectablePartners.filter((partner) => partner.status === 'active').map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminRestaurantFallback', { id: partner.restaurantId })} · {partner.settlementCurrencyCode || 'USD'}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSettlementAgreement')}</span>
          <select required value={settlementForm.agreementId} onChange={(event) => setSettlementForm({ ...settlementForm, agreementId: event.target.value })} disabled={loadingSettlementAgreements || !settlementForm.partnerId} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">{loadingSettlementAgreements ? t('adminLoadingAgreements') : t('adminSelectAgreement')}</option>
            {settlementAgreements.map((agreement) => <option key={agreement.id} value={agreement.id}>v{agreement.version} · {localizeCreditStatus(agreement.status, t)}</option>)}
          </select>
          {settlementAgreementOptionsError && <p className="mt-2 text-xs font-semibold text-red-300">{settlementAgreementOptionsError}</p>}
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrency')}</span>
          <input value={settlementForm.currencyCode} readOnly className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-3 text-sm font-semibold text-sky-300 outline-none" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPeriodStarts')}</span>
          <input required type="datetime-local" value={settlementForm.periodStart} onChange={(event) => setSettlementForm({ ...settlementForm, periodStart: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPeriodEnds')}</span>
          <input required type="datetime-local" value={settlementForm.periodEnd} onChange={(event) => setSettlementForm({ ...settlementForm, periodEnd: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPaymentReferenceOptional')}</span>
          <input value={settlementForm.paymentReference} onChange={(event) => setSettlementForm({ ...settlementForm, paymentReference: event.target.value })} placeholder={t('adminPaymentReferencePlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReasonForSnapshot')}</span>
          <input required maxLength={1000} value={settlementForm.reason} onChange={(event) => setSettlementForm({ ...settlementForm, reason: event.target.value })} placeholder={t('adminReasonForSnapshotPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
        </label>
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> {t('adminCreateSnapshot')}</button>
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReasonForReconciliation')}</span>
            <input maxLength={1000} value={reconciliationReason} onChange={(event) => setReconciliationReason(event.target.value)} placeholder={t('adminReasonForReconciliationPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
          </label>
          <button type="button" disabled={busy} onClick={runReconciliation} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> {t('adminReconcileLedger')}</button>
        </div>
        {reconciliation && <div className={`rounded-xl border px-3 py-3 text-xs sm:col-span-2 ${reconciliation.status === 'balanced' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' : 'border-red-500/30 bg-red-950/20 text-red-300'}`}>
          {t('adminLastRun')}: <strong>{localizeCreditStatus(reconciliation.status, t)}</strong> · {t('adminDifference')}: {money(reconciliation.differenceCents, reconciliation.currencyCode || settlementForm.currencyCode)} · {reconciliation.entryCount} {t('adminJournalEntries')} · {t('adminIntegrityScope')}: {reconciliation.scope === 'all_time_ledger' ? t('adminAllTimeLedger') : t('adminUnknown')}
          <IntegritySummary integrity={reconciliation.integrity} />
        </div>}
      </form>
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="min-w-[1080px] w-full text-left text-xs">
          <thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminSettlementPeriod')}</th><th className="px-3 py-3 font-medium">{t('adminCycle')}</th><th className="px-3 py-3 font-medium">{t('adminValueDate')}</th><th className="px-3 py-3 font-medium">{t('adminNetPayable')}</th><th className="px-3 py-3 font-medium">{t('adminSettlementStatusProvenance')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead>
          <tbody className="divide-y divide-gray-800">
            {!settlements.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminNoSettlementSnapshots')}</td></tr> : settlements.map((settlement) => <tr key={settlement.id}>
              <td className="px-3 py-3 text-white">{settlement.restaurantName || t('adminPartnerFallback', { id: settlement.partnerId })}<p className="mt-1 text-gray-600">{t('adminGrossAmount')} {money(settlement.grossCents, settlement.currencyCode)} · {t('adminRefunds')} {money(settlement.refundCents, settlement.currencyCode)}</p></td>
              <td className="px-3 py-3 text-gray-400">{dateTime(settlement.periodStart)}<br />{t('adminTo')} {dateTime(settlement.periodEnd)}</td>
              <td className="px-3 py-3 text-gray-400">{settlement.cycleId ? <span title={settlement.cycleId}>{String(settlement.cycleId).slice(0, 8)}</span> : t('adminCycleManual')}</td>
              <td className="px-3 py-3 text-gray-400">{settlement.valueDate ? dateTime(settlement.valueDate) : t('adminUnknownDate')}</td>
              <td className="px-3 py-3 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</td>
              <td className="px-3 py-3"><Badge status={settlement.status} /><p className="mt-1 break-all text-[10px] text-gray-600">{t('adminPayoutStatus')}: {localizeCreditStatus(settlement.payoutStatus || 'none', t)}</p><p className="mt-1 break-all text-[10px] text-gray-600">{t('adminCreatedBy')} {settlement.createdBy || t('adminSystem')}</p>{settlement.approvedBy && <p className="mt-1 break-all text-[10px] text-sky-300">{t('adminApprovedBy')} {settlement.approvedBy}</p>}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap gap-2">{settlement.status === 'pending' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'approved')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminApprove')}</button>}{settlement.status === 'approved' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'paid')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminMarkPaid')}</button>}{['pending', 'approved'].includes(settlement.status) && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'voided')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminVoid')}</button>}</div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </Section>;
}

function SettlementEvidence({ settlements }) {
  const { t } = useTranslation('credit');
  if (!settlements?.length) return null;
  return <Section eyebrow={t('adminPayoutEvidence')} title={t('adminSettlementPaymentTrail')} detail={t('adminSettlementEvidenceDescription')}><div className="mt-4 grid gap-3 md:grid-cols-2">{settlements.slice(0, 6).map((settlement) => <article key={settlement.id} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{settlement.restaurantName || t('adminPartnerFallback', { id: settlement.partnerId })}</h3><p className="mt-1 text-[11px] text-gray-600">{dateTime(settlement.periodStart)} {t('adminTo')} {dateTime(settlement.periodEnd)}</p></div><Badge status={settlement.status} /></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-gray-600">{t('adminNetPayable')}</dt><dd className="mt-1 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</dd></div><div><dt className="text-gray-600">{t('adminApprovedBy')}</dt><dd className="mt-1 break-all text-sky-300">{settlement.approvedBy || t('adminPendingApproval')}</dd></div><div><dt className="text-gray-600">{t('adminPaymentReference')}</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-300">{settlement.paymentReference || t('adminNotRecorded')}</dd></div></dl>{settlement.paidAt && <p className="mt-3 border-t border-gray-800 pt-3 text-[11px] text-gray-500">{t('adminPaid')} {dateTime(settlement.paidAt)}</p>}</article>)}</div>{settlements.length > 6 && <p className="mt-3 text-xs text-gray-600">{t('adminRecentSettlementSummary')}</p>}</Section>;
}

function CreditPayoutRecovery({ settlements, busy, reverseSettlement }) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Payout recovery" title="Reverse a paid settlement" detail="Use this only when the external payout failed or was returned. The operation requires recovery evidence and creates a compensating ledger entry; it never edits the original payment transaction."><div className="grid gap-3 md:grid-cols-2">{settlements.filter((settlement) => settlement.status === 'paid' && Number(settlement.netCents || 0) > 0).slice(0, 6).map((settlement) => <article key={`reversal-${settlement.id}`} className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{settlement.restaurantName || t('adminPartnerFallback', { id: settlement.partnerId })}</h3><p className="mt-1 text-xs text-gray-500">{money(settlement.netCents, settlement.currencyCode)} · {settlement.paymentReference || t('adminNoPaymentReference')}</p></div><button type="button" disabled={busy} onClick={() => reverseSettlement(settlement)} className="rounded-lg border border-amber-500/40 px-2.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminReversePayout')}</button></div></article>)}</div></Section>;
}

export default function OxsteedCreditSettlementsPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [partners, setPartners] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [settlementPartnerId, setSettlementPartnerId] = useState('');
  const [settlementStatus, setSettlementStatus] = useState('');
  const [settlementPagination, setSettlementPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreSettlements, setLoadingMoreSettlements] = useState(false);
  const [settlementForm, setSettlementForm] = useState({ partnerId: '', agreementId: '', currencyCode: 'USD', periodStart: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 16), periodEnd: new Date().toISOString().slice(0, 16), paymentReference: '', reason: '' });
  const [settlementAgreementOptions, setSettlementAgreementOptions] = useState([]);
  const [settlementAgreementLookupPartnerId, setSettlementAgreementLookupPartnerId] = useState('');
  const [loadingSettlementAgreements, setLoadingSettlementAgreements] = useState(false);
  const [settlementAgreementOptionsError, setSettlementAgreementOptionsError] = useState('');
  const settlementAgreementRequestRef = useRef(0);
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciliationRuns, setReconciliationRuns] = useState([]);
  const [reconciliationReason, setReconciliationReason] = useState('');
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();

  const load = useCallback(async ({ quiet = false, appendSettlements = false, settlementOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendSettlements) setLoading(true);
    if (appendSettlements) setLoadingMoreSettlements(true);
    setError('');
    try {
      const settlementParams = { limit: 50, offset: appendSettlements ? settlementOffset : 0 };
      if (settlementPartnerId) settlementParams.partnerId = settlementPartnerId;
      if (settlementStatus) settlementParams.status = settlementStatus;
      const [partnersResponse, agreementsResponse, settlementsResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/partners'),
        adminApi.get('/admin/super/oxsteed-credit/agreements'),
        adminApi.get('/admin/super/oxsteed-credit/settlements', { params: settlementParams }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setPartners(partnersResponse.data?.partners || []);
      setAgreements(agreementsResponse.data?.agreements || []);
      const loadedSettlements = settlementsResponse.data?.settlements || [];
      if (appendSettlements) setSettlements((current) => [...current, ...loadedSettlements]);
      else setSettlements(loadedSettlements);
      setSettlementPagination(settlementsResponse.data?.pagination || { limit: settlementParams.limit, offset: settlementParams.offset, hasMore: false, nextOffset: null });
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendSettlements) setLoadingMoreSettlements(false);
      }
    }
  }, [settlementPartnerId, settlementStatus, t]);

  useEffect(() => { load(); }, [load]);

  const loadSettlementAgreements = useCallback(async (partnerId) => {
    const requestId = ++settlementAgreementRequestRef.current;
    const normalizedPartnerId = String(partnerId || '');
    if (!normalizedPartnerId) {
      setSettlementAgreementOptions([]);
      setSettlementAgreementLookupPartnerId('');
      setSettlementAgreementOptionsError('');
      setLoadingSettlementAgreements(false);
      return;
    }
    setLoadingSettlementAgreements(true);
    setSettlementAgreementOptionsError('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/agreements', { params: { partnerId: normalizedPartnerId } });
      if (requestId !== settlementAgreementRequestRef.current) return;
      setSettlementAgreementOptions(response.data?.agreements || []);
      setSettlementAgreementLookupPartnerId(normalizedPartnerId);
    } catch (err) {
      if (requestId === settlementAgreementRequestRef.current) {
        setSettlementAgreementOptionsError(safeCreditErrorMessage(err, t('adminAgreementLookupFailed')));
      }
    } finally {
      if (requestId === settlementAgreementRequestRef.current) setLoadingSettlementAgreements(false);
    }
  }, []);

  const selectablePartners = useMemo(() => {
    const activeOptions = partners;
    const selectedIds = [settlementForm.partnerId].filter(Boolean).map(String);
    const selectedPartners = [...partners].filter((partner) => selectedIds.includes(String(partner.partnerId)));
    return Array.from(new Map([...activeOptions, ...selectedPartners].map((partner) => [String(partner.partnerId), partner])).values());
  }, [partners, settlementForm.partnerId]);

  const createSettlement = async (event) => {
    event.preventDefault();
    if (!settlementForm.partnerId || !settlementForm.agreementId) return setError(t('adminChoosePartnerAgreementError'));
    setBusy(true); setNotice(''); setError('');
    const payload = {
      partnerId: settlementForm.partnerId,
      agreementId: settlementForm.agreementId,
      periodStart: new Date(settlementForm.periodStart).toISOString(),
      periodEnd: new Date(settlementForm.periodEnd).toISOString(),
      paymentReference: settlementForm.paymentReference || undefined,
      reason: settlementForm.reason,
    };
    try {
      await adminApi.post('/admin/super/oxsteed-credit/settlements', payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-settlement', payload) } });
      idempotencyKeysRef.current.clear('credit-settlement', payload);
      setNotice(t('adminSettlementSnapshotCreated'));
      setSettlementForm((current) => ({ ...current, paymentReference: '', reason: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementCreationFailed')));
    } finally { setBusy(false); }
  };
  const transitionSettlement = async (settlement, status) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminSettlementTransitionTitle', { status: localizeCreditStatus(status, t) }), description: t('adminSettlementTransitionDescription'), label: t('adminRequiredAuditReason'), defaultValue: t('adminSettlementTransitionDefault') });
    if (!reason?.trim()) {
      setError(t('adminSettlementTransitionReasonRequired'));
      return;
    }
    let paymentReference = settlement.paymentReference || '';
    if (status === 'paid' && !paymentReference && Number(settlement.netCents || 0) > 0) {
      paymentReference = await requestDialog({ kind: 'text', title: t('adminExternalPaymentReference'), description: t('adminExternalPaymentReferenceDescription'), label: t('adminPaymentReference'), placeholder: t('adminPaymentReferencePlaceholder') }) || '';
      if (!paymentReference.trim()) {
        setError(t('adminPaymentReferenceRequired'));
        return;
      }
    }
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/settlements/${settlement.id}/status`, { status, expectedStatus: settlement.status, reason: reason.trim(), paymentReference: paymentReference.trim() || undefined });
      // Phase 7 (gap 9): approval (status=approved) queues as a pending action
      // for a second admin; every other transition executes immediately.
      setNotice(response.status === 202
        ? t('adminMakerCheckerQueued')
        : t('adminSettlementStatusChanged', { partner: settlement.restaurantName || t('adminPartner'), status: localizeCreditStatus(status, t) }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementStatusChangeFailed')));
    } finally { setBusy(false); }
  };
  const reverseSettlement = async (settlement) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminSettlementReversalTitle'), description: t('adminSettlementReversalDescription'), label: t('adminRequiredReversalReason'), defaultValue: t('adminSettlementReversalDefault') });
    if (!reason?.trim()) {
      setError(t('adminSettlementReversalReasonRequired'));
      return;
    }
    const recoveryReference = await requestDialog({ kind: 'text', title: t('adminSettlementRecoveryReference'), description: t('adminSettlementRecoveryReferenceDescription'), label: t('adminRecoveryReference'), placeholder: t('adminRecoveryReferencePlaceholder') }) || '';
    if (!recoveryReference.trim()) {
      setError(t('adminRecoveryReferenceRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    const payload = { reason: reason.trim(), recoveryReference: recoveryReference.trim() };
    const keyPayload = { settlementId: settlement.id, ...payload };
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/settlements/${settlement.id}/reversal`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-settlement-reversal', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-settlement-reversal', keyPayload);
      setNotice(t('adminSettlementReversed', { partner: settlement.restaurantName || t('adminPartner') }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementReversalFailed')));
    } finally { setBusy(false); }
  };
  const runReconciliation = async () => {
    if (!reconciliationReason.trim()) {
      setError(t('adminReconciliationReasonRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/reconciliation', {
        currencyCode: settlementForm.currencyCode || 'USD',
        periodStart: new Date(settlementForm.periodStart).toISOString(),
        periodEnd: new Date(settlementForm.periodEnd).toISOString(),
        reason: reconciliationReason.trim(),
      });
      const run = response.data?.run || null;
      setReconciliation(run);
      if (run) setReconciliationRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setReconciliationReason('');
      setNotice(run?.status === 'balanced'
        ? t('adminReconciliationBalanced')
        : run?.status === 'failed'
          ? t('adminReconciliationIntegrityFailed')
          : t('adminReconciliationDifference'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminReconciliationFailed')));
    } finally { setBusy(false); }
  };
  const downloadSettlementHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (settlementPartnerId) params.partnerId = settlementPartnerId;
      if (settlementStatus) params.status = settlementStatus;
      const response = await adminApi.get('/admin/super/oxsteed-credit/settlements.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminSettlementCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementCsvFailed')));
    } finally { setBusy(false); }
  };
  return (
    <>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminSettlementQueue')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminSettlementQueueDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <SettlementEvidence settlements={settlements} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-[#111318] p-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSettlementQueue')}</p>
        <p className="mt-1 text-xs text-gray-500">{t('adminSettlementQueueDescription')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <span>{t('adminPartner')}</span>
            <select aria-label={t('adminSettlementPartnerFilter')} value={settlementPartnerId} onChange={(event) => setSettlementPartnerId(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
              <option value="">{t('adminAllPartners')}</option>
              {partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminPartnerFallback', { id: partner.partnerId })}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <span>{t('adminStatus')}</span>
            <select aria-label={t('adminSettlementStatusFilter')} value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
              <option value="">{t('adminAllStatuses')}</option>
              <option value="pending">{t('statusPending')}</option>
              <option value="approved">{t('statusApproved')}</option>
              <option value="paid">{t('statusPaid')}</option>
              <option value="reversed">{t('statusReversed')}</option>
              <option value="disputed">{t('statusDisputed')}</option>
              <option value="voided">{t('statusVoided')}</option>
            </select>
          </label>
          <button type="button" onClick={downloadSettlementHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>
          {settlementPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendSettlements: true, settlementOffset: settlementPagination.nextOffset || 0 })} disabled={loadingMoreSettlements || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreSettlements ? t('adminLoading') : t('adminLoadOlder')}</button>}
        </div>
      </div>
      <SettlementControls
        selectablePartners={selectablePartners}
        settlementForm={settlementForm}
        setSettlementForm={setSettlementForm}
        loadSettlementAgreements={loadSettlementAgreements}
        loadingSettlementAgreements={loadingSettlementAgreements}
        settlementAgreements={settlementAgreementOptions}
        settlementAgreementOptionsError={settlementAgreementOptionsError}
        busy={busy}
        createSettlement={createSettlement}
        reconciliationReason={reconciliationReason}
        setReconciliationReason={setReconciliationReason}
        runReconciliation={runReconciliation}
        reconciliation={reconciliation}
        settlements={settlements}
        transitionSettlement={transitionSettlement}
      />
      <CreditPayoutRecovery
        settlements={settlements}
        busy={busy}
        reverseSettlement={reverseSettlement}
      />
      </main>
    </>
  );
}
