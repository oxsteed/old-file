import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getPaymentAttempt } from '../../api/logistics';
import { formatCreditMinorUnits } from '../../lib/creditCurrency';
import '../../styles/logistics/LogisticsCheckout.css';

const POLL_INTERVAL_MS = 4000;

/**
 * PaymentStatusPanel - shows one payment attempt's lifecycle (Phase 3).
 *
 * Server statuses: pending, processing, succeeded, failed, canceled.
 * Critically distinguishes "we received your confirmation" (pending /
 * processing) from "funds settled" — settled is shown ONLY for status
 * 'succeeded', which the server sets exclusively via the signed Stripe
 * webhook (or a committed Credit settlement) together with settled_at.
 * A browser redirect or confirmCardPayment result alone never marks an
 * attempt settled. The public attempt view never exposes internal failure
 * detail, so failed attempts show generic copy.
 *
 * Props:
 *  - attempt: initial attempt object { id, status, settled_at, method,
 *      installment, amount_cents, created_at }
 *  - poll: when true (default), polls getPaymentAttempt until terminal.
 *  - onRetry: called when the buyer chooses to retry a failed/canceled
 *      attempt. The parent must mint a NEW idempotency key for the retry.
 *  - showViewAll: render the "View all my payments" link.
 */
export default function PaymentStatusPanel({ attempt: initialAttempt, poll = true, onRetry, showViewAll = false }) {
  const { t, i18n } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [attempt, setAttempt] = useState(initialAttempt);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => { setAttempt(initialAttempt); }, [initialAttempt]);

  const refresh = useCallback(async () => {
    if (!attempt?.id) return null;
    setChecking(true);
    setError(null);
    try {
      const res = await getPaymentAttempt(attempt.id);
      const next = res?.data?.attempt || res?.attempt || null;
      if (next) setAttempt(next);
      return next;
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || null);
      return null;
    } finally {
      setChecking(false);
    }
  }, [attempt?.id]);

  const isTerminal = (a) => ['succeeded', 'failed', 'canceled','superseded'].includes(a?.status);

  useEffect(() => {
    if (!poll || !attempt?.id || isTerminal(attempt)) return undefined;
    timerRef.current = setInterval(() => { refresh(); }, POLL_INTERVAL_MS);
  return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [poll, attempt?.id, attempt?.status, refresh]);

  if (!attempt) return null;
if(attempt.status==='superseded')return <div className="lx-callout" role="status">{tx('logistics.staff.reconciled','Duplicate charge needs review')}</div>;

  const money = (minor) => formatCreditMinorUnits(minor ?? 0, 'USD');
  const dateOf = (value) => (value ? new Date(value).toLocaleString(i18n.language) : '—');
  const methodLabel = attempt.method === 'credit'
    ? tx('logistics.checkout.method.credit', 'OxSteed Credit')
    : tx('logistics.checkout.method.stripe', 'Card via Stripe');
  const installmentLabel = attempt.installment === 'final'
    ? tx('logistics.checkout.schedule.final', 'Final balance')
    : tx('logistics.checkout.schedule.deposit', 'Deposit');

  const settled = attempt.status === 'succeeded';
  const failed = attempt.status === 'failed';
  const canceled = attempt.status === 'canceled';
  const active = !settled && !failed && !canceled;

  const steps = [
    { key: 'received', label: tx('logistics.checkout.status.received', 'We received your payment confirmation.'), done: true, activeState: attempt.status === 'pending' },
    { key: 'processing', label: tx('logistics.checkout.status.processing', 'Processing your payment…'), done: ['processing', 'succeeded'].includes(attempt.status), activeState: attempt.status === 'processing' },
    { key: 'settled', label: tx('logistics.checkout.status.settled', 'Payment settled'), done: settled, activeState: false },
  ];

  return (
    <section className="lx-card" aria-labelledby="lx-attempt-status-title">
      <h3 id="lx-attempt-status-title" className="lx-card-title lx-mb-4">
        {tx('logistics.checkout.sections.status', 'Payment status')}
      </h3>

      <div className="lx-kv-list">
        <div className="lx-kv-row">
          <span className="lx-kv-label">{tx('logistics.checkout.status.attempt', 'Attempt {{id}}', { id: attempt.id })}</span>
          {settled ? (
            <span className="lx-settle-badge lx-settle-badge--settled">{tx('logistics.checkout.payments.settledBadge', 'Settled')}</span>
          ) : (
            <span className="lx-settle-badge lx-settle-badge--awaiting">{tx('logistics.checkout.payments.awaitingBadge', 'Awaiting settlement')}</span>
          )}
        </div>
        <div className="lx-kv-row">
          <span className="lx-kv-label">{tx('logistics.checkout.status.amount', 'Amount')}</span>
          <span className="lx-kv-value lx-t-bold">{money(attempt.amount_cents)}</span>
        </div>
        <div className="lx-kv-row">
          <span className="lx-kv-label">{tx('logistics.checkout.status.installment', 'Installment')}</span>
          <span className="lx-kv-value">{installmentLabel}</span>
        </div>
        <div className="lx-kv-row">
          <span className="lx-kv-label">{tx('logistics.checkout.status.method', 'Method')}</span>
          <span className="lx-kv-value">{methodLabel}</span>
        </div>
        <div className="lx-kv-row">
          <span className="lx-kv-label">{tx('logistics.checkout.status.createdAt', 'Started {{date}}', { date: dateOf(attempt.created_at) })}</span>
          <span className="lx-kv-value">{attempt.settled_at ? dateOf(attempt.settled_at) : '—'}</span>
        </div>
      </div>

      {settled && (
        <div className="lx-callout lx-mt-6" role="status">
          <p>
            <strong>{tx('logistics.checkout.status.settled', 'Payment settled')}</strong>
            <br />
            {tx('logistics.checkout.status.settledDetail', 'OxSteed has confirmed receipt of {{amount}}. Your installment is complete.', { amount: money(attempt.amount_cents) })}
          </p>
        </div>
      )}

      {active && (
        <>
          <ol className="lx-attempt-timeline" aria-label={tx('logistics.checkout.sections.status', 'Payment status')}>
            {steps.map((step) => (
              <li
                key={step.key}
                className={`lx-attempt-step${step.done ? ' lx-attempt-step--done' : ''}${step.activeState ? ' lx-attempt-step--active' : ''}`}
                aria-current={step.activeState ? 'step' : undefined}
              >
                <span className="lx-attempt-dot" aria-hidden="true" />
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          {!settled && (
            <p className="lx-t-small lx-t-faint lx-mt-6" style={{ lineHeight: 1.7 }}>
              {tx('logistics.checkout.status.notSettled', 'Funds are not settled yet. We will confirm here once the payment clears.')}
            </p>
          )}
        </>
      )}

      {(failed || canceled) && (
        <div className="lx-callout lx-callout--danger lx-mt-6" role="alert">
          <p>
            <strong>
              {canceled
                ? tx('logistics.checkout.payments.states.canceled', 'Canceled')
                : tx('logistics.checkout.status.failed', 'Payment failed')}
            </strong>
            <br />
            {tx('logistics.checkout.status.failedUnknown', 'The payment did not go through. No money was taken.')}
          </p>
          {onRetry && (
            <div className="lx-btn-row lx-mt-6">
              <button type="button" className="lx-action-primary" onClick={onRetry} data-track-private>
                {tx('logistics.checkout.status.retry', 'Try again with a new payment attempt')}
              </button>
            </div>
          )}
          <p className="lx-t-xs lx-t-faint lx-mt-6">
            {tx('logistics.checkout.status.newKeyNote', 'Retries always create a new payment attempt, so you are never charged twice for the same confirmation.')}
          </p>
        </div>
      )}

      {error && (
        <p className="lx-t-small lx-mt-6" role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>
      )}

      <div className="lx-btn-row lx-mt-6">
        <button
          type="button"
          className="lx-action-secondary"
          onClick={refresh}
          disabled={checking || !attempt?.id}
          aria-busy={checking} data-track-private
        >
          {checking
            ? tx('logistics.checkout.status.checking', 'Checking payment status…')
            : tx('logistics.checkout.status.refresh', 'Refresh status')}
        </button>
        {showViewAll && (
          <Link to="/logistics/payments" className="lx-action-ghost">
            {tx('logistics.checkout.status.viewAll', 'View all my payments')}
          </Link>
        )}
      </div>
    </section>
  );
}
