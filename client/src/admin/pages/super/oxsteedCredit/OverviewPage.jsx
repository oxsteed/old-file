import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Store,
  WalletCards,
  ChevronRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { adminRoute } from '../../../adminRouteManifest';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  Badge,
  CreditSubNav,
  CREDIT_SUBNAV_ITEMS,
  Metric,
  Section,
  creditNotificationLabel,
  dateTime,
  money,
  useCreditPageState,
} from './shared';

export default function OxsteedCreditOverviewPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [overview, setOverview] = useState(null);
  const [rail, setRail] = useState(null);
  const [notificationRetryReason, setNotificationRetryReason] = useState('');
  const [retryingNotificationId, setRetryingNotificationId] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [overviewResponse, railResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/rail'),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
      setRail(railResponse.data?.rail || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const retryNotification = async (notification) => {
    const reason = notificationRetryReason.trim();
    if (!reason) {
      setError(t('adminRetryNotificationReasonRequired'));
      return;
    }
    setRetryingNotificationId(notification.id); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/notifications/${notification.id}/retry`, { reason });
      setNotificationRetryReason('');
      setNotice(t('adminNotificationRequeued'));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminNotificationRetryFailed')));
    } finally { setRetryingNotificationId(''); }
  };

  // Phase 7 (gap 10): resolutions are now customer / merchant / rejected /
  // in-review. Only resolved_customer may carry compensationCents, which the
  // server posts as a compensating credit without touching journal history.

  const summary = overview?.summary || {};
  const summaryByCurrency = overview?.summaryByCurrency || [];
  const partnerCounts = overview?.partnerCounts || { total: 0, active: 0 };
  const coverageAlerts = overview?.coverageAlerts || { pendingPartners: 0, activePartnersWithoutAgreement: 0, expiringAgreements: 0 };
  const notificationHealth = overview?.notificationHealth || { pending: 0, sending: 0, failed: 0, oldestPendingAt: null, backlogStale: false, backlogStaleAfterMinutes: 15, oldestFailedAt: null, failedNotifications: [], workerHeartbeat: {} };
  const riskLimits = overview?.riskLimits || null;
  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-300">{t('adminSuperAdmin')}</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> {t('adminStoredValueControl')}</span></div><h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t('adminPageTitle')}</h1><p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{t('adminPageDescription')}</p></div><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button></div></header>
        {rail && (
          <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Snowflake className="h-5 w-5 shrink-0 text-sky-300" />
                <p className="text-sm font-semibold text-white">{t('adminCreditRail')}</p>
                <Badge status={rail.enabled ? 'enabled' : 'suspended'} />
              </div>
              <Link to={adminRoute('oxsteedCreditHealth').path} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800">{t('adminCreditSubnavHealth')} <ChevronRight className="h-3.5 w-3.5" /></Link>
            </div>
            {rail.frozen && (
              <div role="alert" className="mt-3 flex flex-wrap items-start gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300">
                <div><strong>{t('adminRailFrozenBanner')}</strong><p className="mt-1 text-xs text-red-300/80">{t('adminRailFreezeReasonLabel')}: {rail.freeze?.reason || t('adminUnknown')}</p></div>
              </div>
            )}
            {rail.prerequisites && (
              <p className="mt-3 text-xs text-gray-500">{t('adminProductionPrerequisites')}: <span className={rail.prerequisites.readyForProductionActivation ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'}>{rail.prerequisites.readyForProductionActivation ? t('adminInfrastructureReady') : t('adminNotReady')}</span></p>
            )}
          </section>
        )}
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={WalletCards} label={t('adminCustomerBalance', { currency: summary.currencyCode || 'USD' })} value={money(summary.customerBalanceCents, summary.currencyCode)} detail={t('adminCustomerAccounts', { count: summary.customerAccounts || 0 })} /><Metric icon={CreditCard} label={t('adminAvailableBalance', { currency: summary.currencyCode || 'USD' })} value={money(summary.customerAvailableCents, summary.currencyCode)} detail={`${money(summary.customerReservedCents, summary.currencyCode)} ${t('adminReserved')}`} tone="text-emerald-300" /><Metric icon={Store} label={t('adminPartnerPayable', { currency: summary.currencyCode || 'USD' })} value={money(summary.partnerPayableCents, summary.currencyCode)} detail={t('adminPartnerAccounts', { count: summary.partnerAccounts || 0 })} tone="text-sky-300" /><Metric icon={FileCheck2} label={t('adminPartnerNetwork')} value={partnerCounts.total} detail={t('adminActivePartners', { count: partnerCounts.active })} /><Metric icon={AlertTriangle} label={t('adminInactiveAccounts')} value={summary.inactiveAccounts || 0} detail={t('adminNeedsReviewBeforeSpending')} tone="text-amber-300" /></section>
      <Section eyebrow="Coverage watch" title="Partner agreement health" detail="These counts are calculated across the full partner network, not just the first page. Resolve coverage gaps before customers are told they can spend Credit at a restaurant."><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-xl border p-4 ${coverageAlerts.activePartnersWithoutAgreement ? 'border-red-500/30 bg-red-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminActivePartnersWithoutAgreement')}</p><strong className={`mt-2 block text-2xl ${coverageAlerts.activePartnersWithoutAgreement ? 'text-red-300' : 'text-emerald-300'}`}>{coverageAlerts.activePartnersWithoutAgreement}</strong><p className="mt-1 text-xs text-gray-600">{t('adminNotEligibleForSpending')}</p></div><div className={`rounded-xl border p-4 ${coverageAlerts.expiringAgreements ? 'border-amber-500/30 bg-amber-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminAgreementsExpiring30Days')}</p><strong className={`mt-2 block text-2xl ${coverageAlerts.expiringAgreements ? 'text-amber-300' : 'text-emerald-300'}`}>{coverageAlerts.expiringAgreements}</strong><p className="mt-1 text-xs text-gray-600">{t('adminReviewRenewals')}</p></div><div className={`rounded-xl border p-4 ${coverageAlerts.pendingPartners ? 'border-sky-500/30 bg-sky-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminPartnersPendingActivation')}</p><strong className={`mt-2 block text-2xl ${coverageAlerts.pendingPartners ? 'text-sky-300' : 'text-emerald-300'}`}>{coverageAlerts.pendingPartners}</strong><p className="mt-1 text-xs text-gray-600">{t('adminConfirmCommercialTerms')}</p></div></div></Section>
      <Section eyebrow="Delivery watch" title="Credit customer notifications" detail="Ledger changes commit independently from notification delivery. Use this view to catch delivery backlog or terminal failures without changing customer balances."><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-xl border p-4 ${notificationHealth.backlogStale ? 'border-red-500/40 bg-red-950/20' : notificationHealth.pending || notificationHealth.sending ? 'border-sky-500/30 bg-sky-950/20' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminQueuedSending')}</p><BellRing className={`h-4 w-4 ${notificationHealth.backlogStale ? 'text-red-300' : 'text-sky-300'}`} /></div><strong className={`mt-2 block text-2xl ${notificationHealth.backlogStale ? 'text-red-300' : 'text-sky-300'}`}>{notificationHealth.pending + notificationHealth.sending}</strong><p className={`mt-1 text-xs ${notificationHealth.backlogStale ? 'text-red-200' : 'text-gray-600'}`}>{notificationHealth.backlogStale ? t('adminDeliveryBacklogThreshold', { minutes: notificationHealth.backlogStaleAfterMinutes || 15 }) : t('adminQueuedInFlight', { queued: notificationHealth.pending, inFlight: notificationHealth.sending })}{notificationHealth.oldestPendingAt ? ` · ${t('adminOldest')} ${dateTime(notificationHealth.oldestPendingAt)}` : ''}</p></div><div className={`rounded-xl border p-4 ${notificationHealth.failed ? 'border-red-500/30 bg-red-950/20' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminTerminalFailures')}</p><AlertTriangle className={`h-4 w-4 ${notificationHealth.failed ? 'text-red-300' : 'text-emerald-300'}`} /></div><strong className={`mt-2 block text-2xl ${notificationHealth.failed ? 'text-red-300' : 'text-emerald-300'}`}>{notificationHealth.failed}</strong><p className="mt-1 text-xs text-gray-600">{notificationHealth.oldestFailedAt ? `${t('adminOldest')} ${dateTime(notificationHealth.oldestFailedAt)}` : t('adminNoTerminalDeliveryFailures')}</p></div><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminDeliveryContract')}</p><strong className="mt-2 block text-lg text-white">{t('adminDurableOutbox')}</strong><p className="mt-1 text-xs text-gray-600">{t('adminDeliveryContractDescription')}</p></div></div>{notificationHealth.failedNotifications?.length > 0 && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-950/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-red-200">{t('adminFailedDeliveriesAttention')}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{t('adminRetryOnlyRequeues')}</p></div><label className="min-w-[240px] flex-1"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminRetryReason')}</span><input value={notificationRetryReason} onChange={(event) => setNotificationRetryReason(event.target.value)} maxLength={1000} placeholder={t('adminRetryReasonPlaceholder')} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-xs text-white outline-none focus:border-orange-400" /></label></div><div className="mt-4 space-y-2">{notificationHealth.failedNotifications.map((notification) => <article key={notification.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-white">{creditNotificationLabel(notification, t)}</strong><span className="font-mono text-[10px] text-gray-600">{notification.id}</span></div><p className="mt-1 text-[11px] text-gray-500">{t('adminNotificationAttempts', { count: notification.attempts })} · {t('adminNotificationRecipient', { id: notification.userId || t('adminUnknown') })} · {dateTime(notification.updatedAt || notification.createdAt)}</p>{notification.lastError && <p className="mt-1 break-words text-[11px] text-red-300">{notification.lastError}</p>}</div><button type="button" onClick={() => retryNotification(notification)} disabled={busy || retryingNotificationId === notification.id || !notificationRetryReason.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${retryingNotificationId === notification.id ? 'animate-spin' : ''}`} />{retryingNotificationId === notification.id ? t('adminRequeuing') : t('adminRetryDelivery')}</button></article>)}</div></div>}</Section>
      {summaryByCurrency.length > 1 && <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminCurrencyControls')}</p><h2 className="mt-1 text-lg font-semibold text-white">{t('adminBalancesByCurrency')}</h2></div><span className="text-xs text-gray-500">{t('adminNoAutomaticFx')}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaryByCurrency.map((currencySummary) => <div key={currencySummary.currencyCode} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{currencySummary.currencyCode}</strong><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminWallets', { count: currencySummary.customerAccounts || 0 })}</span></div><p className="mt-2 text-lg font-semibold text-emerald-300">{money(currencySummary.customerAvailableCents, currencySummary.currencyCode)}</p><p className="mt-1 text-xs text-gray-500">{t('adminCustomerAvailable')} · {money(currencySummary.partnerPayableCents, currencySummary.currencyCode)} {t('adminPartnerPayableShort')}</p></div>)}</div></section>}
      {riskLimits && <Section eyebrow={t('adminRiskGuardrails')} title={t('adminFundingSpendingTransferLimits')} detail={t('adminRiskGuardrailsDescription')}><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">{t('adminPerTransaction')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTransactionCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminHardCapOneMovement')}</span></div><div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">{t('adminPerCustomerWallet')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxCustomerBalanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminMaxOutstandingBalance')}</span></div><div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">{t('adminGlobalOutstanding')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTotalIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminAllCustomerWalletsPerCurrency')}</span></div><div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">{t('adminDailyFunding')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminLoadsGrantsPerCustomer')}</span></div><div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{t('adminDailySpending')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerSpendCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminAcrossPartnerRestaurants')}</span></div><div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{t('adminSpendMovements')}</span><strong className="mt-2 block text-lg text-white">{Number(riskLimits.maxDailyCustomerSpendCount || 0)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminPurchasesActiveHoldsPerDay')}</span></div><div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">{t('adminDailyTransfers')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerTransferCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminOutboundCustomerTransfers')}</span></div><div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">{t('adminTransferMovements')}</span><strong className="mt-2 block text-lg text-white">{Number(riskLimits.maxDailyCustomerTransferCount || 0)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminOutboundTransfersPerDay')}</span></div></div></Section>}
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white">{t('adminCreditSectionsTitle')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CREDIT_SUBNAV_ITEMS.filter((item) => item.routeKey !== 'oxsteedCredit').map((item) => (
              <Link key={item.routeKey} to={adminRoute(item.routeKey).path} className="group flex items-start justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-4 transition hover:border-orange-500/40">
                <span>
                  <span className="block text-sm font-semibold text-white group-hover:text-orange-200">{t(item.labelKey)}</span>
                  {item.descriptionKey && <span className="mt-1 block text-xs leading-5 text-gray-500">{t(item.descriptionKey)}</span>}
                </span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-600 group-hover:text-orange-300" />
              </Link>
            ))}
          </div>
        </section>
      <div className="rounded-2xl border border-amber-500/20 bg-amber-950/15 p-4 text-xs leading-5 text-amber-200"><strong>{t('adminOperationalBoundary')}:</strong> {t('adminOperationalBoundaryDescription')}</div>
      </main>
    </>
  );
}
