import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

export default function FoodTrackPage() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get(`/api/food/orders/track/${token}`)
      .then(r => setOrder(r.data.order))
      .catch(e => setError(e.response?.data?.error || 'Order not found'))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePrint = () => window.print();

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!order) return <p>Order not found.</p>;

  const statusSteps = ['received', 'accepted', 'preparing', 'ready', 'completed'];
  const currentIdx = statusSteps.indexOf(order.status);

  return (
    <div className="food-track-page">
      <h1>Order #{order.queue_number || order.id}</h1>
      <p className="food-track-restaurant">{order.restaurant_name}</p>

      <div className="food-track-timeline">
        {statusSteps.map((step, i) => (
          <div key={step} className={`food-track-step ${i <= currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}>
            <div className="food-track-dot" />
            <span>{step}</span>
          </div>
        ))}
      </div>

      <div className="food-track-status">
        <p><strong>Status:</strong> {order.status}</p>
        {order.estimated_ready_at && (
          <p><strong>Ready around:</strong> {new Date(order.estimated_ready_at).toLocaleTimeString()}</p>
        )}
        {order.payment_status && (
          <p><strong>Payment:</strong> {order.payment_status}</p>
        )}
      </div>

      {order.items && (
        <div className="food-track-items">
          <h2>Items</h2>
          {order.items.map((item, i) => (
            <div key={i} className="food-track-item">
              <span>{item.quantity}x {item.name}</span>
              <span>${((item.price_cents * item.quantity) / 100).toFixed(2)}</span>
            </div>
          ))}
          <div className="food-track-total">
            <strong>Total: ${(order.total_cents / 100).toFixed(2)}</strong>
          </div>
        </div>
      )}

      <button onClick={handlePrint} className="food-track-print">
        Print Receipt
      </button>
    </div>
  );
}
