'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));

const appFlow = require('../controllers/restaurantAppFlowController');
const food = require('../controllers/foodController');
const inventory = require('../controllers/restaurantInventoryController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;
const ORDER_ID = 100;

function accessRow(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    status: 'active',
    fulfillment_modes: ['pickup', 'dine_in', 'delivery'],
    accepts_online_orders: true,
    accepts_in_store_orders: true,
    kitchen_display_enabled: true,
    prep_time_min: 12,
    currency_code: 'USD',
    settings: {},
    effective_role: 'owner',
    owner_user_id: USER_ID,
    business_owner_id: USER_ID,
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com', role: 'customer' };
    next();
  });

  app.get('/api/restaurants/:restaurantId/app/bootstrap', appFlow.getBootstrap);
  app.get('/api/restaurants/:restaurantId/manager/dashboard', appFlow.getManagerDashboard);
  app.get('/api/restaurants/:restaurantId/manager/reports', appFlow.getManagerReports);
  app.patch('/api/restaurants/:restaurantId/publishing', appFlow.updatePublishing);
  app.get('/api/restaurants/:restaurantId/kitchen/prep-device-config', appFlow.getPrepDeviceConfig);
  app.patch('/api/restaurants/:restaurantId/kitchen/prep-device-config', appFlow.updatePrepDeviceConfig);
  app.post('/api/restaurants/:restaurantId/devices/pairing-codes', appFlow.createDevicePairingCode);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/runtime-config', appFlow.getDeviceRuntimeConfig);
  app.post('/api/restaurants/:restaurantId/devices/:deviceId/heartbeat', appFlow.deviceHeartbeat);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/kitchen-feed', appFlow.getKitchenFeed);
  app.post('/api/restaurants/:restaurantId/devices/:deviceId/kitchen-feed/ack', appFlow.ackKitchenFeed);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/queue-board', appFlow.getDeviceQueueBoard);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/config', appFlow.getDeviceConfig);
  app.patch('/api/restaurants/:restaurantId/devices/:deviceId', appFlow.updateDeviceConfig);
  app.post('/api/restaurants/:restaurantId/pos/sync/ack', appFlow.ackPendingOperations);
  app.get('/api/restaurants/:restaurantId/pos/sync/status', appFlow.getPosSyncStatus);
  app.get('/api/restaurants/:restaurantId/pos/orders', appFlow.listPosOrders);
  app.get('/api/restaurants/:restaurantId/pos/held-tickets', appFlow.listHeldTickets);
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/create', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/tickets', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/orders/quote', food.quoteOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/hold', appFlow.holdPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/reopen', appFlow.reopenPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/void', appFlow.voidPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/split', appFlow.splitPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/merge', appFlow.mergePosOrders);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payment', appFlow.recordPosPayment);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/refund', appFlow.refundPosOrder);
  app.post('/api/restaurants/:restaurantId/menu-items/:itemId/availability', appFlow.setMenuItemAvailability);
  app.get('/api/restaurants/:restaurantId/pos/shifts/:shiftId/drawer-events', appFlow.listDrawerEvents);
  app.post('/api/restaurants/:restaurantId/pos/shifts/:shiftId/drawer-events', appFlow.recordDrawerEvent);
  app.get('/api/restaurants/:restaurantId/kitchen/feed', appFlow.getKitchenFeed);
  app.post('/api/restaurants/:restaurantId/kitchen/feed/ack', appFlow.ackKitchenFeed);
  app.get('/api/restaurants/:restaurantId/kitchen/audit-events', appFlow.listKitchenAuditEvents);
  app.post('/api/restaurants/:restaurantId/kitchen/orders/:orderId/ack', appFlow.ackKitchenTicket);
  app.post('/api/restaurants/:restaurantId/kitchen/items/:orderItemId/action', appFlow.performKitchenItemAction);
  app.post('/api/restaurants/:restaurantId/kitchen/stations', appFlow.upsertKitchenStation);
  app.post('/api/restaurants/:restaurantId/kitchen/station-routes', appFlow.routeMenuItemToStation);
  app.post('/api/restaurants/:restaurantId/kitchen/printer-jobs', appFlow.createPrinterJob);
  app.post('/api/restaurants/:restaurantId/crew/tasks', appFlow.createCrewTask);
  app.post('/api/restaurants/:restaurantId/crew/tasks/:taskId/review', appFlow.reviewCrewTask);
  app.get('/api/restaurants/:restaurantId/crew/tasks/:taskId/proofs', appFlow.listCrewTaskProofs);
  app.post('/api/restaurants/:restaurantId/crew/tasks/:taskId/proofs', appFlow.addCrewTaskProof);
  app.post('/api/restaurants/:restaurantId/crew/tasks/:taskId/comments', appFlow.addCrewTaskComment);
  app.post('/api/restaurants/:restaurantId/runner/tasks/:taskId/location', appFlow.logRunnerLocation);
  app.post('/api/restaurants/:restaurantId/runner/tasks/:taskId/handoff', appFlow.completeRunnerHandoff);
  app.post('/api/restaurants/:restaurantId/runner/tasks/:taskId/settlements', appFlow.upsertRunnerSettlement);
  app.get('/api/restaurants/:restaurantId/inventory/hooks/status', appFlow.getInventoryHookStatus);
  app.post('/api/restaurants/:restaurantId/inventory/items/:itemId/adjust', inventory.adjustItem);
  app.get('/api/food/customer/favorite-items', food.listCustomerFavoriteItems);
  app.post('/api/food/customer/favorite-items/:restaurantId/:itemId/toggle', food.toggleCustomerFavoriteItem);
  app.use(errorHandler);
  return app;
}

function buildDeviceApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/restaurants/:restaurantId/devices/pair', appFlow.pairDevice);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/runtime-config', appFlow.getDeviceRuntimeConfig);
  app.post('/api/restaurants/:restaurantId/devices/:deviceId/heartbeat', appFlow.deviceHeartbeat);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/kitchen-feed', appFlow.getKitchenFeed);
  app.post('/api/restaurants/:restaurantId/devices/:deviceId/kitchen-feed/ack', appFlow.ackKitchenFeed);
  app.get('/api/restaurants/:restaurantId/devices/:deviceId/queue-board', appFlow.getDeviceQueueBoard);
  app.get('/api/restaurants/:restaurantId/display/queue-board', appFlow.getPublicDisplayQueueBoard);
  app.get('/api/restaurants/:restaurantId/display/devices/:deviceId/stats', appFlow.getDisplayStats);
  app.patch('/api/restaurants/:restaurantId/display/devices/:deviceId/settings', appFlow.updateDeviceDisplaySettings);
  app.post('/api/restaurants/:restaurantId/display/devices/:deviceId/report-issue', appFlow.reportDeviceIssue);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('restaurant app-flow backend', () => {
  test('returns unified app bootstrap context for a staff app', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 9, role: 'manager', status: 'active', permissions_override: { allow: ['inventory.manage'] } }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, app_key: 'pos', device_name: 'Front POS', status: 'paired', location_id: 77, location: { id: 77, name: 'Front Counter' } }] })
      .mockResolvedValueOnce({ rows: [{ id: 77, name: 'Front Counter', is_primary: true }] })
      .mockResolvedValueOnce({ rows: [{ id: BUSINESS_ID, business_name: 'Ox Burger Group' }] })
      .mockResolvedValueOnce({ rows: [accessRow({ tax_rate_bps: 725, service_fee_bps: 0 })] });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/app/bootstrap?app=pos&deviceId=1`);

    expect(res.status).toBe(200);
    expect(res.body.restaurant.id).toBe(RESTAURANT_ID);
    expect(res.body.membership.role).toBe('owner');
    expect(res.body.membership.permissions).toContain('*');
    expect(res.body.business.business_name).toBe('Ox Burger Group');
    expect(res.body.location.name).toBe('Front Counter');
    expect(res.body.device.id).toBe(1);
    expect(res.body.app.settings.taxRateBps).toBe(725);
    expect(res.body.app.enabledModules.pos).toBe(true);
    expect(res.body.devices[0].app_key).toBe('pos');
  });

  test('returns manager dashboard metrics from live order/inventory/support data', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ order_count: 4, sales_cents: 8900, tips_cents: 500 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, queue_number: 8, is_delayed: true, status: 'preparing' }] })
      .mockResolvedValueOnce({ rows: [{ item_name: 'Burger', quantity: 7, revenue_cents: 6300 }] })
      .mockResolvedValueOnce({ rows: [{ total_items: 12, low_stock_items: 2 }] })
      .mockResolvedValueOnce({ rows: [{ open_cases: 3, escalated_cases: 1 }] })
      .mockResolvedValueOnce({ rows: [{ active_members: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          order_count: 18,
          sales_cents: 42100,
          tips_cents: 3200,
          average_ticket_cents: 2338,
          cancelled_orders: 1,
          refunded_orders: 0,
          delivery_orders: 6,
          pickup_orders: 9,
          dine_in_orders: 3,
          in_store_orders: 7,
          online_orders: 11,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          status: 'completed',
          payment_status: 'paid',
          order_source: 'mobile',
          fulfillment_type: 'pickup',
          order_count: 9,
          sales_cents: 21000,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          item_count: 20,
          queued_items: 4,
          preparing_items: 5,
          ready_items: 3,
          bumped_items: 6,
          delayed_items: 2,
          problem_items: 1,
          average_prep_seconds: 640,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          active_tasks: 3,
          completed_today: 8,
          issue_tasks: 1,
          average_delivery_seconds: 1100,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          paired_devices: 4,
          pending_devices: 1,
          stale_devices: 2,
          last_seen_at: '2026-06-21T14:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [accessRow()] });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/manager/dashboard?days=14`);

    expect(res.status).toBe(200);
    expect(res.body.range.days).toBe(14);
    expect(res.body.today.sales_cents).toBe(8900);
    expect(res.body.reporting.orders.sales_cents).toBe(42100);
    expect(res.body.reporting.orderBreakdown[0].order_source).toBe('mobile');
    expect(res.body.reporting.kitchen.average_prep_seconds).toBe(640);
    expect(res.body.reporting.runner.active_tasks).toBe(3);
    expect(res.body.reporting.devices.stale_devices).toBe(2);
    expect(res.body.alerts.delayedOrders).toBe(1);
    expect(res.body.alerts.lowStockItems).toBe(2);
    expect(res.body.alerts.kitchenProblemItems).toBe(1);
    expect(res.body.alerts.runnerIssueTasks).toBe(1);
    expect(res.body.alerts.staleDevices).toBe(2);
    expect(res.body.topItems[0].item_name).toBe('Burger');
  });

  test('returns manager report rollups for dashboards', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-06-30', order_count: 6, sales_cents: 14800 }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', payment_status: 'paid', order_count: 5 }] })
      .mockResolvedValueOnce({ rows: [{ station_label: 'Grill', item_count: 12, average_prep_seconds: 420 }] })
      .mockResolvedValueOnce({ rows: [{ status: 'Completed', task_count: 3, handoffs: 3 }] })
      .mockResolvedValueOnce({ rows: [{ mapped_items: 8, auto_managed_items: 6, blocked_or_low_items: 1 }] })
      .mockResolvedValueOnce({ rows: [{ pending_operations: 1, applied_operations: 9, failed_operations: 0 }] });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/manager/reports?days=30`);

    expect(res.status).toBe(200);
    expect(res.body.salesByDay[0].sales_cents).toBe(14800);
    expect(res.body.kitchenByStation[0].station_label).toBe('Grill');
    expect(res.body.inventoryHooks.auto_managed_items).toBe(6);
    expect(res.body.posSync.pending_operations).toBe(1);
  });

  test('updates full manager publishing controls and primary location', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [accessRow({
          status: 'active',
          accepts_online_orders: false,
          prep_time_min: 18,
          delivery_radius_meters: 6000,
          tax_rate_bps: 725,
          service_fee_bps: 250,
          timezone: 'America/New_York',
          currency_code: 'USD',
        })],
      })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          restaurant_id: RESTAURANT_ID,
          name: 'Columbus Kitchen',
          is_primary: true,
          status: 'active',
        }],
      });

    const res = await request(buildApp())
      .patch(`/api/restaurants/${RESTAURANT_ID}/publishing`)
      .send({
        status: 'active',
        acceptsOnlineOrders: false,
        fulfillmentModes: ['pickup', 'delivery'],
        prepTimeMin: 18,
        deliveryRadiusMeters: 6000,
        taxRateBps: 725,
        serviceFeeBps: 250,
        onlineOrderPauseReason: 'Busy lunch rush',
        timezone: 'America/New_York',
        operatingHours: { weekly: { monday: [{ open: '09:00', close: '17:00' }] } },
        primaryLocation: {
          name: 'Columbus Kitchen',
          addressStreet: '123 Main St',
          addressCity: 'Columbus',
          addressState: 'OH',
          addressZip: '43215',
          latitude: 39.9612,
          longitude: -82.9988,
          status: 'active',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.restaurant.status).toBe('active');
    expect(res.body.primaryLocation.name).toBe('Columbus Kitchen');
    expect(mockQuery.mock.calls.some(([sql]) => /operating_hours/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /restaurant_locations/.test(sql))).toBe(true);
  });

  test('persists kitchen prep settings and device config patches', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [accessRow({
          settings: {
            kitchenPrep: { expoMode: 'balanced' },
            stationPrepTargets: { Grill: 720 },
            deviceDefaults: { sound: true },
          },
        })],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          restaurant_id: RESTAURANT_ID,
          app_key: 'kitchen',
          device_name: 'Expo KDS',
          config: { sound: true },
          config_version: 2,
        }],
      });

    const getRes = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/kitchen/prep-device-config`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.prep.stationTargets.Grill).toBe(720);
    expect(getRes.body.devices[0].deviceName).toBe('Expo KDS');

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: RESTAURANT_ID,
          prep_time_min: 20,
          kitchen_display_enabled: true,
          settings: {
            kitchenPrep: { expoMode: 'rush' },
            stationPrepTargets: { Fry: 300 },
            deviceDefaults: { sound: false },
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          restaurant_id: RESTAURANT_ID,
          app_key: 'kitchen',
          device_name: 'Expo KDS',
          location_id: 77,
          config: { sound: false },
          config_version: 3,
        }],
      });

    const patchRes = await request(buildApp())
      .patch(`/api/restaurants/${RESTAURANT_ID}/kitchen/prep-device-config`)
      .send({
        prepTimeMin: 20,
        kitchenPrep: { expoMode: 'rush' },
        stationTargets: { Fry: 300 },
        deviceDefaults: { sound: false },
        devices: [{ deviceId: 901, locationId: 77, config: { sound: false } }],
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.prep.prepTimeMin).toBe(20);
    expect(patchRes.body.devices[0].configVersion).toBe(3);
    expect(mockQuery.mock.calls.some(([sql]) => /settings \\|\\|/.test(sql))).toBe(true);
  });

  test('creates display pairing code and remotely updates device config', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 801,
          app_key: 'display',
          device_name: 'Front Kiosk',
          mode: 'kiosk',
          location_id: 77,
          status: 'pending',
        }],
      });

    const pairCodeRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/devices/pairing-codes`)
      .send({
        appKey: 'display',
        deviceName: 'Front Kiosk',
        mode: 'kiosk',
        locationId: 77,
        config: { idleTimeoutSeconds: 90 },
      });

    expect(pairCodeRes.status).toBe(201);
    expect(pairCodeRes.body.device.location_id).toBe(77);
    expect(pairCodeRes.body.pairingCode).toBeTruthy();

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 801,
          app_key: 'display',
          mode: 'queue_board',
          location_id: 77,
          status: 'paired',
          config: { idleTimeoutSeconds: 120 },
        }],
      });

    const updateRes = await request(buildApp())
      .patch(`/api/restaurants/${RESTAURANT_ID}/devices/801`)
      .send({
        mode: 'queue_board',
        locationId: 77,
        status: 'paired',
        config: { idleTimeoutSeconds: 120 },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.device.mode).toBe('queue_board');
    expect(mockQuery.mock.calls.some(([sql]) => /config \\|\\|/.test(sql))).toBe(true);

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 801,
          app_key: 'display',
          mode: 'queue_board',
          restaurant: { id: RESTAURANT_ID, display_name: 'Ox Burger Lab' },
          location: { id: 77, name: 'Front Counter' },
        }],
      });

    const configRes = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/devices/801/config`);

    expect(configRes.status).toBe(200);
    expect(configRes.body.device.location.id).toBe(77);
    expect(configRes.body.contract.routes.runtimeConfig).toBe('/api/restaurants/3/devices/801/runtime-config');
    expect(configRes.body.contract.routes.queueBoard).toBe('/api/restaurants/3/devices/801/queue-board');
  });

  test('paired display devices poll heartbeat and queue-board without staff auth', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 801, restaurant_id: RESTAURANT_ID, app_key: 'display', status: 'paired' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 801,
          restaurant_id: RESTAURANT_ID,
          app_key: 'display',
          device_name: 'Lobby board',
          location_id: 77,
          status: 'paired',
          config_version: 3,
        }],
      });

    const heartbeatRes = await request(buildDeviceApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/devices/801/heartbeat`)
      .set('X-Device-Token', 'display-token')
      .send({ configVersion: 2, telemetry: { battery: 'ac' } });

    expect(heartbeatRes.status).toBe(200);
    expect(heartbeatRes.body.configChanged).toBe(true);
    expect(heartbeatRes.body.contract.routes.queueBoard).toBe('/api/restaurants/3/devices/801/queue-board');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 801, restaurant_id: RESTAURANT_ID, app_key: 'display', status: 'paired' }] })
      .mockResolvedValueOnce({ rows: [{ id: RESTAURANT_ID, display_name: 'Ox Burger Lab', logo_url: null, timezone: 'America/New_York' }] })
      .mockResolvedValueOnce({
        rows: [
          { queue_number: 12, status: 'preparing', table_label: 'A1', fulfillment_type: 'dine_in' },
          { queue_number: 13, status: 'ready', table_label: null, fulfillment_type: 'pickup' },
        ],
      });

    const boardRes = await request(buildDeviceApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/devices/801/queue-board`)
      .set('X-Device-Token', 'display-token');

    expect(boardRes.status).toBe(200);
    expect(boardRes.body.preparing).toEqual([12]);
    expect(boardRes.body.ready).toEqual([13]);
    expect(boardRes.body.readyEntries[0].guestLabel).toBe('Pickup');
    expect(boardRes.body.contract.routes.publicQueueBoard).toBe('/api/food/restaurants/3/queue-board');
  });

  test('paired kitchen devices poll and ack feed without staff auth', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 901, restaurant_id: RESTAURANT_ID, app_key: 'kitchen', status: 'paired' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          restaurant_id: RESTAURANT_ID,
          app_key: 'kitchen',
          device_name: 'Expo KDS',
          location_id: 77,
          status: 'paired',
          last_kitchen_event_id: 990,
          config_version: 1,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: ORDER_ID,
          queue_number: 12,
          status: 'preparing',
          items: [{ id: 201, itemName: 'Burger', kitchenStatus: 'queued' }],
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 991, event_type: 'item_ready' }] });

    const feedRes = await request(buildDeviceApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/devices/901/kitchen-feed`)
      .set('X-Device-Token', 'kitchen-token');

    expect(feedRes.status).toBe(200);
    expect(feedRes.body.cursor).toBe(991);
    expect(feedRes.body.contract.routes.kitchenFeedAck).toBe('/api/restaurants/3/devices/901/kitchen-feed/ack');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 901, restaurant_id: RESTAURANT_ID, app_key: 'kitchen', status: 'paired' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          restaurant_id: RESTAURANT_ID,
          app_key: 'kitchen',
          device_name: 'Expo KDS',
          status: 'paired',
          last_kitchen_event_id: 991,
          sync_status: 'healthy',
        }],
      });

    const ackRes = await request(buildDeviceApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/devices/901/kitchen-feed/ack`)
      .set('X-Device-Token', 'kitchen-token')
      .send({ cursor: 991 });

    expect(ackRes.status).toBe(200);
    expect(ackRes.body.lastKitchenEventId).toBe(991);
    expect(ackRes.body.contract.routes.kitchenFeed).toBe('/api/restaurants/3/devices/901/kitchen-feed');
  });

  test('display compatibility routes accept device-token aliases and persist settings', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 801, restaurant_id: RESTAURANT_ID, app_key: 'display', status: 'paired', config: {} }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 801,
          restaurant_id: RESTAURANT_ID,
          app_key: 'display',
          status: 'paired',
          config_version: 4,
          config: { displaySettings: { boardTitle: 'Pickup board', showGuestNames: false, pageSize: 10 } },
        }],
      });

    const settingsRes = await request(buildDeviceApp())
      .patch(`/api/restaurants/${RESTAURANT_ID}/display/devices/801/settings`)
      .set('Authorization', 'Device display-token')
      .send({ boardTitle: 'Pickup board', showGuestNames: false, pageSize: 10 });

    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.settings.boardTitle).toBe('Pickup board');
    expect(settingsRes.body.contract.routes.compat.settings).toBe('/api/restaurants/3/display/devices/801/settings');
    expect(mockQuery.mock.calls.some(([sql]) => /displaySettings/.test(sql) && /config_version = config_version \+ 1/.test(sql))).toBe(true);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 801, restaurant_id: RESTAURANT_ID, app_key: 'display', status: 'paired' }] })
      .mockResolvedValueOnce({ rows: [{ id: RESTAURANT_ID, display_name: 'Ox Burger Lab', timezone: 'America/New_York' }] })
      .mockResolvedValueOnce({ rows: [{ active_orders: 4, preparing_orders: 2, ready_orders: 1, completed_orders: 8, kiosk_orders: 3 }] })
      .mockResolvedValueOnce({ rows: [{ paired_displays: 2, stale_displays: 1, last_display_seen_at: '2026-06-21T15:00:00.000Z' }] });

    const statsRes = await request(buildDeviceApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/display/devices/801/stats`)
      .set('X-OxSteed-Device-Token', 'display-token');

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.activeOrders).toBe(4);
    expect(statsRes.body.stats.staleDisplays).toBe(1);
  });

  test('quotes kiosk totals with server tax and direct-payment compatibility', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [accessRow({
          tax_rate_bps: 725,
          service_fee_bps: 100,
          fulfillment_modes: ['pickup', 'dine_in', 'delivery'],
        })],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, name: 'Classic Burger', price_cents: 1000, currency_code: 'USD', is_available: true }],
      });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/orders/quote`)
      .send({
        orderSource: 'kiosk',
        fulfillmentType: 'pickup',
        paymentMode: 'direct_payment',
        tipCents: 100,
        items: [{ menuItemId: 11, quantity: 2 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.quote.subtotalCents).toBe(2000);
    expect(res.body.quote.taxCents).toBe(145);
    expect(res.body.quote.serviceFeeCents).toBe(20);
    expect(res.body.quote.totalCents).toBe(2265);
    expect(res.body.quote.paymentMode).toBe('direct_payment');
    expect(res.body.supportedPaymentModes).toContain('pay_at_counter');
    expect(res.body.supportedPaymentModes).toContain('restaurant_credit');
  });

  test('creates POS orders in the same food_orders flow', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 55, restaurant_id: RESTAURANT_ID, status: 'open', staff_user_id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 11, name: 'Classic Burger', price_cents: 899, currency_code: 'USD', is_available: true }] })
      .mockResolvedValueOnce({ rows: [{ next_queue: 12 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: ORDER_ID,
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          queue_number: 12,
          order_source: 'counter',
          payment_status: 'unpaid',
          total_cents: 899,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 201 }] })
      .mockResolvedValueOnce({ rows: [{ id: 301 }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId: 55,
        items: [{ menuItemId: 11, quantity: 1, stationLabel: 'Grill' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.queue_number).toBe(12);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_orders/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_order_items/.test(sql))).toBe(true);
  });

  test('creates POS tickets through alias route with modifiers and discount lines', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 55, restaurant_id: RESTAURANT_ID, status: 'open', staff_user_id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 11, name: 'Classic Burger', price_cents: 1000, currency_code: 'USD', is_available: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 91, name: 'Extra Cheese', price_delta_cents: 200, is_available: true }] })
      .mockResolvedValueOnce({ rows: [{ next_queue: 14 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: ORDER_ID,
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          queue_number: 14,
          order_source: 'counter',
          payment_status: 'unpaid',
          subtotal_cents: 1200,
          discount_cents: 120,
          total_cents: 1080,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 202 }] })
      .mockResolvedValueOnce({ rows: [{ id: 302 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/tickets`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId: 55,
        items: [{ menuItemId: 11, quantity: 1, modifierIds: [91], stationLabel: 'Grill' }],
        discountLines: [{ code: 'STAFF10', label: 'Staff 10%', percentBps: 1000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.total_cents).toBe(1080);
    expect(mockQuery.mock.calls.some(([sql]) => /food_order_item_modifiers/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([, params]) => JSON.stringify(params).includes('posDiscounts'))).toBe(true);
    expect(mockQuery.mock.calls.some(([, params]) => JSON.stringify(params).includes('Extra Cheese'))).toBe(true);
  });

  test('lists held tickets through the dedicated POS contract', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: ORDER_ID,
          queue_number: 9,
          pos_ticket_state: 'held',
          payment_status: 'unpaid',
          items: [],
        }],
      });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/pos/held-tickets`);

    expect(res.status).toBe(200);
    expect(res.body.orders[0].pos_ticket_state).toBe('held');
    expect(mockQuery.mock.calls[1][1]).toContain('held');
  });

  test('records POS payment and updates food order payment status', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, restaurant_id: RESTAURANT_ID, total_cents: 899, payment_status: 'unpaid' }] })
      .mockResolvedValueOnce({ rows: [{ paid_cents: 0, refunded_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 501, amount_cents: 899, payment_type: 'cash' }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, total_cents: 899, payment_status: 'unpaid', pos_ticket_state: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ paid_cents: 899, refunded_cents: 0, pending_payments: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, payment_status: 'paid', pos_ticket_state: 'closed' }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/payments`)
      .send({ paymentType: 'cash', amountCents: 899, status: 'captured' });

    expect(res.status).toBe(201);
    expect(res.body.payment.payment_type).toBe('cash');
    expect(res.body.order.payment_status).toBe('paid');
  });

  test('records direct-payment alias and manual refund through ledger-backed POS endpoints', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, restaurant_id: RESTAURANT_ID, total_cents: 1200, payment_status: 'unpaid', pos_ticket_state: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ paid_cents: 0, refunded_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 601, amount_cents: 1200, payment_type: 'external' }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, total_cents: 1200, payment_status: 'unpaid', pos_ticket_state: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ paid_cents: 1200, refunded_cents: 0, pending_payments: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, payment_status: 'paid', pos_ticket_state: 'closed' }] });

    const paymentRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/payment`)
      .send({ paymentType: 'direct_payment', amountCents: 1200 });

    expect(paymentRes.status).toBe(201);
    expect(paymentRes.body.payment.payment_type).toBe('external');

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, restaurant_id: RESTAURANT_ID, total_cents: 1200, payment_status: 'paid', pos_ticket_state: 'closed' }] })
      .mockResolvedValueOnce({ rows: [{ paid_cents: 1200, refunded_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 602, amount_cents: 300, payment_type: 'refund' }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, total_cents: 1200, payment_status: 'paid', pos_ticket_state: 'closed' }] })
      .mockResolvedValueOnce({ rows: [{ paid_cents: 1200, refunded_cents: 300, pending_payments: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, payment_status: 'unpaid', pos_ticket_state: 'open' }] });

    const refundRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/refund`)
      .send({ amountCents: 300, reason: 'Guest adjustment' });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.payment.payment_type).toBe('refund');
    expect(mockQuery.mock.calls.some(([, params]) => JSON.stringify(params).includes('payment_refunded'))).toBe(true);
  });

  test('voids unpaid POS tickets through compatibility route', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ net_paid_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, pos_ticket_state: 'voided', status: 'cancelled', payment_status: 'unpaid' }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/void`)
      .send({ reason: 'Mistaken ticket' });

    expect(res.status).toBe(200);
    expect(res.body.order.pos_ticket_state).toBe('voided');
    expect(mockQuery.mock.calls.some(([, params]) => JSON.stringify(params).includes('ticket_voided'))).toBe(true);
  });

  test('toggles menu availability for sold-out POS flows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 11, is_available: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, name: 'Classic Burger', is_available: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 700, menu_item_id: 11, next_available: false }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/menu-items/11/availability`)
      .send({ isAvailable: false, reason: 'Sold out' });

    expect(res.status).toBe(200);
    expect(res.body.item.is_available).toBe(false);
    expect(res.body.event.next_available).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_menu_items/.test(sql))).toBe(true);
  });

  test('acknowledges pending local POS operations idempotently', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 1, client_operation_id: 'local-1', status: 'applied' }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, client_operation_id: 'local-2', status: 'acked' }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/sync/ack`)
      .send({
        deviceId: 801,
        operations: [
          { operationId: 'local-1', type: 'order_create', entityType: 'food_order', entityId: String(ORDER_ID), status: 'applied' },
          { operationId: 'local-2', type: 'drawer_event', status: 'acked', payload: { amountCents: 500 } },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(mockQuery.mock.calls.some(([sql]) => /restaurant_pos_pending_operations/.test(sql))).toBe(true);
  });

  test('reports POS sync health for device replacement UI', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 801,
          restaurant_id: RESTAURANT_ID,
          app_key: 'pos',
          device_name: 'Front POS',
          status: 'paired',
          sync_status: 'healthy',
          pending_operations: 1,
          failed_operations: 0,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ pending_operations: 1, applied_operations: 4, failed_operations: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, client_operation_id: 'local-1', status: 'acked' }] });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/pos/sync/status`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.devices[0].deviceName).toBe('Front POS');
    expect(res.body.operations.pending_operations).toBe(1);
    expect(res.body.recentOperations[0].client_operation_id).toBe('local-1');
  });

  test('records POS drawer events for shift reconciliation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 700,
          restaurant_id: RESTAURANT_ID,
          shift_id: 55,
          event_type: 'cash_drop',
          amount_cents: 5000,
          reason: 'Mid-shift safe drop',
        }],
      });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/shifts/55/drawer-events`)
      .send({
        eventType: 'cash_drop',
        amountCents: 5000,
        reason: 'Mid-shift safe drop',
      });

    expect(res.status).toBe(201);
    expect(res.body.event.event_type).toBe('cash_drop');
    expect(res.body.event.amount_cents).toBe(5000);
  });

  test('splits and merges POS tickets while preserving food order items', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, restaurant_id: RESTAURANT_ID, business_id: BUSINESS_ID, status: 'received', payment_status: 'unpaid', order_source: 'counter', fulfillment_type: 'pickup', currency_code: 'USD', metadata: {} }] })
      .mockResolvedValueOnce({ rows: [{ payment_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 201, line_total_cents: 500, order_item_count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ next_queue: 13 }] })
      .mockResolvedValueOnce({ rows: [{ id: 101, queue_number: 13 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ subtotal_cents: 399 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, subtotal_cents: 399, total_cents: 399 }] })
      .mockResolvedValueOnce({ rows: [{ subtotal_cents: 500 }] })
      .mockResolvedValueOnce({ rows: [{ id: 101, subtotal_cents: 500, total_cents: 500 }] });

    const splitRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/split`)
      .send({ orderItemIds: [201] });

    expect(splitRes.status).toBe(201);
    expect(splitRes.body.splitOrder.id).toBe(101);
    expect(mockQuery.mock.calls.some(([sql]) => /pos_parent_order_id/.test(sql))).toBe(true);

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [
        { id: ORDER_ID, status: 'received', payment_status: 'unpaid', pos_ticket_state: 'open', currency_code: 'USD', fulfillment_type: 'pickup', tax_rate_bps: 0, service_fee_bps: 0 },
        { id: 101, status: 'received', payment_status: 'unpaid', pos_ticket_state: 'open', currency_code: 'USD', fulfillment_type: 'pickup', tax_rate_bps: 0, service_fee_bps: 0 },
      ] })
      .mockResolvedValueOnce({ rows: [{ payment_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ subtotal_cents: 899 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, total_cents: 899 }] })
      .mockResolvedValueOnce({ rows: [{ subtotal_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 101, total_cents: 0 }] });

    const mergeRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/merge`)
      .send({ sourceOrderId: 101 });

    expect(mergeRes.status).toBe(200);
    expect(mockQuery.mock.calls.some(([, params]) => JSON.stringify(params).includes('mergedIntoOrderId'))).toBe(true);
  });

  test('returns kitchen feed with item-level station state', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: ORDER_ID,
          queue_number: 12,
          status: 'preparing',
          items: [{
            id: 201,
            itemName: 'Burger',
            kitchenStatus: 'preparing',
            stationLabel: 'Grill',
            targetPrepSeconds: 720,
          }],
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 991, event_type: 'item_ready' }] });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/kitchen/feed?station=Grill&cursor=990`);

    expect(res.status).toBe(200);
    expect(res.body.orders[0].items[0].stationLabel).toBe('Grill');
    expect(res.body.cursor).toBe(991);
    expect(res.body.events[0].event_type).toBe('item_ready');
    expect(mockQuery.mock.calls[1][0]).toMatch(/foi.station_label/);
  });

  test('acknowledges kitchen tickets and records audit history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow({ prep_time_min: 16 })] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, status: 'received', queue_number: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, status: 'preparing', queue_number: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: 993, event_type: 'ticket_ack', from_status: 'received', to_status: 'preparing' }] });

    const ackRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/kitchen/orders/${ORDER_ID}/ack`)
      .send({ startPreparing: true, stationLabel: 'Expo', prepTimeMin: 16 });

    expect(ackRes.status).toBe(201);
    expect(ackRes.body.order.status).toBe('preparing');
    expect(ackRes.body.event.event_type).toBe('ticket_ack');
    expect(mockQuery.mock.calls.some(([sql]) => /promised_at/.test(sql))).toBe(true);

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 993,
          event_type: 'ticket_ack',
          queue_number: 12,
          actor_first_name: 'Owner',
        }],
      });

    const auditRes = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/kitchen/audit-events?cursor=990`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.cursor).toBe(993);
    expect(auditRes.body.events[0].event_type).toBe('ticket_ack');
  });

  test('performs kitchen item action with delay reason and prep timer metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 201,
          order_id: ORDER_ID,
          kitchen_status: 'preparing',
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          order_status: 'preparing',
          queue_number: 12,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 201,
          order_id: ORDER_ID,
          kitchen_status: 'delayed',
          delay_reason: 'Equipment failure',
          target_prep_seconds: 900,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ total_items: 2, ready_items: 0, cancelled_items: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, status: 'preparing' }] })
      .mockResolvedValueOnce({ rows: [{ id: 992, event_type: 'item_delay', to_status: 'delayed' }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/kitchen/items/201/action`)
      .send({ action: 'delay', reason: 'Equipment failure', targetPrepSeconds: 900 });

    expect(res.status).toBe(201);
    expect(res.body.item.kitchen_status).toBe('delayed');
    expect(res.body.event.event_type).toBe('item_delay');
    expect(mockQuery.mock.calls.some(([sql]) => /delay_reason/.test(sql))).toBe(true);
  });

  test('configures kitchen station routing and printer jobs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 31, name: 'Grill', is_active: true }] });

    const stationRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/kitchen/stations`)
      .send({ name: 'Grill', printerConfig: { printer: 'expo-1' } });

    expect(stationRes.status).toBe(201);
    expect(stationRes.body.station.name).toBe('Grill');

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 41, menu_item_id: 11, station_id: 31 }] });

    const routeRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/kitchen/station-routes`)
      .send({ menuItemId: 11, stationId: 31 });

    expect(routeRes.status).toBe(200);
    expect(routeRes.body.route.station_id).toBe(31);

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 31 }] })
      .mockResolvedValueOnce({ rows: [{ id: ORDER_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 51, status: 'queued', job_type: 'kitchen_ticket' }] });

    const printRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/kitchen/printer-jobs`)
      .send({ stationId: 31, orderId: ORDER_ID, jobType: 'kitchen_ticket', payload: { queue: 12 } });

    expect(printRes.status).toBe(201);
    expect(printRes.body.job.status).toBe('queued');
  });

  test('creates crew task and comment history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 701, title: 'Restock pickup shelf', status: 'not_started' }] });

    const createRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/crew/tasks`)
      .send({ title: 'Restock pickup shelf', requiresApproval: true });

    expect(createRes.status).toBe(201);
    expect(createRes.body.task.id).toBe(701);

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 701 }] })
      .mockResolvedValueOnce({ rows: [{ id: 801, task_id: 701, comment: 'Done, needs review.' }] });

    const commentRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/crew/tasks/701/comments`)
      .send({ comment: 'Done, needs review.' });

    expect(commentRes.status).toBe(201);
    expect(commentRes.body.comment.comment).toBe('Done, needs review.');
  });

  test('submits crew task proof and records manager approval history', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 701, status: 'in_progress', requires_approval: true, assigned_to: USER_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 901, task_id: 701, proof_type: 'photo', file_url: 'https://cdn.example/proof.jpg' }] })
      .mockResolvedValueOnce({ rows: [{ id: 701, status: 'needs_approval', proof_url: 'https://cdn.example/proof.jpg' }] })
      .mockResolvedValueOnce({ rows: [] });

    const proofRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/crew/tasks/701/proofs`)
      .send({ fileUrl: 'https://cdn.example/proof.jpg', proofType: 'photo', note: 'Shelf restocked.' });

    expect(proofRes.status).toBe(201);
    expect(proofRes.body.proof.file_url).toBe('https://cdn.example/proof.jpg');
    expect(proofRes.body.task.status).toBe('needs_approval');
    expect(mockQuery.mock.calls.some(([sql]) => /restaurant_crew_task_proofs/.test(sql))).toBe(true);

    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 701, status: 'needs_approval' }] })
      .mockResolvedValueOnce({ rows: [{ id: 701, status: 'completed', approved_by: USER_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const reviewRes = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/crew/tasks/701/review`)
      .send({ approved: true, note: 'Looks good.' });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.task.status).toBe('completed');
    expect(mockQuery.mock.calls.some(([, params]) => JSON.stringify(params).includes('approved'))).toBe(true);
  });

  test('logs runner GPS ping and updates task location snapshot', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 901 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1001, latitude: 39.96, longitude: -82.99, captured_at: '2026-06-21T04:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 901 }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/runner/tasks/901/location`)
      .send({ latitude: 39.96, longitude: -82.99, accuracyMeters: 12 });

    expect(res.status).toBe(201);
    expect(res.body.ping.latitude).toBe(39.96);
    expect(mockQuery.mock.calls.some(([sql]) => /restaurant_runner_location_pings/.test(sql))).toBe(true);
  });

  test('records runner customer handoff before settlement', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          assigned_to: USER_ID,
          status: 'En route',
          restaurant_id: RESTAURANT_ID,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          assigned_to: USER_ID,
          status: 'Completed',
          handoff_at: '2026-06-30T16:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 1002, task_id: 901, method: 'Signature', note: 'Met customer.' }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/runner/tasks/901/handoff`)
      .send({ method: 'Signature', note: 'Met customer.' });

    expect(res.status).toBe(201);
    expect(res.body.task.status).toBe('Completed');
    expect(res.body.proof.method).toBe('Signature');
    expect(mockQuery.mock.calls.some(([sql]) => /handoff_at/.test(sql))).toBe(true);
  });

  test('creates runner settlement for delivery fee and tip reconciliation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 901, food_order_id: ORDER_ID, assigned_to: USER_ID, task_status: 'Completed', handoff_at: '2026-06-21T04:10:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1100, status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1101, task_id: 901, delivery_fee_cents: 300, tip_cents: 200, status: 'approved' }] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/runner/tasks/901/settlements`)
      .send({ deliveryFeeCents: 300, tipCents: 200, status: 'approved' });

    expect(res.status).toBe(201);
    expect(res.body.settlement.status).toBe('approved');
    expect(res.body.settlement.tip_cents).toBe(200);
  });

  test('reports inventory hook status for menu availability automation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({
        rows: [{
          mapped_items: 4,
          auto_managed_items: 3,
          unavailable_menu_items: 1,
          blocked_or_low_inventory_items: 1,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          menu_item_id: 11,
          menu_item_name: 'Chicken Bowl',
          inventory_item_name: 'Chicken',
          quantity: '0',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 700, menu_item_id: 11, next_available: false }] });

    const res = await request(buildApp())
      .get(`/api/restaurants/${RESTAURANT_ID}/inventory/hooks/status`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('attention_required');
    expect(res.body.summary.mapped_items).toBe(4);
    expect(res.body.affectedMenuItems[0].menu_item_name).toBe('Chicken Bowl');
    expect(res.body.recentEvents[0].next_available).toBe(false);
  });

  test('inventory adjustment automatically syncs mapped menu availability', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 77, restaurant_id: RESTAURANT_ID, name: 'Chicken', quantity: '2', low_stock_threshold: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77, restaurant_id: RESTAURANT_ID, quantity: '0', low_stock_threshold: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 901 }] })
      .mockResolvedValueOnce({
        rows: [{
          menu_item_id: 11,
          menu_item_name: 'Chicken Bowl',
          current_available: true,
          blocked_by_stock: true,
          blocking_items: ['Chicken'],
          blocking_inventory_item_id: 77,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/restaurants/${RESTAURANT_ID}/inventory/items/77/adjust`)
      .send({ type: 'count', quantity: 0 });

    expect(res.status).toBe(200);
    expect(res.body.availability.changes).toHaveLength(1);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_menu_items/.test(sql))).toBe(true);
  });

  test('syncs saved menu item favorites for the customer app', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        menu_item_id: 11,
        restaurant_id: RESTAURANT_ID,
        item_name: 'Classic Burger',
        restaurant_name: 'Ox Burger Lab',
        price_cents: 899,
        currency_code: 'USD',
        is_available: true,
      }],
    });

    const listRes = await request(buildApp())
      .get('/api/food/customer/favorite-items');

    expect(listRes.status).toBe(200);
    expect(listRes.body.favoriteItems[0].menuItemId).toBe(11);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 11, restaurant_id: RESTAURANT_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ menu_item_id: 11 }] });

    const toggleRes = await request(buildApp())
      .post(`/api/food/customer/favorite-items/${RESTAURANT_ID}/11/toggle`);

    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.favorited).toBe(true);
    expect(toggleRes.body.favoriteItemIds).toEqual([11]);
  });
});
