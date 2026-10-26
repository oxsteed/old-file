import useAppResume from '../../hooks/useAppResume';
// Poll + `/restaurant-display` socket refresh for a guest-tracked food order.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTrackedFoodOrder } from '../../api/food';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';

const POLL_MS = 30000;
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
  }, [initialOrder, trackingToken]);

  const refresh = useCallback(() => {
    if (!trackingToken) return Promise.resolve();
    return getTrackedFoodOrder(trackingToken)
      .then((next) => {
        if (next) setOrder(next);
      })
      .catch(() => {});
  }, [trackingToken]);

  const active = !order || ACTIVE_STATUSES.has(order.status);
  const automaticRefresh = useCallback(() => { if (document.visibilityState !== 'hidden' && active) return refresh(); }, [refresh, active]);
  useAppResume(automaticRefresh, enabled && active);

  useEffect(() => {
    if (!enabled || !trackingToken || !restaurantId || !active) return undefined;
    automaticRefresh();
    timerRef.current = setInterval(automaticRefresh, POLL_MS);
    const unsubscribe = subscribeRestaurantDisplay(restaurantId, automaticRefresh);
    return () => {
      clearInterval(timerRef.current);
      unsubscribe();
    };
  }, [enabled, restaurantId, trackingToken, automaticRefresh, active]);

  return {
    order,
    refresh,
    isActive: Boolean(order && ACTIVE_STATUSES.has(order.status)),
  };
}
