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

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!order) return <p>Order not found.</p>;

  return (
    <div className="food-track-page">
      <h1>Order #{order.queue_number || order.id}</h1>
      <div className="food-track-status">
        <p><strong>Status:</strong> {order.status}</p>
        {order.estimated_ready_at && (
          <p><strong>Ready around:</strong> {new Date(order.estimated_ready_at).toLocaleTimeString()}</p>
        )}
      </div>
      {order.items && (
        <div className="food-track-items">
          <h2>Items</h2>
          {order.items.map((item, i) => (
            <div key={i}>{item.quantity}x {item.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
