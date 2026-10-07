import React, { useState } from 'react';
import api from '../../api/axios';

export default function POSOrderActions({ restaurantId, orderId, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const callApi = async (method, url, data) => {
    setLoading(true);
    try {
      await api({ method, url, data });
      if (onUpdate) onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSplit = () => {
    // TODO: item selection UI. For now, splits via API directly.
    alert('Select items to split in the ticket view');
  };

  const handleMerge = () => {
    const sourceId = prompt('Enter source order ID to merge from:');
    if (!sourceId) return;
    callApi('post', `/api/food/restaurants/${restaurantId}/pos/orders/${orderId}/merge`, {
      sourceOrderId: parseInt(sourceId, 10),
    });
  };

  const handleVoid = () => {
    if (!window.confirm('Void this order? This cannot be undone.')) return;
    callApi('patch', `/api/food/restaurants/${restaurantId}/orders/${orderId}/status`, {
      status: 'cancelled',
      reason: 'Voided from POS',
    });
  };

  const handleRefund = () => {
    if (!refundReason.trim()) {
      alert('Refund reason is required');
      return;
    }
    callApi('post', `/api/food/restaurants/${restaurantId}/pos/orders/${orderId}/refund`, {
      amount_cents: refundAmount ? parseInt(refundAmount, 10) : undefined,
      reason: refundReason,
    });
    setShowRefund(false);
  };

  const handleReprint = () => window.print();

  return (
    <div className="pos-order-actions">
      <button onClick={handleSplit} disabled={loading}>Split</button>
      <button onClick={handleMerge} disabled={loading}>Merge</button>
      <button onClick={handleVoid} disabled={loading} className="danger">Void</button>
      <button onClick={() => setShowRefund(!showRefund)} disabled={loading}>Refund</button>
      <button onClick={handleReprint} disabled={loading}>Reprint</button>

      {showRefund && (
        <div className="pos-refund-form">
          <input
            type="number"
            value={refundAmount}
            onChange={e => setRefundAmount(e.target.value)}
            placeholder="Amount in cents (blank = full)"
          />
          <input
            value={refundReason}
            onChange={e => setRefundReason(e.target.value)}
            placeholder="Reason (required)"
          />
          <button onClick={handleRefund} disabled={loading}>Issue Refund</button>
        </div>
      )}
    </div>
  );
}
