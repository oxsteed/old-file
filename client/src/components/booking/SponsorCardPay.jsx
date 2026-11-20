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

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError('');
    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (stripeError || paymentIntent?.status !== 'succeeded') {
        setError(stripeError?.message || t('booking.sponsorPayFailed'));
        return;
      }
      const result = await onConfirmPayment(paymentIntent.id);
      toast.success(t('booking.sponsorPaid'));
      onPaid?.(result);
    } catch (err) {
      setError(err?.response?.data?.error || t('booking.sponsorPayFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="sponsor-card-form">
      <div className="sponsor-card-element">
        <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
      </div>
      {error && <p role="alert" className="sponsor-card-error">{error}</p>}
      <button type="submit" disabled={busy || !stripe} className="sponsor-card-pay-btn">
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
      <button type="button" onClick={start} disabled={loading} className="sponsor-card-start-btn">
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
