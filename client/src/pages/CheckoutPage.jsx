import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../context/AuthContext';
import OrderErrorBoundary from '../components/OrderErrorBoundary';
import DirectPaymentRecordModal from '../components/DirectPaymentRecordModal';

function CardPaymentForm({ cartId, intent, onPaid }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [cardError, setCardError] = useState('');

  const pay = async (event) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setCardError('');
    try {
      const card = elements.getElement(CardElement);
      const confirmed = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: { card },
      });
      if (confirmed.error) {
        setCardError(confirmed.error.message || t('checkout.cardPayFailed'));
        return;
      }
      if (confirmed.paymentIntent?.status !== 'succeeded') {
        setCardError(t('checkout.cardPayNotSucceeded'));
        return;
      }
      // Server re-verifies the PaymentIntent (amount, currency, ownership)
      // before marking the order paid; a client-side success alone never pays.
      const response = await api.post(`/carts/${cartId}/confirm`, {
        paymentIntentId: intent.paymentIntentId,
        orderId: intent.orderId,
      });
      onPaid(response.data);
    } catch (error) {
      setCardError(error?.response?.data?.message || error?.response?.data?.error || error?.message || t('checkout.cardPayConfirmFailed'));
    } finally {
      setPaying(false);
    }
  };

  return (
    <form onSubmit={pay} className="space-y-4" data-track="ui.137ad6cada.5">
      <div className="border border-[var(--color-border)] rounded-xl px-4 py-3 bg-[var(--color-surface)]">
        <CardElement options={{ hidePostalCode: false }} />
      </div>
      {cardError && <p className="text-red-700 text-sm" role="alert">{cardError}</p>}
      <button type="submit" className="bg-primary text-white px-5 py-3 rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50" disabled={!stripe || paying} data-track="ui.137ad6cada.6">
        {paying ? t('checkout.cardPayProcessing') : t('checkout.cardPayButton', { total: (intent.total / 100).toFixed(2) })}
      </button>
    </form>
  );
}

export default function CheckoutPage() {
  return (
    <OrderErrorBoundary componentNameKey="orderErrorBoundary.componentNames.checkout">
      <CheckoutPageContent />
    </OrderErrorBoundary>
  );
}

function CheckoutPageContent() {
  const { t } = useTranslation();
  const { cartId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orderDetails, setOrderDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentRecordOpen, setPaymentRecordOpen] = useState(false);
  const [paymentRecorded, setPaymentRecorded] = useState(false);
  const [intent, setIntent] = useState(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState('');
  const [cardPaid, setCardPaid] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);

  const startCardPayment = async () => {
    setIntentLoading(true);
    setIntentError('');
    try {
      const response = await api.post(`/carts/${cartId}/payment-intent`, {
        cartId,
        ...(user?.email ? { email: user.email } : {}),
      });
      const created = response.data?.data;
      if (!created?.clientSecret || !created?.orderId || !created?.paymentIntentId) {
        throw new Error(t('checkout.cardPayIntentFailed'));
      }
      // The intent total is authoritative: shipping, discount, and dynamic
      // pricing can move it away from the session total shown above.
      setIntent(created);
      const publishableKey = created.publishableKey || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (!publishableKey) {
        setIntentError(t('checkout.cardPayUnavailable'));
        setIntent(null);
        return;
      }
      setStripePromise(loadStripe(publishableKey));
    } catch (err) {
      // Server gates stay authoritative: email-unverified, terms, and
      // checkout restrictions all surface here as 403s and block the card form.
      setIntentError(err.response?.data?.message || err.response?.data?.error || err.message || t('checkout.cardPayIntentFailed'));
    } finally {
      setIntentLoading(false);
    }
  };

  useEffect(() => {
    async function loadSession() {
      try {
        setLoading(true);
        const response = await api.get(`/carts/${cartId}/session`);
        const session = response.data?.data;
        if (!session || !Array.isArray(session.items)) {
          throw new Error(t('checkout.sessionMissing'));
        }
        setOrderDetails(session);
      } catch (err) {
        setError(err.response?.data?.error || err.message || t('checkout.loadFailed'));
      } finally {
        setLoading(false);
      }
    }

    if (cartId) {
      loadSession();
    }
  }, [cartId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-2xl p-6">
          <h1 className="text-lg font-semibold text-red-900 mb-2">{t('common.error')}</h1>
          <p className="text-red-700 mb-4">{error}</p>
          <button
            onClick={() => navigate(cartId ? `/cart/${cartId}` : '/products')}
            className="w-full bg-primary text-white py-2.5 rounded-xl hover:bg-primary-dark" data-track="ui.137ad6cada.1"
          >
            {t('common.backToCart')}
          </button>
        </div>
      </div>
    );
  }

  const items = orderDetails?.items || [];
  const subtotalCents = orderDetails?.subtotal || 0;
  const taxCents = orderDetails?.tax || 0;
  const totalCents = orderDetails?.total || 0;

  return (
    <>
      <PageMeta title={t('checkout.title')} description={t('checkout.pageDescription')} />
      <div className="min-h-screen bg-[var(--color-bg)] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">{t('checkout.title', { defaultValue: 'Checkout' })}</h1>
                <p className="text-sm text-[var(--color-text-muted)] mt-2">
                  {t('checkout.paymentPathsNotice')}
                </p>
              </div>
              <button
                onClick={() => navigate(cartId ? `/cart/${cartId}` : '/products')}
                className="shrink-0 bg-[var(--color-surface-2)] text-[var(--color-text)] px-4 py-2 rounded-xl hover:bg-[var(--color-surface-3)]" data-track="ui.137ad6cada.2"
              >
                {t('common.back', { defaultValue: 'Back' })}
              </button>
            </div>

            {paymentRecorded && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
                {t('checkout.paymentSaved')}
              </div>
            )}

            {cardPaid && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900" role="status">
                {t('checkout.cardPaySuccess', { order: cardPaid.orderId || cardPaid.order?.id || '' })}
              </div>
            )}
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold">{t('checkout.orderSummary', { defaultValue: 'Order Summary' })}</h2>
            {items.length === 0 ? (
              <p className="text-[var(--color-text-muted)]">{t('checkout.emptyCart')}</p>
            ) : (
                <div className="space-y-3">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-3">
                    <div>
                      <div className="font-medium text-[var(--color-text)]">{item.name} × {item.quantity}</div>
                      {item.notes && <div className="text-sm text-[var(--color-text-muted)]">{item.notes}</div>}
                    </div>
                    <div className="font-semibold text-[var(--color-text)]">${(item.totalPrice / 100).toFixed(2)}</div>
                  </div>
                ))}
                <div className="pt-3 space-y-2">
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>{t('checkout.subtotal', { defaultValue: 'Subtotal' })}</span>
                    <span>${(subtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>{t('checkout.tax', { defaultValue: 'Tax' })}</span>
                    <span>${(taxCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t border-[var(--color-border)]">
                    <span>{t('checkout.total', { defaultValue: 'Total' })}</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold">{t('checkout.cardPayTitle')}</h2>
            <p className="text-[var(--color-text-muted)] leading-relaxed">
              {t('checkout.cardPayBody')}
            </p>
            {intentError && <p className="text-red-700 text-sm" role="alert">{intentError}</p>}
            {!intent && !cardPaid && (
              <button
                onClick={startCardPayment}
                className="bg-primary text-white px-5 py-3 rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50"
                disabled={intentLoading || items.length === 0} data-track="ui.137ad6cada.7"
              >
                {intentLoading ? t('checkout.cardPayPreparing') : t('checkout.cardPayStart')}
              </button>
            )}
            {intent && stripePromise && !cardPaid && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('checkout.cardPayIntentTotal', { total: (intent.total / 100).toFixed(2) })}
                </p>
                <Elements stripe={stripePromise}>
                  <CardPaymentForm
                    cartId={cartId}
                    intent={intent}
                    onPaid={(data) => {
                      setCardPaid(data?.data || data || {});
                      setIntent(null);
                    }}
                  />
                </Elements>
                <button
                  onClick={() => setIntent(null)}
                  className="text-sm text-[var(--color-text-muted)] underline" data-track="ui.137ad6cada.8"
                >
                  {t('checkout.cardPayCancel')}
                </button>
              </div>
            )}
            {!intent && !intentError && (
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('checkout.cardPayFallbackNote')}
              </p>
            )}
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold">{t('checkout.whatNext')}</h2>
            <p className="text-[var(--color-text-muted)] leading-relaxed">
              {t('checkout.whatNextBody')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setPaymentRecordOpen(true)}
                className="bg-primary text-white px-5 py-3 rounded-xl font-semibold hover:bg-primary-dark" data-track="ui.137ad6cada.3"
              >
                {t('checkout.recordPaymentProof')}
              </button>
              <button
                onClick={() => navigate(cartId ? `/cart/${cartId}` : '/products')}
                className="bg-[var(--color-surface-2)] text-[var(--color-text)] px-5 py-3 rounded-xl font-semibold hover:bg-[var(--color-surface-3)]" data-track="ui.137ad6cada.4"
              >
                {t('checkout.returnToCart')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <DirectPaymentRecordModal
        isOpen={paymentRecordOpen}
        title={t('checkout.recordPaymentTitle')}
        subtitle={t('checkout.recordPaymentSubtitle')}
        sourceType="other"
        sourceId={cartId}
        sourceLabel={orderDetails?.cartId ? `${t('checkout.cartCheckout')} · ${orderDetails.cartId}` : t('checkout.cartCheckout')}
        amountCents={totalCents}
        currencyCode="USD"
        payerId={null}
        payeeId={null}
        businessId={null}
        onClose={() => setPaymentRecordOpen(false)}
        onSuccess={() => {
          setPaymentRecordOpen(false);
          setPaymentRecorded(true);
        }}
      />
    </>
  );
}
