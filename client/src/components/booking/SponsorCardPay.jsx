import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import './SponsorCardPay.css';

// Group 3 (items 121-125, D-40): a sponsor pays their share with their own
// card. The server mints a per-sponsorship PaymentIntent and confirms the
// payment from it (the webhook settles the same row), so a closed tab
// still ends with a completed payment. The caller supplies the intent
// creation and the server confirm call, so the same form serves the
// token flow (no account) and the signed-in flow.
function CardForm({ clientSecret, onConfirmPayment, onPaid, amountLabel }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // G3-17: the last PaymentIntent that already succeeded at Stripe. When
  // the server confirm fails, the card must not be charged again — the
  // retry below confirms the same intent instead.
  const [lastIntentId, setLastIntentId] = useState(null);
  const [confirmFailed, setConfirmFailed] = useState(false);

  const confirmExisting = async () => {
    if (!lastIntentId || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await onConfirmPayment(lastIntentId);
      setConfirmFailed(false);
      toast.success(t('booking.sponsorPaid'));
      onPaid?.(result);
    } catch (err) {
      setError(err?.response?.data?.error || t('booking.sponsorPayFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError('');
    setConfirmFailed(false);
    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (stripeError || paymentIntent?.status !== 'succeeded') {
        setError(stripeError?.message || t('booking.sponsorPayFailed'));
        return;
      }
      try {
        const result = await onConfirmPayment(paymentIntent.id);
        toast.success(t('booking.sponsorPaid'));
        onPaid?.(result);
      } catch (confirmErr) {
        // The card already succeeded at Stripe; only the server confirm
        // failed, so keep the intent id for the retry below.
        setLastIntentId(paymentIntent.id);
        setConfirmFailed(true);
        setError(confirmErr?.response?.data?.error || t('booking.sponsorPayFailed'));
      }
    } catch (err) {
      setError(err?.response?.data?.error || t('booking.sponsorPayFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="sponsor-card-form" data-track="ui.92a0cf4d94.1">
      <div className="sponsor-card-element">
        <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
      </div>
      {error && <p role="alert" className="sponsor-card-error">{error}</p>}
      {confirmFailed && lastIntentId && (
        <button type="button" onClick={confirmExisting} disabled={busy} className="sponsor-card-pay-btn" data-track="ui.92a0cf4d94.2">
          {busy ? t('booking.sponsorPaying') : t('booking.sponsorConfirmExisting')}
        </button>
      )}
      <button type="submit" disabled={busy || !stripe} className="sponsor-card-pay-btn" data-track="ui.92a0cf4d94.3">
        {busy ? t('booking.sponsorPaying') : t('booking.sponsorPayNow', { amount: amountLabel })}
      </button>
    </form>
  );
}

export default function SponsorCardPay({ amountCents, createIntent, onConfirmPayment, onPaid }) {
  const { t } = useTranslation();
  const [intent, setIntent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stripePromise, setStripePromise] = useState(null);

  const amountLabel = useMemo(
    () => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format((amountCents || 0) / 100),
    [amountCents],
  );

  const start = async () => {
    setLoading(true);
    try {
      const data = await createIntent();
      if (!data?.clientSecret || !data?.publishableKey) {
        throw new Error('Card payments are not configured');
      }
      setStripePromise(loadStripe(data.publishableKey));
      setIntent(data);
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || t('booking.sponsorPayFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!intent || !stripePromise) {
    return (
      <button type="button" onClick={start} disabled={loading} className="sponsor-card-start-btn" data-track="ui.92a0cf4d94.4">
        {t('booking.sponsorPayStart', { amount: amountLabel })}
      </button>
    );
  }
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret }}>
      <CardForm
        clientSecret={intent.clientSecret}
        onConfirmPayment={onConfirmPayment}
        onPaid={onPaid}
        amountLabel={amountLabel}
      />
    </Elements>
  );
}
