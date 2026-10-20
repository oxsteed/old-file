import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  confirmCreditReservePurchase,
  createCreditReservePurchase,
  formatFoodMoney,
  getCreditReserveBalance,
  listCreditReserveLedger,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { createStableIdempotencyKeyStore } from '../../lib/idempotency';

// Phase 4: restaurant credit pre-purchase reserve ("gift card inventory"
// model). The restaurant buys OxSteed Credit up front; customer credit
// issuance is then capped at the reserve balance. 2.5% platform fee is taken
// at purchase time; the reserve is credited with the net amount.
const RESERVE_MIN_CENTS = 1000; // $10
const RESERVE_MAX_CENTS = 1000000; // $10,000
const RESERVE_FEE_BPS = 250;
const LEDGER_PAGE_SIZE = 20;

const stripePromise = (() => {
  try {
    const key = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  } catch {
    return null;
  }
})();

function parseAmountCents(value, currency) {
  return parseCreditMajorAmount(value, currency) || 0;
}

function feeCentsFor(amountCents) {
  return Math.round((amountCents * RESERVE_FEE_BPS) / 10000);
}

function referenceLabel(entry) {
  switch (entry.referenceType) {
    case 'purchase':
      return 'Reserve purchase';
    case 'issuance':
      return 'Credit issued to customer';
    case 'refund_reversal':
      return 'Refund reversal';
    case 'admin_adjustment':
      return 'Admin adjustment';
    default:
      return entry.referenceType || 'Reserve movement';
  }
}

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'grid',
  placeItems: 'center',
  padding: 18,
  background: 'rgba(7,20,35,.68)',
};

const modalStyle = {
  width: 'min(480px, 100%)',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#fff',
  borderRadius: 16,
  padding: '1.25rem 1.25rem 1.5rem',
  boxShadow: '0 24px 60px rgba(0,0,0,.35)',
};

function ReserveCardForm({ clientSecret, amountCents, currency, onConfirmed }) {
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
        setCardError(error.message || 'The card payment failed. Try another card.');
        return;
      }
      if (paymentIntent && ['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
        onConfirmed();
      } else {
        setCardError('The card payment failed. Try another card.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} data-track-private>
      <p className="fd-card-meta" style={{ marginBottom: '0.75rem' }}>
        Pay {formatFoodMoney(amountCents, currency)} by card. The reserve is credited only after the payment succeeds.
      </p>
      <label style={{ display: 'block', marginBottom: '0.75rem' }}>
        <span className="fd-card-meta">Card details</span>
        <div style={{ border: '1px solid #d7dce3', borderRadius: 8, padding: '0.85rem 1rem', background: '#fff', marginTop: 4 }}>
          <CardElement options={{ style: { base: { fontSize: '16px', color: '#10253f' } } }} />
        </div>
      </label>
      {cardError && <p role="alert" style={{ color: '#b42318', fontSize: '0.9rem' }}>{cardError}</p>}
      <button type="submit" className="fd-btn" disabled={submitting || !stripe} style={{ width: '100%' }} data-track-private>
        {submitting ? 'Processing…' : `Pay ${formatFoodMoney(amountCents, currency)}`}
      </button>
    </form>
  );
}

function ReservePurchaseModal({ restaurantId, currency, onClose, onPurchased }) {
  const [step, setStep] = useState('amount');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [intent, setIntent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const beginIntent = async (event) => {
    event.preventDefault();
    const cents = parseAmountCents(amount, currency);
    if (!cents || cents < RESERVE_MIN_CENTS || cents > RESERVE_MAX_CENTS) {
      setAmountError(
        `Enter an amount between ${formatFoodMoney(RESERVE_MIN_CENTS, currency)} and ${formatFoodMoney(RESERVE_MAX_CENTS, currency)}.`
      );
      return;
    }
    setAmountError('');
    setSubmitting(true);
    try {
      const idempotencyKey = idempotencyKeysRef.current.get('credit-reserve-purchase', { restaurantId, amountCents: cents });
      const result = await createCreditReservePurchase(restaurantId, { amountCents: cents }, idempotencyKey);
      const purchaseId = result?.purchase?.id;
      if (!purchaseId) throw new Error('purchase-intent-missing');
      setIntent({
        purchaseId,
        clientSecret: result?.clientSecret || null,
        feeCents: Number(result?.feeCents || 0),
        issuableCents: Number(result?.issuableCents || 0),
        amountCents: Number(result?.purchase?.amountCents || cents),
        alreadySucceeded: result?.purchase?.status === 'succeeded' || (!result?.clientSecret && result?.replayed),
      });
      if (result?.purchase?.status === 'succeeded' || (!result?.clientSecret && result?.replayed)) {
        // Replayed an already-paid purchase: nothing to charge, refresh.
        await onPurchased();
        setStep('done');
      } else {
        setStep('card');
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not start the reserve purchase.'));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPurchase = async () => {
    setStep('processing');
    setConfirmError('');
    try {
      const result = await confirmCreditReservePurchase(restaurantId, intent.purchaseId);
      if (result?.reserve) {
        await onPurchased();
        setStep('done');
        toast.success('Credit reserve funded.');
      } else {
        throw new Error('confirm-missing');
      }
    } catch (error) {
      setConfirmError(apiErrorMessage(error, 'The payment has not completed yet. You can retry once it clears.'));
      setStep('card');
    }
  };

  const cents = parseAmountCents(amount, currency);
  const feePreview = cents > 0 ? feeCentsFor(cents) : 0;

  return (
    <div style={modalBackdropStyle} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section style={modalStyle} role="dialog" aria-modal="true" aria-label="Buy credit reserve">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '1.05rem' }}>Buy credit reserve</strong>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={close} data-track-private>Close</button>
        </div>

        {step === 'amount' && (
          <form onSubmit={beginIntent} data-track-private>
            <p className="fd-card-meta" style={{ marginBottom: '0.75rem' }}>
              Pre-pay for the credit you plan to issue to customers. A 2.5% platform fee applies; the rest lands in your reserve.
            </p>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              <span className="fd-card-meta">Amount ({currency})</span>
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(event) => { setAmount(event.target.value); setAmountError(''); }}
                placeholder="0.00"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '0.6rem 0.75rem', border: '1px solid #d7dce3', borderRadius: 8, fontSize: '1rem' }}
                aria-invalid={amountError ? 'true' : undefined}
              />
            </label>
            {amountError && <p role="alert" style={{ color: '#b42318', fontSize: '0.9rem' }}>{amountError}</p>}
            {cents > 0 && !amountError && (
              <p className="fd-card-meta" style={{ marginBottom: '0.75rem' }}>
                Fee (2.5%): {formatFoodMoney(feePreview, currency)} · Added to reserve: {formatFoodMoney(cents - feePreview, currency)}
              </p>
            )}
            <button type="submit" className="fd-btn" disabled={submitting} style={{ width: '100%' }} data-track-private>
              {submitting ? 'Starting…' : 'Continue to payment'}
            </button>
          </form>
        )}

        {step === 'card' && intent?.clientSecret && stripePromise && (
          <Elements stripe={stripePromise}>
            <ReserveCardForm
              clientSecret={intent.clientSecret}
              amountCents={intent.amountCents}
              currency={currency}
              onConfirmed={confirmPurchase}
            />
          </Elements>
        )}

        {step === 'card' && (!intent?.clientSecret || !stripePromise) && (
          <div>
            <p className="fd-card-meta">Card payments are unavailable right now. The purchase was recorded as pending; retry once payments are back.</p>
            <button type="button" className="fd-btn fd-btn-secondary" onClick={close} style={{ width: '100%', marginTop: '0.75rem' }} data-track-private>Close</button>
          </div>
        )}

        {step === 'processing' && (
          <div>
            <p role="status" className="fd-card-meta">Confirming your payment with the reserve…</p>
            {confirmError && <p role="alert" style={{ color: '#b42318', fontSize: '0.9rem' }}>{confirmError}</p>}
          </div>
        )}

        {step === 'done' && (
          <div>
            <p className="fd-card-meta">Your credit reserve is funded. New customer credit issuance draws down from this balance.</p>
            <button type="button" className="fd-btn" onClick={onClose} style={{ width: '100%', marginTop: '0.75rem' }} data-track-private>Done</button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function RestaurantCreditReservePanel({ restaurant }) {
  const restaurantId = restaurant?.id;
  const currency = restaurant?.currency_code || 'USD';
  const [balance, setBalance] = useState(null);
  const [ledger, setLedger] = useState({ entries: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const [balanceResult, ledgerResult] = await Promise.all([
        getCreditReserveBalance(restaurantId),
        listCreditReserveLedger(restaurantId, { limit: LEDGER_PAGE_SIZE, offset: 0 }),
      ]);
      setBalance(balanceResult || null);
      setLedger({
        entries: Array.isArray(ledgerResult?.entries) ? ledgerResult.entries : [],
        total: Number(ledgerResult?.total || 0),
      });
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to load the credit reserve.'));
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="fd-section" aria-label="Credit reserve">
      <div className="fd-credit-manager-head" style={{ marginBottom: '0.75rem' }}>
        <div>
          <p className="fd-credit-manager-kicker">Credit reserve</p>
          <p className="fd-card-meta">
            Pre-pay for customer credit before you issue it. Once enrolled, every credit grant is capped at this balance.
          </p>
        </div>
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setPurchaseOpen(true)} data-track-private>
          Buy credit reserve
        </button>
      </div>

      {loading ? (
        <div className="fd-empty">Loading credit reserve…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">Available balance</p>
              <strong style={{ fontSize: '1.35rem' }}>{formatFoodMoney(Number(balance?.balanceCents || 0), currency)}</strong>
            </div>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">Lifetime purchased</p>
              <strong style={{ fontSize: '1.35rem' }}>{formatFoodMoney(Number(balance?.lifetimePurchasedCents || 0), currency)}</strong>
            </div>
            <div className="fd-card" style={{ flex: '1 1 160px', padding: '0.85rem 1rem' }}>
              <p className="fd-card-meta">Lifetime issued</p>
              <strong style={{ fontSize: '1.35rem' }}>{formatFoodMoney(Number(balance?.lifetimeIssuedCents || 0), currency)}</strong>
            </div>
          </div>

          {!balance?.optedIn && (
            <p className="fd-card-meta" style={{ marginBottom: '1rem' }}>
              This restaurant is not enrolled yet: credit issuance is not capped by a reserve.
              Your first purchase enrolls it and caps future issuance at the reserve balance.
            </p>
          )}

          <p className="fd-section-label">Reserve history</p>
          {ledger.entries.length === 0 ? (
            <div className="fd-empty">No reserve movements yet.</div>
          ) : (
            <div className="fd-credit-request-list">
              {ledger.entries.map((entry) => {
                const cents = Number(entry.amountCents || 0);
                const positive = cents >= 0;
                return (
                  <article key={entry.id} className="fd-credit-request-card">
                    <div className="fd-credit-request-main">
                      <div>
                        <strong>{referenceLabel(entry)}</strong>
                        <span>{formatCreditDateTime(entry.createdAt, 'Recently')} · Balance after: {formatFoodMoney(Number(entry.balanceAfterCents || 0), currency)}</span>
                      </div>
                      <strong className="fd-credit-request-amount" style={{ color: positive ? '#15803d' : '#b42318' }}>
                        {positive ? '+' : '−'}{formatFoodMoney(Math.abs(cents), currency)}
                      </strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {ledger.total > ledger.entries.length && (
            <p className="fd-card-meta" style={{ marginTop: '0.5rem' }}>
              Showing {ledger.entries.length} of {ledger.total} movements.
            </p>
          )}
        </>
      )}

      {purchaseOpen && (
        <ReservePurchaseModal
          restaurantId={restaurantId}
          currency={currency}
          onClose={() => setPurchaseOpen(false)}
          onPurchased={load}
        />
      )}
    </section>
  );
}
