import React from 'react';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-blue-100 text-blue-800',
  processing: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-gray-100 text-gray-800',
};

export default function OrderManagementTable({ orders, onRowClick }) {
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPrice = (cents) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Order ID</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Customer</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Email</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Status</th>
            <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-white">Amount</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              onClick={() => onRowClick(order)}
              className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition"
            >
              <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">#{order.id}</td>
              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                {order.customerName}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                {order.customerEmail}
              </td>
              <td className="px-6 py-4 text-sm">
                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900 dark:text-white">
                {formatPrice(order.totalCents)}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                {formatDate(order.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
