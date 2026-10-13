import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import consultingPaymentApi from '../api/consultingPayment';

// Review P3-1067: pay a consulting session by card. The server confirms the
// payment from the stored PaymentIntent (and the webhook does the same), so a
// closed tab still ends with a completed payment.
function CardForm({ clientSecret, paymentId, onPaid }) {
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
        setError(stripeError?.message || t('payment.consultingCardFailed'));
        return;
      }
      const { data } = await consultingPaymentApi.confirmPayment(paymentId, paymentIntent.id);
      toast.success(t('payment.consultingCardPaid'));
      onPaid?.(data);
    } catch (err) {
      setError(err?.response?.data?.error || t('payment.consultingCardFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
      <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px', direction: 'ltr' }}>
        <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
      </div>
      {error && <p role="alert" style={{ color: '#EF4444' }}>{error}</p>}
      <button type="submit" disabled={busy || !stripe} style={{ padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600 }}>
        {busy ? t('payment.consultingCardProcessing') : t('payment.consultingCardPay')}
      </button>
    </form>
  );
}

export default function ConsultingCardPay({ sessionId, packageId, onPaid }) {
  const { t } = useTranslation();
  const [intent, setIntent] = useState(null);
  const [loading, setLoading] = useState(false);
  const stripeKey = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
  const stripePromise = useMemo(() => (stripeKey ? loadStripe(stripeKey) : null), [stripeKey]);

  if (!stripePromise) return null;

  const start = async () => {
    setLoading(true);
    try {
      const { data } = await consultingPaymentApi.createPaymentIntent(sessionId, packageId);
      setIntent({ clientSecret: data.clientSecret, paymentId: data.payment?.id });
    } catch (err) {
      toast.error(err?.response?.data?.error || t('payment.consultingCardFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!intent) {
    return (
      <button type="button" onClick={start} disabled={loading || !packageId} style={{ padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600 }}>
        {t('payment.consultingCardStart')}
      </button>
    );
  }
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret }}>
      <CardForm clientSecret={intent.clientSecret} paymentId={intent.paymentId} onPaid={onPaid} />
    </Elements>
  );
}
