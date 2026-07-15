import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import OrderErrorBoundary from '../components/OrderErrorBoundary';
import DirectPaymentRecordModal from '../components/DirectPaymentRecordModal';

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
  const [orderDetails, setOrderDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentRecordOpen, setPaymentRecordOpen] = useState(false);
  const [paymentRecorded, setPaymentRecorded] = useState(false);

  useEffect(() => {
    async function loadSession() {
      try {
        setLoading(true);
        const response = await api.get(`/carts/${cartId}/session`);
        const session = response.data?.data;
        if (!session || !Array.isArray(session.items)) {
          throw new Error('Checkout session is missing order details.');
        }
        setOrderDetails(session);
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load checkout details');
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
            className="w-full bg-primary text-white py-2.5 rounded-xl hover:bg-primary-dark"
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
      <PageMeta title={t('checkout.title', { defaultValue: 'Checkout' })} description="Launch-safe checkout summary for restaurant credit and direct payment." />
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl shadow p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">{t('checkout.title', { defaultValue: 'Checkout' })}</h1>
                <p className="text-sm text-gray-600 mt-2">
                  Restaurant credit and direct payment are the launch payment paths. Card checkout is not shown here.
                </p>
              </div>
              <button
                onClick={() => navigate(cartId ? `/cart/${cartId}` : '/products')}
                className="shrink-0 bg-gray-100 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-200"
              >
                {t('common.back', { defaultValue: 'Back' })}
              </button>
            </div>

            {paymentRecorded && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
                Payment proof saved. The record is now available in activity/history.
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold">{t('checkout.orderSummary', { defaultValue: 'Order Summary' })}</h2>
            {items.length === 0 ? (
              <p className="text-gray-600">This cart is empty.</p>
            ) : (
                <div className="space-y-3">
                  {items.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-4 border-b border-gray-100 pb-3">
                    <div>
                      <div className="font-medium text-gray-900">{item.name} × {item.quantity}</div>
                      {item.notes && <div className="text-sm text-gray-500">{item.notes}</div>}
                    </div>
                    <div className="font-semibold text-gray-900">${(item.totalPrice / 100).toFixed(2)}</div>
                  </div>
                ))}
                <div className="pt-3 space-y-2">
                  <div className="flex justify-between text-gray-600">
                    <span>{t('checkout.subtotal', { defaultValue: 'Subtotal' })}</span>
                    <span>${(subtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>{t('checkout.tax', { defaultValue: 'Tax' })}</span>
                    <span>${(taxCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                    <span>{t('checkout.total', { defaultValue: 'Total' })}</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold">What happens next</h2>
            <p className="text-gray-600 leading-relaxed">
              For launch, this page keeps the checkout flow honest: no card payment screen is shown.
              If payment is handled outside OxSteed, record the proof here so the order can be matched later.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setPaymentRecordOpen(true)}
                className="bg-primary text-white px-5 py-3 rounded-xl font-semibold hover:bg-primary-dark"
              >
                Record direct payment proof
              </button>
              <button
                onClick={() => navigate(cartId ? `/cart/${cartId}` : '/products')}
                className="bg-gray-100 text-gray-700 px-5 py-3 rounded-xl font-semibold hover:bg-gray-200"
              >
                Return to cart
              </button>
            </div>
          </div>
        </div>
      </div>

      <DirectPaymentRecordModal
        isOpen={paymentRecordOpen}
        title="Record checkout payment"
        subtitle="Add the payment method, confirmation number, and proof link so the payment can be matched to this checkout later."
        sourceType="other"
        sourceId={cartId}
        sourceLabel={orderDetails?.cartId ? `Cart checkout · ${orderDetails.cartId}` : 'Cart checkout'}
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
