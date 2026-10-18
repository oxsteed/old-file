"use strict";
// Real PostgreSQL verification. Only the disposable rehearsal DB is accepted.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const connectionString = process.env.SCREEN_TEST_DATABASE_URL;
if (
  !connectionString ||
  !/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/oxsteed_rehearsal(?:\?|$)/.test(
    connectionString,
  )
)
  throw new Error("Use the disposable loopback oxsteed_rehearsal database");
const db = new Pool({ connectionString, max: 8 });
require.cache[require.resolve("../db")] = { exports: db };
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_screens_synthetic";
const sync = require("../services/restaurantScreenSync");
const screens = require("../controllers/restaurantScreensController");
const app = require("../controllers/restaurantAppFlowController");
const emitted = [];
const socket = require("../services/socketService");
socket.broadcastToRestaurantDisplay = (_id, _event, payload) => {
  emitted.push(payload);
  return true;
};
async function call(fn, params, user, body = {}, token = null) {
  let response,
    status = 200;
  const req = {
    params,
    query: {},
    body,
    user,
    headers: {},
    get(name) {
      if (name.toLowerCase() === "x-device-token") return token;
      if (name.toLowerCase() === "idempotency-key") return body.idempotencyKey;
      return undefined;
    },
  };
  const res = {
    status(n) {
      status = n;
      return this;
    },
    json(value) {
      response = value;
      return this;
    },
  };
  await fn(req, res, (error) => {
    if (error) throw error;
  });
  return { data: response, status, req };
}
(async () => {
  try {
    assert.equal(
      (await db.query("SELECT current_database() AS name")).rows[0].name,
      "oxsteed_rehearsal",
    );
    await db.query(
      require("node:fs").readFileSync(
        require("node:path").join(
          __dirname,
          "../migrations/887_restaurant_screen_sync.sql",
        ),
        "utf8",
      ),
    );
    const uid = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic','Screen','Owner')",
      [uid, `screen-${uid}@example.com`],
    );
    const {
      rows: [biz],
    } = await db.query(
      "INSERT INTO businesses(user_id,business_name,business_kind,is_active,is_listed,setup_status) VALUES($1,'Synthetic screen store','restaurant',true,true,'active') RETURNING id",
      [uid],
    );
    const {
      rows: [r],
    } = await db.query(
      "INSERT INTO food_restaurants(business_id,owner_user_id,display_name,slug,status,discovery_status,screens_v2_enabled,accepts_in_store_orders,accepts_online_orders,fulfillment_modes) VALUES($1,$2,'Synthetic screen store',$3,'active','visible',true,true,true,ARRAY['pickup','dine_in']) RETURNING *",
      [biz.id, uid, `screens-${uid}`],
    );
    const restaurantId = Number(r.id),
      owner = { id: uid };
    const {
      rows: [item],
    } = await db.query(
      "INSERT INTO food_menu_items(restaurant_id,name,price_cents) VALUES($1,'Test meal',1000) RETURNING *",
      [restaurantId],
    );
    const {
      rows: [location],
    } = await db.query(
      "INSERT INTO restaurant_locations(restaurant_id,name) VALUES($1,'Second store') RETURNING id",
      [restaurantId],
    );
    const scope = {
      restaurantId,
      locationId: null,
      allLocations: true,
      readOrders: true,
    };
    const first = await sync.snapshot(scope);
    assert.equal(first.enabled, true);
    // Rollbacks cannot advance the public cursor.
    const client = await db.connect();
    await client.query("BEGIN");
    await client.query(
      "UPDATE food_menu_items SET price_cents=1100 WHERE id=$1",
      [item.id],
    );
    await client.query("ROLLBACK");
    client.release();
    assert.equal((await sync.snapshot(scope)).cursor, first.cursor);
    const start = (await sync.snapshot(scope)).cursor;
    const a = await db.connect(),
      b = await db.connect();
    await a.query("BEGIN");
    await a.query("UPDATE food_menu_items SET price_cents=1001 WHERE id=$1", [
      item.id,
    ]);
    await b.query("BEGIN");
    const later = b.query("UPDATE food_menu_items SET name=name WHERE id=$1", [
      item.id,
    ]);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await sync.snapshot(scope)).cursor, start);
    await a.query("COMMIT");
    await later;
    await b.query("COMMIT");
    a.release();
    b.release();
    const deltas = await sync.changes(scope, start);
    assert.deepEqual(
      deltas.events.map((e) => e.revision),
      [start + 1, start + 2],
    );
    await db.query("UPDATE food_menu_items SET price_cents=1000 WHERE id=$1", [
      item.id,
    ]);
    // Snapshot pagination includes more than the legacy 100-ticket limit.
    await db.query(
      "INSERT INTO food_orders(restaurant_id,business_id,queue_number,total_cents) SELECT $1,$2,n,1000 FROM generate_series(1,300) n",
      [restaurantId, biz.id],
    );
    const one = await sync.snapshot(scope);
    assert.equal(one.orders.length, 250);
    assert.equal(one.hasMore, true);
    const two = await sync.snapshot(scope, {
      afterOrderId: one.nextOrderId,
      snapshotCursor: one.cursor,
    });
    assert.equal(two.orders.length, 50);
    await db.query(
      "UPDATE food_orders SET location_id=$2 WHERE restaurant_id=$1 AND queue_number=1",
      [restaurantId, location.id],
    );
    const scoped = await sync.snapshot({
      ...scope,
      allLocations: false,
      locationId: location.id,
    });
    assert.equal(scoped.orders.length, 1);
    const publicOnly = await sync.snapshot({
      ...scope,
      readOrders: false,
      allLocations: false,
      locationId: location.id,
    });
    assert.equal(publicOnly.orders.length, 0);
    assert.deepEqual(publicOnly.board.preparing, [1]);
    assert.ok(
      (
        await sync.changes({ ...scope, readOrders: false }, one.cursor)
      ).events.every((e) => Object.keys(e).length === 1),
    );
    const defaultDelta = await sync.changes(
      { ...scope, allLocations: false, locationId: null },
      one.cursor,
    );
    assert.ok(
      defaultDelta.events.some((e) => e.kind === "food_orders"),
      "old location is invalidated when an order moves",
    );
    await assert.rejects(
      call(screens.control, { restaurantId }, { id: crypto.randomUUID() }),
      (e) => [403, 404].includes(e.status),
    );

    await assert.rejects(
      sync.snapshot(scope, { snapshotCursor: one.cursor }),
      (e) => e.code === "screen_snapshot_changed",
    );
    const ticket = crypto.randomUUID(),
      payload = {
        fulfillmentType: "pickup",
        paymentMode: "pay_at_counter",
        items: [
          {
            menuItemId: Number(item.id),
            quantity: 1,
            modifierIds: [],
            itemName: "Test meal",
          },
        ],
      };
    const imported = await call(screens.importTicket, { restaurantId }, owner, {
      id: ticket,
      payload,
      expectedTotalCents: 1000,
    });
    assert.equal(imported.data.status, "pending");
    const duplicate = await call(
      screens.importTicket,
      { restaurantId },
      owner,
      { id: ticket, payload, expectedTotalCents: 1000 },
    );
    assert.equal(duplicate.data.id, ticket);
    await assert.rejects(
      call(screens.importTicket, { restaurantId }, owner, {
        id: ticket,
        payload,
        expectedTotalCents: 1,
      }),
      (e) => e.code === "screen_idempotency_conflict",
    );
    await assert.rejects(
      call(screens.importTicket, { restaurantId }, owner, {
        id: crypto.randomUUID(),
        payload: { ...payload, paymentMode: "card" },
        expectedTotalCents: 1000,
      }),
      (e) => e.code === "screen_payment_online_required",
    );
    // Import itself cannot manufacture a kitchen order.
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT COUNT(*) AS n FROM food_orders WHERE restaurant_id=$1",
            [restaurantId],
          )
        ).rows[0].n,
      ),
      300,
    );
    // Link an ambiguously acknowledged online kiosk order to the same draft UUID.
    const kioskToken = "synthetic-kiosk-only",
      kioskId = crypto.randomUUID();
    const {
      rows: [kioskDevice],
    } = await db.query(
      `INSERT INTO restaurant_app_devices(restaurant_id,app_key,device_name,mode,status,device_token_hash,device_token_expires_at,config) VALUES($1,'display','Test kiosk','kiosk','paired',$2,NOW()+INTERVAL '1 day','{"screenRole":"kiosk"}') RETURNING *`,
      [
        restaurantId,
        crypto.createHash("sha256").update(kioskToken).digest("hex"),
      ],
    );
    const online = await call(
      screens.createOrder,
      { restaurantId, deviceId: kioskDevice.id },
      null,
      { ...payload, client_order_id: kioskId, expectedTotalCents: 1000 },
      kioskToken,
    );
    await call(screens.importTicket, { restaurantId }, owner, {
      id: kioskId,
      payload,
      expectedTotalCents: 1000,
    });
    const recovered = await call(
      screens.acceptTicket,
      { restaurantId, ticketId: kioskId },
      owner,
    );
    assert.equal(recovered.data.order.id, online.data.order.id);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT COUNT(*) AS n FROM food_orders WHERE restaurant_id=$1 AND metadata->>'clientOrderId'=$2",
            [restaurantId, kioskId],
          )
        ).rows[0].n,
      ),
      1,
    );
    assert.ok(
      (await call(screens.control, { restaurantId }, owner)).data.devices.some(
        (d) => d.id === kioskDevice.id,
      ),
    );
    await call(
      app.updateDeviceConfig,
      { restaurantId, deviceId: kioskDevice.id },
      owner,
      { locationId: location.id, config: { screenRole: "kiosk" } },
    );
    const cleared = await call(
      app.updateDeviceConfig,
      { restaurantId, deviceId: kioskDevice.id },
      owner,
      { locationId: null },
    );
    assert.equal(cleared.data.device.location_id, null);
    const beat = await call(
      app.deviceHeartbeat,
      { restaurantId, deviceId: kioskDevice.id },
      null,
      {
        configVersion: cleared.data.device.config_version,
        appliedConfigVersion: cleared.data.device.config_version,
        screenCursor: (await sync.snapshot(scope)).cursor,
        pendingOperations: 0,
        syncStatus: "healthy",
      },
      kioskToken,
    );
    assert.equal(beat.data.configChanged, false);
    assert.equal(
      beat.data.device.applied_config_version,
      cleared.data.device.config_version,
    );
    await db.query("UPDATE food_menu_items SET price_cents=1200 WHERE id=$1", [
      item.id,
    ]);
    await assert.rejects(
      call(screens.acceptTicket, { restaurantId, ticketId: ticket }, owner),
      (e) => e.code === "screen_price_conflict",
    );
    const approvedFingerprint = [
      { id: String(item.id), name: "Test meal", price: 1200, modifiers: [] },
    ];
    const accepted = await call(
      screens.acceptTicket,
      { restaurantId, ticketId: ticket },
      owner,
      { approvedTotalCents: 1200, approvedFingerprint },
    );
    assert.ok(accepted.data.order);
    assert.equal(accepted.data.order.payment_status, "unpaid");
    assert.equal(accepted.data.order.customer_id, null);
    const replay = await call(
      screens.acceptTicket,
      { restaurantId, ticketId: ticket },
      owner,
      { approvedTotalCents: 1200, approvedFingerprint },
    );
    assert.equal(replay.data.order.id, accepted.data.order.id);
    const order = accepted.data.order,
      orderItem = (
        await db.query("SELECT * FROM food_order_items WHERE order_id=$1", [
          order.id,
        ])
      ).rows[0];
    await assert.rejects(
      call(
        app.performKitchenItemAction,
        { restaurantId, orderItemId: orderItem.id },
        owner,
        {
          action: "start",
          idempotencyKey: crypto.randomUUID(),
          expectedRevision: 9999,
        },
      ),
      (e) => e.code === "screen_revision_conflict",
    );
    const started = await call(
      app.performKitchenItemAction,
      { restaurantId, orderItemId: orderItem.id },
      owner,
      {
        action: "start",
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: orderItem.screen_revision,
      },
    );
    await call(
      app.performKitchenItemAction,
      { restaurantId, orderItemId: orderItem.id },
      owner,
      {
        action: "ready",
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: started.data.item.screen_revision,
      },
    );
    const token = "synthetic-device-only";
    const {
      rows: [device],
    } = await db.query(
      "INSERT INTO restaurant_app_devices(restaurant_id,app_key,device_name,mode,status,device_token_hash,device_token_expires_at,config) VALUES($1,'kitchen','Test expo','expeditor','paired',$2,NOW()+INTERVAL '1 day','{\"screenRole\":\"expeditor\"}') RETURNING *",
      [restaurantId, crypto.createHash("sha256").update(token).digest("hex")],
    );
    const authorized = await screens.access({
      params: { restaurantId, deviceId: device.id },
      query: {},
      get: () => token,
    });
    assert.equal(authorized.readOrders, true);
    const invokeExpo = async (action) => {
      const current = (
        await db.query("SELECT * FROM food_orders WHERE id=$1", [order.id])
      ).rows[0];
      const req = {
        params: { restaurantId, orderId: order.id },
        body: {
          action,
          expectedRevision: current.screen_revision,
          idempotencyKey: crypto.randomUUID(),
        },
        screenDevice: device,
        screenRestaurant: { ...r, effective_role: "screen_expeditor" },
        get: () => null,
      };
      let result;
      await screens.orderAction(
        req,
        {
          status() {
            return this;
          },
          json(x) {
            result = x;
          },
        },
        (e) => {
          throw e;
        },
      );
      return result;
    };
    await invokeExpo("finish_check");
    const readyBoard = await sync.snapshot({ ...scope, readOrders: false });
    assert.ok(readyBoard.board.ready.includes(order.queue_number));
    const tracked = await call(
      require("../controllers/foodController").getTrackedOrder,
      { trackingToken: accepted.data.trackingToken },
      null,
    );
    assert.equal(tracked.data.order.id, order.id);
    assert.equal(tracked.data.order.status, "ready");
    assert.equal(tracked.data.order.queue_number, order.queue_number);
    const trackingHash = crypto
      .createHash("sha256")
      .update(accepted.data.trackingToken)
      .digest("hex");
    await db.query(
      "UPDATE food_orders SET metadata=metadata||$2::jsonb WHERE id=$1",
      [
        order.id,
        JSON.stringify({
          trackingToken: trackingHash,
          tracking_token: trackingHash,
        }),
      ],
    );
    assert.equal(
      (
        await call(
          require("../controllers/foodController").getTrackedOrder,
          { trackingToken: accepted.data.trackingToken },
          null,
        )
      ).data.order.status,
      "ready",
    );
    await assert.rejects(
      call(
        require("../controllers/foodController").getTrackedOrder,
        { trackingToken: trackingHash },
        null,
      ),
      (e) => e.code === "order_not_found",
    );

    assert.equal(
      (await db.query("SELECT status FROM food_orders WHERE id=$1", [order.id]))
        .rows[0].status,
      "ready",
    );
    await assert.rejects(
      invokeExpo("hand_off"),
      (e) => e.code === "order_unpaid",
    );
    await db.query("UPDATE food_orders SET payment_status='paid' WHERE id=$1", [
      order.id,
    ]);
    await invokeExpo("hand_off");
    const afterHandoff = await sync.snapshot({ ...scope, readOrders: false });
    assert.ok(!afterHandoff.board.ready.includes(order.queue_number));
    assert.equal(
      (
        await call(
          require("../controllers/foodController").getTrackedOrder,
          { trackingToken: accepted.data.trackingToken },
          null,
        )
      ).data.order.status,
      "completed",
    );

    assert.equal(
      (await db.query("SELECT status FROM food_orders WHERE id=$1", [order.id]))
        .rows[0].status,
      "completed",
    );
    await db.query(
      "UPDATE restaurant_app_devices SET status='disabled' WHERE id=$1",
      [device.id],
    );
    await assert.rejects(
      screens.access({
        params: { restaurantId, deviceId: device.id },
        query: {},
        get: () => token,
      }),
      (e) => e.code === "invalid_device_credential",
    );
    // Backlog recovery and publication use real committed rows, no private payloads.
    const before = (await sync.snapshot(scope)).cursor;
    await db.query(
      "SELECT restaurant_screen_record_change($1,NULL,'synthetic',n::text) FROM generate_series(1,1000) n",
      [restaurantId],
    );
    let cursor = before,
      count = 0;
    const began = performance.now();
    do {
      const page = await sync.changes(scope, cursor);
      count += page.events.length;
      cursor = page.cursor;
      if (!page.hasMore) break;
    } while (true);
    assert.equal(count, 1000);
    assert.ok(performance.now() - began < 15000);

    const cursorBeforeDisable = (await sync.snapshot(scope)).cursor;
    await db.query(
      "UPDATE food_restaurants SET screens_v2_enabled=false WHERE id=$1",
      [restaurantId],
    );
    assert.ok(
      (await sync.changes(scope, cursorBeforeDisable)).events.some(
        (e) => e.kind === "screen_rollout_disabled",
      ),
    );
    assert.equal((await sync.snapshot(scope)).enabled, false);
    // Unresolved drafts can still be imported while the rollout is disabled.
    await call(screens.importTicket, { restaurantId }, owner, {
      id: crypto.randomUUID(),
      payload,
      expectedTotalCents: 1200,
    });
    const pendingBefore = Number(
      (
        await db.query(
          "SELECT COUNT(*) AS n FROM restaurant_screen_events WHERE published_at IS NULL",
        )
      ).rows[0].n,
    );
    const transport = socket.broadcastToRestaurantDisplay;
    socket.broadcastToRestaurantDisplay = () => false;
    await assert.rejects(sync.publishBatch(), /transport is unavailable/);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT COUNT(*) AS n FROM restaurant_screen_events WHERE published_at IS NULL",
          )
        ).rows[0].n,
      ),
      pendingBefore,
    );
    socket.broadcastToRestaurantDisplay = transport;
    await sync.publishBatch();
    assert.ok(emitted.length);
    assert.deepEqual(Object.keys(emitted.at(-1)).sort(), [
      "restaurantId",
      "revision",
    ]);
    console.log(
      JSON.stringify({
        passed: true,
        activeSnapshot: 300,
        backlogEvents: 1000,
        recoveryMs: Math.round(performance.now() - began),
        checks: [
          "transaction rollback",
          "commit ordering",
          "pagination",
          "location isolation",
          "offline import idempotency",
          "price review",
          "no financial replay",
          "ambiguous online response recovery",
          "expected revisions",
          "station to expo to handoff",
          "device revocation",
          "redacted outbox",
          "publication retry",
          "rollback recovery",
          "no public internal IDs",
        ],
      }),
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
