import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  createOxsteedCreditTopup,
  getOxsteedCreditTopup,
  issueOxsteedCreditTopupStepup,
  retryOxsteedCreditTopup,
} from '../../api/oxsteedCredit';
import { createBusinessCreditTopup, getBusinessCreditTopup, retryBusinessCreditTopup } from '../../api/businesses';
import { createStableIdempotencyKeyStore } from '../../lib/idempotency';
import { formatCreditMinorUnits, parseCreditMajorAmount } from '../../lib/creditCurrency';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../lib/creditErrors';

// Review P2-549: add money to OxSteed Credit by card. Mirrors the restaurant
// top-up flow: amount -> optional step-up code -> card -> poll until the
// webhook credits the ledger (status 'completed').
const QUICK_AMOUNTS = [25, 50, 100, 250];
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40;
const MIN_CENTS = 100;

const stripePromise = (() => {
  try {
    const key = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  } catch {
    return null;
  }
})();

function errorCode(error) {
  return error?.response?.data?.code || null;
}

function CardStep({ clientSecret, amountCents, currency, onConfirmed }) {
  const { t } = useTranslation('credit');
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setCardError('');
    try {
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (error) {
        setCardError(error.message || t('restaurantTopups.cardFailed'));
      } else if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) {
        onConfirmed();
      } else {
        setCardError(t('restaurantTopups.cardFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="credit-form" onSubmit={submit} data-track-private>
      <label>
        <span>{t('restaurantTopups.cardDetails')}</span>
        <div className="ox-credit-card-element" style={{ direction: 'ltr' }}>
          <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
        </div>
      </label>
      {cardError && <p role="alert" className="credit-field-error">{cardError}</p>}
      <button type="submit" className="credit-primary" disabled={submitting || !stripe} data-track-private>
        {submitting ? t('restaurantTopups.processing') : t('restaurantTopups.pay', { amount: formatCreditMinorUnits(amountCents, currency) })}
      </button>
    </form>
  );
}

// Group 13 Slice 4b (657): when businessFunding ({ businessId, members }) is passed, the panel
// funds a named member's Credit from the business payment method: the
// owner/manager pays with their own card and the member is credited.
// The self-service flow (no businessFunding) is unchanged.
// initialTopupId deep-links to one top-up record (from the Credit page's
// pending top-ups list): the panel loads that record through the existing
// GET /topups/:id read path and shows it read-only instead of the amount
// form. A record the caller cannot read (another customer's top-up)
// falls through to the amount form with a notice, never an error page.
export default function OxsteedCreditTopupPanel({ currency = 'USD', disabled = false, onCredited, businessFunding = null, initialTopupId = null }) {
  const { t } = useTranslation('credit');
  const [step, setStep] = useState(initialTopupId ? 'viewing' : 'amount');
  const [viewedTopup, setViewedTopup] = useState(null);
  const [viewedTopupError, setViewedTopupError] = useState(false);
  const [amount, setAmount] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [code, setCode] = useState('');
  const [intent, setIntent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState(null);
  const keysRef = useRef(createStableIdempotencyKeyStore());
  const timerRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  function dateTime(value) {
    return formatCreditDateTime(value, t('noDate'), t.lng);
  }

  function topupStatusLabel(status) {
    return {
      pending: t('walletTopup.status.pending'),
      completed: t('walletTopup.status.completed'),
      failed: t('walletTopup.status.failed'),
      requires_attention: t('walletTopup.status.requires_attention'),
    }[status] || t('walletTopup.status.pending');
  }

  // Group 13 Slice 4f (679): what each top-up status means for this
  // record — when the value lands and what happens while it is pending.
  // Derived from the status alone; the record's own facts (amount, expiry)
  // sit beside it.
  function topupStatusExplanation(status) {
    return {
      pending: t('walletTopup.statusExplanation.pending'),
      completed: t('walletTopup.statusExplanation.completed'),
      failed: t('walletTopup.statusExplanation.failed'),
      requires_attention: t('walletTopup.statusExplanation.requires_attention'),
    }[status] || t('walletTopup.statusExplanation.pending');
  }

  // Load one top-up record into the read-only view (657 deep link, 680
  // retry/original links). A record the caller cannot read falls through
  // to the amount form with a notice, never an error page.
  const loadRecord = useCallback(async (recordId) => {
    try {
      const record = businessFunding
        ? (await getBusinessCreditTopup(businessFunding.businessId, recordId))?.topup || null
        : (await getOxsteedCreditTopup(recordId))?.topup || null;
      if (record) {
        setViewedTopup(record);
        setViewedTopupError(false);
        setStep('viewing');
        return true;
      }
      setViewedTopupError(true);
      setStep('amount');
      return false;
    } catch {
      setViewedTopupError(true);
      setStep('amount');
      return false;
    }
  }, [businessFunding]);

  // Deep-linked record view (657): load the named top-up once. The fetch
  // reuses the same owner-scoped read the panel already polls after a
  // creation, so a record belonging to someone else is simply not found.
  useEffect(() => {
    if (!initialTopupId) return;
    loadRecord(initialTopupId);
  }, [initialTopupId, loadRecord]);

  const clearViewing = () => {
    stopPolling();
    setViewedTopup(null);
    setViewedTopupError(false);
    setStep('amount');
  };

  const reset = () => {
    stopPolling();
    setViewedTopup(null);
    setViewedTopupError(false);
    setStep('amount');
    setIntent(null);
    setChallengeId(null);
    setCode('');
  };

  const poll = useCallback((topupId, cents) => {
    stopPolling();
    setStep('processing');
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      let status = null;
      try {
        // G-22: a business-funded top-up is read as the funder, not the recipient.
        status = businessFunding
          ? (await getBusinessCreditTopup(businessFunding.businessId, topupId))?.topup?.status || null
          : (await getOxsteedCreditTopup(topupId))?.topup?.status || null;
      } catch {
        status = null;
      }
      if (status === 'completed') {
        keysRef.current.clear(businessFunding ? 'business-credit-topup' : 'credit-topup', { amountCents: cents, currency });
        toast.success(t(businessFunding ? 'walletTopup.businessCredited' : 'walletTopup.credited'));
        setMessage({ tone: 'success', text: t(businessFunding ? 'walletTopup.businessCredited' : 'walletTopup.credited') });
        reset();
        onCredited?.();
        return;
      }
      if (status === 'failed' || status === 'expired') {
        setMessage({ tone: 'error', text: t('restaurantTopups.failed') });
        reset();
        return;
      }
      if (attempts >= POLL_MAX_ATTEMPTS) {
        setMessage({ tone: 'info', text: t('restaurantTopups.timeout') });
        reset();
        return;
      }
      timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, onCredited, stopPolling, t, businessFunding]);

  const begin = async (cents, stepup) => {
    setSubmitting(true);
    try {
      const key = keysRef.current.get(businessFunding ? 'business-credit-topup' : 'credit-topup', { amountCents: cents, currency });
      const payload = { amountCents: cents, currencyCode: currency, ...(stepup || {}) };
      // G-22: the business-funded create names the member and records the reason.
      const result = businessFunding
        ? await createBusinessCreditTopup(businessFunding.businessId, { ...payload, memberId, reason: reason.trim() }, key)
        : await createOxsteedCreditTopup(payload, key);
      const topupId = result?.topup?.id;
      if (!topupId) throw new Error('topup-missing');
      setIntent({ topupId, clientSecret: result.clientSecret || null });
      if (result.replayed || !result.clientSecret) poll(topupId, cents);
      else setStep('card');
    } catch (error) {
      if (errorCode(error) === 'credit_stepup_challenge_required' && !stepup) {
        try {
          const issued = await issueOxsteedCreditTopupStepup({ amountCents: cents, currencyCode: currency });
          setChallengeId(issued?.challenge?.id || null);
          setStep('stepup');
          toast.success(t('restaurantTopups.challengeSent'));
        } catch (issueError) {
          toast.error(safeCreditErrorMessage(issueError, t('restaurantTopups.challengeFailed')));
        }
      } else {
        toast.error(safeCreditErrorMessage(error, t('restaurantTopups.createFailed')));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitAmount = (event) => {
    event.preventDefault();
    const cents = parseCreditMajorAmount(amount, currency) || 0;
    if (cents < MIN_CENTS) {
      setMessage({ tone: 'error', text: t('walletTopup.invalidAmount', { min: formatCreditMinorUnits(MIN_CENTS, currency) }) });
      return;
    }
    if (businessFunding) {
      if (!memberId) { setMessage({ tone: 'error', text: t('walletTopup.businessMemberRequired') }); return; }
      if (!reason.trim()) { setMessage({ tone: 'error', text: t('walletTopup.businessReasonRequired') }); return; }
    }
    setMessage(null);
    setAmountCents(cents);
    begin(cents, null);
  };

  const submitStepup = (event) => {
    event.preventDefault();
    if (!challengeId || !code.trim()) {
      toast.error(t('restaurantTopups.invalidCode'));
      return;
    }
    begin(amountCents, { stepupChallengeId: challengeId, stepupCode: code.trim() });
  };

  // Group 13 Slice 4f (680): retry the failed record being viewed. The
  // key is fresh per attempt (a random UUID, never the creation key); the
  // server links the new attempt to this record and replays an existing
  // retry instead of starting a second one. On a fresh attempt the card
  // step collects payment exactly like a new top-up; a replayed attempt
  // just polls until the webhook credits it.
  const retryViewedTopup = async () => {
    if (!viewedTopup || viewedTopup.status !== 'failed' || retrying) return;
    setRetrying(true);
    try {
      const key = globalThis.crypto?.randomUUID
        ? `credit-topup-retry:${globalThis.crypto.randomUUID()}`
        : `credit-topup-retry:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const result = businessFunding
        ? await retryBusinessCreditTopup(businessFunding.businessId, viewedTopup.id, key)
        : await retryOxsteedCreditTopup(viewedTopup.id, key);
      const retryId = result?.topup?.id;
      if (!retryId) throw new Error('topup-retry-missing');
      const cents = Number(result.topup.amountCents) || 0;
      setAmountCents(cents);
      setViewedTopup(result.topup);
      if (result.replayed || !result.clientSecret) {
        if (result.replayed) setMessage({ tone: 'info', text: t('walletTopup.retryExists') });
        poll(retryId, cents);
      } else {
        setIntent({ topupId: retryId, clientSecret: result.clientSecret });
        setStep('card');
      }
    } catch (error) {
      toast.error(safeCreditErrorMessage(error, t('restaurantTopups.createFailed')));
    } finally {
      setRetrying(false);
    }
  };

  const viewingTopup = step === 'viewing' ? viewedTopup : null;
  if (!stripePromise) return null;

  return (
    <section className="ox-credit-panel" aria-labelledby="wallet-topup-heading" data-testid="wallet-topup">
      <div className="ox-credit-panel-heading">
        <div>
          <h2 id="wallet-topup-heading">{viewingTopup ? t('walletTopup.viewingTitle') : businessFunding ? t('walletTopup.businessTitle') : t('walletTopup.title')}</h2>
          <p className="ox-credit-panel-copy">{viewingTopup ? t('walletTopup.viewingCopy') : businessFunding ? t('walletTopup.businessIntro') : t('walletTopup.intro')}</p>
        </div>
      </div>
      {viewedTopupError && <p role="alert" className="credit-field-error">{t('walletTopup.viewingNotFound')}</p>}
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className="credit-modal-subtitle">{message.text}</p>}
      {step === 'viewing' && !viewingTopup && <p role="status" className="credit-modal-subtitle">{t('walletTopup.viewingLoading')}</p>}
      {viewingTopup && (
        <div>
          <div className="ox-credit-hold-list">
            <article>
              <div><strong>{formatCreditMinorUnits(viewingTopup.amountCents, viewingTopup.currencyCode || currency)}</strong><span>{topupStatusLabel(viewingTopup.status)}</span><small>{t('requestedAt', { date: dateTime(viewingTopup.createdAt) })}{viewingTopup.expiresAt ? ` · ${t('expiresAt', { date: dateTime(viewingTopup.expiresAt) })}` : ''}</small></div>
              <div className="ox-credit-hold-end"><span className={`ox-credit-hold-status ${viewingTopup.status}`}>{topupStatusLabel(viewingTopup.status)}</span></div>
            </article>
          </div>
          <p className="ox-credit-panel-copy">{topupStatusExplanation(viewingTopup.status)}</p>
          {viewingTopup.fundedByBusinessId && (
            <>
              <p className="ox-credit-panel-copy">{t('walletTopup.fundedByBusiness', { business: viewingTopup.fundedByBusinessName || viewingTopup.fundedByBusinessId })}</p>
              {viewingTopup.fundedByName && <p className="ox-credit-panel-copy">{t('walletTopup.fundedByPerson', { name: viewingTopup.fundedByName })}</p>}
              {viewingTopup.fundingReason && <p className="ox-credit-panel-copy">{t('walletTopup.fundingReason', { reason: viewingTopup.fundingReason })}</p>}
              {viewingTopup.fundingAuthorizedAt && <p className="ox-credit-panel-copy">{t('walletTopup.fundingAuthorizedAt', { date: dateTime(viewingTopup.fundingAuthorizedAt) })}</p>}
              {viewingTopup.fundingState && <p className="ox-credit-panel-copy">{t(`walletTopup.fundingState_${viewingTopup.fundingState}`)}</p>}
            </>
          )}
          {viewingTopup.retriedFromTopupId && (
            <p className="ox-credit-panel-copy">{t('walletTopup.retriedFrom')} <button type="button" className="ox-credit-detail-link" onClick={() => loadRecord(viewingTopup.retriedFromTopupId)} data-track-private>{t('walletTopup.viewOriginal')}</button></p>
          )}
          {viewingTopup.status === 'failed' && (
            viewingTopup.retryTopupId ? (
              <p className="ox-credit-panel-copy">{t('walletTopup.retryExists')} <button type="button" className="ox-credit-detail-link" onClick={() => loadRecord(viewingTopup.retryTopupId)} data-track-private>{t('walletTopup.viewRetry')}</button></p>
            ) : (
              <button type="button" className="credit-primary" onClick={retryViewedTopup} disabled={retrying} data-track-private>
                {retrying ? t('walletTopup.retryingTopup') : t('walletTopup.retryTopup')}
              </button>
            )
          )}
          <button type="button" className="credit-secondary" onClick={clearViewing} data-track-private>{t('walletTopup.viewNewTopup')}</button>
        </div>
      )}
      {step === 'amount' && (
        <form className="credit-form" onSubmit={submitAmount} data-track-private>
          {businessFunding && <>
            <label>
              <span>{t('walletTopup.businessMemberLabel')}</span>
              <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">{t('walletTopup.businessMemberPlaceholder')}</option>
                {(businessFunding.members || []).filter((m) => m.status === 'active' && m.user_id).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.member_email || m.user_id} ({m.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('walletTopup.businessReasonLabel')}</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('walletTopup.businessReasonPlaceholder')} />
            </label>
          </>}
          <label>
            <span>{t('restaurantTopups.amount')}</span>
            <div className="credit-money-input">
              <span>{currency}</span>
              <input inputMode="decimal" value={amount} disabled={disabled} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </label>
          <div className="credit-quick-amounts" role="group" aria-label={t('restaurantTopups.quickAmounts')}>
            {QUICK_AMOUNTS.map((quick) => (
              <button key={quick} type="button" className="credit-chip" disabled={disabled} onClick={() => setAmount(String(quick))} data-track-private>
                {formatCreditMinorUnits(quick * 100, currency)}
              </button>
            ))}
          </div>
          <p className="ox-credit-panel-copy">{t('walletTopup.pendingVsPosted')}</p>
          <button type="submit" className="credit-primary" disabled={disabled || submitting} data-track-private>
            {submitting ? t('restaurantTopups.processing') : t('restaurantTopups.continue')}
          </button>
        </form>
      )}
      {step === 'stepup' && (
        <form className="credit-form" onSubmit={submitStepup} data-track-private>
          <p className="credit-modal-subtitle"><strong>{t('restaurantTopups.stepupTitle')}</strong><br />{t('restaurantTopups.stepupCopy')}</p>
          <label>
            <span>{t('restaurantTopups.stepupCode')}</span>
            <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder={t('restaurantTopups.stepupCodePlaceholder')} />
          </label>
          <button type="submit" className="credit-primary" disabled={submitting} data-track-private>{t('restaurantTopups.verifyAndContinue')}</button>
          <button type="button" className="credit-secondary" onClick={reset} data-track-private>{t('restaurantTopups.close')}</button>
        </form>
      )}
      {step === 'card' && intent?.clientSecret && (
        <Elements stripe={stripePromise}>
          <CardStep clientSecret={intent.clientSecret} amountCents={amountCents} currency={currency} onConfirmed={() => poll(intent.topupId, amountCents)} />
        </Elements>
      )}
      {step === 'processing' && <p role="status" className="credit-modal-subtitle">{t('restaurantTopups.confirming')}</p>}
    </section>
  );
}
