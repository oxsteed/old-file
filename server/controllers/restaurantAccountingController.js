'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const accounting = require('../services/restaurantAccountingService');
const reports = require('./restaurantReportsController');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

async function access(req) {
  const restaurantId = Number.parseInt(req.params.restaurantId, 10);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage']))) {
    throw new AppError('You do not have permission to manage accounting integrations', 403, 'forbidden');
  }
  return restaurant;
}

exports.list = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    res.json({ integrations: await accounting.listIntegrations(pool, restaurant.id) });
  } catch (error) { next(error); }
};

exports.upsert = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const result = await withTransaction(pool, async (client) => {
      const integration = await accounting.upsertIntegration(client, {
        restaurantId: restaurant.id,
        ...req.body,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.accounting.integration_updated',
        target_type: 'accounting_integration', target_id: integration.id,
        after_state: { provider: integration.provider, status: integration.status, external_company_id: integration.externalCompanyId, account_mapping: integration.accountMapping },
        client, throwOnError: true,
      });
      return integration;
    }, 'restaurant_accounting_integration_upsert');
    res.json({ integration: result });
  } catch (error) { next(error); }
};

exports.queueJournal = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const provider = accounting.normalizeProvider(req.params.provider);
    const currency = accounting.normalizeCurrency(req.body?.currencyCode || req.query?.currency);
    const { rows, fromDate, toDate } = await reports._accountingTest.loadSalesJournalRows(restaurant.id, { ...restaurant, locationScope: await require('../services/restaurantLocationAccessService').getLocationScope(restaurant, req.user.id) }, req.body || req.query || {});
    const currencyRows = rows.filter((row) => String(row.currency || 'USD').toUpperCase() === currency);
    const lines = reports._accountingTest.accountingLines(currencyRows);
    const result = await withTransaction(pool, async (client) => accounting.queueExport(client, {
      restaurantId: restaurant.id,
      provider,
      periodFrom: req.body?.from || req.query?.from || fromDate,
      periodTo: req.body?.to || req.query?.to || toDate,
      currencyCode: currency,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      lines,
      actorUserId: req.user.id,
    }), 'restaurant_accounting_export_queue');
    res.status(result.replayed ? 200 : 202).json(result);
  } catch (error) { next(error); }
};

exports.updateExport = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const result = await withTransaction(pool, async (client) => {
      const updated = await accounting.updateExportStatus(client, {
        restaurantId: restaurant.id,
        exportId: req.params.exportId,
        status: req.body?.status,
        externalBatchId: req.body?.externalBatchId,
        lastError: req.body?.lastError,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.accounting.export_status_updated',
        target_type: 'accounting_export', target_id: updated.id,
        after_state: { status: updated.status, external_batch_id: updated.externalBatchId, last_error: updated.lastError },
        client, throwOnError: true,
      });
      return updated;
    }, 'restaurant_accounting_export_status');
    res.json({ export: result });
  } catch (error) { next(error); }
};
