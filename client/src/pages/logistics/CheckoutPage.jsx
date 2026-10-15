import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import LogisticsStatusPill from '../../components/logistics/LogisticsStatusPill';
import QuoteAcceptanceGate from '../../components/logistics/QuoteAcceptanceGate';
import PaymentStatusPanel from '../../components/logistics/PaymentStatusPanel';
import { createPaymentAttempt, getCheckoutContext } from '../../api/logistics';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';
import '../../styles/logistics/LogisticsCheckout.css';

/**
 * CheckoutPage - full-page buyer checkout for one logistics installment (Phase 3).
 *
 * URL: /logistics/checkout?purchase_order_id=123&installment=deposit&return=/logistics/orders/123
 *   or ?participant_id=456 for pooled-campaign participations.
 *
 * Flow:
 *   1. Load checkout context (order summary, versioned quote, payment
 *      schedule, cancellation terms, Credit rail state) via the LIVE
 *      GET /logistics/finance/checkout-context.
 *   2. If quote.pending_version is non-null, the QuoteAcceptanceGate blocks
 *      payment entirely (never pay against a superseded quote). Acceptance
 *      posts to the LIVE POST /logistics/finance/quotes/:id/accept.
 *   3. Buyer picks exactly ONE method per installment: Stripe card or
 *      OxSteed Credit. No mixed funding, no saved-card auto-charge.
 *   4. Dedicated confirmation step: checkbox + explicit confirm button.
 *   5. Payment attempt via the LIVE POST /logistics/checkout/attempt with a
 *      per-session idempotency UUID in the body. The server resolves the
 *      accepted quote itself and verifies amount_cents (never trusts ours).
 *      Stripe: confirmCardPayment with the server-issued client_secret.
 *      Credit: attempt recorded as pending_execution; the Credit workstream
 *      settles it. 503 + code 'logistics_payments_disabled' while the
 *      LOGISTICS_PAYMENTS_ENABLED gate is off.
 *   6. PaymentStatusPanel distinguishes "confirmation received" from
 *      "funds settled" — settled shows only for status 'succeeded', which
 *      the server sets exclusively via the signed webhook / committed
 *      Credit settlement.
 *
 * Money: all amounts are integer minor units (USD cents) from the server.
 * The client never computes money amounts; it only displays server values
 * and does integer subtraction for the Credit shortfall.
 */

function sanitizeReturnPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Only same-origin relative paths; reject protocol-relative and absolute URLs.
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  return trimmed;
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function CardDetailsField({ disabled }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  return (
    <div className="lx-form-group lx-mt-6">
      <label className="lx-label" htmlFor="lx-checkout-card">
        {tx('logistics.checkout.method.cardDetails', 'Card details')}
      </label>
      <div
        id="lx-checkout-card"
        className="lx-input"
        style={{ paddingBlock: 'var(--space-3)', opacity: disabled ? 0.6 : 1 }}
      >
        <CardElement options={{ style: { base: { fontSize: '16px' } }, disabled }} />
      </div>
      <p className="lx-t-xs lx-t-faint lx-mt-6" style={{ lineHeight: 1.6 }}>
        {tx(
          'logistics.checkout.method.cardNote',
          'Card details are handled by Stripe. OxSteed never sees or stores your card number.'
        )}
      </p>
    </div>
  );
}

function CheckoutFlow({ context, returnPath, returnLabel, onQuoteAccepted }) {
  const { t, i18n } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });

  const { subject, quote, credit } = context;
  const schedule = quote.schedule || [];
  const money = (minor) => formatCreditMinorUnits(minor ?? 0, 'USD');

  // Which installment is being paid: explicit param wins, else first unpaid.
  const [searchParams] = useSearchParams();
  const requestedInstallment = searchParams.get('installment');
  const initialInstallment = useMemo(() => {
    const valid = ['deposit', 'final'];
    if (valid.includes(requestedInstallment)) {
      const row = schedule.find((s) => s.installment === requestedInstallment);
      if (row && row.status === 'unpaid') return requestedInstallment;
    }
    const firstUnpaid = schedule.find((s) => s.status === 'unpaid');
    return firstUnpaid ? firstUnpaid.installment : 'deposit';
  }, [requestedInstallment, schedule]);
  const [installment, setInstallment] = useState(initialInstallment);
  const activeRow = schedule.find((s) => s.installment === installment) || schedule[0] || {};
  const amountCents = Number(activeRow.amount_cents || 0);

  const [method, setMethod] = useState(null); // 'stripe' | 'credit'
  const [step, setStep] = useState('method'); // method | confirm | status
  const [confirmed, setConfirmed] = useState(false);
  const [mustCheckError, setMustCheckError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [attempt, setAttempt] = useState(null);

  const stripe = useStripe();
  const elements = useElements();

  // One idempotency key per checkout session; a NEW key is minted for every
  // retry so a retry can never double-charge the same confirmation.
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  const creditRailOn = credit?.rail_enabled === true;
  const creditEligible = credit?.eligible !== false;
  // balance_cents is null when the server cannot report a balance (no
  // per-user balance probe exists yet); null means "unknown", never zero.
  // The client only warns/blocks on a KNOWN shortfall; the server enforces
  // the balance at execution time either way.
  const balanceKnown = credit?.balance_cents !== null && credit?.balance_cents !== undefined;
  const balanceCents = balanceKnown ? Number(credit.balance_cents) : 0;
  const creditBlocked = !creditRailOn || !creditEligible;
  const shortfallCents = balanceKnown ? Math.max(0, amountCents - balanceCents) : 0; // integer math only

  const stripeKeyConfigured = Boolean(import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY);

  const installmentLabel = (name) => (name === 'final'
    ? tx('logistics.checkout.schedule.final', 'Final balance')
    : tx('logistics.checkout.schedule.deposit', 'Deposit'));
  const methodLabel = (m) => (m === 'credit'
    ? tx('logistics.checkout.method.credit', 'OxSteed Credit')
    : tx('logistics.checkout.method.stripe', 'Card via Stripe'));

  const startConfirm = () => {
    if (!method) return;
    setMustCheckError(false);
    setConfirmed(false);
    setStep('confirm');
  };

  const retryWithNewKey = () => {
    idempotencyKeyRef.current = newIdempotencyKey();
    setAttempt(null);
    setSubmitError(null);
    setConfirmed(false);
    setStep('method');
  };

  const submitPayment = async () => {
    if (submitting) return;
    if (!confirmed) {
      setMustCheckError(true);
      return;
    }
    if (method === 'credit' && shortfallCents > 0) return; // fail closed client-side; server enforces too
    setMustCheckError(false);
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Live server contract: POST /logistics/checkout/attempt with the
      // idempotency UUID in the body. Server resolves the accepted quote
      // itself and verifies amount_cents against it (never trusts ours).
      const payload = {
        subject_type: subject.kind,
        purchase_order_id: subject.kind === 'purchase_order' ? subject.id : undefined,
        participant_id: subject.kind === 'pooled_participant' ? subject.id : undefined,
        installment,
        method,
        amount_cents: amountCents,
      };
      const res = await createPaymentAttempt(payload, idempotencyKeyRef.current);
      const created = res?.data?.attempt || res?.attempt;
      if (!created?.id) throw new Error(tx('logistics.checkout.errors.generic', 'Something went wrong. Please try again.'));

      if (res?.idempotent_replay) {
        // Same key raced us: converge on the existing attempt and poll it.
        setAttempt(created);
        setStep('status');
        return;
      }

      if (method === 'stripe') {
        const clientSecret = res?.data?.client_secret;
        if (!clientSecret) throw new Error(tx('logistics.checkout.errors.generic', 'Something went wrong. Please try again.'));
        if (!stripeKeyConfigured || !stripe || !elements) {
          throw new Error(tx(
            'logistics.checkout.method.stripeUnavailable',
            'Card payments are not available right now. Please try again later or use OxSteed Credit.'
          ));
        }
        const cardEl = elements.getElement(CardElement);
        const { error: stripeError } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card: cardEl },
        });
        if (stripeError) {
          // Card declined / 3DS failed: the attempt stays server-side and
          // will poll to failed/canceled; offer a retry with a new key.
          // (The public attempt view never exposes processor failure
          // detail, so we show our generic failed copy.)
          setAttempt({ ...created, status: 'failed' });
          setStep('status');
          return;
        }
        // Card confirmed by Stripe: funds are NOT settled yet. The attempt
        // moves to status and polls until the server confirms via webhook.
        setAttempt({ ...created, status: 'processing' });
        setStep('status');
        return;
      }

      // Credit: server records the attempt as pending_execution; the Credit
      // workstream settles it. Poll until settled.
      setAttempt({ ...created, status: created.status || 'processing' });
      setStep('status');
    } catch (err) {
      const code = err.response?.data?.code;
      const status = err.response?.status;
      if (code === 'logistics_payments_disabled' || status === 503) {
        setSubmitError(tx(
          'logistics.checkout.errors.paymentsDisabled',
          'Online payments are not enabled yet. Please try again later.'
        ));
      } else if (code === 'stripe_not_configured') {
        setSubmitError(tx(
          'logistics.checkout.method.stripeUnavailable',
          'Card payments are not available right now. Please try again later or use OxSteed Credit.'
        ));
      } else if (code === 'quote_not_accepted' || code === 'quote_expired' || code === 'quote_missing') {
        // The quote moved under us: refetch so the gate/expired panel
        // reflects the current server state.
        onQuoteAccepted(null, true);
        setSubmitError(tx('logistics.checkout.errors.quoteChanged', 'The quote changed while you were checking out. Review the new version before paying.'));
      } else if (status === 409) {
        setSubmitError(tx('logistics.checkout.errors.duplicate', 'This payment was already submitted. Check the payment status instead of paying again.'));
      } else {
        setSubmitError(
          err.response?.data?.error
          || err.response?.data?.message
          || tx('logistics.checkout.errors.generic', 'Something went wrong. Please try again.')
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const dateOf = (value) => (value ? new Date(value).toLocaleDateString(i18n.language) : '—');

  const stepIndex = step === 'method' ? 0 : step === 'confirm' ? 1 : 2;
  const stepLabels = [
    tx('logistics.checkout.sections.method', 'Payment method'),
    tx('logistics.checkout.sections.confirm', 'Confirm payment'),
    tx('logistics.checkout.sections.status', 'Payment status'),
  ];

  return (
    <div className="lx-checkout-grid">
      <div>
        {/* Stepper */}
        <div className="lx-stepper" role="list" aria-label={tx('logistics.checkout.title', 'Secure checkout')}>
          {stepLabels.map((label, idx) => (
            <div
              key={label}
              role="listitem"
              aria-current={idx === stepIndex ? 'step' : undefined}
              className={`lx-step${idx < stepIndex ? ' lx-step--done' : ''}${idx === stepIndex ? ' lx-step--current' : ''}`}
              title={label}
            />
          ))}
        </div>

        {step === 'method' && (
          <section className="lx-card" aria-labelledby="lx-method-title">
            <h2 id="lx-method-title" className="lx-card-title lx-mb-4">
              {tx('logistics.checkout.method.choose', 'Choose how to pay this installment')}
            </h2>
            <p className="lx-t-small lx-t-faint lx-mb-6" style={{ lineHeight: 1.7 }}>
              {tx(
                'logistics.checkout.method.oneMethodNote',
                'Each installment is paid with exactly one method. No mixed funding, and nothing is charged without your explicit confirmation.'
              )}
            </p>

            {/* Installment picker when both are payable */}
            {schedule.length > 1 && (
              <div className="lx-form-group">
                <label className="lx-label" htmlFor="lx-checkout-installment">
                  {tx('logistics.checkout.status.installment', 'Installment')}
                </label>
                <select
                  id="lx-checkout-installment"
                  className="lx-select"
                  value={installment}
                  onChange={(e) => { setInstallment(e.target.value); setMethod(null); }}
                >
                  {schedule.map((row) => (
                    <option key={row.installment} value={row.installment} disabled={row.status !== 'unpaid'}>
                      {installmentLabel(row.installment)} — {money(row.amount_cents)}
                      {row.status !== 'unpaid' ? ` (${tx('logistics.checkout.schedule.settled', 'Settled')})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="lx-method-list" role="radiogroup" aria-label={tx('logistics.checkout.sections.method', 'Payment method')}>
              {/* Stripe card */}
              <label className={`lx-method-option${method === 'stripe' ? ' lx-method-option--selected' : ''}`}>
                <input
                  type="radio"
                  name="lx-checkout-method"
                  value="stripe"
                  checked={method === 'stripe'}
                  onChange={() => setMethod('stripe')}
                />
                <span className="lx-method-body">
                  <span className="lx-method-title">{tx('logistics.checkout.method.stripe', 'Card via Stripe')}</span>
                  <span className="lx-method-desc">
                    {tx(
                      'logistics.checkout.method.stripeDesc',
                      'Pay with a debit or credit card. You enter card details each time; nothing is saved or auto-charged.'
                    )}
                  </span>
                </span>
              </label>

              {/* OxSteed Credit */}
              <label className={`lx-method-option${method === 'credit' ? ' lx-method-option--selected' : ''}${creditBlocked ? ' lx-method-option--disabled' : ''}`}>
                <input
                  type="radio"
                  name="lx-checkout-method"
                  value="credit"
                  checked={method === 'credit'}
                  disabled={creditBlocked}
                  onChange={() => setMethod('credit')}
                  aria-describedby="lx-credit-method-note"
                />
                <span className="lx-method-body">
                  <span className="lx-method-title">
                    {tx('logistics.checkout.method.credit', 'OxSteed Credit')}
                  </span>
                  <span className="lx-method-desc">
                    {tx('logistics.checkout.method.creditDesc', 'Pay from your OxSteed Credit balance.')}
                  </span>
                  <span id="lx-credit-method-note">
                    {!creditRailOn && (
                      <span className="lx-method-desc" role="note">
                        <strong>{tx('logistics.checkout.method.creditDisabled', 'OxSteed Credit is temporarily unavailable')}</strong>
                        <br />
                        {tx(
                          'logistics.checkout.method.creditDisabledDetail',
                          'Credit payments are disabled right now, so this installment cannot be taken from Credit. You can still pay by card.'
                        )}
                      </span>
                    )}
                    {creditRailOn && !creditEligible && (
                      <span className="lx-method-desc" role="note">
                        {tx('logistics.checkout.method.creditNotEligible', 'This order is not eligible for Credit payment.')}
                      </span>
                    )}
                    {creditRailOn && creditEligible && balanceKnown && (
                      <span className="lx-method-balance">
                        {tx('logistics.checkout.method.creditBalance', 'Available Credit balance: {{amount}}', { amount: money(balanceCents) })}
                      </span>
                    )}
                    {creditRailOn && creditEligible && !balanceKnown && (
                      <span className="lx-method-desc" role="note">
                        {tx(
                          'logistics.checkout.method.creditBalanceUnknown',
                          'Your Credit balance will be checked when you confirm the payment.'
                        )}
                      </span>
                    )}
                    {creditRailOn && creditEligible && balanceKnown && shortfallCents > 0 && (
                      <span className="lx-method-desc" role="alert" style={{ color: 'var(--color-error)', fontWeight: 700 }}>
                        {tx('logistics.checkout.method.creditInsufficient', 'Insufficient Credit balance')}
                        {' — '}
                        {tx('logistics.checkout.method.creditShortfall', 'You are {{amount}} short of the {{installment}} amount.', {
                          amount: money(shortfallCents),
                          installment: installmentLabel(installment).toLowerCase(),
                        })}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            </div>

            {method === 'credit' && shortfallCents > 0 && (
              <div className="lx-callout lx-callout--warning lx-mt-6" role="alert">
                <p>
                  {tx('logistics.checkout.method.creditTopUpHint', 'Top up your Credit balance or continue with a card instead.')}
                </p>
                <div className="lx-btn-row lx-mt-6">
                  <button type="button" className="lx-action-secondary" onClick={() => setMethod('stripe')}>
                    {tx('logistics.checkout.method.payWithCardInstead', 'Pay with card instead')}
                  </button>
                </div>
              </div>
            )}

            {method === 'stripe' && <CardDetailsField disabled={false} />}

            <div className="lx-btn-row lx-mt-6">
              <button
                type="button"
                className="lx-action-primary"
                onClick={startConfirm}
                disabled={!method || (method === 'credit' && shortfallCents > 0)}
              >
                {tx('logistics.checkout.confirm.continue', 'Continue to confirmation')}
              </button>
            </div>
            <p className="lx-t-xs lx-t-faint lx-mt-6">
              {tx('logistics.checkout.confirm.noAutoCharge', 'No saved cards. Every charge needs your explicit confirmation here.')}
            </p>
          </section>
        )}

        {step === 'confirm' && (
          <section className="lx-card" aria-labelledby="lx-confirm-title">
            <h2 id="lx-confirm-title" className="lx-card-title lx-mb-4">
              {tx('logistics.checkout.confirm.reviewTitle', 'Review and confirm')}
            </h2>
            <div className="lx-confirm-box">
              <p className="lx-confirm-line">
                {tx(
                  'logistics.checkout.confirm.line',
                  'You are about to pay {{amount}} ({{installment}}) for order {{reference}} using {{method}}.',
                  {
                    amount: money(amountCents),
                    installment: installmentLabel(installment),
                    reference: subject.reference || `#${subject.id}`,
                    method: methodLabel(method),
                  }
                )}
              </p>
              <label className="lx-checkbox-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => { setConfirmed(e.target.checked); setMustCheckError(false); }}
                  aria-describedby={mustCheckError ? 'lx-confirm-error' : undefined}
                />
                <span>
                  {tx(
                    'logistics.checkout.confirm.checkbox',
                    'I confirm I want OxSteed to charge {{amount}} to {{method}} for the {{installment}} of order {{reference}}.',
                    {
                      amount: money(amountCents),
                      method: methodLabel(method),
                      installment: installmentLabel(installment).toLowerCase(),
                      reference: subject.reference || `#${subject.id}`,
                    }
                  )}
                </span>
              </label>
              {mustCheckError && (
                <p id="lx-confirm-error" className="lx-t-small lx-mt-6" role="alert" style={{ color: 'var(--color-error)', fontWeight: 700 }}>
                  {tx('logistics.checkout.confirm.mustCheck', 'Please tick the confirmation box to continue.')}
                </p>
              )}
              {submitError && (
                <div className="lx-callout lx-callout--danger lx-mt-6" role="alert">
                  <p>{submitError}</p>
                </div>
              )}
              <div className="lx-btn-row lx-mt-6">
                <button
                  type="button"
                  className="lx-action-primary"
                  onClick={submitPayment}
                  disabled={submitting || (method === 'credit' && shortfallCents > 0)}
                  aria-busy={submitting}
                >
                  {submitting
                    ? tx('logistics.checkout.confirm.submitting', 'Submitting payment…')
                    : tx('logistics.checkout.confirm.button', 'Confirm and pay {{amount}}', { amount: money(amountCents) })}
                </button>
                <button
                  type="button"
                  className="lx-action-secondary"
                  onClick={() => setStep('method')}
                  disabled={submitting}
                >
                  {tx('logistics.checkout.confirm.back', 'Back to payment method')}
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'status' && attempt && (
          <>
            <PaymentStatusPanel attempt={attempt} onRetry={retryWithNewKey} showViewAll />
            {returnPath && (
              <div className="lx-btn-row lx-mt-6">
                <Link to={returnPath} className="lx-action-primary">
                  {tx('logistics.checkout.returnTo', 'Return to {{label}}', { label: returnLabel })}
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* Summary sidebar */}
      <aside className="lx-checkout-summary" aria-label={tx('logistics.checkout.sections.summary', 'Order summary')}>
        <div className="lx-card lx-mb-6">
          <h2 className="lx-card-title lx-mb-4">{tx('logistics.checkout.sections.summary', 'Order summary')}</h2>
          <div className="lx-kv-list">
            <div className="lx-kv-row">
              <span className="lx-kv-label">{tx('logistics.checkout.summary.reference', 'Reference')}</span>
              <span className="lx-kv-value lx-t-bold">{subject.reference || '—'}</span>
            </div>
            {subject.title && (
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.checkout.summary.product', 'Product')}</span>
                <span className="lx-kv-value">{subject.title}</span>
              </div>
            )}
            {subject.qty != null && (
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.checkout.summary.quantity', 'Quantity')}</span>
                <span className="lx-kv-value">{subject.qty}</span>
              </div>
            )}
            {subject.lane_name && (
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.checkout.summary.lane', 'Lane')}</span>
                <span className="lx-kv-value">{subject.lane_name}</span>
              </div>
            )}
            {subject.supplier_name && (
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.checkout.summary.supplier', 'Supplier')}</span>
                <span className="lx-kv-value">{subject.supplier_name}</span>
              </div>
            )}
            {subject.expected_arrival_date && (
              <div className="lx-kv-row">
                <span className="lx-kv-label">{tx('logistics.checkout.summary.expectedArrival', 'Expected arrival')}</span>
                <span className="lx-kv-value">{dateOf(subject.expected_arrival_date)}</span>
              </div>
            )}
            <div className="lx-kv-row">
              <span className="lx-kv-label">{tx('logistics.checkout.summary.status', 'Status')}</span>
              <LogisticsStatusPill status={subject.status} />
            </div>
          </div>
        </div>

        <div className="lx-card lx-mb-6">
          <h2 className="lx-card-title lx-mb-4">
            {tx('logistics.checkout.sections.quote', 'Quote')} ·{' '}
            {tx('logistics.checkout.quote.version', 'Quote version {{version}}', { version: quote.version })}
          </h2>
          {quote.accepted_at && (
            <p className="lx-t-xs lx-t-faint lx-mb-4">
              {tx('logistics.checkout.quote.acceptedOn', 'Accepted {{date}}', { date: dateOf(quote.accepted_at) })}
            </p>
          )}
          <div className="lx-kv-list">
            {(quote.line_items || []).map((item, idx) => (
              <div className="lx-kv-row" key={`${item.label}-${idx}`}>
                <span className="lx-kv-label">{item.label}</span>
                <span className="lx-kv-value">{money(item.amount_cents)}</span>
              </div>
            ))}
          </div>
          <div className="lx-checkout-total-row">
            <span className="lx-t-bold">{tx('logistics.checkout.quote.total', 'Quote total')}</span>
            <span className="lx-checkout-total-amount">{money(quote.total_cents)}</span>
          </div>
          <p className="lx-t-xs lx-t-faint lx-mt-6" style={{ lineHeight: 1.7 }}>
            {tx(
              'logistics.checkout.quote.depositPercent',
              'Deposit is {{percent}}% of the quote total, set in the approved quote.',
              { percent: Math.round(Number(quote.deposit_pct ?? 0.3) * 100) }
            )}
            <br />
            {tx('logistics.checkout.usdOnly', 'All amounts are in USD.')}
          </p>
        </div>

        <div className="lx-card lx-mb-6">
          <h2 className="lx-card-title lx-mb-4">{tx('logistics.checkout.sections.schedule', 'Payment schedule')}</h2>
          <div className="lx-kv-list">
            {schedule.map((row) => (
              <div className="lx-kv-row" key={row.installment}>
                <span className="lx-kv-label">
                  {installmentLabel(row.installment)}
                  <br />
                  <span className="lx-t-xs lx-t-faint">
                    {row.due_at
                      ? tx('logistics.checkout.schedule.dueOn', 'Due {{date}}', { date: dateOf(row.due_at) })
                      : tx('logistics.checkout.schedule.dueNow', 'Due now')}
                  </span>
                </span>
                <span className="lx-kv-value" style={{ textAlign: 'end' }}>
                  <strong>{money(row.amount_cents)}</strong>
                  <br />
                  <span className={`lx-settle-badge ${row.status === 'settled' ? 'lx-settle-badge--settled' : 'lx-settle-badge--awaiting'} lx-mt-6`}>
                    {row.status === 'settled'
                      ? tx('logistics.checkout.schedule.settled', 'Settled')
                      : row.status === 'paid'
                        ? tx('logistics.checkout.schedule.paid', 'Paid')
                        : row.status === 'processing'
                          ? tx('logistics.checkout.schedule.processing', 'Payment processing')
                          : tx('logistics.checkout.schedule.unpaid', 'Awaiting payment')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {quote.cancellation_terms && (
          <div className="lx-card">
            <h2 className="lx-card-title lx-mb-4">{tx('logistics.checkout.sections.terms', 'Cancellation terms')}</h2>
            <p className="lx-t-small lx-t-muted" style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {quote.cancellation_terms}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function CheckoutPageInner() {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [searchParams] = useSearchParams();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);

  const poId = searchParams.get('po_id');
  const participantId = searchParams.get('participant_id');
  const returnPath = sanitizeReturnPath(searchParams.get('return'));

  const load = useCallback(() => {
    if (!poId && !participantId) {
      setLoading(false);
      setError(tx('logistics.checkout.missingSubject', 'No order or campaign was selected for checkout.'));
      return;
    }
    setLoading(true);
    setError(null);
    getCheckoutContext(poId ? { orderId: poId } : { participant_id: participantId })
      .then((res) => setContext(res?.data || null))
      .catch((err) => setError(
        err.response?.data?.error
        || err.response?.data?.message
        || tx('logistics.checkout.loadError', 'We could not load this checkout. Please try again.')
      ))
      .finally(() => setLoading(false));
  }, [poId, participantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load, quoteRefreshKey]);

  // Called by the quote gate (accepted quote) or on a quote_changed 409
  // during payment (null quote + refetch => gate reappears if still pending).
  const handleQuoteAccepted = useCallback((nextQuote, refetchOnly = false) => {
    if (nextQuote) {
      // Clear pending_version explicitly: the gate shows whenever it is
      // non-null, and a shallow merge would keep the stale one.
      setContext((ctx) => (ctx
        ? { ...ctx, quote: { ...ctx.quote, ...nextQuote, status: 'accepted', pending_version: nextQuote.pending_version ?? null } }
        : ctx));
    } else if (refetchOnly) {
      setQuoteRefreshKey((k) => k + 1);
    }
  }, []);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="lx-loading" role="status" aria-live="polite">
          <span className="lx-spinner" aria-hidden="true" />
          {tx('logistics.checkout.loading', 'Loading checkout…')}
        </div>
      );
    }
    if (error || !context) {
      return (
        <div className="lx-empty" role="alert">
          <p>{error || tx('logistics.checkout.loadError', 'We could not load this checkout. Please try again.')}</p>
          <div className="lx-btn-row lx-mt-6" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={load} className="lx-action-secondary">
              {tx('logistics.workspace.dataError.retry', 'Try again')}
            </button>
            <Link to="/logistics/buyer" className="lx-action-ghost">
              {tx('logistics.checkout.backToDashboard', 'Back to buyer dashboard')}
            </Link>
          </div>
        </div>
      );
    }

    const { quote } = context;
    // No payable quote yet (none published, or only a staff draft): there
    // is nothing to pay against, so show an informative state instead of
    // the payment flow.
    if (!quote) {
      return (
        <div className="lx-empty" role="status">
          <p>
            <strong>
              {tx('logistics.checkout.noQuote.title', 'No quote is ready yet')}
            </strong>
          </p>
          <p>
            {tx(
              'logistics.checkout.noQuote.body',
              'Operations has not published a payable quote for this order. You will be notified when it is ready. No payment is due right now.'
            )}
          </p>
          <div className="lx-btn-row lx-mt-6" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={load} className="lx-action-secondary">
              {tx('logistics.workspace.dataError.retry', 'Try again')}
            </button>
            <Link to="/logistics/buyer" className="lx-action-ghost">
              {tx('logistics.checkout.backToDashboard', 'Back to buyer dashboard')}
            </Link>
          </div>
        </div>
      );
    }
    // A non-null pending_version means a newer quote needs acceptance
    // before any payment (never pay against a superseded quote).
    const needsAcceptance = quote?.pending_version != null;
    const expired = quote?.status === 'expired';

    return (
      <>
        {needsAcceptance && (
          <div className="lx-mb-6">
            <QuoteAcceptanceGate
              quote={quote}
              onAccepted={(next) => handleQuoteAccepted(next)}
            />
          </div>
        )}
        {expired && (
          <div className="lx-callout lx-callout--danger lx-mb-6" role="alert">
            <p>
              <strong>
                {tx(
                  'logistics.checkout.quote.expired',
                  'This quote expired on {{date}}. Ask operations for a new quote before paying.',
                  { date: quote?.valid_until ? new Date(quote.valid_until).toLocaleDateString() : '—' }
                )}
              </strong>
            </p>
          </div>
        )}
        {!needsAcceptance && !expired && (
          <CheckoutFlow
            context={context}
            returnPath={returnPath}
            returnLabel={context.return_label || tx('logistics.checkout.backToOrder', 'Back to order')}
            onQuoteAccepted={handleQuoteAccepted}
          />
        )}
      </>
    );
  };

  return (
    <PageShell>
      <LogisticsLayout
        showNav={false}
        title={tx('logistics.checkout.title', 'Secure checkout')}
        subtitle={tx('logistics.checkout.subtitle', 'Review your quote and confirm each installment separately.')}
      >
        <div className="lx-workspaces">
          {returnPath && (
            <div className="lx-back-row lx-mb-6">
              <Link to={returnPath} className="lx-link">
                ← {tx('logistics.checkout.backToOrder', 'Back to order')}
              </Link>
            </div>
          )}
          {renderBody()}
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}

/**
 * Default export: the checkout flow uses useStripe()/useElements(), so the
 * page renders inside <Elements>. When no publishable key is configured,
 * stripe resolves to null and card payment is blocked with a clear message
 * instead of crashing.
 */
export default function CheckoutPage(props) {
  const stripeKey = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
  const stripePromise = useMemo(
    () => (stripeKey ? loadStripe(stripeKey) : Promise.resolve(null)),
    [stripeKey]
  );
  return (
    <Elements stripe={stripePromise}>
      <CheckoutPageInner {...props} />
    </Elements>
  );
}
