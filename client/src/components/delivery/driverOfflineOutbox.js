// Group 9 Slice G (items 496/497): the driver offline action outbox.
//
// The GPS queue already exists (DriverTrackingControls persists points
// to a per-job localStorage queue and flushes on online/reconnect).
// This module extends the same pattern to the driver actions that
// today require connectivity — status updates, proof metadata, issue
// reports, stop completions — instead of duplicating the GPS queue.
// One outbox per job, in localStorage, flushed in recorded order.
//
// Proof photo bytes while offline (D-89): the metadata is queued
// and the file itself is held in memory (module-level Map) until
// connectivity returns, because a File cannot live in localStorage.
// If the tab closes before the flush, the file is gone but the
// queued entry is NOT dropped: the flush marks it `failed` with
// `needsFile`, and the checklist tells the driver to re-attach the
// photo. A queued action is never silently dropped — it stays
// visible as queued, synced, or failed until the driver explicitly
// discards it.
//
// Pure logic, no API imports: callers pass the executors (built from
// api/delivery) into flushOutbox, so this module is unit-testable
// with node --test and a stub storage.

export const OUTBOX_VERSION = 1;

export function outboxKey(jobId) {
  return `delivery-outbox:${jobId}`;
}

function readRaw(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeRaw(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the queue lives in
    // memory only for this tab. Never throw out of a queue write.
  }
}

export function readOutbox(storage, jobId) {
  if (!jobId) return [];
  const entries = readRaw(storage, outboxKey(jobId), []);
  return Array.isArray(entries) ? entries : [];
}

export function writeOutbox(storage, jobId, entries) {
  if (!jobId) return;
  writeRaw(storage, outboxKey(jobId), entries);
}

export function newActionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Queue one driver action. `kind` is one of: status | proof | issue |
// stop_complete. `payload` is the API payload for that action.
export function enqueueAction(storage, jobId, kind, payload) {
  const entry = {
    id: newActionId(),
    jobId: String(jobId),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    state: 'queued',
    error: null,
    needsFile: false,
  };
  const entries = readOutbox(storage, jobId);
  entries.push(entry);
  writeOutbox(storage, jobId, entries);
  return entry;
}

export function updateEntry(storage, jobId, id, patch) {
  const entries = readOutbox(storage, jobId);
  const next = entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  writeOutbox(storage, jobId, next);
  return next.find((entry) => entry.id === id) || null;
}

// Explicit discard only: the driver taps "Discard" on a failed
// entry. Nothing in the flush path ever removes an entry silently.
export function discardEntry(storage, jobId, id) {
  writeOutbox(storage, jobId, readOutbox(storage, jobId).filter((entry) => entry.id !== id));
}

export function retryEntry(storage, jobId, id) {
  return updateEntry(storage, jobId, id, { state: 'queued', error: null, needsFile: false });
}

export function queuedCount(storage, jobId) {
  return readOutbox(storage, jobId).filter((entry) => entry.state === 'queued' || entry.state === 'syncing').length;
}

// Proof files held in memory, keyed by outbox entry id. localStorage
// cannot hold a File, so a queued photo proof keeps its bytes here
// until the flush uploads them.
const proofFiles = new Map();

export function holdProofFile(actionId, file) {
  if (file) proofFiles.set(actionId, file);
}

export function takeProofFile(actionId) {
  const file = proofFiles.get(actionId) || null;
  proofFiles.delete(actionId);
  return file;
}

export function hasProofFile(actionId) {
  return proofFiles.has(actionId);
}

export function isNetworkFailure(error) {
  // Axios network failures carry no response; a 4xx/5xx from the
  // server does. Only the former means "try again later".
  return Boolean(error) && error.response == null;
}

// Build the executors the flush uses, from the delivery API. The
// caller (the detail page) passes the real api functions in; the
// outbox module itself imports no API code.
//
// Replay safety: every replayed call carries a stable idempotency
// key derived from the queued entry id (`delivery-outbox:<id>`).
// The server dedupes status updates and issue reports on that key
// (delivery_action_idempotency), so a flush that retries after an
// ambiguous failure returns the stored duplicate instead of
// applying the action twice. A photo proof re-uploads its file on
// retry, but the delivered transition underneath it carries the
// same stable key, so the delivery itself can never double-apply.
export function buildOutboxExecutors(jobId, api) {
  const replayKey = (entry) => `delivery-outbox:${entry.id}`;
  return {
    async status(entry) {
      const { status, ...details } = entry.payload || {};
      await api.updateDeliveryStatus(jobId, status, { ...details, idempotencyKey: replayKey(entry) });
    },
    async issue(entry) {
      await api.reportDeliveryIssue(jobId, { ...(entry.payload || {}), idempotencyKey: replayKey(entry) });
    },
    async stop_complete(entry) {
      // Stops carry no idempotency key server-side: completing an
      // already-completed stop 409s (delivery_stop_conflict). A flush
      // retry after an ambiguous failure lands exactly there, and
      // the stop IS done, so the conflict is the success signal,
      // not a failure to surface.
      try {
        await api.completeDeliveryStop(jobId, entry.payload?.stopId);
      } catch (error) {
        if (error?.response?.data?.code === 'delivery_stop_conflict') return;
        throw error;
      }
    },
    async proof(entry) {
      const payload = entry.payload || {};
      if (['photo', 'signature'].includes(payload.proofType)) {
        const file = takeProofFile(entry.id);
        if (!file) {
          const error = new Error('proof file missing');
          error.needsFile = true;
          throw error;
        }
        const uploaded = await api.uploadDeliveryProof(jobId, file, payload.proofType);
        if (!uploaded?.uploadId) throw new Error('proof upload missing receipt');
        await api.updateDeliveryStatus(jobId, 'delivered', { proofType: payload.proofType, uploadId: uploaded.uploadId, idempotencyKey: replayKey(entry) });
        return;
      }
      await api.updateDeliveryStatus(jobId, 'delivered', { ...payload, idempotencyKey: replayKey(entry) });
    },
  };
}

// Flush the queued actions in recorded order. Returns the entries
// after the flush. A network failure stops the flush and leaves the
// remaining entries queued for the next attempt; a validation
// failure (4xx) marks that entry failed and moves on, so one bad
// action never blocks the rest — but the failed entry stays visible
// with its error until the driver retries or explicitly discards it.
export async function flushOutbox(storage, jobId, executors) {
  const entries = readOutbox(storage, jobId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const entry of entries) {
    if (entry.state !== 'queued') continue;
    const executor = executors?.[entry.kind];
    if (typeof executor !== 'function') {
      updateEntry(storage, jobId, entry.id, { state: 'failed', error: 'unknown action' });
      continue;
    }
    updateEntry(storage, jobId, entry.id, { state: 'syncing', error: null });
    try {
      await executor(entry);
      updateEntry(storage, jobId, entry.id, { state: 'synced', error: null, needsFile: false });
    } catch (error) {
      if (error?.needsFile) {
        updateEntry(storage, jobId, entry.id, { state: 'failed', error: 'proof file missing', needsFile: true });
        continue;
      }
      if (isNetworkFailure(error)) {
        updateEntry(storage, jobId, entry.id, { state: 'queued', error: null });
        break;
      }
      updateEntry(storage, jobId, entry.id, {
        state: 'failed',
        error: error?.response?.data?.error || error?.message || 'failed',
      });
    }
  }
  return readOutbox(storage, jobId);
}

// The offline task checklist for one job: the stops and actions for
// the current job, each with its live state — done (server state),
// queued (an offline action is waiting), failed (a replay was
// rejected and needs the driver), or pending. A failed entry never
// hides the task: the row shows failed until it is retried,
// discarded, or superseded by a newer server state.
export function checklistItems(job, stops, entries) {
  const queuedFor = (predicate) => entries.find((entry) => (entry.state === 'queued' || entry.state === 'syncing') && predicate(entry));
  const failedFor = (predicate) => entries.find((entry) => entry.state === 'failed' && predicate(entry));
  const stateFor = (done, predicate) => {
    if (done) return 'done';
    if (failedFor(predicate)) return 'failed';
    if (queuedFor(predicate)) return 'queued';
    return 'pending';
  };
  const statusIs = (entry, status) => entry.kind === 'status' && entry.payload?.status === status;
  const items = [];
  const pickedUp = Boolean(job?.picked_up_at) || ['picked_up', 'in_transit', 'delivered'].includes(job?.status);
  items.push({
    key: 'pickup',
    labelKey: 'delivery.offline.checklistPickup',
    state: stateFor(pickedUp, (entry) => statusIs(entry, 'picked_up')),
  });
  for (const stop of stops || []) {
    const done = stop.status === 'completed' || Boolean(stop.completed_at);
    items.push({
      key: `stop:${stop.id}`,
      labelKey: 'delivery.offline.checklistStop',
      labelParams: { label: stop.label || stop.address || String(stop.id) },
      stopId: stop.id,
      state: stateFor(done, (entry) => entry.kind === 'stop_complete' && String(entry.payload?.stopId) === String(stop.id)),
    });
  }
  const inTransit = ['in_transit', 'delivered'].includes(job?.status);
  items.push({
    key: 'in_transit',
    labelKey: 'delivery.offline.checklistInTransit',
    state: stateFor(inTransit, (entry) => statusIs(entry, 'in_transit')),
  });
  const proofDone = job?.status === 'delivered';
  items.push({
    key: 'proof',
    labelKey: 'delivery.offline.checklistProof',
    state: stateFor(proofDone, (entry) => entry.kind === 'proof'),
  });
  return items;
}
