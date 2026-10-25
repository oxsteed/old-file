'use strict';

// Opt-in, fully migrated disposable PostgreSQL. Scope and permission services
// are real; only outbound notifications and the pool transport are replaced.
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({ success: true })),
}));
const crypto = require('crypto');
const { Pool } = require('pg');
const db = require('../db');
const permissions = require('../services/permissionsService');
const scopeModel = require('../services/scopeModel');
const {
  getLocationScope,
} = require('../services/restaurantLocationAccessService');
const identity = require('../services/restaurantStaffIdentityService');
const app = require('../controllers/restaurantAppFlowController');
const pos = require('../controllers/restaurantPosController');
const food = require('../controllers/foodController');
const inventory = require('../controllers/restaurantInventoryController');
const inventoryOps = require('../controllers/restaurantInventoryOperationsController');
const reports = require('../controllers/restaurantReportsController');
const access = require('../controllers/restaurantLocationAccessController');
const devices = require('../controllers/restaurantDeviceController');
const schedule = require('../controllers/businessStaffScheduleController');
const legacySchedule = require('../controllers/staffSchedulingController');
const hubs = require('../controllers/storeHubController');
const members = require('../controllers/businessMembersController');
const url = process.env.RESTAURANT_STORE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.pathname !== '/restaurant_store_test'
  ) {
    throw new Error(
      'Requires disposable migrated loopback restaurant_store_test',
    );
  }
}
(url ? describe : describe.skip)(
  'restaurant two-store isolation, full PostgreSQL schema',
  () => {
    let pool,
      owner,
      hq,
      managerA,
      managerB,
      employeeA,
      businessId,
      restaurantId;
    let locationA,
      locationB,
      orderA,
      orderB,
      itemA,
      itemB,
      deviceA,
      deviceB,
      shiftA,
      shiftB,
      entryB,
      memberA;
    const operationKey = crypto.randomUUID();
    const receiptKey = `store-receipt-${crypto.randomUUID()}`;
    async function call(handler, options = {}) {
      const req = {
        params: {
          restaurantId: String(restaurantId),
          businessId: String(businessId),
          ...options.params,
        },
        body: options.body || {},
        query: options.query || {},
        user: { id: options.user || managerA },
        headers: {},
        businessRole: options.user === owner ? 'owner' : 'manager',
        get: (name) => (name === 'Idempotency-Key' ? options.key : undefined),
        ...options.req,
      };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.data = data;
          return this;
        },
        setHeader() {},
        set() {
          return this;
        },
        send(data) {
          this.data = data;
          return this;
        },
      };
      let error;
      await handler(req, res, (e) => {
        error = e;
      });
      if (error && !error.statusCode) throw error;
      return {
        status: error?.statusCode || res.statusCode,
        data: res.data,
        error,
      };
    }
    function success(result) {
      if (result.error) throw result.error;
      expect(result.status).toBeLessThan(300);
      return result.data;
    }
    function forbidden(result) {
      expect([403, 404, 409]).toContain(result.status);
      expect(result.data).toBeUndefined();
    }
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 8 });
      db.query.mockImplementation((...args) => pool.query(...args));
      db.connect.mockImplementation(() => pool.connect());
      [owner, hq, managerA, managerB, employeeA] = Array.from(
        { length: 5 },
        () => crypto.randomUUID(),
      );
      for (const id of [owner, hq, managerA, managerB, employeeA])
        await pool.query(
          "INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic','Store','Test')",
          [id, `${id}@example.test`],
        );
      ({
        rows: [{ id: businessId }],
      } = await pool.query(
        'INSERT INTO businesses(user_id,business_name) VALUES($1,$2) RETURNING id',
        [owner, `Store isolation ${crypto.randomUUID()}`],
      ));
      ({
        rows: [{ id: restaurantId }],
      } = await pool.query(
        "INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone,status,accepts_in_store_orders) VALUES($1,$2,'Store isolation','America/New_York','active',TRUE) RETURNING id",
        [businessId, owner],
      ));
      ({
        rows: [{ id: locationA }],
      } = await pool.query(
        'SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE',
        [restaurantId],
      ));
      ({
        rows: [{ id: locationB }],
      } = await pool.query(
        "INSERT INTO restaurant_locations(restaurant_id,name,is_primary,status,timezone) VALUES($1,'Sibling Store B',FALSE,'active','America/New_York') RETURNING id",
        [restaurantId],
      ));
      for (const [user, location, role] of [
        [hq, null, 'manager'],
        [managerA, locationA, 'manager'],
        [managerB, locationB, 'manager'],
        [employeeA, locationA, 'employee'],
      ]) {
        const {
          rows: [m],
        } = await pool.query(
          "INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING id",
          [businessId, owner, user, `${user}@example.test`, role],
        );
        if (user === managerA) memberA = m.id;
        if (location)
          await pool.query(
            "INSERT INTO restaurant_location_memberships(restaurant_id,location_id,membership_id,status) VALUES($1,$2,$3,'active')",
            [restaurantId, location, m.id],
          );
        if (role === 'manager')
          await pool.query(
            "INSERT INTO membership_permission_overrides(membership_id,permission_id,effect) SELECT $1,id,'allow' FROM team_permissions WHERE code=ANY($2::text[])",
            [
              m.id,
              [
                'settings.view',
                'settings.manage',
                'pos.use',
                'pos.manage',
                'orders.view',
                'orders.manage',
                'inventory.view',
                'inventory.manage',
                'inventory.update',
                'analytics.view_financial',
                'kitchen.view',
                'kitchen.manage',
                'crew.manage',
                'restaurant.manage',
              ],
            ],
          );
      }
      for (const [location, amount, name, queue] of [
        [locationA, 1000, 'Store A meal', 1],
        [locationB, 9000, 'SECRET Store B meal', 2],
      ]) {
        const {
          rows: [o],
        } = await pool.query(
          "INSERT INTO food_orders(restaurant_id,business_id,location_id,customer_id,order_source,fulfillment_type,status,payment_status,subtotal_cents,total_cents,currency_code,queue_number) VALUES($1,$2,$3,$4,'counter','pickup','received','paid',$5,$5,'USD',$6) RETURNING *",
          [restaurantId, businessId, location, owner, amount, queue],
        );
        await pool.query(
          'INSERT INTO food_order_items(order_id,item_name,quantity,unit_price_cents,line_total_cents) VALUES($1,$2,1,$3,$3)',
          [o.id, name, amount],
        );
        if (location === locationA) orderA = o;
        else orderB = o;
        const {
          rows: [item],
        } = await pool.query(
          'INSERT INTO restaurant_inventory_items(restaurant_id,location_id,name,quantity,low_stock_threshold) VALUES($1,$2,$3,0,5) RETURNING *',
          [restaurantId, location, name],
        );
        if (location === locationA) itemA = item;
        else itemB = item;
        await pool.query(
          "INSERT INTO restaurant_inventory_adjustments(restaurant_id,location_id,item_id,item_name,adjustment_type,quantity_delta,quantity_after) VALUES($1,$2,$3,$4,'waste',-1,0)",
          [restaurantId, location, item.id, name],
        );
        await pool.query(
          "INSERT INTO restaurant_inventory_vendor_price_history(restaurant_id,inventory_item_id,unit_cost_cents,source_type) VALUES($1,$2,$3,'manual')",
          [restaurantId, item.id, amount],
        );
        const {
          rows: [d],
        } = await pool.query(
          "INSERT INTO restaurant_app_devices(restaurant_id,location_id,app_key,device_name,status,device_token_hash) VALUES($1,$2,'kitchen',$3,'paired',$4) RETURNING *",
          [
            restaurantId,
            location,
            name,
            crypto
              .createHash('sha256')
              .update(`synthetic-${location}`)
              .digest('hex'),
          ],
        );
        if (location === locationA) deviceA = d;
        else deviceB = d;
        const {
          rows: [shift],
        } = await pool.query(
          "INSERT INTO business_staff_shifts(business_id,user_id,location_id,shift_date,start_time,end_time) VALUES($1,$2,$3,CURRENT_DATE,'09:00','17:00') RETURNING *",
          [businessId, location === locationA ? employeeA : managerB, location],
        );
        if (location === locationA) shiftA = shift;
        else shiftB = shift;
      }
      ({
        rows: [entryB],
      } = await pool.query(
        'INSERT INTO business_time_entries(business_id,user_id,location_id,entry_date,hours_worked) VALUES($1,$2,$3,CURRENT_DATE,8) RETURNING *',
        [businessId, managerB, locationB],
      ));
      await pool.query(
        "INSERT INTO restaurant_inventory_purchase_requests(restaurant_id,location_id,item_name,client_operation_id) VALUES($1,$2,'SECRET Store B purchase',$3)",
        [restaurantId, locationB, operationKey],
      );
      await pool.query(
        "INSERT INTO restaurant_inventory_supplier_issues(restaurant_id,location_id,supplier_name,issue,client_operation_id) VALUES($1,$2,'SECRET B','SECRET issue',$3)",
        [restaurantId, locationB, operationKey],
      );
      await pool.query(
        "INSERT INTO restaurant_pos_receipt_events(restaurant_id,location_id,food_order_id,queue_number,total_cents,payment_status,channel,idempotency_key) VALUES($1,$2,$3,$4,$5,'paid','print',$6)",
        [
          restaurantId,
          locationB,
          orderB.id,
          orderB.queue_number,
          orderB.total_cents,
          receiptKey,
        ],
      );
    }, 30000);
    beforeEach(() => permissions.invalidateCache());
    afterAll(async () => {
      if (pool) await pool.end();
    }); // disposable database is dropped by the caller
    test('the real membership resolver distinguishes assigned staff from owner/HQ', async () => {
      for (const [user, mode] of [
        [managerA, 'assigned'],
        [owner, 'all'],
        [hq, 'all'],
      ]) {
        const restaurant = await scopeModel.resolveRestaurantAccess(
          user,
          restaurantId,
        );
        const scope = await getLocationScope(restaurant, user);
        expect(scope.mode).toBe(mode);
        if (mode === 'assigned')
          expect(scope.location_ids).toEqual([Number(locationA)]);
      }
    });
    test.each(['list', 'clear', 'replace'])(
      'assigned manager cannot %s store grants or erase their boundary',
      async (method) => {
        forbidden(
          await call(access[method], {
            params: { membershipId: String(memberA) },
            body: { scope: 'all', locationIds: [locationB] },
          }),
        );
        const { rows } = await pool.query(
          "SELECT location_id FROM restaurant_location_memberships WHERE membership_id=$1 AND status='active'",
          [memberA],
        );
        expect(rows.map((r) => r.location_id)).toEqual([locationA]);
      },
    );
    test.each([
      ['owner', () => owner],
      ['HQ', () => hq],
    ])('%s can administer all stores', async (_name, user) => {
      const result = success(await call(access.list, { user: user() }));
      expect(result.locations.map((r) => r.id)).toEqual(
        expect.arrayContaining([locationA, locationB]),
      );
    });
    test.each([
      ['native POS', app.listPosOrders],
      ['merchant feed', food.listRestaurantOrders],
    ])('%s lists only assigned store orders', async (_name, handler) => {
      const result = success(
        await call(handler, { query: { includeMeta: 'true' } }),
      );
      expect(JSON.stringify(result)).toContain(String(orderA.id));
      expect(JSON.stringify(result)).not.toContain('SECRET Store B meal');
      const orders = Array.isArray(result) ? result : result.orders;
      expect(orders.map((r) => r.id)).not.toContain(orderB.id);
    });
    test('staff cannot read sibling order but its customer can', async () => {
      forbidden(
        await call(food.getOrder, { params: { orderId: String(orderB.id) } }),
      );
      success(
        await call(food.getOrder, {
          user: owner,
          params: { orderId: String(orderB.id) },
        }),
      );
    });
    test.each([
      [
        'payment',
        app.recordPosPayment,
        { paymentType: 'cash', amountCents: 9000 },
      ],
      ['refund', app.refundPosOrder, { amountCents: 100 }],
      ['void', app.voidPosOrder, { reason: 'Store test' }],
      ['reprint', app.reprintReceipt, {}],
    ])(
      '%s cannot mutate/read another store order',
      async (_name, handler, body) => {
        forbidden(
          await call(handler, {
            params: { orderId: String(orderB.id) },
            body,
            key: crypto.randomUUID(),
          }),
        );
        const {
          rows: [order],
        } = await pool.query(
          'SELECT status,total_cents,payment_status FROM food_orders WHERE id=$1',
          [orderB.id],
        );
        expect(order).toMatchObject({
          status: 'received',
          total_cents: 9000,
          payment_status: 'paid',
        });
      },
    );
    test('receipt retry cannot return sibling-store event', async () => {
      forbidden(
        await call(pos.createReceiptEvent, {
          key: receiptKey,
          body: {
            orderId: orderA.id,
            queueNumber: orderA.queue_number,
            totalCents: 1000,
            paymentStatus: 'paid',
            channel: 'Printed',
          },
        }),
      );
    });
    test.each([
      [
        'purchase',
        inventory.createPurchaseRequest,
        { itemName: 'Store A purchase', requestedQuantity: 1 },
      ],
      [
        'supplier issue',
        inventory.createSupplierIssue,
        { supplierName: 'A', issue: 'A issue' },
      ],
    ])(
      '%s retry cannot return sibling-store record',
      async (_name, handler, body) => {
        forbidden(
          await call(handler, {
            body: {
              ...body,
              locationId: locationA,
              clientOperationId: operationKey,
            },
          }),
        );
      },
    );
    test.each(['updateItem', 'deleteItem', 'adjustItem'])(
      'inventory %s rejects sibling item',
      async (method) => {
        forbidden(
          await call(inventory[method], {
            params: { itemId: String(itemB.id) },
            body: { name: 'Should not change', type: 'count', quantity: 4 },
          }),
        );
        const {
          rows: [item],
        } = await pool.query(
          'SELECT name,quantity FROM restaurant_inventory_items WHERE id=$1',
          [itemB.id],
        );
        expect(item.name).toContain('SECRET');
        expect(Number(item.quantity)).toBe(0);
      },
    );
    test('vendor price history excludes sibling inventory prices', async () => {
      const data = success(await call(inventoryOps.listVendorPriceHistory));
      expect(JSON.stringify(data)).not.toContain('SECRET');
      expect(JSON.stringify(data)).toContain('Store A meal');
    });
    test('inventory report and all-store totals remain correctly scoped', async () => {
      const own = success(await call(reports.inventorySummary));
      const all = success(await call(reports.inventorySummary, { user: hq }));
      expect(own.low_stock_count).toBe(1);
      expect(all.low_stock_count).toBe(2);
      expect(own.top_waste.map((r) => r.item_name)).toEqual(['Store A meal']);
    });
    test('loyalty cohort and item calculations exclude sibling orders', async () => {
      const own = success(await call(reports.loyaltySummary));
      const all = success(await call(reports.loyaltySummary, { user: owner }));
      expect(own.total_identified_orders).toBe(1);
      expect(all.total_identified_orders).toBe(2);
      expect(own.top_items.map((r) => r.item_name)).toEqual(['Store A meal']);
    });
    test('operations summary executes assigned and all-store predicates on real schema', async () => {
      for (const user of [managerA, hq])
        expect(
          success(await call(reports.operationsSummary, { user })).checklists
            .runs,
        ).toBe(0);
    });
    test('sales export does not include sibling-store amount', async () => {
      const data = success(await call(reports.salesSummary));
      expect(data.totals.orders).toBe(1);
      expect(data.totals.gross_cents).toBe(1000);
      expect(JSON.stringify(data)).not.toContain('9000');
    });
    test.each(['getDeviceConfig', 'updateDeviceConfig', 'rotateDeviceToken'])(
      '%s cannot access sibling device',
      async (method) => {
        forbidden(
          await call(app[method], {
            params: { deviceId: String(deviceB.id) },
            body: { deviceName: 'No change' },
          }),
        );
        const {
          rows: [d],
        } = await pool.query(
          'SELECT device_name FROM restaurant_app_devices WHERE id=$1',
          [deviceB.id],
        );
        expect(d.device_name).toContain('SECRET');
      },
    );
    test('bootstrap hides sibling devices and locations', async () => {
      const data = success(await call(app.getBootstrap));
      expect(JSON.stringify(data)).not.toContain('SECRET Store B');
      expect(JSON.stringify(data)).not.toContain('Sibling Store B');
    });
    test('unified fleet cannot disable sibling device, HQ can', async () => {
      const {
        rows: [d],
      } = await pool.query(
        'SELECT id FROM restaurant_devices WHERE source_app_device_id=$1',
        [deviceB.id],
      );
      forbidden(
        await call(devices.setDeviceStatus, {
          params: { deviceId: String(d.id) },
          body: { status: 'disabled' },
        }),
      );
      success(
        await call(devices.setDeviceStatus, {
          user: hq,
          params: { deviceId: String(d.id) },
          body: { status: 'disabled' },
        }),
      );
      success(
        await call(devices.setDeviceStatus, {
          user: hq,
          params: { deviceId: String(d.id) },
          body: { status: 'active' },
        }),
      );
    });
    test.each([
      ['modern', schedule.listShifts],
      ['legacy', legacySchedule.getWeekSchedule],
    ])('%s schedule hides sibling shifts', async (_name, handler) => {
      const data = success(await call(handler));
      const shifts = Array.isArray(data)
        ? data
        : data.shifts || data.schedule.flatMap((row) => row.shifts);
      expect(shifts.map((r) => r.id)).toContain(shiftA.id);
      expect(shifts.map((r) => r.id)).not.toContain(shiftB.id);
    });
    test.each([
      ['modern', schedule.deleteShift, 'shiftId'],
      ['legacy', legacySchedule.deleteShift, 'id'],
    ])(
      '%s schedule cannot delete sibling shift',
      async (_name, handler, param) => {
        forbidden(
          await call(handler, { params: { [param]: String(shiftB.id) } }),
        );
        expect(
          (
            await pool.query(
              'SELECT id FROM business_staff_shifts WHERE id=$1',
              [shiftB.id],
            )
          ).rowCount,
        ).toBe(1);
      },
    );
    test('manual payroll entry and punch edits cannot access sibling staff', async () => {
      forbidden(
        await call(legacySchedule.logHours, {
          body: { user_id: managerB, hours_worked: 8 },
        }),
      );
      forbidden(
        await call(schedule.editTimeEntry, {
          params: { entryId: String(entryB.id) },
          body: { reason: 'no', hours_worked: 1 },
        }),
      );
    });
    test('omitted clock-in store resolves to assigned store', async () => {
      const data = success(await call(schedule.clockIn));
      expect(Number(data.location_id)).toBe(Number(locationA));
    });
    test('legacy global staff PIN cannot unlock an unassigned store', async () => {
      const bcrypt = require('bcrypt');
      const pin = '429183';
      await pool.query(
        "INSERT INTO restaurant_staff_pins(restaurant_id,staff_user_id,pin_hash,pin_digest,staff_label) VALUES($1,$2,$3,$4,'Store A manager')",
        [
          restaurantId,
          managerA,
          await bcrypt.hash(pin, 4),
          identity.staffPinDigest(restaurantId, pin),
        ],
      );
      await expect(
        identity.validateStaffPinForRestaurant({
          restaurantId,
          pin,
          locationId: locationB,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      const data = await identity.validateStaffPinForRestaurant({
        restaurantId,
        pin,
        locationId: locationA,
      });
      expect(data.pinRow.staff_user_id).toBe(managerA);
    });

    test('status retries cannot disclose a sibling order', async () => {
      const key = crypto.randomUUID();
      await pool.query(
        "INSERT INTO restaurant_kitchen_events(restaurant_id,food_order_id,event_type,idempotency_key) VALUES($1,$2,'order_accepted',$3)",
        [restaurantId, orderB.id, key],
      );
      forbidden(
        await call(food.updateOrderStatus, {
          params: { orderId: String(orderA.id) },
          body: { status: 'accepted' },
          key,
        }),
      );
      forbidden(
        await call(food.updateOrderStatus, {
          params: { orderId: String(orderB.id) },
          body: { status: 'accepted' },
        }),
      );
    });
    test('native receipt reprint retries cannot return sibling receipt', async () => {
      forbidden(
        await call(app.reprintReceipt, {
          params: { orderId: String(orderA.id) },
          key: receiptKey,
        }),
      );
    });
    test('POS checkout retry remains pinned to the requested store', async () => {
      const clientOrderId = crypto.randomUUID();
      await pool.query(
        'UPDATE food_orders SET client_order_id=$2 WHERE id=$1',
        [orderB.id, clientOrderId],
      );
      forbidden(
        await call(app.createPosOrder, {
          body: {
            orderSource: 'kiosk',
            items: [{ menuItemId: 1, quantity: 1 }],
            locationId: locationA,
            clientOrderId,
          },
        }),
      );
    });
    test.each(['cash', 'refund'])(
      'payment %s retry cannot use sibling order',
      async (paymentType) => {
        const key = crypto.randomUUID();
        forbidden(
          await call(app.recordPosPayment, {
            params: { orderId: String(orderB.id) },
            body: { paymentType, amountCents: 10 },
            key,
          }),
        );
      },
    );
    test('staff PIN creation cannot assign sibling staff or location', async () => {
      forbidden(
        await call(app.setStaffPin, {
          body: { staffUserId: managerB, pin: '850302', locationId: locationA },
        }),
      );
      forbidden(
        await call(app.setStaffPin, {
          body: { staffLabel: 'A', pin: '850302', locationId: locationB },
        }),
      );
    });
    test('device pairing and moving a device cannot cross assigned stores', async () => {
      forbidden(
        await call(app.createDevicePairingCode, {
          body: { appKey: 'kitchen', deviceName: 'No', locationId: locationB },
        }),
      );
      forbidden(
        await call(app.updateDeviceConfig, {
          params: { deviceId: String(deviceA.id) },
          body: { locationId: locationB },
        }),
      );
      success(
        await call(app.updateDeviceConfig, {
          params: { deviceId: String(deviceA.id) },
          body: { config: { testFlag: true } },
        }),
      );
      const {
        rows: [d],
      } = await pool.query(
        'SELECT location_id FROM restaurant_app_devices WHERE id=$1',
        [deviceA.id],
      );
      expect(d.location_id).toBe(locationA);
    });
    test('string primary-store flags cannot bypass brand authority', async () => {
      forbidden(
        await call(app.updateRestaurantLocation, {
          params: { locationId: String(locationA) },
          body: { isPrimary: 'true' },
        }),
      );
    });
    test('printer queues and fallback device credentials stay in their store', async () => {
      const {
        rows: [station],
      } = await pool.query(
        "INSERT INTO restaurant_kitchen_stations(restaurant_id,location_id,name,device_id) VALUES($1,$2,'Sibling printer',$3) RETURNING id",
        [restaurantId, locationB, deviceB.id],
      );
      const {
        rows: [job],
      } = await pool.query(
        'INSERT INTO restaurant_printer_jobs(restaurant_id,location_id,station_id,payload) VALUES($1,$2,$3,\'{"marker":"SECRET B print"}\') RETURNING *',
        [restaurantId, locationB, station.id],
      );
      expect(
        JSON.stringify(success(await call(app.listPrinterJobs))),
      ).not.toContain('SECRET B print');
      forbidden(
        await call(app.updatePrinterJob, {
          params: { jobId: String(job.id) },
          body: { status: 'cancelled' },
        }),
      );
      // Owner account plus a valid Store A credential is still Store A hardware.
      forbidden(
        await call(app.claimPrinterJob, {
          user: owner,
          params: { jobId: String(job.id) },
          body: { deviceId: deviceA.id },
          req: {
            get: (name) =>
              name === 'X-Device-Token' ? `synthetic-${locationA}` : undefined,
          },
        }),
      );
      expect(
        (
          await pool.query(
            'SELECT status FROM restaurant_printer_jobs WHERE id=$1',
            [job.id],
          )
        ).rows[0].status,
      ).toBe('queued');
    });
    test('transfer reads and retries cannot reveal sibling stock', async () => {
      const key = crypto.randomUUID();
      const other = success(
        await call(inventoryOps.createTransfer, {
          user: owner,
          body: {
            itemId: itemB.id,
            quantity: 1,
            fromAreaName: 'Receiving',
            toAreaName: 'Shelf',
            clientOperationId: key,
          },
        }),
      );
      expect(
        JSON.stringify(success(await call(inventoryOps.listTransfers))),
      ).not.toContain('SECRET Store B meal');
      forbidden(
        await call(inventoryOps.createTransfer, {
          body: {
            itemId: itemA.id,
            quantity: 1,
            fromAreaName: 'Receiving',
            toAreaName: 'Shelf',
            clientOperationId: key,
          },
        }),
      );
      forbidden(
        await call(inventoryOps.updateTransfer, {
          params: { transferId: String(other.transfer.id) },
          body: { status: 'cancelled' },
        }),
      );
    });
    test('receiving rejects sibling inventory before stock writes', async () => {
      const denied = await call(inventoryOps.createReceipt, {
        body: {
          supplierName: 'A supplier',
          locationId: locationA,
          lines: [{ itemId: itemB.id, quantity: 1 }],
        },
      });
      expect(denied.status).toBe(400);
      expect(denied.error.code).toBe('location_mismatch');
      expect(denied.data).toBeUndefined();
      expect(
        Number(
          (
            await pool.query(
              'SELECT quantity FROM restaurant_inventory_items WHERE id=$1',
              [itemB.id],
            )
          ).rows[0].quantity,
        ),
      ).toBe(0);
    });
    test('operations totals use populated store snapshots', async () => {
      const {
        rows: [checklist],
      } = await pool.query(
        "INSERT INTO restaurant_checklists(restaurant_id,name) VALUES($1,'Store checks') RETURNING id",
        [restaurantId],
      );
      for (const location of [locationA, locationB])
        await pool.query(
          `INSERT INTO restaurant_checklist_runs(checklist_id,restaurant_id,location_id,total_tasks,completed_tasks,started_at) VALUES($1,$2,$3,1,0,NOW()-INTERVAL '1 minute')`,
          [checklist.id, restaurantId, location],
        );
      expect(
        success(await call(reports.operationsSummary)).checklists.runs,
      ).toBe(1);
      expect(
        success(await call(reports.operationsSummary, { user: hq })).checklists
          .runs,
      ).toBe(2);
    });
    test('hub list hides sibling hub identities', async () => {
      success(
        await call(hubs.registerHub, {
          user: owner,
          body: { locationId: locationB, name: 'SECRET B hub' },
        }),
      );
      expect(JSON.stringify(success(await call(hubs.listHubs)))).not.toContain(
        'SECRET B hub',
      );
      expect(
        JSON.stringify(success(await call(hubs.listHubs, { user: hq }))),
      ).toContain('SECRET B hub');
    });
    test.each([
      ['CSV', reports.salesExportCsv],
      ['journal', reports.salesJournalExportCsv],
      ['accounting', reports.salesAccountingExportCsv],
      ['BI', reports.salesBiExportNdjson],
    ])(
      '%s export excludes sibling order identifiers',
      async (_name, handler) => {
        const result = success(
          await call(handler, { params: { provider: 'quickbooks' } }),
        );
        expect(result.trim().split('\n').length).toBeGreaterThan(1);
        expect(result).not.toContain('SECRET Store B');
        expect(result).not.toContain(`,${orderB.id},`);
        expect(result).not.toContain(`"order_id":${orderB.id}`);
      },
    );
    test('labor jurisdiction and staff assignment edits honor store boundaries', async () => {
      forbidden(
        await call(schedule.getLaborJurisdiction, {
          query: { restaurant_id: restaurantId, location_id: locationB },
        }),
      );
      forbidden(
        await call(schedule.setLaborJurisdiction, {
          body: { restaurant_id: restaurantId, location_id: locationB },
        }),
      );
      forbidden(
        await call(schedule.createShift, {
          body: {
            user_id: managerB,
            shift_start: '2026-10-25T09:00',
            shift_end: '2026-10-25T17:00',
            locationId: locationA,
          },
        }),
      );
    });
    test('explicit financial permission denial still defeats manager role', async () => {
      await pool.query(
        "UPDATE membership_permission_overrides SET effect='deny' WHERE membership_id=$1 AND permission_id=(SELECT id FROM team_permissions WHERE code='analytics.view_financial')",
        [memberA],
      );
      permissions.invalidateCache();
      forbidden(await call(reports.salesSummary));
      await pool.query(
        "UPDATE membership_permission_overrides SET effect='allow' WHERE membership_id=$1 AND permission_id=(SELECT id FROM team_permissions WHERE code='analytics.view_financial')",
        [memberA],
      );
    });
    test('hub credentials cannot follow a source device moved to another store', async () => {
      const {
        rows: [registry],
      } = await pool.query(
        'SELECT id FROM restaurant_devices WHERE source_app_device_id=$1',
        [deviceA.id],
      );
      await pool.query(
        "UPDATE restaurant_devices SET device_role='hub' WHERE id=$1",
        [registry.id],
      );
      const data = success(
        await call(hubs.registerHub, {
          user: owner,
          body: {
            locationId: locationA,
            deviceId: registry.id,
            name: 'Store A hub',
          },
        }),
      );
      await pool.query(
        'UPDATE restaurant_app_devices SET location_id=$2 WHERE id=$1',
        [deviceA.id, locationB],
      );
      try {
        forbidden(
          await call(hubs.authenticateHubDevice, {
            user: owner,
            params: { hubId: String(data.hub.id) },
            req: {
              get: (name) =>
                name === 'X-Device-Token'
                  ? `synthetic-${locationA}`
                  : undefined,
            },
          }),
        );
      } finally {
        await pool.query(
          'UPDATE restaurant_app_devices SET location_id=$2 WHERE id=$1',
          [deviceA.id, locationA],
        );
      }
    });
    test('current staff grants are checked again when a legacy PIN is reused', async () => {
      const pin = '429183';
      // The PIN created earlier remains active, but its owner's current stores changed.
      await pool.query(
        "UPDATE restaurant_location_memberships SET location_id=$2 WHERE membership_id=$1 AND status='active'",
        [memberA, locationB],
      );
      try {
        await expect(
          identity.validateStaffPinForRestaurant({
            restaurantId,
            pin,
            locationId: locationA,
          }),
        ).rejects.toMatchObject({ statusCode: 403 });
      } finally {
        await pool.query(
          "UPDATE restaurant_location_memberships SET location_id=$2 WHERE membership_id=$1 AND status='active'",
          [memberA, locationA],
        );
      }
    });
    test('business member roster hides sibling identities and pay rates', async () => {
      const data = success(
        await call(members.listMembers, { params: { id: String(businessId) } }),
      );
      expect(data.members.map((row) => row.user_id)).toContain(employeeA);
      expect(data.members.map((row) => row.user_id)).not.toContain(managerB);
      const all = success(
        await call(members.listMembers, {
          user: hq,
          params: { id: String(businessId) },
        }),
      );
      expect(all.members.map((row) => row.user_id)).toContain(managerB);
    });
    test('assigned manager cannot create business-wide unscoped staff invitations', async () => {
      const denied = await call(members.inviteMember, {
        params: { id: String(businessId) },
        body: { email: 'synthetic-new@example.test', role: 'employee' },
      });
      expect(denied.status).toBe(403);
      expect(denied.data.code).toBe('location_scope_forbidden');
      const {
        rows: [count],
      } = await pool.query(
        "SELECT COUNT(*) FROM business_members WHERE business_id=$1 AND invite_email='synthetic-new@example.test'",
        [businessId],
      );
      expect(Number(count.count)).toBe(0);
    });
    test('concurrent all-store and assigned status retries share one event', async () => {
      const key = crypto.randomUUID();
      const options = {
        params: { orderId: String(orderA.id) },
        body: { status: 'accepted' },
        key,
      };
      const results = await Promise.all([
        call(food.updateOrderStatus, { ...options, user: owner }),
        call(food.updateOrderStatus, options),
      ]);
      for (const result of results)
        expect(success(result).order.id).toBe(orderA.id);
      const {
        rows: [count],
      } = await pool.query(
        'SELECT COUNT(*) FROM restaurant_kitchen_events WHERE restaurant_id=$1 AND idempotency_key=$2',
        [restaurantId, key],
      );
      expect(Number(count.count)).toBe(1);
    });
  },
);
