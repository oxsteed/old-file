import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from '../../api/axios';
import PageMeta from '../../components/PageMeta';
import OrderManagementTable from '../components/OrderManagementTable';
import OrderDetailModal from '../components/OrderDetailModal';
import OrderFilters from '../components/OrderFilters';

export default function OrderManagement() {
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

  // Fetch orders
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminOrders', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.search) params.append('search', filters.search);
      params.append('skip', filters.skip);
      params.append('limit', filters.limit);
      params.append('sortBy', filters.sortBy);
      params.append('sortOrder', filters.sortOrder);

      const res = await axios.get(`/api/admin/orders?${params.toString()}`);
      return res.data;
    },
    staleTime: 30000,
  });

  // Fetch order statistics
  const { data: stats } = useQuery({
    queryKey: ['adminOrderStats'],
    queryFn: async () => {
      const res = await axios.get('/api/admin/orders/stats');
      return res.data.data;
    },
    staleTime: 60000,
  });

  const handleFilterChange = (newFilters) => {
    setFilters({ ...filters, ...newFilters, skip: 0 });
  };

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
        <PageMeta title="Order Management" description="Manage marketplace orders" />
        <div className="rounded-lg bg-red-50 p-4 text-red-800">
          <p className="font-semibold">Error loading orders</p>
          <p className="text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageMeta title="Order Management" description="Manage marketplace orders" />

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Order Management</h1>
          <p className="text-gray-600 dark:text-gray-400">View, filter, and manage all marketplace orders</p>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition"
        >
          Refresh
        </button>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="mb-6 grid gap-4 md:grid-cols-6">
          <StatCard label="Total Orders" value={stats.totalOrders} />
          <StatCard label="Pending" value={stats.pendingOrders} variant="warning" />
          <StatCard label="Processing" value={stats.processingOrders} variant="info" />
          <StatCard label="Completed" value={stats.completedOrders} variant="success" />
          <StatCard label="Cancelled" value={stats.cancelledOrders} variant="danger" />
          <StatCard label="Revenue" value={`$${(stats.totalRevenueCents / 100).toFixed(2)}`} variant="success" />
        </div>
      )}

      {/* Filters */}
      <OrderFilters filters={filters} onFilterChange={handleFilterChange} />

      {/* Orders Table */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading orders...</p>
          </div>
        ) : !data?.data || data?.data?.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <p>No orders found</p>
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
  const currentPage = Math.floor(pagination.skip / pagination.limit) + 1;
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-700">
      <div className="text-sm text-gray-600 dark:text-gray-400">
        Showing {pagination.skip + 1} to {Math.min(pagination.skip + pagination.limit, pagination.total)} of {pagination.total}
      </div>
      <div className="flex gap-2">
        <button
          disabled={pagination.skip === 0}
          onClick={() => onPageChange(Math.max(0, pagination.skip - pagination.limit))}
          className="rounded px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          Previous
        </button>
        <span className="px-3 py-1 text-sm">
          Page {currentPage} of {totalPages}
        </span>
        <button
          disabled={!pagination.hasMore}
          onClick={() => onPageChange(pagination.skip + pagination.limit)}
          className="rounded px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          Next
        </button>
      </div>
    </div>
  );
}
