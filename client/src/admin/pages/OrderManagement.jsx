import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi';
import PageMeta from '../../components/PageMeta';
import AdminErrorState from '../lib/AdminErrorState';
import OrderManagementTable from '../components/OrderManagementTable';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderFilters from '../components/OrderFilters';
import ReturnsQueueTable from '../../components/ReturnsQueueTable';

const RETURN_STATUSES = ['', 'requested', 'approved', 'declined', 'refunded', 'cancelled'];

export default function OrderManagement() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    skip: 0,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'DESC'
  });

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // G1-B6: the admin return queue lives on this page as a second tab,
  // because this is where the operations admins already work. Deciding
  // a return is status-only (approved/declined); it never refunds.
  const [activeTab, setActiveTab] = useState('orders');
  const [returnsStatus, setReturnsStatus] = useState('');
  const [returnsSkip, setReturnsSkip] = useState(0);
  const [notes, setNotes] = useState({});
  const [decidingId, setDecidingId] = useState(null);
  const [decideError, setDecideError] = useState(null);
  const [decideSuccess, setDecideSuccess] = useState(null);

  // Fetch orders (via adminApi so token refresh and 403 handling apply)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminOrders', filters],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.search) params.append('search', filters.search);
      params.append('skip', filters.skip);
      params.append('limit', filters.limit);
      params.append('sortBy', filters.sortBy);
      params.append('sortOrder', filters.sortOrder);

      const res = await adminApi.get(`/admin/orders?${params.toString()}`, { signal });
      return res.data;
    },
    staleTime: 30000,
  });

  // Fetch order statistics
  const { data: stats } = useQuery({
    queryKey: ['adminOrderStats'],
    queryFn: async ({ signal }) => {
      const res = await adminApi.get('/admin/orders/stats', { signal });
      return res.data.data;
    },
    staleTime: 60000,
  });

  // Fetch return requests (admin queue: every return in the system).
  const { data: returnsData, isLoading: returnsLoading, refetch: refetchReturns } = useQuery({
    queryKey: ['adminReturns', returnsStatus, returnsSkip],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (returnsStatus) params.append('status', returnsStatus);
      params.append('skip', returnsSkip);
      params.append('limit', 20);
      const res = await adminApi.get(`/admin/orders/returns?${params.toString()}`, { signal });
      return res.data;
    },
    staleTime: 30000,
    enabled: activeTab === 'returns',
  });

  const handleDecide = async (row, decision) => {
    setDecidingId(row.id);
    setDecideError(null);
    setDecideSuccess(null);
    try {
      await adminApi.post(`/admin/orders/returns/${row.id}/decision`, {
        decision,
        note: (notes[row.id] || '').trim() || undefined,
      });
      setDecideSuccess(t('marketplaceReturns.decided'));
      setNotes((prev) => ({ ...prev, [row.id]: '' }));
      refetchReturns();
    } catch (err) {
      setDecideError(err?.response?.data?.error || t('marketplaceReturns.decideFailed'));
    } finally {
      setDecidingId(null);
    }
  };

  const returnStatusLabel = (value) => {
    if (!value) return t('marketplaceReturns.statusAll');
    return t(`marketplaceReturns.status${value.charAt(0).toUpperCase()}${value.slice(1)}`);
  };

  const handleFilterChange = (newFilters) => {
    setFilters({ ...filters, ...newFilters, skip: 0 });
  };

  // Typeahead suggestions for the order search, from the latest loaded order rows.
  const orderSuggestItems = useMemo(() => {
    const rows = data?.data || [];
    const seen = new Set();
    const items = [];
    for (const order of rows) {
      if (order.id == null || seen.has(order.id)) continue;
      seen.add(order.id);
      const title = order.customerName || order.customerEmail || `#${order.id}`;
      items.push({ id: order.id, title, meta: order.customerEmail || `#${order.id}` });
    }
    return items;
  }, [data]);

  const handleRowClick = (order) => {
    setSelectedOrder(order);
    setShowDetailModal(true);
  };

  const handlePageChange = (newSkip) => {
    setFilters({ ...filters, skip: newSkip });
  };

  const handleRefresh = () => {
    refetch();
  };

  if (error) {
    return (
      <div className="p-6">
        <PageMeta title={t('adminOrderManagement.metaTitle')} description={t('adminOrderManagement.metaDescription')} />
        <AdminErrorState
          title={t('adminOrderManagement.errorTitle')}
          message={error?.response?.data?.error || error?.message || t('adminOrderManagement.errorMessage')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageMeta title={t('adminOrderManagement.metaTitle')} description={t('adminOrderManagement.metaDescription')} />

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('adminOrderManagement.heading')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('adminOrderManagement.subheading')}</p>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition"
        >
          {t('adminOrderManagement.refresh')}
        </button>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="mb-6 grid gap-4 md:grid-cols-6">
          <StatCard label={t('adminOrderManagement.statTotalOrders')} value={stats.totalOrders} />
          <StatCard label={t('adminOrderManagement.statPending')} value={stats.pendingOrders} variant="warning" />
          <StatCard label={t('adminOrderManagement.statProcessing')} value={stats.processingOrders} variant="info" />
          <StatCard label={t('adminOrderManagement.statCompleted')} value={stats.completedOrders} variant="success" />
          <StatCard label={t('adminOrderManagement.statCancelled')} value={stats.cancelledOrders} variant="danger" />
          <StatCard label={t('adminOrderManagement.statRevenue')} value={`$${(stats.totalRevenueCents / 100).toFixed(2)}`} variant="success" />
        </div>
      )}

      {/* Queue tabs: orders, and the G1-B6 return queue */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setActiveTab('orders')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'orders' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`}
        >
          {t('adminOrderManagement.ordersTab')}
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'returns' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`}
        >
          {t('adminOrderManagement.returnsTab')}
        </button>
      </div>

      {activeTab === 'orders' ? (
        <>
          {/* Filters */}
          <OrderFilters filters={filters} onFilterChange={handleFilterChange} suggestItems={orderSuggestItems} />

          {/* Orders Table */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
                <p className="mt-2 text-gray-600 dark:text-gray-400">{t('adminOrderManagement.loadingOrders')}</p>
              </div>
            ) : !data?.data || data?.data?.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <p>{t('adminOrderManagement.noOrders')}</p>
              </div>
            ) : (
              <>
                <OrderManagementTable
                  orders={data?.data}
                  onRowClick={handleRowClick}
                />
                {data?.pagination && data.pagination.total > 0 && (
                  <Pagination
                    pagination={data.pagination}
                    onPageChange={handlePageChange}
                  />
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Return queue filter */}
          <div className="mb-4 flex items-center gap-2">
            <label htmlFor="admin-returns-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('marketplaceReturns.colStatus')}
            </label>
            <select
              id="admin-returns-status"
              value={returnsStatus}
              onChange={(e) => { setReturnsStatus(e.target.value); setReturnsSkip(0); }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {RETURN_STATUSES.map((value) => (
                <option key={value || 'all'} value={value}>{returnStatusLabel(value)}</option>
              ))}
            </select>
          </div>

          {decideError && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-900 dark:text-red-100">
              {decideError}
            </div>
          )}
          {decideSuccess && (
            <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-900 dark:text-green-100">
              {decideSuccess}
            </div>
          )}

          {/* Return queue table */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
            <ReturnsQueueTable
              returns={returnsData?.data || []}
              loading={returnsLoading}
              emptyText={t('marketplaceReturns.empty')}
              renderOrderLink={(row) => (
                <button
                  onClick={() => handleRowClick({ id: row.orderId })}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  #{row.orderId}
                </button>
              )}
              renderActions={(row) => row.status === 'requested' ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={notes[row.id] || ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder={t('marketplaceReturns.notePlaceholder')}
                    className="w-56 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={decidingId === row.id}
                      onClick={() => handleDecide(row, 'approved')}
                      className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {t('marketplaceReturns.approve')}
                    </button>
                    <button
                      disabled={decidingId === row.id}
                      onClick={() => handleDecide(row, 'declined')}
                      className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {t('marketplaceReturns.decline')}
                    </button>
                  </div>
                </div>
              ) : null}
            />
            {returnsData?.pagination && returnsData.pagination.total > 0 && (
              <Pagination
                pagination={returnsData.pagination}
                onPageChange={(newSkip) => setReturnsSkip(newSkip)}
              />
            )}
          </div>
        </>
      )}

      {/* Order Detail Modal */}
      {showDetailModal && selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedOrder(null);
          }}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, variant = 'default' }) {
  const variants = {
    default: 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white',
    warning: 'bg-yellow-50 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-100',
    info: 'bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100',
    success: 'bg-green-50 dark:bg-green-900 text-green-900 dark:text-green-100',
    danger: 'bg-red-50 dark:bg-red-900 text-red-900 dark:text-red-100',
  };

  return (
    <div className={`rounded-lg p-4 ${variants[variant]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Pagination({ pagination, onPageChange }) {
  const { t } = useTranslation();
  const currentPage = Math.floor(pagination.skip / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-700">
      <div className="text-sm text-gray-600 dark:text-gray-400">
        {t('adminOrderManagement.paginationShowing', {
          from: pagination.skip + 1,
          to: Math.min(pagination.skip + pagination.limit, pagination.total),
          total: pagination.total,
        })}
      </div>
      <div className="flex gap-2">
        <button
          disabled={pagination.skip === 0}
          onClick={() => onPageChange(Math.max(0, pagination.skip - pagination.limit))}
          className="rounded px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          {t('adminOrderManagement.previous')}
        </button>
        <span className="px-3 py-1 text-sm">
          {t('adminOrderManagement.pageOf', { current: currentPage, total: totalPages })}
        </span>
        <button
          disabled={!pagination.hasMore}
          onClick={() => onPageChange(pagination.skip + pagination.limit)}
          className="rounded px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          {t('adminOrderManagement.next')}
        </button>
      </div>
    </div>
  );
}
