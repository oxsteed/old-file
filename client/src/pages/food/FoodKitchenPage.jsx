// OxSteed Food kitchen display system. Staff update explicit order/item state;
// the backend remains authoritative and pushes PII-free refresh events to the
// queue board, POS, and customer tracking surfaces.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  getRestaurantKitchenFeed,
  performRestaurantKitchenItemAction,
  performRestaurantKitchenOrderAction,
  updateFoodOrderStatus,
} from '../../api/food';
import {
  enqueueKitchenAction,
  pendingKitchenActionCount,
  replayKitchenActions,
} from '../../api/kitchenOfflineQueue';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import { FoodBrand, FoodConnBadge, foodTicketUrgency } from './foodShared';
import '../../styles/FoodPages.css';

const POLL_MS = 5000;
const FINISHED_ITEM_STATES = new Set(['ready', 'bumped', 'cancelled']);

function operationId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `kitchen-${prefix}-${id}`;
}

function isNetworkError(error) {
  return !error?.response || error?.code === 'ERR_NETWORK';
}

export default function FoodKitchenPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [workflow, setWorkflow] = useState({ requireQualityCheck: true, handoffDisplaySeconds: 15 });
  const [error, setError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(new Set());
  const [pendingOffline, setPendingOffline] = useState(() => pendingKitchenActionCount(restaurantId));
  const [, setClockTick] = useState(0);
  const timerRef = useRef(null);
  const clockRef = useRef(null);

  const refreshPending = useCallback(() => {
    setPendingOffline(pendingKitchenActionCount(restaurantId));
  }, [restaurantId]);

  const load = useCallback(() => {
    if (!navigator.onLine) {
      setOnline(false);
      setError(true);
      return Promise.resolve();
    }
    return getRestaurantKitchenFeed(restaurantId)
      .then((data) => {
        setOrders(data?.orders || []);
        setWorkflow(data?.workflow || { requireQualityCheck: true, handoffDisplaySeconds: 15 });
        setError(false);
        setOnline(true);
      })
      .catch(() => setError(true));
  }, [restaurantId]);

  const replay = useCallback(async () => {
    if (!navigator.onLine) return;
    const result = await replayKitchenActions(restaurantId);
    refreshPending();
    if (result.replayed > 0) {
      toast.success(t('food.kds.syncedActions', { count: result.replayed }));
      await load();
    }
  }, [load, refreshPending, restaurantId, t]);

  useEffect(() => {
    load().then(replay);
    timerRef.current = setInterval(load, POLL_MS);
    clockRef.current = setInterval(() => setClockTick((n) => n + 1), 30000);
    const unsubscribe = subscribeRestaurantDisplay(restaurantId, load);
    const handleOnline = () => {
      setOnline(true);
      replay();
    };
    const handleOffline = () => {
      setOnline(false);
      setError(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('oxsteed:kitchen-queue-changed', refreshPending);
    return () => {
      clearInterval(timerRef.current);
      clearInterval(clockRef.current);
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('oxsteed:kitchen-queue-changed', refreshPending);
    };
  }, [load, refreshPending, replay, restaurantId]);

  const runMutation = async ({ key, queuedAction, request, successKey }) => {
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));
    try {
      if (!navigator.onLine) {
        enqueueKitchenAction(queuedAction);
        toast(t('food.kds.savedOffline'));
        return;
      }
      try {
        await request();
        if (successKey) toast.success(t(successKey));
        await load();
      } catch (mutationError) {
        if (isNetworkError(mutationError)) {
          enqueueKitchenAction(queuedAction);
          setOnline(false);
          setError(true);
          toast(t('food.kds.savedOffline'));
          return;
        }
        const message = mutationError?.response?.data?.error?.message;
        toast.error(message || t('food.merchant.statusError'));
      }
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      refreshPending();
    }
  };

  const performOrderAction = (order, action, { reason = null } = {}) => {
    const idempotencyKey = operationId(`order-${order.id}-${action}`);
    const payload = { action, reason, idempotencyKey };
    return runMutation({
      key: `order-${order.id}`,
      queuedAction: { id: idempotencyKey, type: 'order_action', restaurantId, entityId: order.id, payload },
      request: () => performRestaurantKitchenOrderAction(restaurantId, order.id, payload),
    });
  };

  const changeOrderStatus = (order, status, action) => {
    const idempotencyKey = operationId(`status-${order.id}-${status}`);
    const payload = { status, action, idempotencyKey };
    return runMutation({
      key: `order-${order.id}`,
      queuedAction: { id: idempotencyKey, type: 'order_status', restaurantId, entityId: order.id, payload },
      request: () => updateFoodOrderStatus(restaurantId, order.id, status, payload),
      successKey: status === 'ready' ? 'food.kds.readyPublished' : null,
    });
  };

  const performItemAction = (order, item, action, reason = null) => {
    const idempotencyKey = operationId(`item-${item.id}-${action}`);
    const payload = { action, reason, stationLabel: item.stationLabel, idempotencyKey };
    return runMutation({
      key: `item-${item.id}`,
      queuedAction: { id: idempotencyKey, type: 'item_action', restaurantId, entityId: item.id, payload },
      request: () => performRestaurantKitchenItemAction(restaurantId, item.id, payload),
    });
  };

  const askForReason = (translationKey) => {
    const value = window.prompt(t(translationKey));
    return value?.trim() || null;
  };

  const columns = [
    { key: 'new', title: t('food.kds.new'), match: (o) => ['received', 'accepted'].includes(o.status) },
    { key: 'preparing', title: t('food.kds.preparing'), match: (o) => o.status === 'preparing' && o.kitchen_stage !== 'quality_check' },
    { key: 'quality', title: t('food.kds.qualityCheck'), match: (o) => o.status === 'preparing' && o.kitchen_stage === 'quality_check' },
    { key: 'ready', title: t('food.kds.ready'), match: (o) => o.status === 'ready' },
  ];

  return (
    <div className="fd-screen">
      <div className="fd-screen-header">
        <FoodBrand size={34} />
        <h1 className="fd-screen-title">{t('food.kds.title')}</h1>
        <span className="fd-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
          <FoodConnBadge ok={online && !error} />
          <span className="fd-kds-meta">{t('food.kds.explicitHint')}</span>
        </span>
        {pendingOffline > 0 && (
          <div className="fd-kds-sync-warning">
            {t('food.kds.pendingSync', { count: pendingOffline })}
            {online && <button type="button" onClick={replay}>{t('food.kds.syncNow')}</button>}
          </div>
        )}
      </div>
      {error && <p className="fd-kds-meta">{t('food.kds.reconnecting')}</p>}
      <div className="fd-kds-grid fd-kds-grid-lifecycle">
        {columns.map((column) => {
          const list = orders.filter(column.match);
          return (
            <section key={column.key} className="fd-kds-col">
              <h2 className="fd-kds-col-title">{column.title} ({list.length})</h2>
              {list.map((order) => {
                const urgency = order.status === 'ready'
                  ? { elapsedMin: null, color: null }
                  : foodTicketUrgency(order.preparation_started_at || order.created_at);
                const items = order.items || [];
                const allItemsFinished = items.length === 0
                  || items.every((item) => FINISHED_ITEM_STATES.has(item.kitchenStatus));
                const orderBusy = busy.has(`order-${order.id}`);
                return (
                  <article
                    key={order.id}
                    className="fd-kds-card"
                    style={urgency.color ? {
                      borderLeft: `5px solid ${urgency.color}`,
                      boxShadow: `inset 0 0 0 1px ${urgency.color}55`,
                    } : undefined}
                  >
                    <div className="fd-kds-num">
                      <span>#{order.queue_number}</span>
                      {urgency.elapsedMin != null && <span className="fd-kds-timer">{urgency.elapsedMin}m</span>}
                    </div>
                    <div className="fd-kds-items">
                      {items.map((item) => {
                        const itemBusy = busy.has(`item-${item.id}`);
                        return (
                          <div key={item.id} className={`fd-kds-item fd-kds-item-${item.kitchenStatus || 'queued'}`}>
                            <div>
                              <strong>{item.quantity}× {item.itemName}</strong>
                              <span className="fd-kds-item-status">{t(`food.kds.itemStatus.${item.kitchenStatus || 'queued'}`)}</span>
                              {item.specialInstructions && <em>{item.specialInstructions}</em>}
                              {item.delayReason && <small>{item.delayReason}</small>}
                            </div>
                            <div className="fd-kds-item-actions">
                              {['queued', 'held', 'delayed', 'problem'].includes(item.kitchenStatus || 'queued') && (
                                <button disabled={itemBusy} onClick={() => performItemAction(order, item, 'start')}>{t('food.kds.startItem')}</button>
                              )}
                              {['preparing', 'delayed', 'problem'].includes(item.kitchenStatus) && (
                                <button disabled={itemBusy} onClick={() => performItemAction(order, item, 'ready')}>{t('food.kds.finishItem')}</button>
                              )}
                              {['ready', 'bumped'].includes(item.kitchenStatus) && order.status !== 'ready' && (
                                <button disabled={itemBusy} onClick={() => performItemAction(order, item, 'recall')}>{t('food.kds.recallItem')}</button>
                              )}
                              {['queued', 'preparing', 'held'].includes(item.kitchenStatus || 'queued') && (
                                <button
                                  className="fd-kds-secondary-action"
                                  disabled={itemBusy}
                                  onClick={() => {
                                    const reason = askForReason('food.kds.delayReasonPrompt');
                                    if (reason) performItemAction(order, item, 'delay', reason);
                                  }}
                                >{t('food.kds.delay')}</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="fd-kds-meta">
                      {t(`food.fulfillment.${order.fulfillment_type}`)}
                      {order.table_label ? ` · ${order.table_label}` : ''}
                      {' · '}{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="fd-kds-order-actions">
                      {order.status === 'received' && (
                        <button disabled={orderBusy} onClick={() => performOrderAction(order, 'acknowledge')}>{t('food.kds.acknowledge')}</button>
                      )}
                      {order.status === 'accepted' && (
                        <button disabled={orderBusy} onClick={() => performOrderAction(order, 'start')}>{t('food.kds.startPreparing')}</button>
                      )}
                      {order.status === 'preparing' && order.kitchen_stage !== 'quality_check' && allItemsFinished && workflow.requireQualityCheck && (
                        <button disabled={orderBusy} onClick={() => performOrderAction(order, 'ready_for_check')}>{t('food.kds.sendToQuality')}</button>
                      )}
                      {order.status === 'preparing' && allItemsFinished && (!workflow.requireQualityCheck || order.kitchen_stage === 'quality_check') && (
                        <button disabled={orderBusy} onClick={() => changeOrderStatus(order, 'ready', 'mark_ready')}>{t('food.kds.markReady')}</button>
                      )}
                      {order.status === 'ready' && order.fulfillment_type !== 'delivery' && (
                        <button
                          disabled={orderBusy}
                          onClick={() => window.confirm(t('food.kds.handoffConfirm')) && changeOrderStatus(order, 'completed', 'handoff')}
                        >{t('food.kds.confirmHandoff')}</button>
                      )}
                      {order.status === 'ready' && order.fulfillment_type === 'delivery' && (
                        <span className="fd-kds-meta">{t('food.kds.waitingForRunner')}</span>
                      )}
                      {(order.status === 'ready' || order.kitchen_stage === 'quality_check') && (
                        <button
                          className="fd-kds-secondary-action"
                          disabled={orderBusy}
                          onClick={() => {
                            const reason = askForReason('food.kds.reopenReasonPrompt');
                            if (reason) performOrderAction(order, 'reopen', { reason });
                          }}
                        >{t('food.kds.reopen')}</button>
                      )}
                    </div>
                  </article>
                );
              })}
              {list.length === 0 && <p className="fd-kds-meta">{t('food.kds.emptyColumn')}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
