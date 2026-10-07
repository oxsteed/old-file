import React, { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { createStableIdempotencyKeyStore } from '../../lib/idempotency';

export default function OrderDetailModal({ order, onClose, onRefresh }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('details');
  const [showMarkShipped, setShowMarkShipped] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState(order.totalCents);
  const refundIdempotencyKeysRef = useRef(createStableIdempotencyKeyStore());

  // Fetch full order details
  const { data: fullOrder, isLoading } = useQuery({
    queryKey: ['adminOrderDetail', order.id],
    queryFn: async () => {
      const res = await api.get(`/admin/orders/${order.id}`);
      return res.data.data;
    },
  });

  // Mark shipped mutation
  const markShippedMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/admin/orders/${order.id}/mark-shipped`, {
        trackingNumber: trackingNumber || undefined,
      });
    },
    onSuccess: () => {
      setShowMarkShipped(false);
      setTrackingNumber('');
      toast.success(t('adminOrderDetail.markedShipped'));
      onRefresh();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || t('adminOrderDetail.markShippedFailed'));
    },
  });

  // Refund mutation
  const refundMutation = useMutation({
    mutationFn: async ({ reason, amountCents }) => {
      const keyPayload = {
        orderId: order.id,
        reason,
        amountCents,
      };
      const idempotencyKey = refundIdempotencyKeysRef.current.get('marketplace-refund', keyPayload);
      await api.post(`/admin/orders/${order.id}/refund`, {
        reason,
        refundAmount: amountCents,
      }, {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      return { keyPayload };
    },
    onSuccess: (_result, variables) => {
      refundIdempotencyKeysRef.current.clear('marketplace-refund', variables.keyPayload);
      setShowRefund(false);
      setRefundReason('');
      toast.success(t('adminOrderDetail.refundProcessed'));
      onRefresh();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || t('adminOrderDetail.refundFailed'));
    },
  });

  // Cancel order mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/admin/orders/${order.id}/cancel`, {
        reason: 'Cancelled by admin',
      });
    },
    onSuccess: () => {
      toast.success(t('adminOrderDetail.orderCancelled'));
      onRefresh();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || t('adminOrderDetail.cancelFailed'));
    },
  });

  if (isLoading) {
    return (
      <Modal onClose={onClose}>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
        </div>
      </Modal>
    );
  }

  const d = fullOrder || order;
  const formatPrice = (cents) => `$${(cents / 100).toFixed(2)}`;
  const formatDate = (date) => new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const statusColor = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300 dark:border dark:border-yellow-800/50',
    paid: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 dark:border dark:border-blue-800/50',
    processing: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 dark:border dark:border-purple-800/50',
    completed: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300 dark:border dark:border-green-800/50',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300 dark:border dark:border-red-800/50',
    refunded: 'bg-gray-100 text-gray-800 dark:bg-gray-800/60 dark:text-gray-300 dark:border dark:border-gray-700/50',
  };

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('adminOrderDetail.orderTitle', { id: d.id })}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('adminOrderDetail.createdAt', { date: formatDate(d.dates?.createdAt || d.createdAt) })}
            </p>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[d.status] || 'bg-gray-100 text-gray-800'}`}>
              {d.status?.toUpperCase()}
            </span>
            <button
              onClick={onClose}
              aria-label={t('common.aria.closeButton')}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-4 border-b border-gray-200 dark:border-gray-700">
        {['details', 'items', 'payment', 'actions'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 px-1 font-medium text-sm ${
              activeTab === tab
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {t(`adminOrderDetail.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {activeTab === 'details' && (
          <div className="space-y-4">
            {/* Customer Info */}
            <Section title={t('adminOrderDetail.customerInformation')}>
              <InfoRow label={t('adminOrderDetail.name')} value={d.customer?.firstName + ' ' + d.customer?.lastName} />
              <InfoRow label={t('adminOrderDetail.email')} value={d.customer?.email} />
              <InfoRow label={t('adminOrderDetail.phone')} value={d.customer?.phone || 'N/A'} />
            </Section>

            {/* Shipping Info */}
            {d.shippingAddress && Object.keys(d.shippingAddress).length > 0 && (
              <Section title={t('adminOrderDetail.shippingAddress')}>
                <div className="space-y-1 text-sm">
                  <p>{d.shippingAddress.street}</p>
                  <p>{d.shippingAddress.city}, {d.shippingAddress.state} {d.shippingAddress.zip}</p>
                  <p>{d.shippingAddress.country}</p>
                </div>
              </Section>
            )}

            {/* Tracking Info */}
            {d.shipping && (
              <Section title={t('adminOrderDetail.shippingStatus')}>
                {d.shipping.trackingNumber ? (
                  <>
                    <InfoRow label={t('adminOrderDetail.trackingNumber')} value={d.shipping.trackingNumber} />
                    <InfoRow label={t('adminOrderDetail.shippedAt')} value={formatDate(d.shipping.shippedAt)} />
                  </>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('adminOrderDetail.notYetShipped')}</p>
                )}
              </Section>
            )}
          </div>
        )}

        {activeTab === 'items' && (
          <Section title={t('adminOrderDetail.orderItems')}>
            <div className="space-y-3">
              {d.items?.map((item) => (
                <div key={item.id} className="flex gap-4 pb-3 border-b border-gray-200 dark:border-gray-700 last:border-0">
                  {item.productImage && (
                    <img
                      src={item.productImage}
                      alt={item.productName}
                      className="h-12 w-12 rounded object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{item.productName}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {item.quantity} × {formatPrice(item.unitPriceCents)}
                    </p>
                  </div>
                  <div className="text-right font-semibold text-gray-900 dark:text-white">
                    {formatPrice(item.totalPriceCents)}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {activeTab === 'payment' && (
          <div className="space-y-4">
            <Section title={t('adminOrderDetail.orderTotals')}>
              <InfoRow label={t('adminOrderDetail.subtotal')} value={formatPrice(d.totals?.subtotalCents || 0)} />
              <InfoRow label={t('adminOrderDetail.tax')} value={formatPrice(d.totals?.taxCents || 0)} />
              <InfoRow label={t('adminOrderDetail.shipping')} value={formatPrice(d.totals?.shippingCents || 0)} />
              <InfoRow label={t('adminOrderDetail.discount')} value={`-${formatPrice(d.totals?.discountCents || 0)}`} />
              <hr className="my-2 border-gray-300 dark:border-gray-600" />
              <InfoRow
                label={t('adminOrderDetail.total')}
                value={formatPrice(d.totals?.totalCents || 0)}
                className="font-bold text-lg"
              />
            </Section>

            {d.transaction && (
              <Section title={t('adminOrderDetail.paymentTransaction')}>
                <InfoRow label={t('adminOrderDetail.paymentIntent')} value={d.transaction.paymentIntentId} monospace />
                <InfoRow label={t('adminOrderDetail.amount')} value={formatPrice(d.transaction.amountCents)} />
                <InfoRow label={t('adminOrderDetail.status')} value={d.transaction.status?.toUpperCase()} />
                {d.transaction.completedAt && (
                  <InfoRow label={t('adminOrderDetail.completed')} value={formatDate(d.transaction.completedAt)} />
                )}
              </Section>
            )}

            {d.refund?.refundedAt && (
              <Section title={t('adminOrderDetail.refundInformation')}>
                <InfoRow label={t('adminOrderDetail.refundedAt')} value={formatDate(d.refund.refundedAt)} />
                <InfoRow label={t('adminOrderDetail.reason')} value={d.refund.refundReason} />
              </Section>
            )}
          </div>
        )}

        {activeTab === 'actions' && (
          <div className="space-y-4">
            {!d.shipping?.trackingNumber && d.status !== 'cancelled' && d.status !== 'refunded' && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900 rounded-lg">
                {!showMarkShipped ? (
                  <button
                    onClick={() => setShowMarkShipped(true)}
                    className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 font-medium"
                  >
                    {t('adminOrderDetail.markAsShipped')}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder={t('adminOrderDetail.trackingNumberPlaceholder')}
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => markShippedMutation.mutate()}
                        disabled={markShippedMutation.isPending}
                        className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
                      >
                        {markShippedMutation.isPending ? t('adminOrderDetail.saving') : t('common.confirm')}
                      </button>
                      <button
                        onClick={() => {
                          setShowMarkShipped(false);
                          setTrackingNumber('');
                        }}
                        className="flex-1 rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {d.status === 'paid' && !d.refund?.refundedAt && (
              <div className="p-4 bg-orange-50 dark:bg-orange-900 rounded-lg">
                {!showRefund ? (
                  <button
                    onClick={() => setShowRefund(true)}
                    className="w-full rounded bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 font-medium"
                  >
                    {t('adminOrderDetail.processRefund')}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('adminOrderDetail.refundAmount')}</label>
                      <input
                        type="number"
                        value={refundAmount / 100}
                        onChange={(e) => setRefundAmount(Math.round(parseFloat(e.target.value) * 100))}
                        step="0.01"
                        className="w-full rounded border border-gray-300 px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('adminOrderDetail.reason')}</label>
                      <textarea
                        placeholder={t('adminOrderDetail.refundReasonPlaceholder')}
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        className="w-full rounded border border-gray-300 px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        rows="2"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => refundMutation.mutate({ reason: refundReason, amountCents: refundAmount })}
                        disabled={!refundReason || refundMutation.isPending}
                        className="flex-1 rounded bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 disabled:opacity-50 font-medium"
                      >
                        {refundMutation.isPending ? t('adminOrderDetail.processing') : t('adminOrderDetail.processRefund')}
                      </button>
                      <button
                        onClick={() => {
                          setShowRefund(false);
                          setRefundReason('');
                        }}
                        className="flex-1 rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {d.status !== 'cancelled' && d.status !== 'refunded' && (
              <div className="p-4 bg-red-50 dark:bg-red-900 rounded-lg">
                <button
                  onClick={() => {
                    if (confirm(t('adminOrderDetail.confirmCancelOrder'))) {
                      cancelMutation.mutate();
                    }
                  }}
                  disabled={cancelMutation.isPending}
                  className="w-full rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50 font-medium"
                >
                  {cancelMutation.isPending ? t('adminOrderDetail.cancelling') : t('adminOrderDetail.cancelOrder')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
          <div className="overflow-y-auto max-h-[90vh] p-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-4 last:border-0">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value, monospace = false, className = '' }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className={`text-gray-900 dark:text-white font-medium ${monospace ? 'font-mono text-xs' : ''} ${className}`}>
        {value}
      </span>
    </div>
  );
}
