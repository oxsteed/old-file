import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function AdminFoodOrders() {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/admin/food-orders', {
        params: { status: status || undefined, limit: 20 },
      });
      setOrders(data.orders);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  return (
    <div className="admin-page">
      <h1>Food Orders</h1>
      <div className="admin-filters">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
        <span>{total} orders</span>
      </div>
      {loading ? <p>Loading...</p> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Restaurant</th>
              <th>Queue</th>
              <th>Status</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td><Link to={`/admin/food-orders/${o.id}`}>#{o.id}</Link></td>
                <td>{o.restaurant_name}</td>
                <td>{o.queue_number || '-'}</td>
                <td>{o.status}</td>
                <td>${(o.total_cents / 100).toFixed(2)}</td>
                <td>{o.payment_status}</td>
                <td>{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
