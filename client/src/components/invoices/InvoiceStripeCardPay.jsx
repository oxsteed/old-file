import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CreditCard, Loader2 } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import invoicesApi from '../../api/invoices';

function formatMoneyFromCents(cents, language) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat(language || undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function InvoiceCardForm({ clientSecret, amountCents, invoiceId, paymentIntentId, onPaid }) {
  const { t, i18n } = useTranslation();
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
        setCardError(error.message || t('invoices.stripeCardPayError', { defaultValue: 'Card payment failed' }));
        return;
      }
      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        setCardError(t('invoices.stripeCardPayError', { defaultValue: 'Card payment failed' }));
        return;
      }
      await invoicesApi.confirmInvoiceCardPayment(invoiceId, { paymentIntentId });
      toast.success(t('invoices.stripeCardPaySuccess', { defaultValue: 'Invoice paid by card' }));
      onPaid?.();
    } catch (err) {
      const message = err.response?.data?.error
        || err.response?.data?.message
        || t('invoices.stripeCardPayError', { defaultValue: 'Card payment failed' });
      setCardError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const amountLabel = formatMoneyFromCents(amountCents, i18n.language);

  return (
    <form className="invoice-stripe-card-pay-form" onSubmit={submit}>
      <label className="invoice-stripe-card-label">
        <span>{t('invoices.stripeCardDetails', { defaultValue: 'Card details' })}</span>
        <div className="invoice-stripe-card-element">
          <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
        </div>
      </label>
      {cardError && <p className="invoice-stripe-card-error" role="alert">{cardError}</p>}
      <button type="submit" className="invoice-stripe-card-cta" disabled={submitting || !stripe}>
        {submitting ? (
          <>
            <Loader2 className="invoice-spin" size={18} aria-hidden="true" />
            {t('invoices.stripeCardPayProcessing', { defaultValue: 'Processing…' })}
          </>
        ) : (
          t('invoices.stripeCardPayCta', {
            amount: amountLabel,
            defaultValue: 'Pay {{amount}} by card',
          })
        )}
      </button>
      <p className="invoice-stripe-card-note">
        {t('invoices.stripeCardPayNote', {
          defaultValue: 'Card payments are settled to the invoice issuer via Stripe Connect.',
        })}
      </p>
    </form>
  );
}

export default function InvoiceStripeCardPay({ invoiceId, balanceCents: balanceCentsProp, onPaid, className = '' }) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState(null);
  const [intent, setIntent] = useState(null);
  const [intentError, setIntentError] = useState('');

  const loadEligibility = useCallback(async () => {
    if (!invoiceId) return;
    try {
      setLoading(true);
      const { data } = await invoicesApi.getInvoiceCardEligibility(invoiceId);
      setEligibility(data);
    } catch {
      setEligibility({ eligible: false });
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadEligibility();
  }, [loadEligibility, balanceCentsProp]);

  const balanceCents = useMemo(() => {
    if (balanceCentsProp != null) return balanceCentsProp;
    if (eligibility?.balanceCents != null) return eligibility.balanceCents;
    return 0;
  }, [balanceCentsProp, eligibility?.balanceCents]);

  const stripePromise = useMemo(() => {
    const key = intent?.publishableKey || import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  }, [intent?.publishableKey]);

  useEffect(() => {
    if (!eligibility?.eligible || !invoiceId || balanceCents <= 0) {
      setIntent(null);
      return undefined;
    }
    let cancelled = false;
    setIntent(null);
    (async () => {
      try {
        setIntentError('');
        const { data } = await invoicesApi.createInvoiceCardPaymentIntent(invoiceId);
        const payload = data?.data || data;
        if (!cancelled) setIntent(payload);
      } catch (err) {
        if (!cancelled) {
          setIntentError(
            err.response?.data?.error
            || t('invoices.stripeCardPayError', { defaultValue: 'Card payment failed' }),
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [eligibility?.eligible, invoiceId, balanceCents, t]);

  if (loading || !eligibility?.eligible) {
    return null;
  }

  const amountLabel = formatMoneyFromCents(balanceCents, i18n.language);

  return (
    <div className={`invoice-stripe-card-pay ${className}`.trim()}>
      <div className="invoice-stripe-card-pay-header">
        <CreditCard size={20} aria-hidden="true" />
        <h3>{t('invoices.stripeCardPayTitle', { defaultValue: 'Pay by card' })}</h3>
      </div>
      <p className="invoice-stripe-card-pay-body">
        {t('invoices.stripeCardPayBody', {
          amount: amountLabel,
          defaultValue: 'Pay {{amount}} securely with your card.',
        })}
      </p>
      {intentError && <p className="invoice-stripe-card-error" role="alert">{intentError}</p>}
      {intent?.clientSecret && stripePromise && (
        <Elements stripe={stripePromise}>
          <InvoiceCardForm
            clientSecret={intent.clientSecret}
            amountCents={intent.amountCents || balanceCents}
            invoiceId={invoiceId}
            paymentIntentId={intent.paymentIntentId}
            onPaid={onPaid}
          />
        </Elements>
      )}
      {!intent?.clientSecret && !intentError && (
        <p className="invoice-stripe-card-loading">
          <Loader2 className="invoice-spin" size={18} aria-hidden="true" />
          {t('invoices.stripeCardPayLoading', { defaultValue: 'Preparing card checkout…' })}
        </p>
      )}
    </div>
  );
}
