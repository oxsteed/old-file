"use strict";
/**
 * Growth domain-hook guard + behavior tests (spec 5.3).
 *
 * The guard lists the required emitDomainEvent hook sites per domain and
 * fails if one is removed. The behavior tests pin the emit contract
 * (no-op while the gate is off, UUIDv7 ids, invalid props rejected
 * before any outbox insert) and the writer's batched geography lookups.
 */
const fs = require("fs");
const path = require("path");

process.env.GROWTH_SUBJECT_PEPPER =
  "synthetic-growth-test-pepper-32-chars";

const SERVER_ROOT = path.join(__dirname, "..");

// event -> { relative file: minimum emitDomainEvent call sites }
const REQUIRED_HOOKS = {
  "job.posted": { "controllers/jobController.js": 1 },
  "job.bid_placed": { "controllers/bidController.js": 1 },
  "job.assigned": { "controllers/jobController.js": 1 },
  "job.completed": { "controllers/jobController.js": 1 },
  "job.cancelled": { "services/jobCancellationService.js": 2 },
  "booking.confirmed": { "services/bookingRequestLifecycle.js": 2 },
  "appointment.booked": {
    "services/directSlotEngine.js": 1,
    "controllers/appointmentController.js": 1,
    "controllers/businessAppointmentsController.js": 1,
  },
  "direct.quote_requested": { "controllers/quoteRequestsController.js": 1 },
  "food.order_placed": { "controllers/foodController.js": 1 },
  "food.order_paid": {
    "controllers/foodController.js": 1,
    "controllers/webhookController.js": 1,
    "services/restaurantPosPaymentLedgerService.js": 1,
  },
  "food.order_cancelled": { "controllers/foodController.js": 1 },
  "food.order_refunded": {
    "controllers/foodController.js": 1,
    "controllers/webhookController.js": 1,
    "controllers/adminFoodOrdersController.js": 1,
    "controllers/agentFoodRefundActions.js": 1,
    "controllers/restaurantSupportController.js": 1,
    "services/restaurantPosPaymentLedgerService.js": 1,
  },
  "food.delivery_enabled": {
    "controllers/restaurantAppFlowController.js": 1,
  },
  "promo.redeemed": {
    "controllers/webhookController.js": 3,
    "controllers/foodController.js": 1,
  },
  "tool_rental.booked": { "controllers/toolBookingsController.js": 1 },
  "subscription.started": {
    "controllers/webhookController.js": 2,
    "controllers/subscriptionController.js": 1,
  },
  "subscription.cancelled": {
    "controllers/webhookController.js": 1,
    "controllers/subscriptionController.js": 1,
    "workers/subscriptionCreditWorkers.js": 1,
  },
  "account.signed_up": { "controllers/helperRegistrationController.js": 1 },
  "account.role_added": {
    "controllers/authController.js": 1,
    "controllers/vortexController.js": 1,
    "controllers/businessAccessCodesController.js": 1,
    "controllers/businessController.js": 1,
    "controllers/careerController.js": 1,
    "controllers/superAdminUserController.js": 1,
  },
  "account.tier_changed": { "controllers/webhookController.js": 1 },
};

describe("spec 5.3 guard: required domain hooks exist", () => {
  for (const [event, files] of Object.entries(REQUIRED_HOOKS)) {
    for (const [rel, min] of Object.entries(files)) {
      test(`${event} is emitted from ${rel} (>= ${min} site${min > 1 ? "s" : ""})`, () => {
        const src = fs.readFileSync(path.join(SERVER_ROOT, rel), "utf8");
        const pattern = new RegExp(
          `emitDomainEvent\\(\\s*[A-Za-z_$][\\w$]*\\s*,\\s*'${event.replace(/\./g, "\\.")}'`,
          "g",
        );
        const matches = src.match(pattern) || [];
        expect(matches.length).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

jest.mock("../growth/gate", () => ({ allow: jest.fn() }));
const gate = require("../growth/gate");
const {
  emitDomainEvent,
  jobEventProps,
  serviceEventProps,
  foodEventProps,
  commerceEventProps,
  accountRoleForMode,
} = require("../growth/emit");

const USER_ID = "00000000-0000-4000-8000-000000000001";
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fakeClient() {
  return { release: jest.fn(), query: jest.fn().mockResolvedValue({ rows: [] }) };
}

describe("emitDomainEvent contract", () => {
  const savedEnv = process.env.GROWTH_TRACKING_HARD_OFF;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GROWTH_TRACKING_HARD_OFF;
    else process.env.GROWTH_TRACKING_HARD_OFF = savedEnv;
    jest.clearAllMocks();
  });

  test("is a no-op returning false while the engine gate is off", async () => {
    delete process.env.GROWTH_TRACKING_HARD_OFF;
    const client = fakeClient();
    await expect(
      emitDomainEvent(client, "job.posted", { job_id: "x" }, { userId: USER_ID }),
    ).resolves.toBe(false);
    expect(client.query).not.toHaveBeenCalled();
  });

  test("writes the outbox row in-transaction with a UUIDv7 event id", async () => {
    process.env.GROWTH_TRACKING_HARD_OFF = "false";
    gate.allow.mockResolvedValue({
      allowed: true,
      context: {
        gpc: false,
        jurisdiction: { code: "US", saleShare: false },
        consents: {},
        rollout: { policy_version: "test-v1" },
        trustedSignals: [],
      },
    });
    const client = fakeClient();
    await expect(
      emitDomainEvent(
        client,
        "job.assigned",
        { job_id: "00000000-0000-4000-8000-000000000099" },
        { userId: USER_ID },
      ),
    ).resolves.toBe(true);
    const insert = client.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO activity_outbox"),
    );
    expect(insert).toBeTruthy();
    expect(insert[1][0]).toMatch(V7);
    expect(insert[1][1]).toBe(USER_ID);
    expect(insert[1][2]).toBe("job.assigned");
  });

  test("returns false without an insert when the gate denies", async () => {
    process.env.GROWTH_TRACKING_HARD_OFF = "false";
    gate.allow.mockResolvedValue({ allowed: false, reason: "switch_off" });
    const client = fakeClient();
    await expect(
      emitDomainEvent(client, "job.posted", { job_id: "x" }, { userId: USER_ID }),
    ).resolves.toBe(false);
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO activity_outbox"),
      ),
    ).toBe(false);
  });

  test("rejects non-allowlisted props (no amounts ever) before inserting", async () => {
    process.env.GROWTH_TRACKING_HARD_OFF = "false";
    gate.allow.mockResolvedValue({
      allowed: true,
      context: {
        gpc: false,
        jurisdiction: { code: "US", saleShare: false },
        consents: {},
        rollout: { policy_version: "test-v1" },
        trustedSignals: [],
      },
    });
    const client = fakeClient();
    await expect(
      emitDomainEvent(
        client,
        "job.posted",
        { job_id: "x", amount_cents: 500 },
        { userId: USER_ID },
      ),
    ).rejects.toThrow("invalid_growth_domain_event");
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO activity_outbox"),
      ),
    ).toBe(false);
  });

  test("requires a real transaction client", async () => {
    process.env.GROWTH_TRACKING_HARD_OFF = "false";
    await expect(
      emitDomainEvent({ query: jest.fn() }, "job.posted", {}, { userId: USER_ID }),
    ).rejects.toThrow("growth_domain_event_requires_transaction_client");
  });
});

describe("guarded prop builders omit anything that would fail validation", () => {
  test("jobEventProps uses job_type_label and drops unsafe values", () => {
    expect(
      jobEventProps({
        id: "00000000-0000-4000-8000-0000000000aa",
        category_id: 7,
        job_type_label: "one_time",
        job_type: "tier1_intro",
        currency_code: "USD",
      }),
    ).toEqual({
      job_id: "00000000-0000-4000-8000-0000000000aa",
      category_id: 7,
      job_type: "one_time",
      currency: "USD",
    });
    expect(
      jobEventProps({ id: 42, category_id: null, job_type_label: "One Time!", currency_code: "usd" }),
    ).toEqual({ job_id: "42" });
    expect(jobEventProps(null)).toEqual({});
  });

  test("serviceEventProps keeps only a bounded service_id", () => {
    expect(serviceEventProps({ service_id: "abc" })).toEqual({ service_id: "abc" });
    expect(serviceEventProps({ serviceId: "x".repeat(37) })).toEqual({});
    expect(serviceEventProps({})).toEqual({});
    expect(serviceEventProps(null)).toEqual({});
  });

  test("foodEventProps omits the kiosk fulfilment the schema lacks", () => {
    expect(
      foodEventProps({ restaurant_id: 12, fulfillment_type: "delivery" }, { itemCount: 3 }),
    ).toEqual({ restaurant_id: "12", fulfilment: "delivery", item_count: 3 });
    expect(
      foodEventProps({ restaurant_id: 12, fulfillment_type: "kiosk" }),
    ).toEqual({ restaurant_id: "12" });
    expect(foodEventProps({ fulfillment_type: "delivery" })).toEqual({});
  });

  test("commerceEventProps enforces the entity pattern and coerces BIGINT strings", () => {
    expect(
      commerceEventProps({ id: "9001", discount_cents: "250", currency_code: "USD" }),
    ).toEqual({ entity_id: "9001", amount_minor: 250, currency: "USD" });
    expect(commerceEventProps({ id: "not-an-id!" })).toEqual({});
    expect(commerceEventProps({ id: 5, amount_minor: -1, currency: "usd" })).toEqual({
      entity_id: "5",
    });
  });

  test("accountRoleForMode derives business/restaurant from the mode prefix", () => {
    expect(accountRoleForMode("business_owner")).toBe("business");
    expect(accountRoleForMode("business_employee")).toBe("business");
    expect(accountRoleForMode("restaurant_owner")).toBe("restaurant");
    expect(accountRoleForMode("restaurant_runner")).toBe("restaurant");
    expect(accountRoleForMode("helper")).toBe("helper");
    expect(accountRoleForMode("consultant")).toBe("helper");
    expect(accountRoleForMode("customer")).toBe("customer");
    expect(accountRoleForMode("admin")).toBe(null);
    expect(accountRoleForMode(undefined)).toBe(null);
  });
});

describe("writer geography batching", () => {
  const CENTROIDS = [
    { id: 9, country: "US", postal_code: "10001", place_name: "New York", admin1: "NY" },
    { id: 5, country: "US", postal_code: "10001", place_name: "New York", admin1: "NY" },
    { id: 3, country: "US", postal_code: "78701", place_name: "Austin", admin1: "TX" },
    { id: 7, country: "CA", postal_code: "M5V1J1", place_name: "Toronto", admin1: "ON" },
  ];
  function fakeGeoConn() {
    return {
      query: jest.fn(async (sql, params) => {
        if (sql.includes("WITH keys") && sql.includes("postal_code")) {
          const rows = [];
          params[0].forEach((country, i) => {
            const m = CENTROIDS.filter(
              (c) => c.country === country && c.postal_code === params[1][i],
            );
            if (m.length) rows.push({ ord: i + 1, id: Math.min(...m.map((x) => x.id)) });
          });
          return { rows };
        }
        if (sql.includes("WITH keys")) {
          const rows = [];
          params[0].forEach((country, i) => {
            const m = CENTROIDS.filter(
              (c) =>
                c.country === country &&
                c.place_name.toLowerCase() === String(params[1][i]).toLowerCase() &&
                c.admin1.toLowerCase() === String(params[2][i]).toLowerCase(),
            );
            if (m.length) rows.push({ ord: i + 1, id: Math.min(...m.map((x) => x.id)) });
          });
          return { rows };
        }
        if (sql.includes("postal_code=$2")) {
          const m = CENTROIDS.filter(
            (c) => c.country === params[0] && c.postal_code === params[1],
          ).sort((a, b) => a.id - b.id);
          return { rows: m.slice(0, 1) };
        }
        const m = CENTROIDS.filter(
          (c) =>
            c.country === params[0] &&
            c.place_name.toLowerCase() === String(params[1]).toLowerCase() &&
            c.admin1.toLowerCase() === String(params[2]).toLowerCase(),
        ).sort((a, b) => a.id - b.id);
        return { rows: m.slice(0, 1) };
      }),
    };
  }

  test("resolveBatch matches resolve() semantics with at most two queries", async () => {
    const { resolve, resolveBatch } = require("../growth/geo/resolve");
    const places = [
      { country: "US", postal_code: "10001", city: "New York", state: "NY" },
      { country: "US", postal_code: "99999", city: "austin", state: "tx" },
      { country: "CA", postal_code: "", city: "Toronto", state: "ON" },
      { country: "USA", postal_code: "10001", city: "New York", state: "NY" },
      { country: "US", postal_code: "00000", city: "Nowhere", state: "ZZ" },
      { country: "US", postal_code: " 78701 ", city: null, state: null },
      {},
    ];
    const batchConn = fakeGeoConn();
    const batched = await resolveBatch(batchConn, places);
    const singleConn = fakeGeoConn();
    const singles = [];
    for (const place of places) singles.push(await resolve(singleConn, place));
    expect(batched).toEqual(singles);
    expect(batched).toEqual([5, 3, 7, 0, 0, 3, 0]);
    expect(batchConn.query.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test("writeBatch projects jobs and resolves centroids in a constant number of queries", async () => {
    const { writeBatch } = require("../growth/ingest/writer");
    const JOB_A = "00000000-0000-4000-8000-0000000000a1";
    const JOB_B = "00000000-0000-4000-8000-0000000000b2";
    const JOB_C = "00000000-0000-4000-8000-0000000000c3";
    const jobsById = {
      [JOB_A]: { id: JOB_A, location_zip: "10001", location_country_code: "US", location_city: "New York", location_state: "NY" },
      [JOB_B]: { id: JOB_B, location_zip: "78701", location_country_code: "US", location_city: "Austin", location_state: "TX" },
      [JOB_C]: { id: JOB_C, location_zip: null, location_country_code: "US", location_city: "Austin", location_state: "TX" },
    };
    const geo = fakeGeoConn();
    const pg = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes("FROM jobs")) {
          return { rows: params[0].map((id) => jobsById[id]).filter(Boolean) };
        }
        return geo.query(sql, params);
      }),
    };
    const allow = jest.fn().mockResolvedValue({
      allowed: true,
      basis: "notice",
      jurisdiction: "US",
      context: {
        subjectKey: "subject",
        user: { country_confirmed: true, country: "US", zip_code: "60601", city: "Chicago", state: "IL", role: "customer" },
      },
    });
    const pipe = { xack: jest.fn(), xdel: jest.fn(), exec: jest.fn().mockResolvedValue([]) };
    const conn = { multi: jest.fn(() => pipe), xadd: jest.fn() };
    const store = { insert: jest.fn().mockResolvedValue(undefined) };
    const now = new Date().toISOString();
    const entries = [];
    [JOB_A, JOB_B, JOB_C].forEach((jobId, j) => {
      for (let i = 0; i < 10; i += 1) {
        entries.push([
          `${j * 10 + i + 1}-0`,
          [
            "payload",
            JSON.stringify({
              userId: USER_ID,
              domain: true,
              trustedSignals: [],
              event: {
                event_id: `00000000-0000-4000-8000-${String(j * 10 + i).padStart(12, "0")}`,
                name: "job.posted",
                schema_ver: 1,
                occurred_at: now,
                props: { job_id: jobId },
              },
            }),
          ],
        ]);
      }
    });
    const result = await writeBatch(entries, { conn, store, allow, db: pg });
    expect(result).toEqual({ stored: 30, discarded: 0 });
    // 1 batched jobs query + 1 postal batch + 1 city batch for 30 events.
    expect(pg.query.mock.calls.length).toBe(3);
    expect(store.insert).toHaveBeenCalledTimes(1);
    const values = store.insert.mock.calls[0][0].values;
    expect(values).toHaveLength(30);
    expect(values.filter((v) => v.entity_id === JOB_A).every((v) => v.postal_ref === 5)).toBe(true);
    expect(values.filter((v) => v.entity_id === JOB_B).every((v) => v.postal_ref === 3)).toBe(true);
    expect(values.filter((v) => v.entity_id === JOB_C).every((v) => v.postal_ref === 3)).toBe(true);
  });
});
