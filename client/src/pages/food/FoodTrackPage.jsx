import useAppResume from '../../hooks/useAppResume';
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import toast from 'react-hot-toast';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import { deleteFoodOrderReview, submitFoodOrderReview, updateFoodOrderReview } from '../../api/food';
import { formatTrackedMoney, trackedItemDisplay } from './foodOrderingHelpers';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import '../../styles/FoodPages.css';

const STATUS_STEPS = ['received', 'accepted', 'preparing', 'ready', 'completed'];

export default function FoodTrackPage() {
  const { t, i18n } = useTranslation();
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

  const active = !order || ['received','accepted','preparing','ready'].includes(order.status);
  const refreshActive = useCallback(() => { if (document.visibilityState !== 'hidden' && active) return load(); }, [load, active]);
  useAppResume(refreshActive, active);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!active) return undefined;
    const interval = setInterval(refreshActive, 30000);
    return () => clearInterval(interval);
  }, [refreshActive, active]);
  useEffect(() => active && order?.restaurant_id ? subscribeRestaurantDisplay(order.restaurant_id, refreshActive) : undefined,
    [order?.restaurant_id, refreshActive, active]);

  const handlePrint = () => window.print();
  const handleRetry = () => {
    setLoading(true);
    load();
  };

  // Review entry: the server accepts one review per completed order, and a
  // guest proves ownership with the same tracking token that opened this
  // page (signed-in customers prove it with their session).
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);

  useEffect(() => {
    setReviewDone(Boolean(order?.has_review));
  }, [order?.has_review]);

  const submitReview = async () => {
    if (!order || reviewSubmitting) return;
    if (!Number.isInteger(reviewRating) || reviewRating < 1 || reviewRating > 5) return;
    setReviewSubmitting(true);
    try {
      if (order.has_review || reviewDone) {
        await updateFoodOrderReview(order.id, { rating: reviewRating, body: reviewBody.trim() || undefined, trackingToken: token });
      } else {
        await submitFoodOrderReview(order.id, { rating: reviewRating, body: reviewBody.trim() || undefined, trackingToken: token });
      }
      setReviewDone(true);
      toast.success(t('food.order.reviewThanks'));
      load();
    } catch (err) {
      const message = err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(typeof message === 'string' ? message : t('food.order.reviewError'));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const removeReview = async () => {
    if (!order || reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      await deleteFoodOrderReview(order.id, { trackingToken: token });
      setReviewDone(false);
      setReviewBody('');
      toast.success(t('food.order.reviewDeleted'));
      load();
    } catch (err) {
      const message = err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(typeof message === 'string' ? message : t('food.order.reviewError'));
    } finally {
      setReviewSubmitting(false);
    }
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
                {order.items.map((item, i) => {
                  const shown = trackedItemDisplay(item);
                  return (
                    <div key={i} className="food-track-item">
                      <span>{shown.quantity}x {shown.name}</span>
                      <span>{formatTrackedMoney(shown.lineTotalCents, order.currency_code, i18n.resolvedLanguage)}</span>
                    </div>
                  );
                })}
                <div className="food-track-total">
                  <strong>{t('food.track.total', 'Total')}: {formatTrackedMoney(order.total_cents, order.currency_code, i18n.resolvedLanguage)}</strong>
                </div>
              </div>
            )}
            {order.status === 'completed' && (
              <div className="food-track-review">
                <h2>{reviewDone ? t('food.track.reviewDone') : t('food.track.reviewTitle')}</h2>
                {reviewDone ? (
                  <>
                    <p>{t('food.track.reviewThanks')}</p>
                    <button type="button" onClick={removeReview} disabled={reviewSubmitting} data-track="ui.225e02a1a4.3">
                      {t('food.track.reviewDelete')}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="food-track-stars" role="radiogroup" aria-label={t('food.track.reviewTitle')}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          role="radio"
                          aria-checked={reviewRating === star}
                          onClick={() => setReviewRating(star)}
                          data-track="ui.225e02a1a4.4"
                        >
                          {star <= reviewRating ? '★' : '☆'}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewBody}
                      onChange={(e) => setReviewBody(e.target.value)}
                      placeholder={t('food.track.reviewPlaceholder')}
                      rows={3}
                      maxLength={2000}
                    />
                    <button type="button" onClick={submitReview} disabled={reviewSubmitting} data-track="ui.225e02a1a4.5">
                      {reviewSubmitting ? t('common.sending') : t('food.track.reviewSubmit')}
                    </button>
                  </>
                )}
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
