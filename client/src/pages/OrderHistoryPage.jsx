import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import OrderErrorBoundary from '../components/OrderErrorBoundary';

export default function OrderHistoryPage() {
  return (
    <OrderErrorBoundary componentName="Order History">
      <OrderHistoryPageContent />
    </OrderErrorBoundary>
  );
}

function OrderHistoryPageContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadOrders();
    loadStats();
  }, [filter]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const params = filter !== 'all' ? { status: filter } : {};
      const response = await api.get('/orders', { params });
      setOrders(response.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.get('/orders/stats');
      setStats(response.data.data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

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

  return (
    <>
      <PageMeta title={t('orders.title')} description={t('orders.description')} />
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-4">{t('orders.title')}</h1>

            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">{t('orders.totalOrders')}</p>
                  <p className="text-2xl font-bold mt-2">{stats.total_orders}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">{t('orders.completedOrders')}</p>
                  <p className="text-2xl font-bold mt-2">{stats.completed_orders}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">{t('orders.pendingOrders')}</p>
                  <p className="text-2xl font-bold mt-2">{stats.pending_orders}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">{t('orders.totalSpent')}</p>
                  <p className="text-2xl font-bold mt-2">
                    ${(stats.total_spent_cents / 100).toFixed(2)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="border-b p-6">
              <h2 className="text-lg font-semibold mb-4">{t('orders.yourOrders')}</h2>
              <div className="flex gap-2 flex-wrap">
                {['all', 'pending', 'paid', 'completed', 'cancelled'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilter(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                      filter === status
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {t(`orders.status.${status}`)}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
                <p>{t('common.loading')}</p>
              </div>
            ) : error ? (
              <div className="p-6 text-center">
                <p className="text-red-600">{error}</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-600 mb-4">{t('orders.noOrders')}</p>
                <button
                  onClick={() => navigate('/marketplace')}
                  className="bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary-dark"
                >
                  {t('orders.continueShopping')}
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" role="grid" aria-label={t('orders.yourOrders')}>
                  <thead className="bg-gray-50 border-b">
                    <tr role="row">
                      <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        {t('orders.orderId')}
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        {t('orders.date')}
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        {t('orders.items')}
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        {t('orders.total')}
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        {t('orders.status')}
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        {t('common.action')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm text-gray-600">#{order.id}</span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {new Date(order.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {order.item_count || '—'}
                        </td>
                        <td className="px-6 py-4 font-semibold">
                          ${(order.total_cents / 100).toFixed(2)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(order.status)}`}>
                            {t(`orders.status.${order.status}`)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => navigate(`/orders/${order.id}`)}
                            className="text-primary hover:text-primary-dark text-sm font-medium"
                          >
                            {t('common.view')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
