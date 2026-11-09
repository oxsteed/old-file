jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../services/socketService", () => ({
  broadcastToRestaurantDisplay: jest.fn(),
}));
const pool = require("../db");
const { broadcastToRestaurantDisplay } = require("../services/socketService");
const {
  positive,
  cursor,
  deviceHealth,
  changes,
  publishBatch,
} = require("../services/restaurantScreenSync");
afterEach(() => jest.clearAllMocks());
test("strict scope and cursor validation rejects unsafe numeric coercion", () => {
  for (const value of ["-1", "1.5", "1 OR 1=1", Infinity, 9007199254740992]) {
    expect(() => positive(value)).toThrow();
    expect(() => cursor(value)).toThrow();
  }
  expect(positive("", true)).toBeNull();
  expect(positive("42")).toBe(42);
  expect(cursor("0")).toBe(0);
});
test("connection health uses successful heartbeat independently of sync/config telemetry", () => {
  const now = Date.now(),
    d = {
      status: "paired",
      last_sync_at: new Date(now),
      config_version: 4,
      applied_config_version: 1,
    };
  expect(deviceHealth({ ...d, last_seen_at: new Date(now - 44999) }, now)).toBe(
    "online",
  );
  expect(deviceHealth({ ...d, last_seen_at: new Date(now - 45000) }, now)).toBe(
    "degraded",
  );
  expect(deviceHealth({ ...d, last_seen_at: new Date(now - 60000) }, now)).toBe(
    "offline",
  );
  expect(deviceHealth({ ...d, status: "disabled" }, now)).toBe("disabled");
});
test("location filtering advances past invisible changes without disclosing other-store IDs", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ revision: "3" }] })
    .mockResolvedValueOnce({
      rows: [
        {
          revision: "1",
          location_id: "7",
          entity_id: "secret-other-location",
          kind: "food_orders",
        },
        {
          revision: "2",
          location_id: "8",
          entity_id: "mine",
          kind: "food_orders",
        },
        {
          revision: "3",
          location_id: null,
          entity_id: "global",
          kind: "food_menu_items",
        },
      ],
    });
  const result = await changes({ restaurantId: 2, locationId: 8 }, 0);
  expect(result.cursor).toBe(3);
  expect(result.events.map((e) => e.entityId)).toEqual(["mine", "global"]);
  expect(JSON.stringify(result)).not.toContain("secret-other-location");
});
test("assigned screen scopes can include several stores without leaking other events", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ revision: "4" }] })
    .mockResolvedValueOnce({
      rows: [
        { revision: "1", location_id: "7", entity_id: "store-7", kind: "food_orders" },
        { revision: "2", location_id: "8", entity_id: "store-8", kind: "food_orders" },
        { revision: "3", location_id: "9", entity_id: "store-9", kind: "food_orders" },
        { revision: "4", location_id: "10", entity_id: "secret-store-10", kind: "food_orders" },
      ],
    });
  const result = await changes({ restaurantId: 2, locationIds: [7, 9] }, 0);
  expect(result.cursor).toBe(4);
  expect(result.events.map((e) => e.entityId)).toEqual(["store-7", "store-9"]);
  expect(JSON.stringify(result)).not.toContain("secret-store-10");
});
test("retained history gap and cursor ahead of head both demand a fresh snapshot", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ revision: "40" }] })
    .mockResolvedValueOnce({ rows: [{ revision: "38" }] });
  expect((await changes({ restaurantId: 2 }, 1)).resetRequired).toBe(true);
  pool.query.mockResolvedValueOnce({ rows: [{ revision: "10" }] });
  expect((await changes({ restaurantId: 2 }, 11)).resetRequired).toBe(true);
});

test("fully pruned history cannot silently advance over unapplied changes", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ revision: "40" }] })
    .mockResolvedValueOnce({ rows: [] });
  expect((await changes({ restaurantId: 2 }, 1)).resetRequired).toBe(true);
});

// Background-jobs audit #46: one unavailable transport used to throw
// out of the whole batch, rolling back every restaurant's
// published_at marks. A failed broadcast now skips just that
// restaurant and the rest still publish. (setup.js mocks
// withTransaction to run against pool.query, so the queued mock
// responses below are the pending check, the FOR UPDATE select, and
// the per-restaurant UPDATE.)
test("publishBatch skips the failed restaurant and still publishes the rest", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
    .mockResolvedValueOnce({
      rows: [
        { restaurant_id: 7, revision: "3" },
        { restaurant_id: 8, revision: "5" },
      ],
    })
    .mockResolvedValueOnce({ rows: [] });
  broadcastToRestaurantDisplay
    .mockReturnValueOnce(true) // restaurant 7 publishes
    .mockReturnValueOnce(false); // restaurant 8 transport down
  const result = await publishBatch();
  expect(result).toEqual({
    published: 1,
    failed: [{ restaurantId: 8, error: "Restaurant display transport is unavailable" }],
  });
  expect(broadcastToRestaurantDisplay).toHaveBeenCalledTimes(2);
  const updates = pool.query.mock.calls.filter(([sql]) => /UPDATE restaurant_screen_events/.test(String(sql)));
  expect(updates).toHaveLength(1);
  expect(updates[0][1]).toEqual([7, "3"]);
});

test("publishBatch with nothing pending publishes nothing and opens no transaction", async () => {
  pool.query.mockResolvedValueOnce({ rows: [] });
  const result = await publishBatch();
  expect(result).toEqual({ published: 0, failed: [] });
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(broadcastToRestaurantDisplay).not.toHaveBeenCalled();
});
