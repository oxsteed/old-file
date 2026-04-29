import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export default function CheckoutPage() {
  const { t } = useTranslation();
  const { cartId } = useParams();
  const navigate = useNavigate();
  const [clientSecret, setClientSecret] = useState(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function initializeCheckout() {
      try {
        setLoading(true);
        // Get checkout session details
        const response = await api.get(`/carts/${cartId}/session`);
        // Create payment intent
        const paymentResponse = await api.post(`/carts/${cartId}/payment-intent`, {
          email,
          shippingAddress: {}
        });

        setClientSecret(paymentResponse.data.data.clientSecret);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to initialize checkout');
        console.error('Checkout error:', err);
      } finally {
        setLoading(false);
      }
    }

    if (cartId) {
      initializeCheckout();
    }
  }, [cartId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-lg p-6">
          <h1 className="text-lg font-semibold text-red-900 mb-2">{t('common.error')}</h1>
          <p className="text-red-700 mb-4">{error}</p>
          <button
            onClick={() => navigate('/cart')}
            className="w-full bg-primary text-white py-2 rounded-lg hover:bg-primary-dark"
          >
            {t('common.backToCart')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageMeta title={t('checkout.title')} description={t('checkout.description')} />
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">{t('checkout.title')}</h1>

          {clientSecret && (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm
                cartId={cartId}
                email={email}
                setEmail={setEmail}
                clientSecret={clientSecret}
                onSuccess={() => navigate(`/orders`)}
              />
            </Elements>
          )}
        </div>
      </div>
    </>
  );
}

function CheckoutForm({ cartId, email, setEmail, clientSecret, onSuccess }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);

  useEffect(() => {
    async function loadOrderDetails() {
      try {
        const response = await api.get(`/carts/${cartId}/session`);
        setOrderDetails(response.data.data);
      } catch (err) {
        console.error('Failed to load order details:', err);
      }
    }
    loadOrderDetails();
  }, [cartId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    try {
      // Get the order ID from the payment intent
      const paymentIntentId = clientSecret.split('_secret_')[0] + '_secret_' + clientSecret.split('_secret_')[1];

      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success?cartId=${cartId}`,
        },
      });

      if (confirmError) {
        setError(confirmError.message);
      } else if (paymentIntent.status === 'succeeded') {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || 'Payment processing failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">{t('checkout.orderSummary')}</h2>
        {orderDetails && (
          <div className="space-y-3">
            {orderDetails.items.map(item => (
              <div key={item.id} className="flex justify-between">
                <span>{item.name} × {item.quantity}</span>
                <span>${(item.totalPrice / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t pt-3">
              <div className="flex justify-between font-semibold">
                <span>{t('checkout.subtotal')}</span>
                <span>${(orderDetails.subtotal / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>{t('checkout.tax')}</span>
                <span>${(orderDetails.tax / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t">
                <span>{t('checkout.total')}</span>
                <span>${(orderDetails.total / 100).toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('checkout.email')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('checkout.paymentMethod')}
          </label>
          <PaymentElement />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!stripe || loading}
          className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('common.processing') : t('checkout.completeOrder')}
        </button>
      </div>
    </form>
  );
}
