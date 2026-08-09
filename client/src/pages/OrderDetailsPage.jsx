import { useEffect, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import OrderErrorBoundary from '../components/OrderErrorBoundary';
import { formatCents, formatDateTime } from '../lib/format';
import { getFoodOrder } from '../api/food';

export default function OrderDetailsPage() {
  return (
    <OrderErrorBoundary componentNameKey="orderErrorBoundary.componentNames.orderDetails">
      <OrderDetailsPageContent />
    </OrderErrorBoundary>
  );
}

function OrderDetailsPageContent() {
  const { t } = useTranslation();
  const params = useParams();
  const orderId = params.orderId || params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const isFoodOrder = location.pathname.startsWith('/food/orders/');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    loadOrder();
  }, [isFoodOrder, orderId]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      if (isFoodOrder) {
        setOrder(await getFoodOrder(orderId));
      } else {
        const response = await api.get(`/orders/${orderId}`);
        setOrder(response.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm(t('orders.confirmCancel'))) return;

    try {
      setCancelLoading(true);
      await api.post(`/orders/${orderId}/cancel`);
      await loadOrder();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel order');
    } finally {
      setCancelLoading(false);
    }
  };

  const canCancel = !isFoodOrder && order && ['pending', 'paid'].includes(order.status);
  const currencyOptions = { currency: order?.currency_code || order?.currency || 'USD' };

  const paymentMethodLabel = (() => {
    const raw = String(order?.payment_method || order?.paymentMode || order?.payment_mode || '').toLowerCase();
    const labels = {
      card: 'Card',
      card_payment: 'Card',
      bank_transfer: 'Bank transfer',
      cash: 'Cash',
      restaurant_credit: 'Restaurant credit',
      wallet_credit: 'Restaurant credit',
      direct_payment: 'Direct payment',
      direct: 'Direct payment',
      off_platform: 'Direct payment',
      pay_at_restaurant: 'Pay at restaurant',
      pay_in_person: 'Pay at restaurant',
    };
    if (labels[raw]) return labels[raw];
    if (order?.transaction) return 'Processor payment';
    return 'Unrecorded';
  })();

  const statusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      paid: 'bg-green-100 text-green-800',
      processing: 'bg-blue-100 text-blue-800',
      received: 'bg-yellow-100 text-yellow-800',
      accepted: 'bg-blue-100 text-blue-800',
      preparing: 'bg-blue-100 text-blue-800',
      ready: 'bg-green-100 text-green-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      refunded: 'bg-gray-100 text-gray-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

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
            onClick={() => navigate('/orders')}
            className="w-full bg-primary text-white py-2 rounded-lg hover:bg-primary-dark"
          >
            {t('orders.backToOrders')}
          </button>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">{t('orders.notFound')}</p>
          <button
            onClick={() => navigate('/orders')}
            className="bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary-dark"
          >
            {t('orders.backToOrders')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageMeta title={`${t('orders.order')} #${orderId}`} />
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">
                {order.restaurant_name ? `${order.restaurant_name} · ` : ''}{t('orders.order')} #{order.id}
              </h1>
              <p className="text-gray-600">
                {t('orders.placedOn')} {formatDateTime(order.created_at, { month: 'long' })}
              </p>
            </div>
            <span className={`px-4 py-2 rounded-full font-semibold ${statusColor(order.status)}`}>
              {t(`orders.statusLabels.${order.status}`, {
                defaultValue: String(order.status || '').replace(/_/g, ' ').replace(/^\w/, (character) => character.toUpperCase()),
              })}
            </span>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Order Items */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="border-b px-6 py-4">
                  <h2 className="text-lg font-semibold">{t('orders.items')}</h2>
                </div>
                <div className="divide-y">
                  {order.items?.map(item => (
                    <div key={item.id} className="px-6 py-4 flex items-center justify-between">
                      <div className="flex-1">
                        {item.image_url && (
                          <img
                            src={item.image_url}
                            alt={item.name || item.itemName}
                            className="w-20 h-20 object-cover rounded mb-3"
                          />
                        )}
                        <h3 className="font-semibold">{item.name || item.itemName}</h3>
                        {item.description && (
                          <p className="text-sm text-gray-600">{item.description}</p>
                        )}
                        <p className="text-sm text-gray-600 mt-2">
                          {t('orders.quantity')}: {item.quantity}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600 mb-1">
                          {formatCents(
                            item.unit_price_cents ?? (Number(item.lineTotalCents || 0) / Math.max(Number(item.quantity || 1), 1)),
                            currencyOptions,
                          )} {t('common.each')}
                        </p>
                        <p className="font-semibold">
                          {formatCents(item.total_price_cents ?? item.lineTotalCents, currencyOptions)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shipping Address */}
              {order.shipping_address && Object.keys(order.shipping_address).length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">{t('orders.shippingAddress')}</h2>
                  <div className="text-gray-700 whitespace-pre-wrap">
                    {JSON.stringify(order.shipping_address, null, 2)}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Order Summary */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4">{t('orders.orderSummary')}</h2>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">{t('checkout.subtotal')}</span>
                    <span>{formatCents(order.subtotal_cents, currencyOptions)}</span>
                  </div>
                  {order.tax_cents > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">{t('checkout.tax')}</span>
                      <span>{formatCents(order.tax_cents, currencyOptions)}</span>
                    </div>
                  )}
                  {(order.shipping_cents > 0 || order.delivery_fee_cents > 0) && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">{t('orders.shipping')}</span>
                      <span>{formatCents(order.shipping_cents || order.delivery_fee_cents, currencyOptions)}</span>
                    </div>
                  )}
                  {order.discount_cents > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>{t('orders.discount')}</span>
                      <span>-{formatCents(order.discount_cents, currencyOptions)}</span>
                    </div>
                  )}
                  <div className="border-t pt-3 flex justify-between font-bold text-lg">
                    <span>{t('checkout.total')}</span>
                    <span>{formatCents(order.total_cents, currencyOptions)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Information */}
              {(order.transaction || order.payment_method || order.payment_mode || order.payment_status) && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">{t('orders.payment')}</h2>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-gray-600">{t('orders.paymentMethod')}</p>
                      <p className="font-semibold">{paymentMethodLabel}</p>
                    </div>
                    {order.transaction?.payment_intent_id && (
                      <div>
                        <p className="text-gray-600">{t('orders.transactionId')}</p>
                        <p className="font-mono text-xs break-all">
                          {order.transaction.payment_intent_id}
                        </p>
                      </div>
                    )}
                    {order.transaction?.status && (
                      <div>
                        <p className="text-gray-600">{t('orders.status')}</p>
                        <p className="font-semibold capitalize">{order.transaction.status}</p>
                      </div>
                    )}
                    {order.payment_status && (
                      <div>
                        <p className="text-gray-600">{t('orders.status')}</p>
                        <p className="font-semibold capitalize">{String(order.payment_status).replace(/_/g, ' ')}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                {canCancel && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelLoading}
                    className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {cancelLoading ? t('common.processing') : t('orders.cancelOrder')}
                  </button>
                )}
                <button
                  onClick={() => navigate('/orders')}
                  className="w-full bg-gray-200 text-gray-800 py-2 rounded-lg hover:bg-gray-300 font-medium"
                >
                  {t('orders.backToOrders')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
