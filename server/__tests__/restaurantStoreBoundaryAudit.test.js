'use strict';

// F-02 / F-20: store (location) data boundary audit.
// Every server file that reads or writes a per-store table must either use a
// store-scope helper (getLocationScope, assertScopedLocation,
// assertLocationAccess, workforce scope, location_ids filters, ...) or be
// listed below with the reviewed reason it does not need one. A new file that
// touches a per-store table without either fails this test, so new routes
// cannot silently skip the store boundary.
const fs = require('fs');
const path = require('path');

// Tables with both restaurant_id and location_id (verified against the
// migrated schema by the .db companion check below).
const STORE_TABLES = [
  'business_staff_schedule_changes',
  'business_staff_shifts',
  'display_pairings',
  'food_orders',
  'restaurant_app_devices',
  'restaurant_audits',
  'restaurant_checklist_runs',
  'restaurant_crew_shifts',
  'restaurant_crew_task_events',
  'restaurant_crew_tasks',
  'restaurant_daily_counters',
  'restaurant_declared_cash_tips',
  'restaurant_delivery_marketplace_integrations',
  'restaurant_delivery_marketplace_orders',
  'restaurant_devices',
  'restaurant_inventory_adjustments',
  'restaurant_inventory_audit_events',
  'restaurant_inventory_availability_events',
  'restaurant_inventory_items',
  'restaurant_inventory_order_reservations',
  'restaurant_inventory_purchase_requests',
  'restaurant_inventory_receipts',
  'restaurant_inventory_supplier_issues',
  'restaurant_inventory_transfers',
  'restaurant_kitchen_events',
  'restaurant_kitchen_stations',
  'restaurant_labor_jurisdictions',
  'restaurant_location_memberships',
  'restaurant_pos_approvals',
  'restaurant_pos_drawer_events',
  'restaurant_pos_payments',
  'restaurant_pos_pending_operations',
  'restaurant_pos_receipt_events',
  'restaurant_pos_shifts',
  'restaurant_printer_jobs',
  'restaurant_printer_settings',
  'restaurant_reservations',
  'restaurant_runner_settlements',
  'restaurant_runner_tasks',
  'restaurant_schedule_versions',
  'restaurant_screen_events',
  'restaurant_screen_tickets',
  'restaurant_staff_pins',
  'restaurant_store_forward_settings',
  'restaurant_store_menu_overrides',
  'restaurant_tables',
  'restaurant_tax_rules',
  'restaurant_terminal_offline_leases',
  'restaurant_terminal_offline_payments',
  'restaurant_terminal_offline_permits',
  'restaurant_waitlist_entries',
  'store_hub_offline_sales',
  'store_hubs',
];

const SCOPE_RE = /getLocationScope|assertScopedLocation|assertLocationAccess|locationScope|scopeClause|storeBoundary|restaurantStoreBoundary|location_ids|locationIds|resolveLocation|requireLocation|workforce\.(clause|staffClause|context)|scopedLocation|scope_lm|ASSIGNED_LOCATION_SCOPE/;

const CUSTOMER_OR_SELF = 'customer/self scope: rows filtered by the signed-in customer or guest';
const PLATFORM_ADMIN = 'platform admin / support staff route behind admin permissions, not store staff';
const SYSTEM_JOB = 'system job or provider webhook; no staff caller';
const DEVICE_BOUND = 'device-bound: the paired device row carries its own restaurant_id/location_id';
const SCOPED_CALLER = 'helper called only from controllers that already resolved and asserted the store scope';
const BUSINESS_LEVEL = 'business-level owner/manager action across all stores (role-gated)';
const AGGREGATE_ONLY = 'existence/count check only; returns no store data';

const REVIEWED = {
  'controllers/adminFoodOrdersController.js': PLATFORM_ADMIN,
  'controllers/agentFoodRefundActions.js': PLATFORM_ADMIN,
  'controllers/businessController.js': AGGREGATE_ONLY,
  'controllers/foodWalletController.js': CUSTOMER_OR_SELF,
  'controllers/mainAppController.js': CUSTOMER_OR_SELF,
  'controllers/restaurantCreditAdminController.js': PLATFORM_ADMIN,
  'controllers/restaurantMarketplaceWebhookController.js': SYSTEM_JOB,
  'controllers/restaurantMediaController.js': AGGREGATE_ONLY,
  'controllers/supportConversationsController.js': PLATFORM_ADMIN,
  'controllers/webhookController.js': SYSTEM_JOB,
  'routes/privacy.js': CUSTOMER_OR_SELF,
  'routes/statementInvestigation.js': PLATFORM_ADMIN,
  'services/abandonedRecoveryWorker.js': SYSTEM_JOB,
  'services/bookingSlotEngine.js': AGGREGATE_ONLY,
  // Careers facts are computed from one worker's own records (keyed by user_id) across stores.
  'services/careers/profileFacts.js': CUSTOMER_OR_SELF,
  'services/cardStoreForward.js': SCOPED_CALLER,
  'services/chargebackEvidenceService.js': SYSTEM_JOB,
  'services/customer360Sources.js': CUSTOMER_OR_SELF,
  'services/foodAbandonedOrderSweeper.js': SYSTEM_JOB,
  'services/laborJurisdictionRules.js': SCOPED_CALLER,
  'services/profileVisibilityActiveWork.js': CUSTOMER_OR_SELF,
  'services/restaurantDeliveryMarketplaceService.js': SCOPED_CALLER,
  'services/restaurantDeviceCredentials.js': DEVICE_BOUND,
  'services/restaurantInventoryAuditService.js': SCOPED_CALLER,
  'services/restaurantInventoryOrderService.js': SCOPED_CALLER,
  'services/restaurantKitchenFireService.js': SCOPED_CALLER,
  'services/restaurantKitchenPrinterService.js': SCOPED_CALLER,
  'services/restaurantOrderTaxService.js': SCOPED_CALLER,
  'services/restaurantPosPaymentLedgerService.js': SCOPED_CALLER,
  'services/restaurantPrepTimeService.js': SCOPED_CALLER,
  'services/restaurantStoreMenuService.js': SCOPED_CALLER,
  'services/restaurantTerminalOffline.js': DEVICE_BOUND,
  'services/settlementStatementService.js': BUSINESS_LEVEL,
  'services/staffOffboarding.js': BUSINESS_LEVEL,
  'services/storeHubBootstrap.js': DEVICE_BOUND,
  'services/supportAccountSnapshot.js': PLATFORM_ADMIN,
  'services/supportChatActions.js': CUSTOMER_OR_SELF,
  'services/supportChatNudges.js': SYSTEM_JOB,
  'services/unifiedDeviceService.js': DEVICE_BOUND,
};

const ROOT = path.join(__dirname, '..');
function serverFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!['node_modules', '__tests__', 'migrations'].includes(name)) walk(full);
      } else if (name.endsWith('.js')) out.push(full);
    }
  };
  ['controllers', 'routes', 'services'].forEach((d) => walk(path.join(ROOT, d)));
  return out;
}

function unscopedStoreAccess() {
  const result = {};
  for (const file of serverFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    if (SCOPE_RE.test(src)) continue;
    const touched = STORE_TABLES.filter((t) => new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+${t}\\b`, 'i').test(src));
    if (touched.length) result[path.relative(ROOT, file).split(path.sep).join('/')] = touched;
  }
  return result;
}

test('every file touching a per-store table is store-scoped or reviewed', () => {
  const unscoped = unscopedStoreAccess();
  const unreviewed = Object.keys(unscoped).filter((f) => !REVIEWED[f]);
  expect(unreviewed).toEqual([]);
});

test('the reviewed list has no stale entries', () => {
  const unscoped = unscopedStoreAccess();
  const stale = Object.keys(REVIEWED).filter((f) => !unscoped[f]);
  expect(stale).toEqual([]);
});

const targetDb = process.env.STATEMENT_TEST_DATABASE_URL || '';
const usingDisposableDb = /credit_statement_test/.test(targetDb);
(usingDisposableDb ? describe : describe.skip)('schema companion', () => {
  test('STORE_TABLES matches every table with restaurant_id and location_id', async () => {
    jest.unmock('pg');
    const { Client } = jest.requireActual('pg');
    const client = new Client({ connectionString: targetDb });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT a.table_name FROM information_schema.columns a
           JOIN information_schema.columns b
             ON b.table_schema=a.table_schema AND b.table_name=a.table_name AND b.column_name='location_id'
          WHERE a.table_schema='public' AND a.column_name='restaurant_id'
          ORDER BY 1`);
      expect(rows.map((r) => r.table_name)).toEqual([...STORE_TABLES].sort());
    } finally {
      await client.end();
    }
  });
});
