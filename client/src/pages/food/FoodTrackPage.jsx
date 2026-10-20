import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {subscribeRestaurantDisplay} from '../../api/restaurantDisplaySocket';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import '../../styles/FoodPages.css';

const STATUS_STEPS = ['received', 'accepted', 'preparing', 'ready', 'completed'];

export default function FoodTrackPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data } = await axios.get(`/api/food/orders/track/${token}`);
      setOrder(data.order);
    } catch (e) {
      setError(e.response?.data?.error || t('food.track.notFound', 'Order not found'));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(()=>order?.restaurant_id?subscribeRestaurantDisplay(order.restaurant_id,load):undefined,[order?.restaurant_id,load]);

  const handlePrint = () => window.print();
  const handleRetry = () => {
    setLoading(true);
    load();
  };

  const currentIdx = STATUS_STEPS.indexOf(order?.status);

  return (
    <PageShell>
      <PageMeta title={t('food.track.title', 'Track Order')} />
      <div className="food-track-page">
        {loading && (
          <div className="food-track-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        )}
        {error && !loading && (
          <div className="food-track-error">
            <p>{error}</p>
            <button onClick={handleRetry} data-track="ui.225e02a1a4.1">{t('common.retry', 'Retry')}</button>
          </div>
        )}
        {order && !loading && (
          <>
            <h1>{t('food.track.order', 'Order')} #{order.queue_number || order.id}</h1>
            {order.restaurant_name && (
              <p className="food-track-restaurant">{order.restaurant_name}</p>
            )}
            <div className="food-track-timeline">
              {STATUS_STEPS.map((step, i) => (
                <div key={step} className={`food-track-step ${i <= currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}>
                  <div className="food-track-dot" />
                  <span>{t(`food.status.${step}`, step)}</span>
                </div>
              ))}
            </div>
            <div className="food-track-status">
              <p><strong>{t('food.track.status', 'Status')}:</strong> {t(`food.status.${order.status}`, order.status)}</p>
              {order.estimated_ready_at && (
                <p><strong>{t('food.track.readyAround', 'Ready around')}:</strong> {new Date(order.estimated_ready_at).toLocaleTimeString()}</p>
              )}
              {order.payment_status && (
                <p><strong>{t('food.track.payment', 'Payment')}:</strong> {order.payment_status}</p>
              )}
              {order.runner_location && (
                <p className="food-track-runner">
                  <strong>{t('food.track.runnerNearby', 'Runner nearby')}:</strong>{' '}
                  {t('food.track.runnerUpdatedAgo', 'location updated {{seconds}}s ago', {
                    seconds: Math.max(0, Math.round((Date.now() - new Date(order.runner_location.capturedAt).getTime()) / 1000)),
                  })}
                </p>
              )}
            </div>
            {order.items && order.items.length > 0 && (
              <div className="food-track-items">
                <h2>{t('food.track.items', 'Items')}</h2>
                {order.items.map((item, i) => (
                  <div key={i} className="food-track-item">
                    <span>{item.quantity}x {item.name}</span>
                    <span>${((item.price_cents * item.quantity) / 100).toFixed(2)}</span>
                  </div>
                ))}
                <div className="food-track-total">
                  <strong>{t('food.track.total', 'Total')}: ${(order.total_cents / 100).toFixed(2)}</strong>
                </div>
              </div>
            )}
            <button onClick={handlePrint} className="food-track-print" data-track="ui.225e02a1a4.2">
              {t('food.track.printReceipt', 'Print Receipt')}
            </button>
          </>
        )}
      </div>
    </PageShell>
  );
}
