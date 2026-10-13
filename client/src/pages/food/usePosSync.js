// usePosSync — wires the web POS to the offline-sync pipeline that was
// previously server-only. The server exposes:
//   GET  /restaurants/:id/pos/sync/status        (degraded/error overview)
//   POST /restaurants/:id/pos/sync/ack           (report operation states)
// Failed mutations are never auto-retried (money fails closed); they are
// recorded locally and reported to the server as 'failed' so the manager's
// sync view shows them, and surfaced in the POS page as a degraded banner.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/axios';

const OUTBOX_KEY = (restaurantId) => `oxsteed:pos-sync-outbox:${restaurantId}`;
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
    localStorage.setItem(OUTBOX_KEY(restaurantId), JSON.stringify(ops.slice(-MAX_OUTBOX)));
  } catch {
    // Local storage unavailable; the in-memory op is still acked best-effort.
  }
}

export function usePosSync(restaurantId, enabled) {
  const [syncState, setSyncState] = useState({ status: 'healthy', operations: { failed_operations: 0, pending_operations: 0 } });
  const [outboxCount, setOutboxCount] = useState(0);
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

  const reportFailedOperation = useCallback((operationType, errorMessage) => {
    const op = {
      operationId: `webpos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
    pollStatus();
    const timer = setInterval(pollStatus, 30000);
    const onOnline = () => flushOutbox();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, restaurantId, pollStatus, flushOutbox]);

  const degraded = syncState.status === 'degraded' || syncState.status === 'error'
    || Number(syncState.operations?.failed_operations || 0) > 0
    || Number(syncState.operations?.pending_operations || 0) > 0
    || outboxCount > 0;

  return {
    syncStatus: syncState.status,
    failedOperations: Number(syncState.operations?.failed_operations || 0),
    pendingOperations: Number(syncState.operations?.pending_operations || 0),
    outboxCount,
    degraded,
    reportFailedOperation,
    refreshSyncStatus: pollStatus,
  };
}
