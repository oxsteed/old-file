'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withDbBudget } = require('../utils/dbBudgets');
const {
  getCustomerCreditAccount,
  getCustomerCreditLimitSummary,
  getCustomerCreditEligibility,
  listCustomerCreditAccounts,
  listCustomerCreditHolds,
  listEligiblePartners,
  listCustomerCreditTransactions,
  getCustomerCreditStatement,
  customerCreditStatementCsv,
  MAX_STATEMENT_EXPORT_ROWS,
  MAX_TRANSACTION_CENTS,
  MAX_CUSTOMER_BALANCE_CENTS,
  MAX_TOTAL_ISSUANCE_CENTS,
  MAX_DAILY_CUSTOMER_ISSUANCE_CENTS,
  MAX_DAILY_CUSTOMER_TRANSFER_CENTS,
  MAX_DAILY_CUSTOMER_TRANSFER_COUNT,
  MAX_DAILY_CUSTOMER_SPEND_CENTS,
  MAX_DAILY_CUSTOMER_SPEND_COUNT,
  getCustomerCreditTransaction,
  createCreditHold,
  releaseCreditHold,
  transferCredit,
  updateCustomerCreditAccountStatus,
  openCreditDispute,
  listCreditDisputes,
  getCreditRailStatus,
  getCustomerCreditRailStatus,
  setCreditRailStatus,
  freezeCreditRail,
  unfreezeCreditRail,
  SUPPORTED_CREDIT_CURRENCIES,
  SUPPORTED_CREDIT_CURRENCY_META,
} = require('../services/oxsteedCreditService');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const { reviewIdentityVerification } = require('../services/identityVerificationService');
const { decideSanctionsScreening } = require('../services/sanctionsScreeningService');
const { getComplianceQueue, transitionComplianceCase } = require('../services/complianceCaseService');
const { issueStepupChallenge, verifyStepupChallenge, amountRequiresStepup } = require('../services/stepupChallengeService');
// Phase 7 (gap 9): maker-checker wraps every admin money movement.
const {
  requestPendingAction,
  decidePendingAction,
  listPendingActions,
} = require('../services/oxsteedCreditPendingActionService');
// Phase 7 (gap 10): compensated dispute resolutions.
const { resolveDisputeWithCompensation } = require('../services/oxsteedCreditDisputeService');
const {
  listPartners,
  listAdminCustomerCreditAccounts,
  getAdminCustomerCreditAccount,
  listAdminCreditTransactions,
  getAdminCreditTransaction,
  registerPartner,
  transitionPartner,
  listAgreements,
  listEntitlements,
  listSettlements,
  listReconciliationRuns,
  createSettlement,
  transitionSettlement,
  reconcileCreditLedger,
  createAgreement,
  transitionAgreement,
  upsertEntitlement,
  bulkUpsertEntitlements,
  MAX_BULK_ENTITLEMENTS,
  listCreditAuditEvents,
  retryCreditNotification,
} = require('../services/oxsteedCreditAdminService');
const {
  getPartnerLedger,
  listPartnerFundingRecords,
} = require('../services/oxsteedCreditPartnerLedgerService');
const {
  calculateQuotedTargetAmount,
  getCurrencyQuote,
  convertCustomerCredit,
} = require('../services/oxsteedCreditCurrencyConversionService');
const { getFxQuote } = require('../services/fxRateProvider');
const {
  listExternalReconciliationRuns,
  triggerExternalReconciliation,
} = require('../services/oxsteedCreditExternalReconciliation');
const {
  NOTIFICATION_WORKER_NAME,
  STALE_AFTER_MINUTES,
  DAILY_WORKER_STALE_AFTER_MINUTES,
  NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
  WORKER_NAMES_SQL,
  FAST_WORKER_NAMES_SQL,
} = require('../services/oxsteedCreditWorkerConfig');

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const MAX_ADMIN_CREDIT_EXPORT_ROWS = 5000;

function csvCell(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function parseUuid(value, fieldName) {
  const normalized = normalizeString(value, 80);
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  }
  return normalized;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  return parsed;
}

function parseBoolean(value, fieldName) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
}

function getIdempotencyKey(req) {
  return normalizeString(req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key, 160);
}

/**
 * Phase 7 (gap 9): maker-checker. The requesting admin (maker) queues a
 * pending action; a different admin (checker) approves or rejects it via
 * POST /super/oxsteed-credit/pending-actions/:id/decision. Below the
 * maker-checker threshold (env, default 0 = everything needs dual
 * approval) the movement executes immediately under the requesting admin.
 * Returns the service result: { executed, pendingAction, result, replayed }.
 */
async function requestMoneyMovement(req, actionType, payload) {
  return requestPendingAction({
    actionType,
    payload: payload || {},
    requestedBy: req.user.id,
    idempotencyKey: getIdempotencyKey(req),
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  });
}

/**
 * Sends a maker-checker result: 202 with the pending receipt when queued,
 * or the execution result when the threshold bypass ran it immediately.
 */
function sendMoneyMovementResult(res, result, executedStatus = 201) {
  if (result.executed) {
    const executedReplayed = Boolean(result.result && result.result.replayed);
    return res.status(executedReplayed ? 200 : executedStatus).json(result.result);
  }
  return res.status(result.replayed ? 200 : 202).json({
    pendingAction: result.pendingAction,
    replayed: Boolean(result.replayed),
  });
}

function getRequestContext(req) {
  return {
    actorUserId: req.user?.id || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
    requestIp: req.ip || null,
    metadata: { source: 'api', requestPath: req.path },
  };
}

function formatCustomerCreditMutationResult(result) {
  if (!result || typeof result !== 'object') return result;

  const safeResult = { ...result };
  if (safeResult.hold && typeof safeResult.hold === 'object') {
    const { idempotencyKey, ...safeHold } = safeResult.hold;
    safeResult.hold = safeHold;
  }
  if (safeResult.transaction && typeof safeResult.transaction === 'object') {
    const transaction = safeResult.transaction;
    safeResult.transaction = {
      id: transaction.id,
      transactionType: transaction.transactionType,
      status: transaction.status,
      amountCents: transaction.amountCents,
      currencyCode: transaction.currencyCode,
      referenceType: transaction.referenceType || null,
      referenceId: transaction.referenceId || null,
      description: transaction.description || null,
      postedAt: transaction.postedAt || null,
      createdAt: transaction.createdAt || null,
      replayed: Boolean(transaction.replayed),
    };
  }
  return safeResult;
}

async function getMyAccount(req, res, next) {
  try {
    const account = await getCustomerCreditAccount(req.user.id, normalizeString(req.query.currencyCode || req.query.currency_code, 8) || 'USD');
    res.json({ name: 'OxSteed Credit', account });
  } catch (error) {
    next(error);
  }
}

async function convertMyCredit(req, res, next) {
  try {
    const result = await convertCustomerCredit({
      customerId: req.user.id,
      quoteId: req.body?.quoteId || req.body?.quote_id,
      sourceAmountMinorUnits: req.body?.sourceAmountMinorUnits || req.body?.source_amount_minor_units,
      idempotencyKey: getIdempotencyKey(req),
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
      metadata: req.body?.metadata,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function getMyCreditLimits(req, res, next) {
  try {
    const limits = await getCustomerCreditLimitSummary(
      req.user.id,
      normalizeString(req.query.currencyCode || req.query.currency_code, 8) || 'USD',
    );
    res.json({ limits });
  } catch (error) {
    next(error);
  }
}

async function getMyAccounts(req, res, next) {
  try {
    res.json({ accounts: await listCustomerCreditAccounts(req.user.id) });
  } catch (error) {
    next(error);
  }
}

async function getMyCreditStatus(req, res, next) {
  try {
    res.json({
      credit: {
        ...(await getCustomerCreditRailStatus()),
        supportedCurrencies: SUPPORTED_CREDIT_CURRENCIES,
        currencyMetadata: SUPPORTED_CREDIT_CURRENCY_META,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function listMyHolds(req, res, next) {
  try {
    res.json(await listCustomerCreditHolds(req.user.id, {
      currencyCode: req.query.currencyCode || req.query.currency_code,
      status: req.query.status || 'active',
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    }));
  } catch (error) {
    next(error);
  }
}

async function getEligiblePartners(req, res, next) {
  try {
    const partners = await listEligiblePartners({
      customerId: req.user.id,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      city: req.query.city,
      state: req.query.state,
      postalCode: req.query.postalCode || req.query.postal_code,
      country: req.query.country,
      orderType: req.query.orderType || req.query.order_type,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    });
    res.json(partners);
  } catch (error) {
    next(error);
  }
}

function parseQueryList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 100);
}

async function getCustomerEligibility(req, res, next) {
  try {
    const result = await getCustomerCreditEligibility({
      customerId: req.user.id,
      restaurantId: req.query.restaurantId || req.query.restaurant_id,
      amountCents: req.query.amountCents || req.query.amount_cents,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      orderType: req.query.orderType || req.query.order_type,
      categories: parseQueryList(req.query.categories || req.query.category),
      menuItemIds: parseQueryList(req.query.menuItemIds || req.query.menu_item_ids),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

const {
  requestIdentityVerification,
  getCustomerVerificationTier,
  TIER1_TOPUP_MAX_CENTS: CUSTOMER_TIER1_MAX,
  TIER2_TOPUP_MAX_CENTS: CUSTOMER_TIER2_MAX,
} = require('../services/identityVerificationService');

/**
 * GET /api/oxsteed-credit/identity-verification
 * Current verification tier and per-tier fiat funding limits.
 */
async function getMyIdentityVerification(req, res, next) {
  try {
    const client = await pool.connect();
    try {
      const tier = await getCustomerVerificationTier(client, req.user.id);
      res.json({
        ...tier,
        tierLimitsCents: { tier1: CUSTOMER_TIER1_MAX, tier2: CUSTOMER_TIER2_MAX },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/oxsteed-credit/identity-verification
 * Open a verification request (manual review queue). Body: { requestedTier }.
 */
async function requestMyIdentityVerification(req, res, next) {
  try {
    const result = await requestIdentityVerification({
      customerId: req.user.id,
      requestedTier: req.body?.requestedTier ?? req.body?.requested_tier ?? 2,
      actorUserId: req.user.id,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function getMyTransactions(req, res, next) {
  try {
    const transactions = await listCustomerCreditTransactions(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      includePagination: true,
    });
    res.json(transactions);
  } catch (error) {
    next(error);
  }
}

async function getMyStatement(req, res, next) {
  try {
    const statement = await getCustomerCreditStatement(req.user.id, {
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      offset: req.query.offset,
      currencyCode: req.query.currencyCode || req.query.currency_code,
    });
    res.json({ statement });
  } catch (error) {
    next(error);
  }
}

async function downloadMyStatement(req, res, next) {
  try {
    const statement = await getCustomerCreditStatement(req.user.id, {
      from: req.query.from,
      to: req.query.to,
      // A download is intentionally bounded to the server-side statement cap.
      limit: MAX_STATEMENT_EXPORT_ROWS,
      offset: 0,
      maxRows: MAX_STATEMENT_EXPORT_ROWS,
      currencyCode: req.query.currencyCode || req.query.currency_code,
    });
    if (statement.hasMore) {
      throw new AppError('Statement is too large to export in one file; narrow the date range', 409, 'credit_statement_export_too_large');
    }
    const filename = `oxsteed-credit-statement-${statement.period.from}-${statement.period.to}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(customerCreditStatementCsv(statement));
  } catch (error) {
    next(error);
  }
}

async function downloadAdminCustomerStatement(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const statement = await getCustomerCreditStatement(customerId, {
      from: req.query.from,
      to: req.query.to,
      limit: MAX_STATEMENT_EXPORT_ROWS,
      offset: 0,
      maxRows: MAX_STATEMENT_EXPORT_ROWS,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      requireActiveOwner: false,
    });
    if (statement.hasMore) {
      throw new AppError('Statement is too large to export in one file; narrow the date range', 409, 'credit_statement_export_too_large');
    }
    const filename = `oxsteed-credit-customer-${customerId}-statement-${statement.period.from}-${statement.period.to}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(customerCreditStatementCsv(statement));
  } catch (error) {
    next(error);
  }
}

async function getMyTransaction(req, res, next) {
  try {
    const transactionId = parseUuid(req.params.transactionId, 'transactionId');
    res.json(await getCustomerCreditTransaction(req.user.id, transactionId, req.query.currencyCode || req.query.currency_code));
  } catch (error) {
    next(error);
  }
}

async function createMyHold(req, res, next) {
  try {
    const partnerId = parsePositiveInt(req.body?.partnerId || req.body?.partner_id, 'partnerId');
    const result = await createCreditHold({
      customerId: req.user.id,
      partnerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      idempotencyKey: getIdempotencyKey(req),
      ...getRequestContext(req),
      orderType: req.body?.orderType || req.body?.order_type,
      category: req.body?.category,
      menuItemId: req.body?.menuItemId || req.body?.menu_item_id,
      city: req.body?.city,
      state: req.body?.state,
      postalCode: req.body?.postalCode || req.body?.postal_code,
      country: req.body?.country,
      purpose: req.body?.purpose,
      referenceType: req.body?.referenceType || req.body?.reference_type,
      referenceId: req.body?.referenceId || req.body?.reference_id,
      expiresAt: req.body?.expiresAt || req.body?.expires_at,
    });
    res.status(result.replayed ? 200 : 201).json(formatCustomerCreditMutationResult(result));
  } catch (error) {
    next(error);
  }
}

async function releaseMyHold(req, res, next) {
  try {
    const holdId = parseUuid(req.params.holdId, 'holdId');
    const result = await releaseCreditHold({
      customerId: req.user.id,
      holdId,
      ...getRequestContext(req),
      reason: req.body?.reason,
    });
    res.json(formatCustomerCreditMutationResult(result));
  } catch (error) {
    next(error);
  }
}

async function adminCaptureHold(req, res, next) {
  try {
    const holdId = parseUuid(req.params.holdId, 'holdId');
    const result = await requestMoneyMovement(req, 'credit_hold_capture', {
      holdId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      orderType: req.body?.orderType || req.body?.order_type,
      category: req.body?.category,
      categories: req.body?.categories,
      menuItemId: req.body?.menuItemId || req.body?.menu_item_id,
      menuItemIds: req.body?.menuItemIds || req.body?.menu_item_ids,
      city: req.body?.city,
      state: req.body?.state,
      postalCode: req.body?.postalCode || req.body?.postal_code,
      country: req.body?.country,
      referenceType: req.body?.referenceType || req.body?.reference_type,
      referenceId: req.body?.referenceId || req.body?.reference_id,
      description: req.body?.description,
      reason: req.body?.reason,
      metadata: { source: 'super_admin_api', ...(req.body?.metadata || {}) },
    });
    if (result.executed && result.result?.expired) {
      return res.status(409).json({ ...result.result, code: 'credit_hold_expired' });
    }
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function transferMyCredit(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can transfer OxSteed Credit', 403, 'credit_transfer_customer_only');
    }
    const recipientCustomerId = parseUuid(req.body?.recipientCustomerId || req.body?.recipient_customer_id, 'recipientCustomerId');
    // Phase 6 (gap 6): large transfers require a fresh step-up challenge,
    // verified before any persistent side effect (same bar as top-ups).
    if (amountRequiresStepup(req.body?.amountCents ?? req.body?.amount_cents)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: req.user.id,
        actionType: 'customer_transfer',
        code: req.body?.stepupCode || req.body?.stepup_code,
      });
    }
    const result = await transferCredit({
      senderCustomerId: req.user.id,
      recipientCustomerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      idempotencyKey: getIdempotencyKey(req),
      ...getRequestContext(req),
      referenceType: 'customer_transfer',
      referenceId: normalizeString(req.body?.referenceId || req.body?.reference_id, 160),
      description: req.body?.description,
    });
    res.status(result.replayed ? 200 : 201).json(formatCustomerCreditMutationResult(result));
  } catch (error) {
    next(error);
  }
}

async function openMyDispute(req, res, next) {
  try {
    const transactionId = parseUuid(req.body?.transactionId || req.body?.transaction_id, 'transactionId');
    const result = await openCreditDispute({
      customerId: req.user.id,
      transactionId,
      reasonCode: req.body?.reasonCode || req.body?.reason_code,
      description: req.body?.description,
      actorUserId: req.user.id,
      idempotencyKey: getIdempotencyKey(req),
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function listMyDisputes(req, res, next) {
  try {
    res.json(await listCreditDisputes({
      customerId: req.user.id,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    }));
  } catch (error) {
    next(error);
  }
}

async function adminLoadCredit(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const referenceId = normalizeString(req.body?.referenceId || req.body?.reference_id || req.body?.fundingReference, 160);
    if (!referenceId) throw new AppError('A funding reference is required for an administrative credit load', 400, 'credit_funding_reference_required');
    // Cheap validation stays before the compliance gate so 400s never touch the DB.
    if (!normalizeString(req.body?.reason, 500)) throw new AppError('A reason is required for administrative credit loads', 400, 'credit_load_reason_required');
    // Phase 5: admin loads are fiat funding too, so they pass through the
    // same compliance choke point as Stripe top-ups (identity tier +
    // sanctions screening), recorded as fundingMethod 'admin_load'.
    await evaluateFundingCompliance({
      customerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      fundingMethod: 'admin_load',
      actorUserId: req.user.id,
      requestIp: req.ip || null,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
    });
    const result = await requestMoneyMovement(req, 'credit_load', {
      customerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      reason: req.body?.reason,
      referenceId,
      metadata: { source: 'super_admin_api', fundingReference: referenceId },
    });
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function adminAdjustCredit(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const direction = req.body?.direction;
    const referenceId = normalizeString(req.body?.referenceId || req.body?.reference_id, 160);
    // A funding/case reference is required for both directions: credits and
    // debits both move real customer balances and must be traceable.
    if (!referenceId) {
      throw new AppError('A funding reference is required for an administrative credit adjustment', 400, 'credit_funding_reference_required');
    }
    const result = await requestMoneyMovement(req, 'credit_adjustment', {
      customerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      direction,
      reason: req.body?.reason,
      referenceId,
      metadata: { source: 'super_admin_api', ...(req.body?.metadata || {}) },
    });
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function refundAdminCredit(req, res, next) {
  try {
    const purchaseTransactionId = parseUuid(req.params.transactionId, 'transactionId');
    // Validate at the boundary before queueing: the reason is required for
    // the audit trail whether the refund executes now or at approval time.
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw new AppError('A reason is required to refund a credit transaction', 400, 'credit_refund_reason_required');
    const result = await requestMoneyMovement(req, 'credit_refund', {
      purchaseTransactionId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      reason,
      metadata: { source: 'super_admin_api', ...(req.body?.metadata || {}) },
    });
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function adminUpdateCreditAccountStatus(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const result = await updateCustomerCreditAccountStatus({ customerId, status: req.body?.status, currencyCode: req.body?.currencyCode || req.body?.currency_code, actorUserId: req.user.id, reason: req.body?.reason, correlationId: req.correlationId || req.get('X-Request-ID') || null, requestIp: req.ip || null });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function listAdminDisputes(req, res, next) {
  try {
    const partnerId = req.query.partnerId || req.query.partner_id
      ? parsePositiveInt(req.query.partnerId || req.query.partner_id, 'partnerId')
      : undefined;
    const result = await listCreditDisputes({
      partnerId,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function downloadAdminCreditDisputes(req, res, next) {
  try {
    // E04: heavy exports run under the 'exports' workload budget so they
    // cannot starve the web tier (fail closed with 503 on exhaustion).
    await withDbBudget('exports', async () => {
      const partnerId = req.query.partnerId || req.query.partner_id
        ? parsePositiveInt(req.query.partnerId || req.query.partner_id, 'partnerId')
        : undefined;
      const options = {
        partnerId,
        status: req.query.status,
        limit: 250,
        offset: 0,
        includePagination: true,
      };
      const disputes = [];
      let page = await listCreditDisputes(options);
      disputes.push(...page.disputes);
      while (page.pagination.hasMore && disputes.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
        page = await listCreditDisputes({ ...options, offset: page.pagination.nextOffset || disputes.length });
        disputes.push(...page.disputes);
      }
      if (page.pagination.hasMore) {
        throw new AppError('Credit dispute export is too large; narrow the filters first', 409, 'credit_dispute_export_too_large', {
          maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
        });
      }
      const headers = ['Dispute ID', 'Opened at', 'Updated at', 'Status', 'Reason', 'Description', 'Resolution', 'Customer ID', 'Partner ID', 'Restaurant', 'Transaction ID', 'Transaction type', 'Reference type', 'Reference ID', 'Amount (cents)', 'Currency', 'Posted at', 'Opened by', 'Resolved by', 'Resolved at'];
      const lines = [headers.map(csvCell).join(',')];
      disputes.forEach((dispute) => {
        lines.push([
          dispute.id,
          dispute.openedAt,
          dispute.updatedAt,
          dispute.status,
          dispute.reasonCode,
          dispute.description,
          dispute.resolution,
          dispute.customerId,
          dispute.partnerId,
          dispute.restaurantName,
          dispute.transactionId,
          dispute.transactionType,
          dispute.referenceType,
          dispute.referenceId,
          dispute.amountCents,
          dispute.currencyCode,
          dispute.postedAt,
          dispute.openedBy,
          dispute.resolvedBy,
          dispute.resolvedAt,
        ].map(csvCell).join(','));
      });
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="oxsteed-credit-disputes-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      });
      res.send(`\ufeff${lines.join('\r\n')}\r\n`);
      }); // withDbBudget('exports')
  } catch (error) {
    next(error);
  }
}

async function resolveAdminDispute(req, res, next) {
  try {
    const disputeId = parseUuid(req.params.disputeId, 'disputeId');
    const rawStatus = req.body?.status;
    // Phase 7 (gap 10): compensated resolutions. The legacy 'resolved'
    // status maps to 'resolved_merchant' (resolution against the customer
    // claim without compensation); the new statuses are resolved_customer
    // (with optional compensation) and resolved_merchant. Disputes are
    // never auto-resolved in the customer's favor.
    const decision = rawStatus === 'resolved' ? 'resolved_merchant' : rawStatus;
    const result = await resolveDisputeWithCompensation({
      disputeId,
      adminId: req.user.id,
      decision,
      reason: req.body?.resolution || req.body?.reason,
      compensationCents: req.body?.compensationCents ?? req.body?.compensation_cents ?? 0,
      requestIp: req.ip || null,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/super/oxsteed-credit/pending-actions
 * Generic maker endpoint: queue any supported money movement for checker
 * approval. The converted money routes call requestMoneyMovement instead,
 * which funnels here with a fixed action type.
 */
async function requestAdminPendingAction(req, res, next) {
  try {
    const result = await requestMoneyMovement(req, req.body?.actionType || req.body?.action_type, req.body?.payload || {});
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/super/oxsteed-credit/pending-actions/:id/decision
 * Checker endpoint: approve (with a fresh step-up challenge) or reject
 * (with a required reason). Self-approval is forbidden.
 */
async function decideAdminPendingAction(req, res, next) {
  try {
    const result = await decidePendingAction({
      actionId: parseUuid(req.params.id, 'id'),
      decidedBy: req.user.id,
      decision: req.body?.decision,
      reason: req.body?.reason,
      stepupChallengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
      stepupCode: req.body?.stepupCode || req.body?.stepup_code,
      requestIp: req.ip || null,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/super/oxsteed-credit/pending-actions?status=&limit=&offset=
 * Checker queue: list pending (or decided) actions.
 */
async function listAdminPendingActions(req, res, next) {
  try {
    const pendingActions = await listPendingActions({
      status: req.query.status || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ pendingActions });
  } catch (error) {
    next(error);
  }
}

async function getAdminOverview(req, res, next) {
  try {
    const [summaryResult, partnersResult, recentResult, notificationHealthResult] = await Promise.all([
      pool.query(`
        SELECT
          currency_code,
          COUNT(*) FILTER (WHERE account_type = 'customer_wallet')::int AS customer_accounts,
          COALESCE(SUM(balance_cents) FILTER (WHERE account_type = 'customer_wallet'), 0) AS customer_balance_cents,
          COALESCE(SUM(reserved_cents) FILTER (WHERE account_type = 'customer_wallet'), 0) AS customer_reserved_cents,
          COUNT(*) FILTER (WHERE account_type = 'partner_payable')::int AS partner_accounts,
          COALESCE(SUM(balance_cents) FILTER (WHERE account_type = 'partner_payable'), 0) AS partner_payable_cents,
          COUNT(*) FILTER (WHERE status <> 'active')::int AS inactive_accounts
        FROM oxsteed_credit_accounts
        GROUP BY currency_code
        ORDER BY currency_code`),
      pool.query(`
        WITH partner_coverage AS (
          SELECT p.id AS partner_id, p.restaurant_id, fr.display_name AS restaurant_name,
                 p.status, p.settlement_currency_code, p.updated_at,
                 COUNT(a.id)::int AS agreement_count,
                 COUNT(a.id) FILTER (WHERE a.status = 'active' AND a.starts_at <= NOW()
                   AND (a.ends_at IS NULL OR a.ends_at > NOW()))::int AS active_agreement_count,
                 COUNT(a.id) FILTER (WHERE a.status = 'active' AND a.starts_at <= NOW()
                   AND a.ends_at > NOW()
                   AND a.ends_at <= NOW() + INTERVAL '30 days')::int AS expiring_agreement_count
            FROM oxsteed_credit_partners p
            JOIN food_restaurants fr ON fr.id = p.restaurant_id
            LEFT JOIN oxsteed_credit_partner_agreements a ON a.partner_id = p.id
           GROUP BY p.id, p.restaurant_id, fr.display_name, p.status, p.settlement_currency_code, p.updated_at
        ), partner_metrics AS (
          SELECT COUNT(*)::int AS total_partner_count,
                 COUNT(*) FILTER (WHERE status = 'active')::int AS active_partner_count,
                 COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_partner_count,
                 COUNT(*) FILTER (WHERE status = 'active' AND active_agreement_count = 0)::int AS active_partners_without_agreement_count,
                 COALESCE(SUM(expiring_agreement_count), 0)::int AS expiring_agreement_count
            FROM partner_coverage
        )
        SELECT pc.*, pm.*
          FROM partner_coverage pc
          CROSS JOIN partner_metrics pm
         ORDER BY pc.updated_at DESC, pc.partner_id DESC
         LIMIT 100`),
      pool.query(`
        SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
               t.partner_id, t.agreement_id, t.reference_type, t.reference_id,
               t.posted_at, t.created_at,
               da.customer_id AS debit_customer_id, ca.customer_id AS credit_customer_id
          FROM oxsteed_credit_transactions t
          JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
          JOIN oxsteed_credit_accounts ca ON ca.id = t.credit_account_id
         ORDER BY t.created_at DESC
         LIMIT 100`),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'sending')::int AS sending_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          MIN(created_at) FILTER (WHERE status IN ('pending', 'sending')) AS oldest_pending_at,
          (MIN(created_at) FILTER (
            WHERE (status = 'pending' AND next_attempt_at <= NOW())
               OR (status = 'sending' AND (locked_at IS NULL OR locked_at < NOW() - (${NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES} * INTERVAL '1 minute')))
          )) < NOW() - (${NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES} * INTERVAL '1 minute') AS backlog_stale,
          MIN(created_at) FILTER (WHERE status = 'failed') AS oldest_failed_at,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', failed.id,
              'userId', failed.user_id,
              'transactionId', failed.transaction_id,
              'holdId', failed.hold_id,
              'eventType', failed.event_type,
              'status', failed.status,
              'attempts', failed.attempts,
              'lastError', failed.last_error,
              'createdAt', failed.created_at,
              'updatedAt', failed.updated_at
            ) ORDER BY failed.created_at DESC, failed.id DESC)
            FROM (
              SELECT id, user_id, transaction_id, hold_id, event_type, status, attempts,
                     last_error, created_at, updated_at
                FROM oxsteed_credit_notification_outbox
               WHERE status = 'failed'
               ORDER BY created_at DESC, id DESC
               LIMIT 25
            ) failed
          ), '[]'::json) AS failed_notifications,
          COALESCE((
            SELECT json_build_object(
              'lastRunAt', heartbeat.last_run_at,
              'lastSuccessAt', heartbeat.last_success_at,
              'lastError', heartbeat.last_error,
              'lastResult', heartbeat.last_result,
              'runCount', heartbeat.run_count,
              'consecutiveFailures', heartbeat.consecutive_failures,
              'stale', heartbeat.last_run_at IS NOT NULL
                AND heartbeat.last_run_at < NOW() - (${STALE_AFTER_MINUTES} * INTERVAL '1 minute')
            )
              FROM oxsteed_credit_worker_heartbeats heartbeat
             WHERE heartbeat.job_name = '${NOTIFICATION_WORKER_NAME}'
          ), '{}'::json) AS worker_heartbeat
          ,COALESCE((
            SELECT json_object_agg(heartbeat.job_name, json_build_object(
              'jobName', heartbeat.job_name,
              'lastRunAt', heartbeat.last_run_at,
              'lastSuccessAt', heartbeat.last_success_at,
              'lastError', heartbeat.last_error,
              'lastResult', heartbeat.last_result,
              'runCount', heartbeat.run_count,
              'consecutiveFailures', heartbeat.consecutive_failures,
              'stale', heartbeat.last_run_at IS NOT NULL
                AND heartbeat.last_run_at < NOW() - (
                  CASE WHEN heartbeat.job_name IN (${FAST_WORKER_NAMES_SQL})
                    THEN ${STALE_AFTER_MINUTES}
                    ELSE ${DAILY_WORKER_STALE_AFTER_MINUTES}
                  END * INTERVAL '1 minute'
                )
            ))
              FROM oxsteed_credit_worker_heartbeats heartbeat
             WHERE heartbeat.job_name IN (${WORKER_NAMES_SQL})
          ), '{}'::json) AS worker_heartbeats
        FROM oxsteed_credit_notification_outbox`),
    ]);
    const summary = summaryResult.rows.find((row) => row.currency_code === 'USD') || {};
    const partnerCounts = {
      total: Number(partnersResult.rows[0]?.total_partner_count ?? partnersResult.rows.length),
      active: Number(partnersResult.rows[0]?.active_partner_count ?? partnersResult.rows.filter((row) => row.status === 'active').length),
    };
    const coverageAlerts = {
      pendingPartners: Number(partnersResult.rows[0]?.pending_partner_count || 0),
      activePartnersWithoutAgreement: Number(partnersResult.rows[0]?.active_partners_without_agreement_count || 0),
      expiringAgreements: Number(partnersResult.rows[0]?.expiring_agreement_count || 0),
    };
    const notificationHealthRow = notificationHealthResult.rows[0] || {};
    const notificationHealth = {
      pending: Number(notificationHealthRow.pending_count || 0),
      sending: Number(notificationHealthRow.sending_count || 0),
      failed: Number(notificationHealthRow.failed_count || 0),
      oldestPendingAt: notificationHealthRow.oldest_pending_at || null,
      backlogStale: Boolean(notificationHealthRow.backlog_stale),
      backlogStaleAfterMinutes: NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
      oldestFailedAt: notificationHealthRow.oldest_failed_at || null,
      failedNotifications: Array.isArray(notificationHealthRow.failed_notifications) ? notificationHealthRow.failed_notifications : [],
      workerHeartbeat: notificationHealthRow.worker_heartbeat && typeof notificationHealthRow.worker_heartbeat === 'object'
        ? notificationHealthRow.worker_heartbeat
        : {},
    };
    const workerHeartbeats = notificationHealthRow.worker_heartbeats && typeof notificationHealthRow.worker_heartbeats === 'object'
      ? notificationHealthRow.worker_heartbeats
      : {};
    const formatSummary = (row) => ({
      currencyCode: row.currency_code || 'USD',
      customerAccounts: Number(row.customer_accounts || 0),
      customerBalanceCents: Number(row.customer_balance_cents || 0),
      customerReservedCents: Number(row.customer_reserved_cents || 0),
      customerAvailableCents: Math.max(0, Number(row.customer_balance_cents || 0) - Number(row.customer_reserved_cents || 0)),
      partnerAccounts: Number(row.partner_accounts || 0),
      partnerPayableCents: Number(row.partner_payable_cents || 0),
      inactiveAccounts: Number(row.inactive_accounts || 0),
    });
    res.json({
      name: 'OxSteed Credit',
      supportedCurrencies: SUPPORTED_CREDIT_CURRENCIES,
      currencyMetadata: SUPPORTED_CREDIT_CURRENCY_META,
      riskLimits: {
        maxTransactionCents: MAX_TRANSACTION_CENTS,
        maxCustomerBalanceCents: MAX_CUSTOMER_BALANCE_CENTS,
        maxTotalIssuanceCents: MAX_TOTAL_ISSUANCE_CENTS,
        maxDailyCustomerIssuanceCents: MAX_DAILY_CUSTOMER_ISSUANCE_CENTS,
        maxDailyCustomerTransferCents: MAX_DAILY_CUSTOMER_TRANSFER_CENTS,
        maxDailyCustomerTransferCount: MAX_DAILY_CUSTOMER_TRANSFER_COUNT,
        maxDailyCustomerSpendCents: MAX_DAILY_CUSTOMER_SPEND_CENTS,
        maxDailyCustomerSpendCount: MAX_DAILY_CUSTOMER_SPEND_COUNT,
      },
      summary: formatSummary(summary),
      summaryByCurrency: summaryResult.rows.map(formatSummary),
      partnerCounts,
      coverageAlerts,
      notificationHealth,
      workerHeartbeats,
      partners: partnersResult.rows.map((row) => ({
        partnerId: String(row.partner_id),
        restaurantId: String(row.restaurant_id),
        restaurantName: row.restaurant_name,
        status: row.status,
        settlementCurrencyCode: row.settlement_currency_code,
        agreementCount: Number(row.agreement_count || 0),
        activeAgreementCount: Number(row.active_agreement_count || 0),
      })),
      recentTransactions: recentResult.rows.map((row) => ({
        id: String(row.id),
        transactionType: row.transaction_type,
        status: row.status,
        amountCents: Number(row.amount_cents || 0),
        currencyCode: row.currency_code,
        partnerId: row.partner_id ? String(row.partner_id) : null,
        agreementId: row.agreement_id || null,
        referenceType: row.reference_type || null,
        referenceId: row.reference_id || null,
        debitCustomerId: row.debit_customer_id || null,
        creditCustomerId: row.credit_customer_id || null,
        postedAt: row.posted_at || null,
        createdAt: row.created_at || null,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function retryAdminCreditNotification(req, res, next) {
  try {
    const notificationId = parseUuid(req.params.notificationId, 'notificationId');
    const result = await retryCreditNotification({
      notificationId,
      reason: req.body?.reason,
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getAdminCreditRail(req, res, next) {
  try {
    res.json({ rail: await getCreditRailStatus() });
  } catch (error) {
    next(error);
  }
}

async function updateAdminCreditRail(req, res, next) {
  try {
    const result = await setCreditRailStatus({
      enabled: parseBoolean(req.body?.enabled, 'enabled'),
      expectedEnabled: req.body?.expectedEnabled === undefined && req.body?.expected_enabled === undefined
        ? undefined
        : parseBoolean(req.body?.expectedEnabled ?? req.body?.expected_enabled, 'expectedEnabled'),
      actorUserId: req.user.id,
      reason: req.body?.reason,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function freezeAdminCreditRail(req, res, next) {
  try {
    const result = await freezeCreditRail({
      reason: req.body?.reason,
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function unfreezeAdminCreditRail(req, res, next) {
  try {
    const result = await unfreezeCreditRail({
      reason: req.body?.reason,
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listAdminCreditExternalReconciliationRuns(req, res, next) {
  try {
    const result = await listExternalReconciliationRuns({
      currencyCode: req.query.currencyCode || req.query.currency_code,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function runAdminCreditExternalReconciliation(req, res, next) {
  try {
    const result = await triggerExternalReconciliation({
      periodStart: req.body?.periodStart || req.body?.period_start,
      periodEnd: req.body?.periodEnd || req.body?.period_end,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

// Phase 5 compliance queue: pending identity verifications, uncleared
// sanctions hits, and open compliance cases with SLA state.
async function getAdminComplianceQueue(req, res, next) {
  try {
    const client = await pool.connect();
    try {
      const queue = await getComplianceQueue(client, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json(queue);
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
}

async function decideAdminComplianceVerification(req, res, next) {
  try {
    const result = await reviewIdentityVerification({
      verificationId: req.params.id,
      decision: req.body?.decision,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function decideAdminComplianceSanction(req, res, next) {
  try {
    const result = await decideSanctionsScreening({
      screeningId: req.params.id,
      decision: req.body?.decision,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      requestIp: req.ip || null,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function transitionAdminComplianceCase(req, res, next) {
  try {
    const result = await transitionComplianceCase({
      caseId: req.params.id,
      toStatus: req.body?.toStatus || req.body?.to_status,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      assignedTo: req.body?.assignedTo || req.body?.assigned_to || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/super/oxsteed-credit/stepup-challenges
 * Issue a step-up challenge for the calling super-admin (used before
 * settlement payout initiation and withdrawal approval). Code is emailed;
 * never in the response.
 *
 * Phase 7 (gap 9): 'pending_action_approve' is the challenge a checker
 * proves before approving a pending money movement.
 */
const ADMIN_STEPUP_ACTION_TYPES = new Set(['settlement_payout', 'withdrawal', 'pending_action_approve']);
async function issueAdminStepupChallenge(req, res, next) {
  try {
    const requestedActionType = String(req.body?.actionType || req.body?.action_type || 'settlement_payout').trim();
    if (!ADMIN_STEPUP_ACTION_TYPES.has(requestedActionType)) {
      throw new AppError('Unsupported admin step-up action', 400, 'credit_stepup_action_invalid');
    }
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: req.user.id,
      actorEmail: req.user?.email,
      actionType: requestedActionType,
      amountCents: req.body?.amountCents || req.body?.amount_cents || 1,
      currencyCode: req.body?.currencyCode || req.body?.currency_code || 'USD',
    });
    res.status(201).json({
      challenge: {
        id: challenge.id,
        actionType: challenge.actionType,
        amountCents: challenge.amountCents,
        currencyCode: challenge.currencyCode,
        expiresAt: challenge.expiresAt,
      },
      delivery,
    });
  } catch (error) {
    next(error);
  }
}

async function listAdminPartners(req, res, next) {
  try {
    const partners = await listPartners({ search: req.query.search || req.query.q, status: req.query.status });
    res.json({ partners });
  } catch (error) {
    next(error);
  }
}

async function listAdminPartnerDirectory(req, res, next) {
  try {
    const result = await listPartners({
      search: req.query.search || req.query.q,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function downloadAdminPartners(req, res, next) {
  try {
    const options = {
      search: req.query.search || req.query.q,
      status: req.query.status,
      limit: 250,
      offset: 0,
      includePagination: true,
    };
    const partners = [];
    let page = await listPartners(options);
    partners.push(...page.partners);
    while (page.pagination.hasMore && partners.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listPartners({ ...options, offset: page.pagination.nextOffset || partners.length });
      partners.push(...page.partners);
    }
    if (page.pagination.hasMore) {
      throw new AppError('Credit partner export is too large; narrow the filters first', 409, 'credit_partner_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Partner ID', 'Restaurant ID', 'Restaurant', 'Business ID', 'Status', 'Settlement currency', 'Customer entitlement required', 'Agreement count', 'Active agreement count', 'Notes', 'Created at', 'Updated at'];
    const lines = [headers.map(csvCell).join(',')];
    partners.forEach((partner) => {
      lines.push([
        partner.partnerId,
        partner.restaurantId,
        partner.restaurantName,
        partner.businessId,
        partner.status,
        partner.settlementCurrencyCode,
        partner.requiresCustomerEntitlement,
        partner.agreementCount,
        partner.activeAgreementCount,
        partner.notes,
        partner.createdAt,
        partner.updatedAt,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-partners-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function listAdminCustomerAccounts(req, res, next) {
  try {
    const result = await listAdminCustomerCreditAccounts({
      search: req.query.search || req.query.q,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function downloadAdminCustomerAccounts(req, res, next) {
  try {
    const options = {
      search: req.query.search || req.query.q,
      status: req.query.status,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      limit: 250,
      offset: 0,
    };
    const accounts = [];
    let page = await listAdminCustomerCreditAccounts(options);
    accounts.push(...page.accounts);
    while (page.hasMore && accounts.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listAdminCustomerCreditAccounts({ ...options, offset: page.offset + page.accounts.length });
      accounts.push(...page.accounts);
    }
    if (page.hasMore) {
      throw new AppError('Customer wallet export is too large; narrow the filters first', 409, 'credit_customer_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Customer ID', 'Name', 'Email', 'Currency', 'Balance (cents)', 'Reserved (cents)', 'Available (cents)', 'Account status', 'Platform active', 'Platform banned', 'Ledger version', 'Last posted at', 'Updated at'];
    const lines = [headers.map(csvCell).join(',')];
    accounts.forEach((account) => {
      lines.push([
        account.customerId,
        account.name,
        account.email,
        account.currencyCode,
        account.balanceCents,
        account.reservedCents,
        account.availableBalanceCents,
        account.status,
        account.isActive,
        account.isBanned,
        account.ledgerVersion,
        account.lastPostedAt,
        account.updatedAt,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-customer-wallets-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function getAdminCustomerAccount(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const result = await getAdminCustomerCreditAccount({
      customerId,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      transactionLimit: req.query.transactionLimit || req.query.transaction_limit,
      holdLimit: req.query.holdLimit || req.query.hold_limit,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getAdminCustomerEligiblePartners(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const result = await listEligiblePartners({
      customerId,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      city: req.query.city,
      state: req.query.state,
      postalCode: req.query.postalCode || req.query.postal_code,
      country: req.query.country,
      orderType: req.query.orderType || req.query.order_type,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function listAdminTransactions(req, res, next) {
  try {
    const options = {
      partnerId: req.query.partnerId || req.query.partner_id,
      transactionType: req.query.transactionType || req.query.transaction_type,
      status: req.query.status,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      limit: req.query.limit,
      includePagination: true,
    };
    if (req.query.offset !== undefined) options.offset = req.query.offset;
    res.json(await listAdminCreditTransactions(options));
  } catch (error) {
    next(error);
  }
}

async function downloadAdminTransactions(req, res, next) {
  try {
    const options = {
      partnerId: req.query.partnerId || req.query.partner_id,
      transactionType: req.query.transactionType || req.query.transaction_type,
      status: req.query.status,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      limit: 250,
      offset: 0,
      includePagination: true,
    };
    const transactions = [];
    let page = await listAdminCreditTransactions(options);
    transactions.push(...page.transactions);
    while (page.pagination?.hasMore && transactions.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listAdminCreditTransactions({ ...options, offset: page.pagination.nextOffset });
      transactions.push(...page.transactions);
    }
    if (page.pagination?.hasMore) {
      throw new AppError('Credit transaction export is too large; narrow the filters first', 409, 'credit_transaction_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Posted at', 'Created at', 'Transaction ID', 'Type', 'Status', 'Amount (cents)', 'Currency', 'Restaurant', 'Partner ID', 'Reference type', 'Reference ID', 'Order ID', 'Description', 'Actor type', 'Actor user ID'];
    const lines = [headers.map(csvCell).join(',')];
    transactions.forEach((transaction) => {
      lines.push([
        transaction.postedAt,
        transaction.createdAt,
        transaction.id,
        transaction.transactionType,
        transaction.status,
        transaction.amountCents,
        transaction.currencyCode,
        transaction.restaurantName,
        transaction.partnerId,
        transaction.referenceType,
        transaction.referenceId,
        transaction.orderId,
        transaction.description,
        transaction.actorType,
        transaction.actorUserId,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function getAdminTransaction(req, res, next) {
  try {
    const transactionId = parseUuid(req.params.transactionId, 'transactionId');
    res.json(await getAdminCreditTransaction(transactionId));
  } catch (error) {
    next(error);
  }
}

async function listAdminAgreements(req, res, next) {
  try {
    const agreements = await listAgreements({
      partnerId: req.query.partnerId || req.query.partner_id,
      status: req.query.status,
      search: req.query.search || req.query.q,
    });
    res.json({ agreements });
  } catch (error) {
    next(error);
  }
}

async function downloadAdminAgreements(req, res, next) {
  try {
    const options = {
      partnerId: req.query.partnerId || req.query.partner_id,
      status: req.query.status,
      search: req.query.search || req.query.q,
      limit: 250,
      offset: 0,
      includePagination: true,
    };
    const agreements = [];
    let page = await listAgreements(options);
    agreements.push(...page.agreements);
    while (page.pagination.hasMore && agreements.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listAgreements({ ...options, offset: page.pagination.nextOffset || agreements.length });
      agreements.push(...page.agreements);
    }
    if (page.pagination.hasMore) {
      throw new AppError('Credit agreement export is too large; narrow the filters first', 409, 'credit_agreement_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Agreement ID', 'Partner ID', 'Restaurant ID', 'Restaurant', 'Version', 'Status', 'Settlement currency', 'Starts at', 'Ends at', 'Customer terms', 'Allowed order types', 'Allowed categories', 'Allowed menu item IDs', 'Geography', 'Max transaction (cents)', 'Daily customer limit (cents)', 'Lifetime customer limit (cents)', 'Customer entitlement required', 'Approved by', 'Created by', 'Created at', 'Updated at', 'Metadata'];
    const lines = [headers.map(csvCell).join(',')];
    agreements.forEach((agreement) => {
      lines.push([
        agreement.id,
        agreement.partnerId,
        agreement.restaurantId,
        agreement.restaurantName,
        agreement.version,
        agreement.status,
        agreement.settlementCurrencyCode,
        agreement.startsAt,
        agreement.endsAt,
        agreement.customerTerms,
        JSON.stringify(agreement.allowedOrderTypes || []),
        JSON.stringify(agreement.allowedCategories || []),
        JSON.stringify(agreement.allowedMenuItemIds || []),
        JSON.stringify(agreement.geography || {}),
        agreement.maxTransactionCents,
        agreement.dailyCustomerLimitCents,
        agreement.lifetimeCustomerLimitCents,
        agreement.requiresCustomerEntitlement,
        agreement.approvedBy,
        agreement.createdBy,
        agreement.createdAt,
        agreement.updatedAt,
        JSON.stringify(agreement.metadata || {}),
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-agreements-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function registerAdminPartner(req, res, next) {
  try {
    const result = await registerPartner({
      restaurantId: req.body?.restaurantId || req.body?.restaurant_id,
      businessId: req.body?.businessId || req.body?.business_id,
      settlementCurrencyCode: req.body?.settlementCurrencyCode || req.body?.settlement_currency_code,
      notes: req.body?.notes,
      reason: req.body?.reason,
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function transitionAdminPartner(req, res, next) {
  try {
    const result = await transitionPartner({
      partnerId: req.params.partnerId,
      targetStatus: req.body?.status || req.body?.targetStatus || req.body?.target_status,
      expectedStatus: req.body?.expectedStatus ?? req.body?.expected_status,
      reason: req.body?.reason,
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function createAdminAgreement(req, res, next) {
  try {
    const result = await createAgreement({
      partnerId: req.params.partnerId,
      startsAt: req.body?.startsAt || req.body?.starts_at,
      endsAt: req.body?.endsAt || req.body?.ends_at,
      customerTerms: req.body?.customerTerms || req.body?.customer_terms,
      allowedOrderTypes: req.body?.allowedOrderTypes || req.body?.allowed_order_types,
      allowedCategories: req.body?.allowedCategories || req.body?.allowed_categories,
      allowedMenuItemIds: req.body?.allowedMenuItemIds || req.body?.allowed_menu_item_ids,
      geography: req.body?.geography,
      maxTransactionCents: req.body?.maxTransactionCents ?? req.body?.max_transaction_cents,
      dailyCustomerLimitCents: req.body?.dailyCustomerLimitCents ?? req.body?.daily_customer_limit_cents,
      lifetimeCustomerLimitCents: req.body?.lifetimeCustomerLimitCents ?? req.body?.lifetime_customer_limit_cents,
      requiresCustomerEntitlement: req.body?.requiresCustomerEntitlement === undefined && req.body?.requires_customer_entitlement === undefined
        ? false
        : parseBoolean(req.body?.requiresCustomerEntitlement ?? req.body?.requires_customer_entitlement, 'requiresCustomerEntitlement'),
      metadata: req.body?.metadata,
      reason: req.body?.reason,
      idempotencyKey: getIdempotencyKey(req),
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function transitionAdminAgreement(req, res, next) {
  try {
    const agreementId = parseUuid(req.params.agreementId, 'agreementId');
    const result = await transitionAgreement({
      agreementId,
      targetStatus: req.body?.status || req.body?.targetStatus || req.body?.target_status,
      expectedStatus: req.body?.expectedStatus ?? req.body?.expected_status,
      reason: req.body?.reason,
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function upsertAdminEntitlement(req, res, next) {
  try {
    const agreementId = parseUuid(req.params.agreementId, 'agreementId');
    const customerId = parseUuid(req.body?.customerId || req.body?.customer_id, 'customerId');
    const result = await upsertEntitlement({
      agreementId,
      customerId,
      status: req.body?.status,
      startsAt: req.body?.startsAt || req.body?.starts_at,
      endsAt: req.body?.endsAt || req.body?.ends_at,
      maxTransactionCents: req.body?.maxTransactionCents ?? req.body?.max_transaction_cents,
      dailyLimitCents: req.body?.dailyLimitCents ?? req.body?.daily_limit_cents,
      reason: req.body?.reason,
      metadata: req.body?.metadata,
      actorUserId: req.user.id,
      idempotencyKey: getIdempotencyKey(req),
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function bulkUpsertAdminEntitlements(req, res, next) {
  try {
    const customerId = parseUuid(req.body?.customerId || req.body?.customer_id, 'customerId');
    const rawAgreementIds = req.body?.agreementIds || req.body?.agreement_ids;
    if (!Array.isArray(rawAgreementIds) || rawAgreementIds.length === 0) {
      throw new AppError('At least one credit agreement is required', 400, 'credit_entitlement_agreements_required');
    }
    if (rawAgreementIds.length > MAX_BULK_ENTITLEMENTS) {
      throw new AppError(`A bulk entitlement action cannot include more than ${MAX_BULK_ENTITLEMENTS} agreements`, 400, 'credit_entitlement_bulk_limit_exceeded');
    }
    const agreementIds = [...new Set(rawAgreementIds.map((agreementId) => parseUuid(agreementId, 'agreementId')))];
    const result = await bulkUpsertEntitlements({
      agreementIds,
      customerId,
      status: req.body?.status,
      startsAt: req.body?.startsAt || req.body?.starts_at,
      endsAt: req.body?.endsAt || req.body?.ends_at,
      maxTransactionCents: req.body?.maxTransactionCents ?? req.body?.max_transaction_cents,
      dailyLimitCents: req.body?.dailyLimitCents ?? req.body?.daily_limit_cents,
      reason: req.body?.reason,
      metadata: req.body?.metadata,
      actorUserId: req.user.id,
      idempotencyKey: getIdempotencyKey(req),
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function listAdminEntitlements(req, res, next) {
  try {
    const customerId = req.query.customerId || req.query.customer_id
      ? parseUuid(req.query.customerId || req.query.customer_id, 'customerId')
      : undefined;
    const agreementId = req.query.agreementId || req.query.agreement_id
      ? parseUuid(req.query.agreementId || req.query.agreement_id, 'agreementId')
      : undefined;
    const result = await listEntitlements({
      search: req.query.search || req.query.q,
      customerId,
      agreementId,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function downloadAdminEntitlements(req, res, next) {
  try {
    const customerId = req.query.customerId || req.query.customer_id
      ? parseUuid(req.query.customerId || req.query.customer_id, 'customerId')
      : undefined;
    const agreementId = req.query.agreementId || req.query.agreement_id
      ? parseUuid(req.query.agreementId || req.query.agreement_id, 'agreementId')
      : undefined;
    const options = {
      search: req.query.search || req.query.q,
      customerId,
      agreementId,
      status: req.query.status,
      limit: 250,
      offset: 0,
    };
    const entitlements = [];
    let page = await listEntitlements(options);
    entitlements.push(...page.entitlements);
    while (page.hasMore && entitlements.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listEntitlements({ ...options, offset: page.offset + page.entitlements.length });
      entitlements.push(...page.entitlements);
    }
    if (page.hasMore) {
      throw new AppError('Credit entitlement export is too large; narrow the filters first', 409, 'credit_entitlement_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Entitlement ID', 'Customer ID', 'Customer name', 'Customer email', 'Agreement ID', 'Partner ID', 'Restaurant ID', 'Restaurant', 'Agreement version', 'Agreement status', 'Currency', 'Access status', 'Starts at', 'Ends at', 'Max transaction (cents)', 'Daily limit (cents)', 'Reason', 'Created by', 'Created at', 'Updated at'];
    const lines = [headers.map(csvCell).join(',')];
    entitlements.forEach((entitlement) => {
      lines.push([
        entitlement.id,
        entitlement.customerId,
        entitlement.customerName,
        entitlement.customerEmail,
        entitlement.agreementId,
        entitlement.partnerId,
        entitlement.restaurantId,
        entitlement.restaurantName,
        entitlement.agreementVersion,
        entitlement.agreementStatus,
        entitlement.currencyCode,
        entitlement.status,
        entitlement.startsAt,
        entitlement.endsAt,
        entitlement.maxTransactionCents,
        entitlement.dailyLimitCents,
        entitlement.reason,
        entitlement.createdBy,
        entitlement.createdAt,
        entitlement.updatedAt,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-entitlements-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function listAdminSettlements(req, res, next) {
  try {
    const options = {
      partnerId: req.query.partnerId || req.query.partner_id,
      status: req.query.status,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      cycleId: req.query.cycleId || req.query.cycle_id,
      payoutStatus: req.query.payoutStatus || req.query.payout_status,
      limit: req.query.limit,
      includePagination: true,
    };
    if (req.query.offset !== undefined) options.offset = req.query.offset;
    res.json(await listSettlements(options));
  } catch (error) {
    next(error);
  }
}

async function downloadAdminSettlements(req, res, next) {
  try {
    const options = {
      partnerId: req.query.partnerId || req.query.partner_id,
      status: req.query.status,
      currencyCode: req.query.currencyCode || req.query.currency_code,
      cycleId: req.query.cycleId || req.query.cycle_id,
      payoutStatus: req.query.payoutStatus || req.query.payout_status,
      limit: 250,
      offset: 0,
      includePagination: true,
    };
    const settlements = [];
    let page = await listSettlements(options);
    settlements.push(...page.settlements);
    while (page.pagination?.hasMore && settlements.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listSettlements({ ...options, offset: page.pagination.nextOffset });
      settlements.push(...page.settlements);
    }
    if (page.pagination?.hasMore) {
      throw new AppError('Settlement export is too large; narrow the filters first', 409, 'credit_settlement_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = [
      'Settlement ID', 'Partner ID', 'Restaurant', 'Agreement ID', 'Period start', 'Period end',
      'Cycle ID', 'Value date', 'Settlement date', 'Payout status', 'Stripe transfer ID',
      'Gross cents', 'Refund cents', 'Fee cents', 'Net cents', 'Status', 'Currency',
      'Payment reference', 'Created by', 'Approved by', 'Paid at', 'Created at', 'Updated at',
    ];
    const lines = [headers.map(csvCell).join(',')];
    settlements.forEach((settlement) => {
      lines.push([
        settlement.id,
        settlement.partnerId,
        settlement.restaurantName,
        settlement.agreementId,
        settlement.periodStart,
        settlement.periodEnd,
        settlement.cycleId,
        settlement.valueDate,
        settlement.settlementDate,
        settlement.payoutStatus,
        settlement.stripeTransferId,
        settlement.grossCents,
        settlement.refundCents,
        settlement.feeCents,
        settlement.netCents,
        settlement.status,
        settlement.currencyCode,
        settlement.paymentReference,
        settlement.createdBy,
        settlement.approvedBy,
        settlement.paidAt,
        settlement.createdAt,
        settlement.updatedAt,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-settlements-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function listAdminCreditAuditEvents(req, res, next) {
  try {
    const customerId = req.query.customerId || req.query.customer_id
      ? parseUuid(req.query.customerId || req.query.customer_id, 'customerId')
      : undefined;
    const partnerId = req.query.partnerId || req.query.partner_id
      ? parsePositiveInt(req.query.partnerId || req.query.partner_id, 'partnerId')
      : undefined;
    const auditEvents = await listCreditAuditEvents({
      actionType: req.query.actionType || req.query.action_type,
      resourceType: req.query.resourceType || req.query.resource_type,
      customerId,
      partnerId,
      correlationId: req.query.correlationId || req.query.correlation_id,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    });
    res.json(auditEvents);
  } catch (error) {
    next(error);
  }
}

async function downloadAdminCreditAuditEvents(req, res, next) {
  try {
    const customerId = req.query.customerId || req.query.customer_id
      ? parseUuid(req.query.customerId || req.query.customer_id, 'customerId')
      : undefined;
    const partnerId = req.query.partnerId || req.query.partner_id
      ? parsePositiveInt(req.query.partnerId || req.query.partner_id, 'partnerId')
      : undefined;
    const options = {
      actionType: req.query.actionType || req.query.action_type,
      resourceType: req.query.resourceType || req.query.resource_type,
      customerId,
      partnerId,
      correlationId: req.query.correlationId || req.query.correlation_id,
      limit: 250,
      offset: 0,
      includePagination: true,
    };
    const auditEvents = [];
    let page = await listCreditAuditEvents(options);
    auditEvents.push(...page.auditEvents);
    while (page.pagination.hasMore && auditEvents.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listCreditAuditEvents({ ...options, offset: page.pagination.nextOffset || auditEvents.length });
      auditEvents.push(...page.auditEvents);
    }
    if (page.pagination.hasMore) {
      throw new AppError('Credit audit export is too large; narrow the filters first', 409, 'credit_audit_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Event ID', 'Created at', 'Action', 'Resource type', 'Resource ID', 'Actor user ID', 'Customer ID', 'Partner ID', 'Reason', 'Before state', 'After state', 'Metadata', 'Correlation ID', 'Request IP', 'Previous event hash', 'Event hash'];
    const lines = [headers.map(csvCell).join(',')];
    auditEvents.forEach((event) => {
      lines.push([
        event.id,
        event.createdAt,
        event.actionType,
        event.resourceType,
        event.resourceId,
        event.actorUserId,
        event.customerId,
        event.partnerId,
        event.reason,
        JSON.stringify(event.beforeState || null),
        JSON.stringify(event.afterState || null),
        JSON.stringify(event.metadata || {}),
        event.correlationId,
        event.requestIp,
        event.previousEventHash,
        event.eventHash,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

async function createAdminSettlement(req, res, next) {
  try {
    const agreementId = parseUuid(req.body?.agreementId || req.body?.agreement_id, 'agreementId');
    const result = await createSettlement({
      partnerId: req.body?.partnerId || req.body?.partner_id,
      agreementId,
      periodStart: req.body?.periodStart || req.body?.period_start,
      periodEnd: req.body?.periodEnd || req.body?.period_end,
      idempotencyKey: getIdempotencyKey(req),
      actorUserId: req.user.id,
      paymentReference: req.body?.paymentReference || req.body?.payment_reference,
      reason: req.body?.reason,
      metadata: req.body?.metadata,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function transitionAdminSettlement(req, res, next) {
  try {
    const settlementId = parseUuid(req.params.settlementId, 'settlementId');
    const targetStatus = req.body?.status || req.body?.targetStatus || req.body?.target_status;
    // Phase 7 (gap 9): only the pending -> approved transition moves money
    // (it releases the settlement for payout), so only it needs a checker.
    // Rejections and other non-money transitions stay single-admin.
    if (targetStatus === 'approved') {
      const result = await requestMoneyMovement(req, 'credit_settlement_approval', {
        settlementId,
        targetStatus,
        expectedStatus: req.body?.expectedStatus ?? req.body?.expected_status,
        reason: req.body?.reason,
        paymentReference: req.body?.paymentReference || req.body?.payment_reference,
      });
      sendMoneyMovementResult(res, result, 200);
      return;
    }
    const result = await transitionSettlement({
      settlementId,
      targetStatus,
      expectedStatus: req.body?.expectedStatus ?? req.body?.expected_status,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      paymentReference: req.body?.paymentReference || req.body?.payment_reference,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function reverseAdminSettlement(req, res, next) {
  try {
    const settlementId = parseUuid(req.params.settlementId, 'settlementId');
    const result = await requestMoneyMovement(req, 'credit_settlement_reversal', {
      settlementId,
      reason: req.body?.reason,
      recoveryReference: req.body?.recoveryReference || req.body?.recovery_reference,
      metadata: req.body?.metadata,
    });
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function reconcileAdminCredit(req, res, next) {
  try {
    const result = await reconcileCreditLedger({
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      periodStart: req.body?.periodStart || req.body?.period_start,
      periodEnd: req.body?.periodEnd || req.body?.period_end,
      actorUserId: req.user.id,
      reason: req.body?.reason,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getAdminPartnerLedger(req, res, next) {
  try {
    const partnerId = parsePositiveInt(req.params.partnerId, 'partnerId');
    const result = await getPartnerLedger({
      partnerId,
      currencyCode: req.query.currencyCode || req.query.currency_code,
    });
    const funding = await listPartnerFundingRecords({
      partnerId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ ...result, funding });
  } catch (error) {
    next(error);
  }
}

async function recordAdminPartnerFunding(req, res, next) {
  try {
    const partnerId = parsePositiveInt(req.params.partnerId, 'partnerId');
    const result = await requestMoneyMovement(req, 'credit_partner_funding', {
      partnerId,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      amountCents: req.body?.amountCents || req.body?.amount_cents,
      direction: req.body?.direction,
      externalReference: req.body?.externalReference || req.body?.external_reference,
      reason: req.body?.reason,
      metadata: req.body?.metadata,
    });
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function createAdminCurrencyQuote(req, res, next) {
  try {
    // Phase 7 (gap 9): quote creation is dual-approved. The live-rate
    // branch resolves the market rate at request time (as it does today)
    // and stores the concrete terms in the payload, so the checker
    // approves exactly the terms the maker saw.
    let payload;
    if (req.body?.useLiveRate === true) {
      const from = String(req.body?.sourceCurrency || req.body?.source_currency || '').toUpperCase();
      const to = String(req.body?.targetCurrency || req.body?.target_currency || '').toUpperCase();
      const sourceAmountCents = req.body?.sourceAmountCents ?? req.body?.source_amount_cents;
      const fx = await getFxQuote(from, to);
      payload = {
        sourceCurrencyCode: from,
        targetCurrencyCode: to,
        sourceAmountMinorUnits: sourceAmountCents,
        targetAmountMinorUnits: calculateQuotedTargetAmount({
          sourceAmountMinorUnits: sourceAmountCents,
          rateNumerator: fx.rateNumerator,
          rateDenominator: fx.rateDenominator,
          roundingMode: 'half_up',
        }),
        feeAmountMinorUnits: 0,
        rateNumerator: fx.rateNumerator,
        rateDenominator: fx.rateDenominator,
        roundingMode: 'half_up',
        provider: fx.provider,
        providerQuoteReference: `${fx.provider}:${from}:${to}:${fx.quotedAt}`,
        expiresAt: req.body?.expiresAt || req.body?.expires_at,
        customerId: req.body?.customerId || req.body?.customer_id,
        reason: req.body?.reason,
        metadata: { ...(req.body?.metadata || {}), fxProvider: fx.provider, fxQuotedAt: fx.quotedAt },
      };
    } else {
      payload = {
        sourceCurrencyCode: req.body?.sourceCurrencyCode || req.body?.source_currency_code,
        targetCurrencyCode: req.body?.targetCurrencyCode || req.body?.target_currency_code,
        sourceAmountMinorUnits: req.body?.sourceAmountMinorUnits || req.body?.source_amount_minor_units,
        targetAmountMinorUnits: req.body?.targetAmountMinorUnits || req.body?.target_amount_minor_units,
        feeAmountMinorUnits: req.body?.feeAmountMinorUnits ?? req.body?.fee_amount_minor_units ?? 0,
        rateNumerator: req.body?.rateNumerator || req.body?.rate_numerator,
        rateDenominator: req.body?.rateDenominator || req.body?.rate_denominator,
        roundingMode: req.body?.roundingMode || req.body?.rounding_mode || 'half_up',
        provider: req.body?.provider,
        providerQuoteReference: req.body?.providerQuoteReference || req.body?.provider_quote_reference,
        expiresAt: req.body?.expiresAt || req.body?.expires_at,
        customerId: req.body?.customerId || req.body?.customer_id,
        reason: req.body?.reason,
        metadata: req.body?.metadata,
      };
    }
    const result = await requestMoneyMovement(req, 'credit_currency_quote', payload);
    sendMoneyMovementResult(res, result);
  } catch (error) {
    next(error);
  }
}

async function getMyCurrencyQuote(req, res, next) {
  try {
    res.json(await getCurrencyQuote({ quoteId: req.params.quoteId, audience: 'customer' }));
  } catch (error) {
    next(error);
  }
}

async function getAdminCurrencyQuote(req, res, next) {
  try {
    res.json(await getCurrencyQuote({ quoteId: req.params.quoteId }));
  } catch (error) {
    next(error);
  }
}

async function listAdminCreditReconciliationRuns(req, res, next) {
  try {
    const result = await listReconciliationRuns({
      currencyCode: req.query.currencyCode || req.query.currency_code,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function downloadAdminCreditReconciliationRuns(req, res, next) {
  try {
    const options = {
      currencyCode: req.query.currencyCode || req.query.currency_code,
      status: req.query.status,
      limit: 250,
      offset: 0,
    };
    const runs = [];
    let page = await listReconciliationRuns(options);
    runs.push(...page.runs);
    while (page.pagination.hasMore && runs.length < MAX_ADMIN_CREDIT_EXPORT_ROWS) {
      page = await listReconciliationRuns({ ...options, offset: page.pagination.nextOffset || runs.length });
      runs.push(...page.runs);
    }
    if (page.pagination.hasMore) {
      throw new AppError('Credit reconciliation export is too large; narrow the filters first', 409, 'credit_reconciliation_export_too_large', {
        maxRows: MAX_ADMIN_CREDIT_EXPORT_ROWS,
      });
    }
    const headers = ['Run ID', 'Currency', 'Period start', 'Period end', 'Status', 'Account balance (cents)', 'Journal balance (cents)', 'Difference (cents)', 'Account count', 'Entry count', 'Error', 'Completed by', 'Started at', 'Completed at', 'Scope'];
    const lines = [headers.map(csvCell).join(',')];
    runs.forEach((run) => {
      lines.push([
        run.id,
        run.currencyCode,
        run.periodStart,
        run.periodEnd,
        run.status,
        run.accountBalanceCents,
        run.journalBalanceCents,
        run.differenceCents,
        run.accountCount,
        run.entryCount,
        run.errorMessage,
        run.completedBy,
        run.startedAt,
        run.completedAt,
        run.metadata?.scope || null,
      ].map(csvCell).join(','));
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oxsteed-credit-reconciliation-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`\ufeff${lines.join('\r\n')}\r\n`);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  formatCustomerCreditMutationResult,
  getMyAccount,
  convertMyCredit,
  getMyCreditLimits,
  getMyAccounts,
  getMyCreditStatus,
  listMyHolds,
  getEligiblePartners,
  getCustomerEligibility,
  getMyIdentityVerification,
  requestMyIdentityVerification,
  getMyTransactions,
  getMyStatement,
  downloadMyStatement,
  downloadAdminCustomerStatement,
  getMyTransaction,
  createMyHold,
  adminCaptureHold,
  releaseMyHold,
  transferMyCredit,
  openMyDispute,
  listMyDisputes,
  adminLoadCredit,
  adminAdjustCredit,
  refundAdminCredit,
  adminUpdateCreditAccountStatus,
  listAdminDisputes,
  downloadAdminCreditDisputes,
  resolveAdminDispute,
  requestAdminPendingAction,
  decideAdminPendingAction,
  listAdminPendingActions,
  getAdminOverview,
  retryAdminCreditNotification,
  getAdminCreditRail,
  updateAdminCreditRail,
  listAdminPartners,
  listAdminPartnerDirectory,
  downloadAdminPartners,
  listAdminCustomerAccounts,
  downloadAdminCustomerAccounts,
  getAdminCustomerAccount,
  getAdminCustomerEligiblePartners,
  listAdminTransactions,
  downloadAdminTransactions,
  getAdminTransaction,
  listAdminAgreements,
  downloadAdminAgreements,
  registerAdminPartner,
  transitionAdminPartner,
  createAdminAgreement,
  transitionAdminAgreement,
  upsertAdminEntitlement,
  bulkUpsertAdminEntitlements,
  listAdminEntitlements,
  downloadAdminEntitlements,
  listAdminSettlements,
  downloadAdminSettlements,
  listAdminCreditAuditEvents,
  downloadAdminCreditAuditEvents,
  createAdminSettlement,
  transitionAdminSettlement,
  reverseAdminSettlement,
  reconcileAdminCredit,
  getAdminPartnerLedger,
  recordAdminPartnerFunding,
  createAdminCurrencyQuote,
  getMyCurrencyQuote,
  getAdminCurrencyQuote,
  listAdminCreditReconciliationRuns,
  downloadAdminCreditReconciliationRuns,
  listAdminCreditExternalReconciliationRuns,
  runAdminCreditExternalReconciliation,
  getAdminComplianceQueue,
  decideAdminComplianceVerification,
  decideAdminComplianceSanction,
  transitionAdminComplianceCase,
  issueAdminStepupChallenge,
  freezeAdminCreditRail,
  unfreezeAdminCreditRail,
};
