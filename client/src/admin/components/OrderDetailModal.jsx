import React, { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { createStableIdempotencyKeyStore } from '../../lib/idempotency';

export default function OrderDetailModal({ order, onClose, onRefresh }) {
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
      toast.success('Order marked shipped');
      onRefresh();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || 'Could not mark order shipped');
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
      toast.success('Refund processed');
      onRefresh();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || 'Could not process refund');
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
      toast.success('Order cancelled');
      onRefresh();
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || 'Could not cancel order');
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
    pending: 'bg-yellow-100 text-yellow-800',
    paid: 'bg-blue-100 text-blue-800',
    processing: 'bg-purple-100 text-purple-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    refunded: 'bg-gray-100 text-gray-800',
  };

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Order #{d.id}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Created {formatDate(d.dates?.createdAt || d.createdAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[d.status] || 'bg-gray-100 text-gray-800'}`}>
              {d.status?.toUpperCase()}
            </span>
            <button
              onClick={onClose}
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
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {activeTab === 'details' && (
          <div className="space-y-4">
            {/* Customer Info */}
            <Section title="Customer Information">
              <InfoRow label="Name" value={d.customer?.firstName + ' ' + d.customer?.lastName} />
              <InfoRow label="Email" value={d.customer?.email} />
              <InfoRow label="Phone" value={d.customer?.phone || 'N/A'} />
            </Section>

            {/* Shipping Info */}
            {d.shippingAddress && Object.keys(d.shippingAddress).length > 0 && (
              <Section title="Shipping Address">
                <div className="space-y-1 text-sm">
                  <p>{d.shippingAddress.street}</p>
                  <p>{d.shippingAddress.city}, {d.shippingAddress.state} {d.shippingAddress.zip}</p>
                  <p>{d.shippingAddress.country}</p>
                </div>
              </Section>
            )}

            {/* Tracking Info */}
            {d.shipping && (
              <Section title="Shipping Status">
                {d.shipping.trackingNumber ? (
                  <>
                    <InfoRow label="Tracking Number" value={d.shipping.trackingNumber} />
                    <InfoRow label="Shipped At" value={formatDate(d.shipping.shippedAt)} />
                  </>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-400">Not yet shipped</p>
                )}
              </Section>
            )}
          </div>
        )}

        {activeTab === 'items' && (
          <Section title="Order Items">
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
            <Section title="Order Totals">
              <InfoRow label="Subtotal" value={formatPrice(d.totals?.subtotalCents || 0)} />
              <InfoRow label="Tax" value={formatPrice(d.totals?.taxCents || 0)} />
              <InfoRow label="Shipping" value={formatPrice(d.totals?.shippingCents || 0)} />
              <InfoRow label="Discount" value={`-${formatPrice(d.totals?.discountCents || 0)}`} />
              <hr className="my-2 border-gray-300 dark:border-gray-600" />
              <InfoRow
                label="Total"
                value={formatPrice(d.totals?.totalCents || 0)}
                className="font-bold text-lg"
              />
            </Section>

            {d.transaction && (
              <Section title="Payment Transaction">
                <InfoRow label="Payment Intent" value={d.transaction.paymentIntentId} monospace />
                <InfoRow label="Amount" value={formatPrice(d.transaction.amountCents)} />
                <InfoRow label="Status" value={d.transaction.status?.toUpperCase()} />
                {d.transaction.completedAt && (
                  <InfoRow label="Completed" value={formatDate(d.transaction.completedAt)} />
                )}
              </Section>
            )}

            {d.refund?.refundedAt && (
              <Section title="Refund Information">
                <InfoRow label="Refunded At" value={formatDate(d.refund.refundedAt)} />
                <InfoRow label="Reason" value={d.refund.refundReason} />
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
                    Mark as Shipped
                  </button>
                ) : (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Tracking number (optional)"
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
                        {markShippedMutation.isPending ? 'Saving...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => {
                          setShowMarkShipped(false);
                          setTrackingNumber('');
                        }}
                        className="flex-1 rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                      >
                        Cancel
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
                    Process Refund
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Refund Amount</label>
                      <input
                        type="number"
                        value={refundAmount / 100}
                        onChange={(e) => setRefundAmount(Math.round(parseFloat(e.target.value) * 100))}
                        step="0.01"
                        className="w-full rounded border border-gray-300 px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Reason</label>
                      <textarea
                        placeholder="Reason for refund..."
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
                        {refundMutation.isPending ? 'Processing...' : 'Process Refund'}
                      </button>
                      <button
                        onClick={() => {
                          setShowRefund(false);
                          setRefundReason('');
                        }}
                        className="flex-1 rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                      >
                        Cancel
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
                    if (confirm('Are you sure you want to cancel this order?')) {
                      cancelMutation.mutate();
                    }
                  }}
                  disabled={cancelMutation.isPending}
                  className="w-full rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50 font-medium"
                >
                  {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Order'}
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
