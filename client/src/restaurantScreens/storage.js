// Browser-only durable storage. No payment mutation is accepted by this queue.
const DB = "oxsteed-restaurant-screens";
let opened;
function db() {
  if (!opened)
    opened = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        for (const name of ["operations", "cache", "leases"])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: "key" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        opened = null;
        reject(r.error);
      };
    });
  return opened;
}
async function transact(store, mode, action) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    let result;
    action(transaction.objectStore(store), (value) => {
      result = value;
    });
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("storage_aborted"));
  });
}
export const getCache = (scope) =>
  transact("cache", "readonly", (s, done) => {
    const r = s.get(scope);
    r.onsuccess = () => done(r.result?.value || null);
  });
export const putCache = (scope, value) =>
  transact("cache", "readwrite", (s) => s.put({ key: scope, value }));
export const listRestaurantOperations = (restaurantId) =>
  transact("operations", "readonly", (s, done) => {
    const r = s.getAll();
    r.onsuccess = () =>
      done(
        r.result.filter(
          (x) =>
            String(x.restaurantId) === String(restaurantId) &&
            ["pending", "review", "submitting"].includes(x.state),
        ),
      );
  });
export const listOperations = (scope) =>
  transact("operations", "readonly", (s, done) => {
    const r = s.getAll();
    r.onsuccess = () =>
      done(
        r.result
          .filter((x) => x.scope === scope)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
  });
export async function enqueueOperation(scope, operation) {
  if (
    !["unpaid_ticket", "kitchen_item", "kitchen_order"].includes(operation.type)
  )
    throw new Error("offline_operation_not_allowed");
  const record = {
    ...operation,
    scope,
    key: `${scope}:${operation.id}`,
    createdAt: Date.now(),
    state: "pending",
  };
  await transact("operations", "readwrite", (s) => {
    const request = s.get(record.key);
    request.onsuccess = () => {
      if (!request.result) s.put(record);
    };
  });
  return record;
}
export const saveOperation = (operation) =>
  transact("operations", "readwrite", (s) => s.put(operation));
export async function withReplayLease(scope, work) {
  if (navigator.locks)
    return navigator.locks.request(
      `restaurant-screen:${scope}`,
      { ifAvailable: true },
      (lock) => (lock ? work() : undefined),
    );
  const owner = crypto.randomUUID(),
    key = `replay:${scope}`;
  const claim = () =>
    transact("leases", "readwrite", (s, done) => {
      const r = s.get(key);
      r.onsuccess = () => {
        if (
          r.result &&
          r.result.owner !== owner &&
          r.result.expires > Date.now()
        )
          return done(false);
        s.put({ key, owner, expires: Date.now() + 60000 });
        done(true);
      };
    });
  if (!(await claim())) return;
  const timer = setInterval(() => claim().catch(() => {}), 10000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    await transact("leases", "readwrite", (s) => {
      const r = s.get(key);
      r.onsuccess = () => {
        if (r.result?.owner === owner) s.delete(key);
      };
    });
  }
}
export async function replayOperations(scope, dispatch) {
  return withReplayLease(scope, async () => {
    const rows = await listOperations(scope);
    for (const row of rows) {
      if (row.state !== "pending") continue;
      try {
        const response = await dispatch(row);
        await saveOperation({
          ...row,
          payload: row.type === "unpaid_ticket" ? { items: [] } : row.payload,
          state: "sent",
          response,
          completedAt: Date.now(),
        });
      } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) break;
        if (
          status === 409 ||
          status === 400 ||
          status === 404 ||
          status === 422
        ) {
          await saveOperation({
            ...row,
            state: "review",
            errorCode: error.response?.data?.code || "conflict",
          });
          continue;
        }
        break;
      }
    }
    return listOperations(scope);
  });
}

// Persist before sending an online unpaid order. If the browser closes before
// acknowledgement, a manager can recover the same UUID without a second order.
export async function stageTicket(scope, operation) {
  if (operation.type !== "unpaid_ticket")
    throw new Error("offline_operation_not_allowed");
  await transact("operations", "readwrite", (store) => {
    const key = `${scope}:${operation.id}`,
      r = store.get(key);
    r.onsuccess = () => {
      if (!r.result)
        store.put({
          ...operation,
          key,
          scope,
          state: "submitting",
          createdAt: Date.now(),
        });
    };
  });
}
export async function setTicketState(scope, id, state) {
  if (!["pending", "review", "sent"].includes(state))
    throw new Error("invalid_operation_state");
  await transact("operations", "readwrite", (store) => {
    const r = store.get(`${scope}:${id}`);
    r.onsuccess = () => {
      if (r.result && r.result.state !== "sent")
        store.put({
          ...r.result,
          state,
          ...(state === "sent" ? { payload: { items: [] } } : {}),
        });
    };
  });
}
