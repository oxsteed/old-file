import { screenSnapshot, screenChanges } from "./api";
import { subscribeRestaurantDisplay } from "../api/restaurantDisplaySocket";
// One serial catch-up loop per screen scope. A later response can never replace
// newer state. The journal is authoritative; socket delivery is only a wakeup.
const clients = new Map();
export function acquireScreenSync(key, options) {
  let record = clients.get(key);
  if (!record) {
    record = { listeners: new Set(), state: null, client: null };
    clients.set(key, record);
    record.client = createScreenSync({
      ...options,
      onState: (state) => {
        record.state = state;
        for (const listener of record.listeners) listener(state);
      },
    });
  }
  record.listeners.add(options.onState);
  if (record.state) options.onState(record.state);
  return {
    refresh: () => record.client.refresh(),
    stop() {
      record.listeners.delete(options.onState);
      if (!record.listeners.size) {
        record.client.stop();
        clients.delete(key);
      }
    },
  };
}
export function createScreenSync({
  restaurantId,
  device,
  onState,
  loadSnapshot = screenSnapshot,
  loadChanges = screenChanges,
  subscribe = subscribeRestaurantDisplay,
}) {
  let stopped = false,
    running = false,
    dirty = false,
    cursor = 0,
    controller = null,
    timer;
  let state = {
    status: "loading",
    snapshot: null,
    lastSync: null,
    cursor: 0,
    error: null,
  };
  const emit = (patch) => {
    state = { ...state, ...patch };
    if (!stopped) onState(state);
  };
  async function readSnapshot() {
    let after = 0,
      first = null,
      orders = [];
    for (let attempts = 0; attempts < 50; attempts++) {
      const page = await loadSnapshot(
        restaurantId,
        device,
        {
          ...(after
            ? { afterOrderId: after, snapshotCursor: first.cursor }
            : {}),
        },
        controller.signal,
      );
      first = first || page;
      orders.push(...page.orders);
      if (!page.hasMore) return { ...first, orders };
      after = page.nextOrderId;
    }
    throw new Error("snapshot_too_large");
  }
  async function snapshot() {
    for (let retry = 0; retry < 3; retry++) {
      try {
        return await readSnapshot();
      } catch (error) {
        if (
          error.response?.data?.code !== "screen_snapshot_changed" ||
          retry === 2
        )
          throw error;
      }
    }
  }
  async function refresh(force = false) {
    if (stopped) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    controller = new AbortController();
    try {
      if (navigator.onLine === false) throw new Error("offline");
      let changed = force || !state.snapshot;
      let nextCursor = cursor;
      if (state.snapshot) {
        for (let pages = 0; pages < 100; pages++) {
          const delta = await loadChanges(
            restaurantId,
            device,
            nextCursor,
            controller.signal,
          );
          if (delta.resetRequired) {
            changed = true;
            break;
          }
          if (Number(delta.cursor) < nextCursor)
            throw new Error("cursor_regressed");
          nextCursor = Number(delta.cursor);
          changed = changed || delta.events.length > 0;
          if (!delta.hasMore) break;
          if (pages === 99) throw new Error("catchup_limit");
        }
      }
      if (changed) {
        const data = await snapshot();
        cursor = Number(data.cursor);
        emit({ snapshot: data });
      }
      if (!changed) cursor = nextCursor;
      emit({ status: "online", lastSync: Date.now(), cursor, error: null });
    } catch (error) {
      if (!stopped)
        emit({
          status: [401, 403].includes(error.response?.status)
            ? "unauthorized"
            : navigator.onLine === false
              ? "offline"
              : "degraded",
          error: error.response?.data?.code || error.message,
        });
    } finally {
      running = false;
      if (dirty && !stopped) {
        dirty = false;
        queueMicrotask(() => refresh());
      }
    }
  }
  const wake = () => refresh();
  const off = subscribe(restaurantId, wake);
  timer = setInterval(wake, 5000);
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  refresh(true);
  return {
    refresh: () => refresh(true),
    stop() {
      stopped = true;
      controller?.abort();
      clearInterval(timer);
      off();
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
    },
  };
}
