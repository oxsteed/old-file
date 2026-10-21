// usePosSync — wires the web POS to the offline-sync pipeline that was
// previously server-only. The server exposes:
//   GET  /restaurants/:id/pos/sync/status        (degraded/error overview)
//   POST /restaurants/:id/pos/sync/ack           (report operation states)
// Generic failed mutations are never auto-retried (money fails closed). Cash
// checkout is the deliberate exception: its order and payment requests carry
// stable idempotency keys, so a cash-only network failure can be replayed
// safely after reconnecting. Card, mobile and credit operations are never
// replayed by this browser queue.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/axios';
import { isNetworkFailure, replayCashOutboxEntries } from './offlineCashReplay';

export { isNetworkFailure, replayCashOutboxEntries } from './offlineCashReplay';

const OUTBOX_KEY = (restaurantId) => `oxsteed:pos-sync-outbox:${restaurantId}`;
const CASH_OUTBOX_KEY = (restaurantId) => `oxsteed:pos-cash-outbox:${restaurantId}`;
const MAX_OUTBOX = 50;

function readOutbox(restaurantId) {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY(restaurantId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(restaurantId, ops) {
  try {
    localStorage.setItem(OUTBOX_KEY(restaurantId), JSON.stringify(ops));
  } catch {
    // Local storage unavailable; the in-memory op is still acked best-effort.
  }
}

function readCashOutbox(restaurantId) {
  try {
    const raw = localStorage.getItem(CASH_OUTBOX_KEY(restaurantId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCashOutbox(restaurantId, ops) {
  try {
    localStorage.setItem(CASH_OUTBOX_KEY(restaurantId), JSON.stringify(ops));
  } catch {
    // The caller still receives a failure toast when durable storage is not available.
  }
}

const operationId = (prefix) => `webpos-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function cashOutboxStorageKey(restaurantId) {
  return CASH_OUTBOX_KEY(restaurantId);
}

export function usePosSync(restaurantId, enabled) {
  const [syncState, setSyncState] = useState({ status: 'healthy', operations: { failed_operations: 0, pending_operations: 0 } });
  const [outboxCount, setOutboxCount] = useState(0);
  const [cashOutboxCount, setCashOutboxCount] = useState(0);
  const flushingCash = useRef(false);
  const restaurantRef = useRef(restaurantId);
  restaurantRef.current = restaurantId;

  const pollStatus = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await api.get(`/restaurants/${restaurantId}/pos/sync/status`);
      setSyncState({
        status: data?.status || 'healthy',
        operations: data?.operations || { failed_operations: 0, pending_operations: 0 },
      });
    } catch {
      // Status polling is advisory; the page works without it.
    }
  }, [restaurantId, enabled]);

  const ackOperations = useCallback(async (operations) => {
    if (!operations.length) return true;
    try {
      await api.post(`/restaurants/${restaurantId}/pos/sync/ack`, { operations });
      return true;
    } catch {
      // Will be retried from the outbox on reconnect.
      return false;
    }
  }, [restaurantId]);

  const flushOutbox = useCallback(async () => {
    const ops = readOutbox(restaurantId);
    if (!ops.length) return;
    try {
      await api.post(`/restaurants/${restaurantId}/pos/sync/ack`, { operations: ops });
      writeOutbox(restaurantId, []);
      setOutboxCount(0);
    } catch {
      // Still offline; keep the outbox.
    }
    pollStatus();
  }, [restaurantId, pollStatus]);

  const replayCashEntry = useCallback(async (entry) => {
    let order = entry.orderId ? { id: entry.orderId, total_cents: entry.orderTotalCents } : null;
    if (!order) {
      const response = await api.post(`/restaurants/${restaurantId}/pos/orders`, entry.orderPayload);
      order = response.data?.order;
      if (!order?.id) throw new Error('Cash order replay did not return an order');
    }
    await api.post(`/restaurants/${restaurantId}/pos/orders/${order.id}/payments`, {
      ...entry.paymentPayload,
      amountCents: Number(entry.paymentPayload?.amountCents || order.total_cents || 0),
    });
    return order;
  }, [restaurantId]);

  const flushCashOutbox = useCallback(async () => {
    if (flushingCash.current || !navigator.onLine) return;
    flushingCash.current = true;
    try {
      const remaining = await replayCashOutboxEntries(readCashOutbox(restaurantId), replayCashEntry);
      writeCashOutbox(restaurantId, remaining);
      setCashOutboxCount(remaining.length);
    } finally {
      flushingCash.current = false;
      pollStatus();
    }
  }, [restaurantId, pollStatus, replayCashEntry]);

  const queueOfflineCashCheckout = useCallback((payload) => {
    if (!payload || payload.method !== 'cash') return false;
    const entry = {
      operationId: operationId('cash'),
      createdAt: new Date().toISOString(),
      attempts: 0,
      orderId: payload.orderId || null,
      orderTotalCents: payload.orderTotalCents || null,
      orderPayload: payload.orderPayload || null,
      paymentPayload: payload.paymentPayload,
    };
    const existing = readCashOutbox(restaurantId);
    if (existing.length >= MAX_OUTBOX) return false;
    const entries = [...existing, entry];
    writeCashOutbox(restaurantId, entries);
    setCashOutboxCount(entries.length);
    return true;
  }, [restaurantId]);

  const reportFailedOperation = useCallback((operationType, errorMessage) => {
    const op = {
      operationId: operationId('failed'),
      operationType,
      entityType: 'pos_mutation',
      status: 'failed',
      errorCode: 'client_mutation_failed',
      errorMessage: String(errorMessage || 'POS mutation failed').slice(0, 1000),
      payload: { reportedBy: 'web_pos', restaurantId: String(restaurantId) },
    };
    const ops = [...readOutbox(restaurantId), op];
    writeOutbox(restaurantId, ops);
    setOutboxCount(ops.length);
    // Report immediately when online; otherwise it flushes on reconnect.
    if (navigator.onLine) {
      ackOperations([op]).then((ok) => {
        if (!ok) return;
        const remaining = readOutbox(restaurantId).filter((o) => o.operationId !== op.operationId);
        writeOutbox(restaurantId, remaining);
        setOutboxCount(remaining.length);
      });
    }
  }, [restaurantId, ackOperations]);

  useEffect(() => {
    if (!enabled) return;
    setOutboxCount(readOutbox(restaurantId).length);
    setCashOutboxCount(readCashOutbox(restaurantId).length);
    pollStatus();
    if (navigator.onLine) flushCashOutbox();
    const timer = setInterval(pollStatus, 30000);
    const onOnline = () => { flushOutbox(); flushCashOutbox(); };
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, restaurantId, pollStatus, flushOutbox, flushCashOutbox]);

  const degraded = syncState.status === 'degraded' || syncState.status === 'error'
    || Number(syncState.operations?.failed_operations || 0) > 0
    || Number(syncState.operations?.pending_operations || 0) > 0
    || outboxCount > 0 || cashOutboxCount > 0;

  return {
    syncStatus: syncState.status,
    failedOperations: Number(syncState.operations?.failed_operations || 0),
    pendingOperations: Number(syncState.operations?.pending_operations || 0),
    outboxCount: outboxCount + cashOutboxCount,
    offlineCashCount: cashOutboxCount,
    degraded,
    reportFailedOperation,
    queueOfflineCashCheckout,
    refreshSyncStatus: pollStatus,
  };
}
