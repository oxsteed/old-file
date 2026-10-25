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

async function loadIntegration(req) {
  const restaurant=await access(req);
  const provider=accounting.normalizeProvider(req.params.provider);
  const {rows:[integration]}=await pool.query('SELECT * FROM restaurant_accounting_integrations WHERE restaurant_id=$1 AND provider=$2',[restaurant.id,provider]);
  if(!integration)throw new AppError('Configure the provider company first',409,'accounting_provider_not_ready');
  return {restaurant,integration};
}
exports.startOAuth=async(req,res,next)=>{try{
  const {integration}=await loadIntegration(req);
  res.json(await require('../services/restaurantAccountingProvider').startOAuth(integration,req.user.id));
}catch(error){next(error);}};
exports.finishOAuth=async(req,res,next)=>{try{
  const {restaurant,integration}=await loadIntegration(req);
  const result=await require('../services/restaurantAccountingProvider').finishOAuth(integration,req.user.id,req.accountingOAuthQuery||{},client=>logBusinessAction(req,{business_id:restaurant.business_id,action:'restaurant.accounting.oauth_connected',target_type:'accounting_integration',target_id:integration.id,client,throwOnError:true}));
  res.set('Cache-Control','no-store').json(result);
}catch(error){next(error);}};
exports.reconcileExport=async(req,res,next)=>{try{
  const restaurant=await access(req);
  const {rows:[batch]}=await pool.query('SELECT * FROM restaurant_accounting_exports WHERE restaurant_id=$1 AND id=$2',[restaurant.id,require('../utils/restaurantReviewValidation').integer(req.params.exportId,'exportId')]);
  if(!batch)throw new AppError('Accounting export not found',404,'accounting_export_not_found');
  const {rows:[integration]}=await pool.query('SELECT * FROM restaurant_accounting_integrations WHERE id=$1',[batch.integration_id]);
  const adapter=require('../services/restaurantAccountingProvider');
  const credentials=await adapter.tokens(integration);
  const {rows:documents}=await pool.query('SELECT d.*,d.document_date::text AS document_date FROM restaurant_accounting_documents d WHERE export_id=$1 ORDER BY d.document_date',[batch.id]);
  const evidence=[];
  for(const document of documents){
    const candidates=await adapter.reconcileDocument(integration,document,credentials);
    const verified=candidates.length===1&&candidates[0].verified;
    evidence.push({documentId:document.id,status:document.status,externalId:document.external_id,candidates,verified});
  }
  const verified=documents.length>0&&evidence.every(e=>e.verified);
  await withTransaction(pool,async client=>{
    const {rows:[current]}=await client.query('SELECT status,lease_token FROM restaurant_accounting_exports WHERE id=$1 FOR UPDATE',[batch.id]);
    if(current.lease_token)throw new AppError('Wait for the provider send to finish',409,'accounting_export_busy');
    for(const item of evidence.filter(e=>e.verified))await client.query("UPDATE restaurant_accounting_documents SET status='posted',external_id=$2,posted_at=COALESCE(posted_at,NOW()),error_code=NULL WHERE id=$1 AND status<>'sending'",[item.documentId,item.candidates[0].externalId]);
    if(verified)await client.query("UPDATE restaurant_accounting_exports SET status='posted',external_batch_id='oxsteed-export:'||id,last_error=NULL WHERE id=$1",[batch.id]);
    await logBusinessAction(req,{business_id:restaurant.business_id,action:'restaurant.accounting.reconciliation_checked',target_type:'accounting_export',target_id:batch.id,
      metadata:{verified,documentCount:documents.length},client,throwOnError:true});
  });
  res.json({exportId:batch.id,evidence,verified});
}catch(error){next(error);}};

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
        provider:req.params.provider,
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
    const {rows:[boundary]}=await pool.query(`SELECT MIN(((NOW() AT TIME ZONE COALESCE(NULLIF(l.timezone,''),NULLIF(r.timezone,''),'UTC'))
      -(COALESCE(l.day_start_hour,0)*INTERVAL '1 hour'))::date)::text AS business_date
      FROM restaurant_locations l JOIN food_restaurants r ON r.id=l.restaurant_id WHERE l.restaurant_id=$1`,[restaurant.id]);
    if(!boundary?.business_date||toDate>=boundary.business_date)
      throw new AppError('Only closed business days may be queued',409,'accounting_business_day_open');
    // Provider dispatch currently accepts fully settled, exclusive-tax tickets.
    // Keep refunds and inclusive-tax allocation in explicit review rather than
    // forwarding the legacy CSV's unsupported journal assumptions.
    if(currencyRows.some(row=>row.payment_type==='refund'||row.payment_status==='refunded'))
      throw new AppError('Refund periods require accounting review before provider dispatch',409,'accounting_refund_review_required');
    const settledRows=currencyRows.filter(row=>row.payment_status==='paid'&&!['cancelled','voided'].includes(row.order_status));
    if(settledRows.some(row=>row.tax_rule_snapshot?.mode==='inclusive'))
      throw new AppError('Inclusive tax allocation requires accounting review',409,'accounting_tax_review_required');
    const lines = reports._accountingTest.accountingLines(settledRows);
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
