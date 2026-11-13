import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { isValidTransferRecipientId } from '../../../../lib/transferReviewGuards';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  AdminActionDialog,
  Badge,
  CreditSubNav,
  Section,
  dateTime,
  dollarsToCents,
  money,
  requestStepupChallengeCode,
  useCreditDialog,
  useCreditPageState,
  DEFAULT_CURRENCY_OPTIONS,
} from './shared';

function QuoteDetail({ quote, customerDisplayName }) {
  const { t } = useTranslation('credit');
  if (!quote) return null;
  const rateText = quote.rateNumerator && quote.rateDenominator
    ? `${quote.rateNumerator} / ${quote.rateDenominator}`
    : t('adminCurrencyQuotes.unknownRate');
  return <article className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white">{t('adminCurrencyQuotes.quoteHeading', { id: quote.id })}</h3>
        <p className="mt-1 text-xs text-gray-500">{quote.sourceCurrencyCode} {t('adminCurrencyQuotes.to')} {quote.targetCurrencyCode}</p>
      </div>
      <Badge status={quote.status} />
    </div>
    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.sourceAmount')}</dt><dd className="mt-1 font-semibold text-gray-900 dark:text-white">{money(quote.sourceAmountMinorUnits, quote.sourceCurrencyCode)}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.targetAmount')}</dt><dd className="mt-1 font-semibold text-emerald-300">{money(quote.targetAmountMinorUnits, quote.targetCurrencyCode)}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.feeAmount')}</dt><dd className="mt-1 font-semibold text-gray-900 dark:text-white">{money(quote.feeAmountMinorUnits, quote.sourceCurrencyCode)}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.rate')}</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-700 dark:text-gray-300">{rateText}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.roundingMode')}</dt><dd className="mt-1 text-gray-700 dark:text-gray-300">{quote.roundingMode || t('adminCurrencyQuotes.unknownRate')}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.provider')}</dt><dd className="mt-1 break-all text-gray-700 dark:text-gray-300">{quote.provider || t('adminCurrencyQuotes.unknownRate')}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.providerReference')}</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-700 dark:text-gray-300">{quote.providerQuoteReference || t('adminCurrencyQuotes.unknownRate')}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.customer')}</dt><dd className="mt-1 break-all text-gray-700 dark:text-gray-300">{customerDisplayName ? `${customerDisplayName} · ${quote.customerId}` : (quote.customerId || t('adminCurrencyQuotes.unknownRate'))}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.expiresAt')}</dt><dd className="mt-1 text-gray-700 dark:text-gray-300">{quote.expiresAt ? dateTime(quote.expiresAt) : t('adminCurrencyQuotes.unknownRate')}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.consumedAt')}</dt><dd className="mt-1 text-gray-700 dark:text-gray-300">{quote.consumedAt ? dateTime(quote.consumedAt) : t('adminCurrencyQuotes.notConsumed')}</dd></div>
      <div><dt className="text-gray-600">{t('adminCurrencyQuotes.createdAt')}</dt><dd className="mt-1 text-gray-700 dark:text-gray-300">{quote.createdAt ? dateTime(quote.createdAt) : t('adminCurrencyQuotes.unknownRate')}</dd></div>
      <div className="sm:col-span-3"><dt className="text-gray-600">{t('adminCurrencyQuotes.reason')}</dt><dd className="mt-1 text-gray-700 dark:text-gray-300">{quote.reason || t('adminCurrencyQuotes.unknownRate')}</dd></div>
    </dl>
  </article>;
}

export default function OxsteedCreditCurrencyQuotesPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef } = useCreditPageState();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const [mode, setMode] = useState('live');
  const [customerId, setCustomerId] = useState('');
  const [sourceCurrency, setSourceCurrency] = useState('USD');
  const [targetCurrency, setTargetCurrency] = useState('EUR');
  const [sourceAmount, setSourceAmount] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [rateNumerator, setRateNumerator] = useState('');
  const [rateDenominator, setRateDenominator] = useState('');
  const [provider, setProvider] = useState('');
  const [providerQuoteReference, setProviderQuoteReference] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState(null);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [lookupId, setLookupId] = useState('');
  const [lookupQuote, setLookupQuote] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  // Domain 7 #11: resolve and show the customer display name next to the
  // id field before the confirm enables. The customer-role transfer
  // recipient lookup is not callable from an admin session, so this page
  // uses the admin-side lookup (GET /admin/super/oxsteed-credit/
  // customers/:customerId). Debounced like the transfer review lookup.
  const [recipient, setRecipient] = useState(null);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState('');
  const recipientLookupTimerRef = useRef(null);

  const scheduleCustomerLookup = (rawId) => {
    if (recipientLookupTimerRef.current) clearTimeout(recipientLookupTimerRef.current);
    const id = String(rawId || '').trim();
    setRecipient(null);
    setRecipientError('');
    if (!isValidTransferRecipientId(id)) {
      setRecipientLoading(false);
      return;
    }
    setRecipientLoading(true);
    recipientLookupTimerRef.current = setTimeout(async () => {
      try {
        const { data } = await adminApi.get(`/admin/super/oxsteed-credit/customers/${encodeURIComponent(id)}`);
        const found = data?.recipient || null;
        if (found && String(found.customerId) === id && found.displayName) {
          setRecipient(found);
        } else {
          setRecipientError(t('adminCurrencyQuotes.customerNotFound'));
        }
      } catch (err) {
        setRecipientError(safeCreditErrorMessage(err, t('adminCurrencyQuotes.customerNotFound')));
      } finally {
        setRecipientLoading(false);
      }
    }, 400);
  };

  useEffect(() => () => { if (recipientLookupTimerRef.current) clearTimeout(recipientLookupTimerRef.current); }, []);

  const recipientOk = recipient
    && String(recipient.customerId) === customerId.trim()
    && Boolean(recipient.displayName);
  const displayNameFor = (quote) => (recipient && quote?.customerId && String(recipient.customerId) === String(quote.customerId)
    ? recipient.displayName
    : null);

  useEffect(() => { setLoading(false); }, [setLoading]);

  const createQuote = async (event) => {
    event.preventDefault();
    if (!customerId.trim()) return setError(t('adminCurrencyQuotes.customerRequired'));
    if (!reason.trim()) return setError(t('adminCurrencyQuotes.reasonRequired'));
    // Domain 7 #11: no quote is queued for a bare id. The customer name
    // must have resolved for the exact id entered; a wrong UUID creates a
    // quote for the wrong customer.
    if (!recipientOk) return setError(t('adminCurrencyQuotes.customerRequiredResolved'));
    if (sourceCurrency === targetCurrency) return setError(t('adminCurrencyQuotes.currenciesDifferent'));
    const sourceAmountMinorUnits = dollarsToCents(sourceAmount, sourceCurrency);
    if (sourceAmountMinorUnits === null) return setError(t('adminCurrencyQuotes.sourceAmountInvalid'));
    let payload;
    if (mode === 'live') {
      payload = {
        useLiveRate: true,
        sourceCurrency,
        targetCurrency,
        sourceAmountCents: sourceAmountMinorUnits,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        customerId: customerId.trim(),
        reason: reason.trim(),
      };
    } else {
      const targetAmountMinorUnits = dollarsToCents(targetAmount, targetCurrency);
      if (targetAmountMinorUnits === null) return setError(t('adminCurrencyQuotes.targetAmountInvalid'));
      const feeAmountMinorUnits = feeAmount.trim() ? dollarsToCents(feeAmount, sourceCurrency) : 0;
      if (feeAmountMinorUnits === null) return setError(t('adminCurrencyQuotes.feeAmountInvalid'));
      if (!/^\d+$/.test(rateNumerator.trim()) || !/^\d+$/.test(rateDenominator.trim())
        || Number(rateNumerator) <= 0 || Number(rateDenominator) <= 0) return setError(t('adminCurrencyQuotes.rateInvalid'));
      if (!provider.trim() || !providerQuoteReference.trim()) return setError(t('adminCurrencyQuotes.providerRequired'));
      payload = {
        sourceCurrencyCode: sourceCurrency,
        targetCurrencyCode: targetCurrency,
        sourceAmountMinorUnits,
        targetAmountMinorUnits,
        feeAmountMinorUnits,
        rateNumerator: rateNumerator.trim(),
        rateDenominator: rateDenominator.trim(),
        roundingMode: 'half_up',
        provider: provider.trim(),
        providerQuoteReference: providerQuoteReference.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        customerId: customerId.trim(),
        reason: reason.trim(),
      };
    }
    // The maker confirm shows the concrete quote terms, not generic text:
    // the resolved customer name plus the amounts, currencies, and rate
    // (live mode resolves the market rate server-side, so the confirm says so).
    const confirmDescription = mode === 'live'
      ? t('adminCurrencyQuotes.confirmDescriptionLive', {
        customer: recipient.displayName,
        sourceAmount,
        sourceCurrency,
        targetCurrency,
      })
      : t('adminCurrencyQuotes.confirmDescriptionManual', {
        customer: recipient.displayName,
        sourceAmount,
        sourceCurrency,
        targetAmount,
        targetCurrency,
        rateNumerator: rateNumerator.trim(),
        rateDenominator: rateDenominator.trim(),
        feeAmount: feeAmount.trim() || '0.00',
        provider: provider.trim(),
        providerReference: providerQuoteReference.trim(),
      });
    const confirmed = await requestDialog({
      kind: 'confirm',
      title: t('adminCurrencyQuotes.confirmTitle'),
      description: confirmDescription,
    });
    if (!confirmed) return;
    setBusy(true); setNotice(''); setError('');
    // Quote creation funnels through the money-movement maker path, which
    // verifies a fresh 'pending_action_request' step-up challenge and then
    // queues the quote for a second admin decision. No quote exists until
    // that second admin approves it.
    const stepup = await requestStepupChallengeCode({
      requestDialog, setNotice, setError, t,
      actionType: 'pending_action_request',
      description: t('creditStepupConfirmDescription'),
    });
    if (!stepup) { setBusy(false); return; }
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/currency-quotes', { ...payload, ...stepup }, {
        headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-currency-quote', payload) },
      });
      idempotencyKeysRef.current.clear('credit-currency-quote', payload);
      const pendingAction = response.data?.pendingAction;
      const quote = response.data?.quote;
      if (pendingAction) {
        setPendingReceipt(pendingAction);
        setCreatedQuote(null);
        setNotice(t('adminCurrencyQuotes.queued', { id: pendingAction.id || '' }));
      } else if (quote) {
        setCreatedQuote(quote);
        setPendingReceipt(null);
        setNotice(t('adminCurrencyQuotes.createdWithId', { id: quote.id }));
      } else {
        setPendingReceipt(null);
        setNotice(t('adminCurrencyQuotes.queuedNoId'));
      }
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCurrencyQuotes.failed')));
    } finally { setBusy(false); }
  };

  const runLookupQuote = async (event) => {
    event.preventDefault();
    const normalizedId = lookupId.trim();
    if (!normalizedId) return setError(t('adminCurrencyQuotes.lookupIdRequired'));
    setLookingUp(true); setNotice(''); setError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/currency-quotes/${encodeURIComponent(normalizedId)}`);
      setLookupQuote(response.data?.quote || null);
      if (!response.data?.quote) setError(t('adminCurrencyQuotes.lookupFailed'));
    } catch (err) {
      setLookupQuote(null);
      setError(safeCreditErrorMessage(err, t('adminCurrencyQuotes.lookupFailed')));
    } finally { setLookingUp(false); }
  };

  return (
    <>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
        <header className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white sm:text-3xl">{t('adminCurrencyQuotes.title')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{t('adminCurrencyQuotes.description')}</p>
          </div>
        </header>
        {error && <div role="alert" aria-live="assertive" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
        {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
        <Section eyebrow={t('adminCurrencyQuotes.createTitle')} title={t('adminCurrencyQuotes.createTitle')} detail={t('adminCurrencyQuotes.description')}>
          <form onSubmit={createQuote} className="mt-5 grid gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 p-4 sm:grid-cols-2">
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="button" onClick={() => setMode('live')} aria-pressed={mode === 'live'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === 'live' ? 'bg-sky-600 text-white' : 'border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}>{t('adminCurrencyQuotes.modeLive')}</button>
              <button type="button" onClick={() => setMode('manual')} aria-pressed={mode === 'manual'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === 'manual' ? 'bg-sky-600 text-white' : 'border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}>{t('adminCurrencyQuotes.modeManual')}</button>
            </div>
            <p className="text-xs leading-5 text-gray-500 sm:col-span-2">{mode === 'live' ? t('adminCurrencyQuotes.useLiveRateNote') : t('adminCurrencyQuotes.manualRateNote')}</p>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.customer')}</span>
              <input required value={customerId} onChange={(event) => { setCustomerId(event.target.value); scheduleCustomerLookup(event.target.value); }} placeholder={t('adminCurrencyQuotes.customerPlaceholder')} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
              {recipientLoading && <span className="mt-1 block text-xs text-gray-500">{t('adminCurrencyQuotes.customerLookupLoading')}</span>}
              {recipientError && <span role="alert" className="mt-1 block text-xs font-semibold text-red-300">{recipientError}</span>}
              {recipientOk && <span className="mt-1 block text-xs font-semibold text-emerald-300">{t('adminCurrencyQuotes.customerResolved', { name: recipient.displayName })}</span>}
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.reason')}</span>
              <input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('adminCurrencyQuotes.reasonPlaceholder')} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.sourceCurrency')}</span>
              <select value={sourceCurrency} onChange={(event) => setSourceCurrency(event.target.value)} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-orange-400">
                {DEFAULT_CURRENCY_OPTIONS.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.targetCurrency')}</span>
              <select value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-orange-400">
                {DEFAULT_CURRENCY_OPTIONS.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.sourceAmount')}</span>
              <input required inputMode="decimal" value={sourceAmount} onChange={(event) => setSourceAmount(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
            </label>
            {mode === 'manual' && <>
              <label>
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.targetAmount')}</span>
                <input required inputMode="decimal" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.feeAmount')}</span>
                <input inputMode="decimal" value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.rateNumerator')}</span>
                <input required inputMode="numeric" value={rateNumerator} onChange={(event) => setRateNumerator(event.target.value)} placeholder="1" className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.rateDenominator')}</span>
                <input required inputMode="numeric" value={rateDenominator} onChange={(event) => setRateDenominator(event.target.value)} placeholder="1" className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.roundingMode')}</span>
                <input readOnly value={t('adminCurrencyQuotes.roundingHalfUp')} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-950/70 px-3 py-3 text-sm font-semibold text-sky-300 outline-none" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.provider')}</span>
                <input required maxLength={80} value={provider} onChange={(event) => setProvider(event.target.value)} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-orange-400" />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.providerReference')}</span>
                <input required maxLength={160} value={providerQuoteReference} onChange={(event) => setProviderQuoteReference(event.target.value)} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-orange-400" />
              </label>
            </>}
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.expiresAt')}</span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-orange-400" />
            </label>
            <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
              <button disabled={busy || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> {t('adminCurrencyQuotes.createButton')}</button>
            </div>
          </form>
          {pendingReceipt && <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-950/20 px-4 py-3 text-xs leading-5 text-sky-300">{t('adminCurrencyQuotes.pendingReceipt', { id: pendingReceipt.id || '' })} {t('adminCurrencyQuotes.pendingReceiptHint')}</div>}
          {createdQuote && <div className="mt-4"><QuoteDetail quote={createdQuote} customerDisplayName={displayNameFor(createdQuote)} /></div>}
        </Section>
        <Section eyebrow={t('adminCurrencyQuotes.lookupTitle')} title={t('adminCurrencyQuotes.lookupTitle')} detail={t('adminCurrencyQuotes.lookupDetail')}>
          <form onSubmit={runLookupQuote} className="mt-5 flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrencyQuotes.quoteId')}</span>
              <input required value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder={t('adminCurrencyQuotes.quoteIdPlaceholder')} className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
            </label>
            <button disabled={lookingUp || busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Search className="h-4 w-4" /> {t('adminCurrencyQuotes.lookupButton')}</button>
          </form>
          <p className="mt-3 text-xs leading-5 text-gray-500">{t('adminCurrencyQuotes.noListNote')}</p>
          {lookupQuote && <div className="mt-4"><QuoteDetail quote={lookupQuote} customerDisplayName={displayNameFor(lookupQuote)} /></div>}
        </Section>
      </main>
    </>
  );
}
