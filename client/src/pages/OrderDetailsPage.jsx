import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';

export default function OrderDetailsPage() {
  const { t } = useTranslation();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/orders/${orderId}`);
      setOrder(response.data.data);
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

  const canCancel = order && ['pending', 'paid'].includes(order.status);

  const statusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      paid: 'bg-green-100 text-green-800',
      processing: 'bg-blue-100 text-blue-800',
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
              <h1 className="text-3xl font-bold mb-2">{t('orders.order')} #{order.id}</h1>
              <p className="text-gray-600">
                {t('orders.placedOn')} {new Date(order.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
            <span className={`px-4 py-2 rounded-full font-semibold ${statusColor(order.status)}`}>
              {t(`orders.status.${order.status}`)}
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
                            alt={item.name}
                            className="w-20 h-20 object-cover rounded mb-3"
                          />
                        )}
                        <h3 className="font-semibold">{item.name}</h3>
                        {item.description && (
                          <p className="text-sm text-gray-600">{item.description}</p>
                        )}
                        <p className="text-sm text-gray-600 mt-2">
                          {t('orders.quantity')}: {item.quantity}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600 mb-1">
                          ${(item.unit_price_cents / 100).toFixed(2)} {t('common.each')}
                        </p>
                        <p className="font-semibold">
                          ${(item.total_price_cents / 100).toFixed(2)}
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
                    <span>${(order.subtotal_cents / 100).toFixed(2)}</span>
                  </div>
                  {order.tax_cents > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">{t('checkout.tax')}</span>
                      <span>${(order.tax_cents / 100).toFixed(2)}</span>
                    </div>
                  )}
                  {order.shipping_cents > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">{t('orders.shipping')}</span>
                      <span>${(order.shipping_cents / 100).toFixed(2)}</span>
                    </div>
                  )}
                  {order.discount_cents > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>{t('orders.discount')}</span>
                      <span>-${(order.discount_cents / 100).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t pt-3 flex justify-between font-bold text-lg">
                    <span>{t('checkout.total')}</span>
                    <span>${(order.total_cents / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Information */}
              {order.transaction && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">{t('orders.payment')}</h2>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-gray-600">{t('orders.paymentMethod')}</p>
                      <p className="font-semibold">{order.payment_method || 'Card'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t('orders.transactionId')}</p>
                      <p className="font-mono text-xs break-all">
                        {order.transaction.payment_intent_id}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t('orders.status')}</p>
                      <p className="font-semibold capitalize">{order.transaction.status}</p>
                    </div>
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
