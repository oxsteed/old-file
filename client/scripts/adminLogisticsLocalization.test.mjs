import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const locales = ['en', 'es', 'fr', 'ht', 'ar'];
const required = [
  'loading', 'unknownStatus',
  'links.sourcingOps', 'links.organizerApprovals', 'links.lanes', 'links.suppliers',
  'links.quotes', 'links.campaigns', 'links.purchaseOrders', 'links.shipmentOps',
  'links.shipments', 'links.complianceReview', 'links.customs', 'links.warehouseOps',
  'links.warehouses', 'links.allocations', 'links.pricing', 'links.restrictions',
  'links.disputes', 'links.superControl',
  'metrics.purchaseOrders', 'metrics.shipments', 'metrics.pooledCampaigns',
  'metrics.sourcingRequests', 'metrics.claims',
  'warehouseTable.title', 'warehouseTable.warehouse', 'warehouseTable.activeReceipts',
  'warehouseTable.totalUnits',
  'shipmentOps.title', 'shipmentOps.subtitle', 'shipmentOps.activeShipments',
  'shipmentOps.customsQueue', 'shipmentOps.exceptions', 'shipmentOps.reference',
  'shipmentOps.route', 'shipmentOps.freight', 'shipmentOps.status', 'shipmentOps.eta',
  'shipmentOps.empty',
  'quotes.title', 'quotes.subtitle', 'quotes.allStatuses', 'quotes.reference',
  'quotes.sourcingRequest', 'quotes.supplier', 'quotes.unitPrice', 'quotes.moq',
  'quotes.leadDays', 'quotes.status', 'quotes.submitted', 'quotes.review',
  'quotes.empty', 'quotes.reviewTitle', 'quotes.decision', 'quotes.adminNotes',
  'quotes.submitDecision', 'quotes.cancel', 'quotes.selectDecisionError',
  'quotes.reviewAccepted', 'quotes.reviewRejected', 'quotes.reviewFailed',
  'shipments.title', 'shipments.subtitle', 'shipments.allStatuses',
  'shipments.reference', 'shipments.route', 'shipments.carrier', 'shipments.tracking',
  'shipments.weightCbm', 'shipments.eta', 'shipments.status', 'shipments.update',
  'shipments.empty', 'shipments.addMilestone', 'shipments.uploadDocument',
  'shipments.milestoneStatus', 'shipments.location', 'shipments.notes',
  'shipments.documentType', 'shipments.file', 'shipments.upload', 'shipments.cancel',
  'shipments.selectMilestoneError', 'shipments.milestoneAdded',
  'shipments.milestoneFailed', 'shipments.documentRequired',
  'shipments.documentUploaded', 'shipments.documentFailed', 'shipments.saving',
  'shipments.uploading', 'shipments.locationPlaceholder', 'shipments.select',
  'shipments.statuses.planned', 'shipments.statuses.completed',
  'shipments.docTypes.bill_of_lading', 'shipments.docTypes.other',
];

const get = (value, dotted) => dotted.split('.').reduce((current, key) => current?.[key], value);

test('logistics admin dashboard and shipment operations use the localized contract', () => {
  const dashboard = read('src/admin/pages/logistics/LogisticsAdminDashboard.jsx');
  const shipmentOps = read('src/admin/pages/logistics/ShipmentOpsAdmin.jsx');
  const quotes = read('src/admin/pages/logistics/QuotesManagement.jsx');
  const shipments = read('src/admin/pages/logistics/ShipmentsAdmin.jsx');
  assert.match(dashboard, /logistics\.admin\.links/);
  assert.match(dashboard, /logistics\.admin\.warehouseTable/);
  assert.match(shipmentOps, /logistics\.admin\.shipmentOps/);
  assert.match(shipmentOps, /toLocaleDateString\(i18n\.language\)/);
  assert.match(quotes, /logistics\.admin\.quotes/);
  assert.match(quotes, /toLocaleDateString\(i18n\.language\)/);
  assert.match(shipments, /logistics\.admin\.shipments/);
  assert.match(shipments, /toLocaleDateString\(i18n\.language\)/);
  assert.doesNotMatch(dashboard, />Loading stats…</);
  assert.doesNotMatch(shipmentOps, />Shipment Ops Workspace</);
  assert.doesNotMatch(quotes, />Quotes Management</);
  assert.doesNotMatch(shipments, />Shipments</);
});

test('all supported locales contain the complete logistics admin contract', () => {
  const catalogs = locales.map((locale) => JSON.parse(read(`src/locales/${locale}.json`)));
  for (const catalog of catalogs) {
    for (const key of required) {
      const value = get(catalog.logistics?.admin, key);
      assert.equal(typeof value, 'string', `missing logistics.admin.${key}`);
      assert.ok(value.trim(), `empty logistics.admin.${key}`);
    }
  }
});
