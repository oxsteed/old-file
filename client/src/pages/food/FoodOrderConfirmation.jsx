// Shared post-order confirmation: live status via socket + poll, optional review.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { formatFoodMoney, submitFoodOrderReview } from '../../api/food';
import { FoodBrand, FOOD_STATUS_KEYS } from './foodShared';
import { useLiveFoodOrder } from './useLiveFoodOrder';

export default function FoodOrderConfirmation({
  restaurantId,
  order: initialOrder,
  trackingToken,
  currency = 'USD',
  variant = 'page',
  onDismiss,
  dismissLabel,
  children,
}) {
  const { t } = useTranslation();
  const { order } = useLiveFoodOrder({
    restaurantId,
    trackingToken,
    initialOrder,
    enabled: Boolean(trackingToken && restaurantId),
  });
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewed, setReviewed] = useState(Boolean(initialOrder?.has_review));

  useEffect(() => {
    setReviewed(Boolean(order?.has_review));
  }, [order?.has_review]);

  if (!order) return null;

  const statusKey = FOOD_STATUS_KEYS[order.status] || FOOD_STATUS_KEYS.received;
  const showReview = order.status === 'completed' && !reviewed;
  const wrapperClass = variant === 'kiosk' ? 'fd-kiosk-start' : 'fd-page fd-confirm';
  const isReady = order.status === 'ready';

  const submitReview = async () => {
    setSubmitting(true);
    try {
      await submitFoodOrderReview(order.id, {
        rating,
        body: body.trim() || undefined,
        trackingToken,
      });
      setReviewed(true);
      toast.success(t('food.order.reviewThanks'));
    } catch (err) {
      const message = err?.response?.data?.error?.message || err?.response?.data?.message;
      toast.error(typeof message === 'string' ? message : t('food.order.reviewError'));
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <>
      <FoodBrand size={variant === 'kiosk' ? 64 : 48} />
      <h2>{variant === 'kiosk' ? t('food.kiosk.thanks') : t('food.order.confirmedTitle')}</h2>
      <p>{t('food.order.yourNumber')}</p>
      <div className="fd-queue-big">#{order.queue_number}</div>

      <div className={`fd-live-status fd-live-status-${order.status}`}>
        <span className="fd-live-dot" aria-hidden="true" />
        <span>{t('food.order.liveStatus')}: {t(statusKey)}</span>
      </div>

      {isReady && (
        <p className="fd-ready-callout">{t('food.order.readyForPickup')}</p>
      )}

      <p className="fd-pay-note">{t('food.order.payInStoreNote')}</p>
      <p>
        {t('food.order.total')}: <strong>{formatFoodMoney(order.total_cents, currency)}</strong>
      </p>

      {showReview && (
        <div className="fd-review-prompt">
          <h3>{t('food.order.rateExperience')}</h3>
          <p className="fd-kds-meta">{t('food.order.rateHint')}</p>
          <div className="fd-star-row" role="group" aria-label={t('food.order.rateExperience')}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`fd-star-btn${star <= rating ? ' fd-star-on' : ''}`}
                onClick={() => setRating(star)}
                aria-pressed={star <= rating}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="fd-review-text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('food.order.reviewOptional')}
            maxLength={500}
            rows={3}
          />
          <button
            type="button"
            className="fd-btn"
            disabled={submitting}
            onClick={submitReview}
          >
            {submitting ? t('food.common.saving') : t('food.order.submitReview')}
          </button>
        </div>
      )}

      {children}

      {onDismiss && (
        <p style={{ fontSize: '0.95rem', color: '#94a3b8', marginTop: '1rem' }}>
          <button type="button" className="fd-btn fd-btn-secondary" onClick={onDismiss}>
            {dismissLabel || t('food.order.orderAgain')}
          </button>
        </p>
      )}
    </>
  );

  if (variant === 'kiosk') {
    return (
      <div
        className={wrapperClass}
        onClick={showReview ? undefined : onDismiss}
        role={showReview ? undefined : 'button'}
        tabIndex={showReview ? undefined : 0}
        onKeyDown={showReview ? undefined : (e) => e.key === 'Enter' && onDismiss?.()}
      >
        {content}
        {!showReview && (
          <p style={{ fontSize: '0.95rem', color: '#94a3b8' }}>{t('food.kiosk.tapForNext')}</p>
        )}
      </div>
    );
  }

  return <div className={wrapperClass}>{content}</div>;
}
