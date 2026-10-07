import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

export default function AdminFoodOrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/admin/food-orders/${id}`, {
        params: { purpose: 'admin_detail_view' },
      });
      setOrder(data.order);
      setItems(data.items);
    } catch (err) {
      console.error('Failed to load', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      alert('Refund reason is required');
      return;
    }
    setRefunding(true);
    try {
      await axios.post(`/api/admin/food-orders/${id}/refund`, {
        amount_cents: refundAmount ? parseInt(refundAmount, 10) : undefined,
        reason: refundReason,
      });
      alert('Refund recorded');
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setRefunding(false);
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!order) return <p>Order not found.</p>;

  const canRefund = ['paid', 'partially_refunded'].includes(order.payment_status);

  return (
    <div className="admin-page">
      <h1>Food Order #{order.id}</h1>
      <div className="admin-detail-grid">
        <div><strong>Restaurant:</strong> {order.restaurant_name}</div>
        <div><strong>Status:</strong> {order.status}</div>
        <div><strong>Payment:</strong> {order.payment_status}</div>
        <div><strong>Total:</strong> ${(order.total_cents / 100).toFixed(2)} {order.currency_code}</div>
        <div><strong>Queue:</strong> {order.queue_number || '-'}</div>
        <div><strong>Fulfillment:</strong> {order.fulfillment_type}</div>
        <div><strong>Guest:</strong> {order.guest_name || '-'} {order.guest_phone || ''}</div>
        <div><strong>Created:</strong> {new Date(order.created_at).toLocaleString()}</div>
      </div>
      <h2>Items</h2>
      <table className="admin-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.quantity}</td>
              <td>${(item.price_cents / 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canRefund && (
        <div className="admin-refund-section">
          <h2>Issue Refund</h2>
          <input
            type="number"
            value={refundAmount}
            onChange={e => setRefundAmount(e.target.value)}
            placeholder={`Amount in cents (default: ${order.total_cents})`}
          />
          <textarea
            value={refundReason}
            onChange={e => setRefundReason(e.target.value)}
            placeholder="Refund reason (required)"
          />
          <button onClick={handleRefund} disabled={refunding}>
            {refunding ? 'Processing...' : 'Issue Refund'}
          </button>
        </div>
      )}
    </div>
  );
}
