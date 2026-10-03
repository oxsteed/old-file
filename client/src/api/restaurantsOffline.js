// client/src/api/restaurantsOffline.js
//
// Offline-aware wrappers around the restaurant operations mutations.
// Each wrapper tries the live call first; only when the request never
// reached the server (offline / DNS / timeout, i.e. no response) is the
// mutation queued in the IndexedDB outbox for later replay. A queued call
// resolves to { queued: true } so the UI can show "will sync" state.
//
// Queueing policy: a 5xx DID reach the server and may have applied, so it
// is never queued (the error surfaces normally). Every queued mutation is
// idempotent-safe on replay (see offlineOutbox.js).

import api from './axios';
import {
  queueMutation,
  isNetworkFailure,
  newClientKey,
  flushOutbox,
  countPending,
} from './offlineOutbox';
import {
  toggleRunItem,
  completeChecklistRun,
  adjustInventoryItem,
  submitTrainingQuiz,
  scoreAuditItem,
  addAuditFinding,
} from './restaurants';

async function liveOrQueue(restaurantId, method, url, body, liveFn) {
  try {
    return await liveFn();
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    await queueMutation({ restaurantId, method, url, body });
    return { queued: true };
  }
}

export const toggleRunItemOffline = (restaurantId, runId, itemId, payload) =>
  liveOrQueue(
    restaurantId,
    'PATCH',
    `/restaurants/${restaurantId}/runs/${runId}/items/${itemId}`,
    payload,
    () => toggleRunItem(restaurantId, runId, itemId, payload)
  );

export const completeChecklistRunOffline = (restaurantId, runId, payload = {}) =>
  liveOrQueue(
    restaurantId,
    'POST',
    `/restaurants/${restaurantId}/runs/${runId}/complete`,
    payload,
    () => completeChecklistRun(restaurantId, runId, payload)
  );

export const adjustInventoryItemOffline = (restaurantId, itemId, payload) => {
  // Stable idempotency key: a replay after a lost response replays safely.
  const body = { ...payload, clientOperationId: payload.clientOperationId || newClientKey() };
  return liveOrQueue(
    restaurantId,
    'POST',
    `/restaurants/${restaurantId}/inventory/items/${itemId}/adjust`,
    body,
    () => adjustInventoryItem(restaurantId, itemId, body)
  );
};

export const submitTrainingQuizOffline = (restaurantId, assignmentId, payload) =>
  liveOrQueue(
    restaurantId,
    'POST',
    `/restaurants/${restaurantId}/training/assignments/${assignmentId}/submit`,
    payload,
    () => submitTrainingQuiz(restaurantId, assignmentId, payload)
  );

export const scoreAuditItemOffline = (restaurantId, auditId, payload) =>
  liveOrQueue(
    restaurantId,
    'POST',
    `/restaurants/${restaurantId}/audits/runs/${auditId}/score`,
    payload,
    () => scoreAuditItem(restaurantId, auditId, payload)
  );

export const addAuditFindingOffline = (restaurantId, auditId, payload) => {
  const body = { ...payload, clientKey: payload.clientKey || newClientKey() };
  return liveOrQueue(
    restaurantId,
    'POST',
    `/restaurants/${restaurantId}/audits/runs/${auditId}/findings`,
    body,
    () => addAuditFinding(restaurantId, auditId, body)
  );
};

// Replay everything queued for a restaurant, in FIFO order.
export const syncPendingMutations = (restaurantId) =>
  flushOutbox(restaurantId, (config) => api.request(config));

export const countPendingMutations = (restaurantId) => countPending(restaurantId);

export const isDeviceOnline = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;
