'use strict';

const pool = require('../db');
const { strictInteger } = require('../utils/strictInteger');
const { attachScope, requireBrand } = require('../services/restaurantReviewScope');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const accounting = require('../services/restaurantAccountingService');
const reports = require('./restaurantReportsController');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const { getLocationScope } = require('../services/restaurantLocationAccessService');

async function access(req) {
  const restaurantId = strictInteger(req.params.restaurantId);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage']))) {
    throw new AppError('You do not have permission to manage accounting integrations', 403, 'forbidden');
  }
  const scoped = await attachScope(restaurant, req.user.id);
  requireBrand(scoped);
  return scoped;
}

exports.list = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    res.json({ integrations: await accounting.listIntegrations(pool, restaurant.id) });
  } catch (error) { next(error); }
};

exports.listExports = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    res.json({ exports: await accounting.listExports(pool, restaurant.id, req.query || {}) });
  } catch (error) { next(error); }
};

exports.upsert = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const result = await withTransaction(pool, async (client) => {
      const integration = await accounting.upsertIntegration(client, {
        ...req.body,
        restaurantId: restaurant.id,
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
    const input = { ...(req.query || {}), ...(req.body || {}) };
    const currency = accounting.normalizeCurrency(input.currencyCode || input.currency);
    const { rows, fromDate, toDate } = await reports._accountingTest.loadSalesJournalRows(
      restaurant.id,
      { ...restaurant, locationScope: await getLocationScope(restaurant, req.user.id) },
      input
    );
    const currencyRows = rows.filter((row) => String(row.currency || 'USD').toUpperCase() === currency);
    const lines = reports._accountingTest.accountingLines(currencyRows);
    const result = await withTransaction(pool, async (client) => {
      const result = await accounting.queueExport(client, {
      restaurantId: restaurant.id,
      provider,
      periodFrom: input.from || fromDate,
      periodTo: input.to || toDate,
      currencyCode: currency,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      lines,
      actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id, actor_role: restaurant.effective_role,
        action: 'restaurant.accounting.export_queued', target_type: 'accounting_export',
        target_id: result.export.id, after_state: result.export,
        metadata: { replayed: result.replayed }, client, throwOnError: true,
      });
      return result;
    }, 'restaurant_accounting_export_queue');
    res.status(result.replayed ? 200 : 202).json(result);
  } catch (error) { next(error); }
};

exports.updateExport = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const result = await withTransaction(pool, async (client) => {
      const updated = await accounting.updateExportStatus(client, {
        restaurantId: restaurant.id,
        exportId: require('../utils/restaurantReviewValidation').integer(req.params.exportId, 'exportId'),
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
