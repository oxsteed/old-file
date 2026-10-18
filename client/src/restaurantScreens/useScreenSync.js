import { useEffect, useState, useRef, useCallback } from "react";
import { acquireScreenSync } from "./syncClient";
import {
  heartbeat,
  runtimeConfig,
  kitchenAction,
  importTicket,
  saveDevice,
} from "./api";
import {
  getCache,
  putCache,
  listOperations,
  replayOperations,
  enqueueOperation,
} from "./storage";
export function useScreenSync({
  restaurantId,
  device,
  accountId = "guest",
  active = true,
  sessionIdle = true,
}) {
  const scope = `${device ? "device" : accountId}:${restaurantId}:${device?.id || "staff"}:${device?.locationId || "default"}`;
  const [state, setState] = useState({
    status: "loading",
    snapshot: null,
    lastSync: null,
    cursor: 0,
  });
  const [operations, setOperations] = useState([]),
    [configuration, setConfiguration] = useState(device?.config || {}),
    [configPending, setConfigPending] = useState(false);
  const sync = useRef(null),
    current = useRef(state),
    config = useRef({ version: device?.configVersion || 0, pending: null }),
    idle = useRef(sessionIdle);
  const scopeRef = useRef(scope),
    tickRef = useRef(() => {});
  scopeRef.current = scope;
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  current.current = state;
  idle.current = sessionIdle;
  const refresh = useCallback(() => sync.current?.refresh(), []);
  const replay = useCallback(async () => {
    if (!navigator.onLine) return;
    await replayOperations(scope, (row) => {
      if (scopeRef.current !== scope) throw new Error("screen_scope_changed");
      return row.type === "unpaid_ticket"
        ? importTicket(restaurantId, device, row)
        : kitchenAction(restaurantId, device, row.type, row.entityId, {
            ...row.payload,
            idempotencyKey: row.id,
          });
    });
    if (scopeRef.current !== scope) return;
    setOperations(await listOperations(scope));
    sync.current?.refresh();
  }, [scope, restaurantId, device?.id]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    getCache(scope)
      .then((snapshot) => {
        if (live && snapshot)
          setState((s) =>
            s.snapshot ? s : { ...s, snapshot, status: "offline" },
          );
      })
      .catch(() => {});
    setState({ status: "loading", snapshot: null, lastSync: null, cursor: 0 });
    setOperations([]);
    config.current = { version: device?.configVersion || 0, pending: null };
    setConfiguration(device?.config || {});
    const client = acquireScreenSync(scope, {
      restaurantId,
      device,
      onState: (s) => {
        if (!live) return;
        setState(s);
        if (s.snapshot) putCache(scope, s.snapshot).catch(() => {});
      },
    });
    sync.current = client;
    listOperations(scope)
      .then((rows) => {
        if (live) setOperations(rows);
      })
      .catch(() => {});
    const online = () => replay().catch(() => {});
    window.addEventListener("online", online);
    online();
    return () => {
      live = false;
      client.stop();
      sync.current = null;
      window.removeEventListener("online", online);
    };
  }, [scope, active, restaurantId, device?.id, replay]);
  useEffect(() => {
    if (!active || !device) return;
    let live = true,
      busy = false,
      dirtyTick = false;
    const tick = async () => {
      if (busy) {
        dirtyTick = true;
        return;
      }
      if (!navigator.onLine) return;
      busy = true;
      try {
        const data = await heartbeat(restaurantId, device, {
          screenCursor: current.current.cursor || 0,
          configVersion: config.current.version,
          appliedConfigVersion: config.current.version,
          pendingOperations: operationsRef.current.filter(
            (o) => o.state === "pending",
          ).length,
          syncStatus:
            current.current.status === "online" ? "healthy" : "degraded",
        });
        if (!live) return;
        if (data.configChanged) {
          const next = await runtimeConfig(restaurantId, device);
          if (!live) return;
          config.current.pending = next.device;
        }
        if (config.current.pending) {
          if (
            idle.current &&
            !operationsRef.current.some((o) =>
              ["pending", "review"].includes(o.state),
            )
          ) {
            const next = config.current.pending;
            const value = {
              ...device,
              config: next.config || {},
              configVersion: next.configVersion || next.config_version,
              locationId: next.location_id || null,
              role: next.config?.screenRole || next.mode || device.role,
              expiresAt: next.device_token_expires_at || device.expiresAt,
            };
            config.current = { version: value.configVersion, pending: null };
            saveDevice(restaurantId, value);
            if (live) {
              setConfiguration(value.config);
              setConfigPending(false);
              if (
                value.locationId !== (device.locationId || null) ||
                value.role !== device.role
              )
                window.location.replace(
                  `/restaurants/screens/${restaurantId}/${value.role}`,
                );
            }
          } else if (live) setConfigPending(true);
        }
      } catch (error) {
        if (live && [401, 403].includes(error.response?.status))
          setState((s) => ({
            ...s,
            status: "unauthorized",
            error: "device_unauthorized",
          }));
      } finally {
        busy = false;
        if (dirtyTick && live) {
          dirtyTick = false;
          queueMicrotask(tick);
        }
      }
    };
    tickRef.current = tick;
    tick();
    const timer = setInterval(tick, 15000);
    return () => {
      live = false;
      tickRef.current = () => {};
      clearInterval(timer);
    };
  }, [active, restaurantId, device?.id]);
  useEffect(() => {
    if (
      Number(state.snapshot?.deviceConfigVersion || 0) >
        Number(config.current.version) ||
      (sessionIdle && config.current.pending)
    )
      tickRef.current();
  }, [
    state.snapshot?.deviceConfigVersion,
    sessionIdle,
    operations.filter((o) => ["pending", "review"].includes(o.state)).length,
  ]);
  const enqueue = useCallback(
    async (operation) => {
      await enqueueOperation(scope, {
        ...operation,
        restaurantId: String(restaurantId),
        locationId: device?.locationId || null,
      });
      setOperations(await listOperations(scope));
      if (navigator.onLine) await replay();
    },
    [scope, replay],
  );
  return {
    ...state,
    operations,
    configuration,
    configPending,
    scope,
    refresh,
    replay,
    enqueue,
  };
}
