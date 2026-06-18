// Poll + `/restaurant-display` socket refresh for a guest-tracked food order.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTrackedFoodOrder } from '../../api/food';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';

const POLL_MS = 4000;
const ACTIVE_STATUSES = new Set(['received', 'accepted', 'preparing', 'ready']);

export function useLiveFoodOrder({
  restaurantId,
  trackingToken,
  initialOrder,
  enabled = true,
}) {
  const [order, setOrder] = useState(initialOrder || null);
  const timerRef = useRef(null);

  useEffect(() => {
    setOrder(initialOrder || null);
  }, [initialOrder]);

  const refresh = useCallback(() => {
    if (!trackingToken) return Promise.resolve();
    return getTrackedFoodOrder(trackingToken)
      .then((next) => {
        if (next) setOrder(next);
      })
      .catch(() => {});
  }, [trackingToken]);

  useEffect(() => {
    if (!enabled || !trackingToken || !restaurantId) return undefined;
    refresh();
    timerRef.current = setInterval(refresh, POLL_MS);
    const unsubscribe = subscribeRestaurantDisplay(restaurantId, refresh);
    return () => {
      clearInterval(timerRef.current);
      unsubscribe();
    };
  }, [enabled, restaurantId, trackingToken, refresh]);

  return {
    order,
    refresh,
    isActive: Boolean(order && ACTIVE_STATUSES.has(order.status)),
  };
}
