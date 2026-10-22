jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require("../db");
const {
  positive,
  cursor,
  deviceHealth,
  changes,
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
