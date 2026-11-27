import React from 'react';
import { useTranslation } from 'react-i18next';

// G1-B6: one return-queue table for both queues that read it: the admin
// Returns tab on /admin/orders and the merchant page at
// /marketplace/returns. The rows carry the same shape from both list
// endpoints. `renderActions` is the admin decide column (approve /
// decline); the merchant page passes none and the table is read-only.
const statusColors = {
  requested: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  refunded: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export default function ReturnsQueueTable({ returns, loading, emptyText, renderActions, renderOrderLink }) {
  const { t } = useTranslation();

  const formatDate = (date) => new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const formatPrice = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

  const statusLabel = (status) => {
    const key = `marketplaceReturns.status${String(status || '').charAt(0).toUpperCase()}${String(status || '').slice(1)}`;
    return t(key);
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('marketplaceReturns.loading')}</p>
      </div>
    );
  }

  if (!returns || returns.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        <p>{emptyText || t('marketplaceReturns.empty')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colOrder')}</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colCustomer')}</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colReason')}</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colStatus')}</th>
            <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colRequested')}</th>
            <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colTotal')}</th>
            {renderActions && (
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">{t('marketplaceReturns.colDecision')}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {returns.map((row) => (
            <tr key={row.id} className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                {renderOrderLink ? renderOrderLink(row) : `#${row.orderId}`}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                {row.customerName || row.customerEmail}
                {row.customerName && row.customerEmail && (
                  <span className="block text-xs">{row.customerEmail}</span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{row.reason}</td>
              <td className="px-6 py-4 text-sm">
                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColors[row.status] || 'bg-gray-100 text-gray-800'}`}>
                  {statusLabel(row.status)}
                </span>
                {row.adminNote && (
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{row.adminNote}</span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{formatDate(row.createdAt)}</td>
              <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900 dark:text-white">
                {formatPrice(row.orderTotalCents)}
              </td>
              {renderActions && (
                <td className="px-6 py-4 text-sm">{renderActions(row)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
