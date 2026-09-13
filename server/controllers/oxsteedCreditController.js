'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const {
  getCustomerCreditAccount,
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
  getCustomerCreditTransaction,
  createCreditHold,
  captureCreditHold,
  releaseCreditHold,
  transferCredit,
  adjustCustomerCredit,
  updateCustomerCreditAccountStatus,
  openCreditDispute,
  listCreditDisputes,
  resolveCreditDispute,
  loadCustomerCredit,
  getCreditRailStatus,
  getCustomerCreditRailStatus,
  setCreditRailStatus,
  SUPPORTED_CREDIT_CURRENCIES,
  SUPPORTED_CREDIT_CURRENCY_META,
} = require('../services/oxsteedCreditService');
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
} = require('../services/oxsteedCreditAdminService');

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

async function getMyAccounts(req, res, next) {
  try {
    res.json({ accounts: await listCustomerCreditAccounts(req.user.id) });
  } catch (error) {
    next(error);
  }
}

async function getMyCreditStatus(req, res, next) {
  try {
    res.json({ credit: await getCustomerCreditRailStatus() });
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
    const result = await captureCreditHold({
      holdId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      idempotencyKey: getIdempotencyKey(req),
      actorUserId: req.user.id,
      actorType: 'admin',
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
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
      description: req.body?.description,
      reason: req.body?.reason,
      metadata: { source: 'super_admin_api', ...(req.body?.metadata || {}) },
    });
    if (result.expired) return res.status(409).json({ ...result, code: 'credit_hold_expired' });
    res.status(result.replayed ? 200 : 201).json(result);
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
    const result = await loadCustomerCredit({
      customerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      idempotencyKey: getIdempotencyKey(req),
      actorUserId: req.user.id,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
      reason: req.body?.reason,
      referenceType: 'admin_load',
      referenceId,
      metadata: { source: 'super_admin_api', fundingReference: referenceId },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function adminAdjustCredit(req, res, next) {
  try {
    const customerId = parseUuid(req.params.customerId, 'customerId');
    const direction = req.body?.direction;
    const referenceId = normalizeString(req.body?.referenceId || req.body?.reference_id, 160);
    if (direction === 'credit' && !referenceId) {
      throw new AppError('A funding reference is required for a positive administrative credit adjustment', 400, 'credit_funding_reference_required');
    }
    const result = await adjustCustomerCredit({
      customerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      direction,
      idempotencyKey: getIdempotencyKey(req),
      actorUserId: req.user.id,
      reason: req.body?.reason,
      referenceType: 'admin_adjustment',
      referenceId,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
      metadata: { source: 'super_admin_api', ...(req.body?.metadata || {}) },
    });
    res.status(result.replayed ? 200 : 201).json(result);
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
  } catch (error) {
    next(error);
  }
}

async function resolveAdminDispute(req, res, next) {
  try {
    const disputeId = parseUuid(req.params.disputeId, 'disputeId');
    const result = await resolveCreditDispute({ disputeId, status: req.body?.status, resolution: req.body?.resolution, actorUserId: req.user.id, requestIp: req.ip || null });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getAdminOverview(req, res, next) {
  try {
    const [summaryResult, partnersResult, recentResult] = await Promise.all([
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
      },
      summary: formatSummary(summary),
      summaryByCurrency: summaryResult.rows.map(formatSummary),
      partnerCounts,
      coverageAlerts,
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
    const result = await transitionSettlement({
      settlementId,
      targetStatus: req.body?.status || req.body?.targetStatus || req.body?.target_status,
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
  getMyAccounts,
  getMyCreditStatus,
  listMyHolds,
  getEligiblePartners,
  getMyTransactions,
  getMyStatement,
  downloadMyStatement,
  getMyTransaction,
  createMyHold,
  adminCaptureHold,
  releaseMyHold,
  transferMyCredit,
  openMyDispute,
  listMyDisputes,
  adminLoadCredit,
  adminAdjustCredit,
  adminUpdateCreditAccountStatus,
  listAdminDisputes,
  downloadAdminCreditDisputes,
  resolveAdminDispute,
  getAdminOverview,
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
  reconcileAdminCredit,
  listAdminCreditReconciliationRuns,
  downloadAdminCreditReconciliationRuns,
};
