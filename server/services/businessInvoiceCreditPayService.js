'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const {
  isInvoicePayer,
  stripeInvoiceCurrency,
  businessInvoiceCreditPayEnabled,
  PAYABLE_INVOICE_STATUSES,
  invoiceBalanceCents,
  round2,
} = require('../utils/businessInvoiceHelpers');
const creditService = require('./oxsteedCreditService');
const { isCreditRailEnabled } = creditService;
const {
  spendWithCreditInTransaction,
  resolveSpendParticipant,
} = require('./creditSpendAdapter');

const CREDIT_REFERENCE_TYPE = 'business_invoice';
const CREDIT_SURFACE = 'invoices';

async function legacyPartnerForBusiness(client, businessId) {
  if (!businessId) return null;
  const { rows } = await client.query(
    `SELECT p.id
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE p.business_id = $1
        AND p.status = 'active'
        AND fr.status = 'active'
      ORDER BY p.updated_at DESC NULLS LAST
      LIMIT 1`,
    [businessId],
  );
  return rows[0] || null;
}

/**
 * Resolve payee for a business/helper invoice. Prefers invoice_seller
 * participants; falls back to business/helper types and legacy business-linked
 * restaurant partners when credit_participants is not populated yet.
 */
async function resolveInvoiceParticipantRef(invoice, client = pool) {
  const db = client || pool;

  async function tryParticipant(type, subjectId) {
    if (subjectId === null || subjectId === undefined) return null;
    try {
      const resolved = await resolveSpendParticipant(
        db,
        { type, subjectId: String(subjectId) },
        CREDIT_SURFACE,
      );
      return {
        participantRef: { type, subjectId: String(subjectId) },
        partnerId: resolved.partnerId,
      };
    } catch (e) {
      if (e.code === 'credit_participant_not_found') return null;
      throw e;
    }
  }

  if (invoice.business_id) {
    for (const type of ['invoice_seller', 'business']) {
      const found = await tryParticipant(type, invoice.business_id);
      if (found) return found;
    }
    const legacy = await legacyPartnerForBusiness(db, invoice.business_id);
    if (legacy) {
      return {
        participantRef: { type: 'business', subjectId: String(invoice.business_id) },
        partnerId: legacy.id,
        legacyPartner: true,
      };
    }
  }

  const issuerUserId = invoice.user_id;
  if (issuerUserId) {
    for (const type of ['invoice_seller', 'helper']) {
      const found = await tryParticipant(type, issuerUserId);
      if (found) return found;
    }

    const { rows: bizRows } = await db.query(
      `SELECT b.id
         FROM businesses b
        WHERE b.is_active = TRUE
          AND (
            b.user_id = $1
            OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id
                 AND bm.member_id = $1
                 AND bm.status = 'active'
            )
          )
        ORDER BY b.is_primary DESC NULLS LAST, b.updated_at DESC NULLS LAST
        LIMIT 25`,
      [issuerUserId],
    );
    for (const row of bizRows) {
      for (const type of ['invoice_seller', 'business']) {
        const found = await tryParticipant(type, row.id);
        if (found) return found;
      }
      const legacy = await legacyPartnerForBusiness(db, row.id);
      if (legacy) {
        return {
          participantRef: { type: 'business', subjectId: String(row.id) },
          partnerId: legacy.id,
          legacyPartner: true,
        };
      }
    }
  }

  return null;
}

async function sumCreditPurchasesForInvoiceCents(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(t.amount_cents), 0)::bigint AS total
       FROM oxsteed_credit_transactions t
      WHERE t.reference_type = $1
        AND t.reference_id = $2
        AND t.transaction_type = 'purchase'`,
    [CREDIT_REFERENCE_TYPE, String(invoiceId)],
  );
  return Number(rows[0]?.total || 0);
}

async function syncInvoicePaidFromCreditLedger(client, invoiceId) {
  const creditPaidCents = await sumCreditPurchasesForInvoiceCents(client, invoiceId);
  const { rows: [locked] } = await client.query(
    `SELECT * FROM business_invoices WHERE id = $1 FOR UPDATE`,
    [invoiceId],
  );
  if (!locked) return null;

  const totalCents = Math.round(Number(locked.total || 0) * 100);
  const targetPaidCents = Math.min(totalCents, creditPaidCents);
  const targetPaid = round2(targetPaidCents / 100);
  const currentPaidCents = Math.round(Number(locked.amount_paid || 0) * 100);

  if (targetPaidCents <= currentPaidCents) {
    return locked;
  }

  const isFullyPaid = targetPaidCents >= totalCents - 1;
  const newStatus = isFullyPaid ? 'paid' : 'partial';

  const { rows: [updated] } = await client.query(
    `UPDATE business_invoices
        SET amount_paid = $1::numeric(12,2),
            status = $2::varchar(20),
            paid_at = CASE WHEN $2::varchar(20) = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
            updated_at = NOW()
      WHERE id = $3::bigint
      RETURNING *`,
    [targetPaid, newStatus, invoiceId],
  );
  return updated;
}

async function loadPayableInvoiceForPayer(invoiceId, user) {
  const { rows } = await pool.query(
    `SELECT bi.*, b.business_name
       FROM business_invoices bi
       LEFT JOIN businesses b ON b.id = bi.business_id
      WHERE bi.id = $1`,
    [invoiceId],
  );
  const invoice = rows[0] || null;
  if (!invoice || !isInvoicePayer(invoice, user)) return null;
  return invoice;
}

function launchGateReason() {
  if (!businessInvoiceCreditPayEnabled()) {
    return { eligible: false, code: 'invoice_credit_pay_disabled', reason: 'launch_hidden' };
  }
  return null;
}

async function evaluateInvoiceCreditEligibility(invoice, user) {
  const launch = launchGateReason();
  if (launch) return { eligible: false, ...launch };

  let railEnabled = false;
  try {
    railEnabled = await isCreditRailEnabled(pool);
  } catch {
    return { eligible: false, code: 'credit_rail_status_unavailable', reason: 'rail_unavailable' };
  }
  if (!railEnabled) {
    return { eligible: false, code: 'credit_rail_suspended', reason: 'rail_off' };
  }

  const status = String(invoice.status || '').toLowerCase();
  if (!PAYABLE_INVOICE_STATUSES.has(status)) {
    return { eligible: false, code: 'invoice_not_payable', reason: 'status' };
  }

  const balanceCents = invoiceBalanceCents(invoice);
  if (balanceCents <= 0) {
    return { eligible: false, code: 'invoice_already_paid', reason: 'paid' };
  }

  const currency = stripeInvoiceCurrency(invoice).toUpperCase();

  try {
    const resolved = await resolveInvoiceParticipantRef(invoice);
    if (!resolved) {
      return {
        eligible: false,
        code: 'credit_provider_not_eligible',
        reason: 'payee_not_enrolled',
        helperParticipantDeferred: !invoice.business_id,
      };
    }
    return {
      eligible: true,
      balanceCents,
      currency,
      partnerId: resolved.partnerId,
      legacyPartner: Boolean(resolved.legacyPartner),
      invoiceKind: invoice.business_id ? 'business' : 'helper',
    };
  } catch (err) {
    logger.warn('invoice_credit_eligibility_failed', {
      invoiceId: invoice.id,
      code: err.code,
      message: err.message,
    });
    return {
      eligible: false,
      code: err.code || 'credit_provider_not_eligible',
      reason: 'payee_not_eligible',
    };
  }
}

async function payBusinessInvoiceWithCredit({
  invoiceId,
  user,
  idempotencyKey,
  amountCents: requestedAmountCents,
  isImpersonated = false,
  requestIp = null,
}) {
  const launch = launchGateReason();
  if (launch) {
    throw new AppError('OxSteed Credit invoice payment is not available yet', 503, launch.code);
  }

  if (isImpersonated) {
    throw new AppError('Impersonated sessions cannot spend OxSteed Credit', 403, 'impersonation_blocked');
  }

  const invoice = await loadPayableInvoiceForPayer(invoiceId, user);
  if (!invoice) {
    throw new AppError('Invoice not found', 404, 'invoice_not_found');
  }

  const eligibility = await evaluateInvoiceCreditEligibility(invoice, user);
  if (!eligibility.eligible) {
    throw new AppError(
      'This invoice cannot be paid with OxSteed Credit',
      eligibility.code === 'credit_provider_not_eligible' ? 403 : 409,
      eligibility.code || 'invoice_credit_not_eligible',
      eligibility,
    );
  }

  const balanceCents = eligibility.balanceCents;
  let amountCents = balanceCents;
  if (requestedAmountCents !== undefined && requestedAmountCents !== null) {
    const parsed = Number(requestedAmountCents);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AppError('Amount must be a positive integer number of cents', 400, 'validation_failed');
    }
    if (parsed > balanceCents) {
      throw new AppError('Payment exceeds the remaining invoice balance', 400, 'amount_exceeds_balance');
    }
    amountCents = parsed;
  }

  const currency = eligibility.currency;
  const resolved = await resolveInvoiceParticipantRef(invoice);
  if (!resolved) {
    throw new AppError('Payee is not enrolled for OxSteed Credit', 403, 'credit_provider_not_eligible');
  }

  const normalizedKey = String(idempotencyKey || '').trim();
  if (!normalizedKey) {
    throw new AppError('Idempotency-Key is required', 400, 'credit_idempotency_key_required');
  }

  const correlationId = `invoice-credit-${normalizedKey}`.slice(0, 160);

  const spendBase = {
    customerId: user.id,
    amountCents,
    currency,
    referenceType: CREDIT_REFERENCE_TYPE,
    referenceId: String(invoice.id),
    idempotencyKey: normalizedKey,
    actorUserId: user.id,
    orderType: 'service',
    category: 'business_invoice',
    correlationId,
    requestIp,
    description: `Invoice ${invoice.invoice_number || invoice.id}`,
    metadata: {
      invoiceId: String(invoice.id),
      invoiceNumber: invoice.invoice_number || null,
      payerUserId: String(user.id),
      businessId: invoice.business_id || null,
      issuerUserId: invoice.user_id || null,
      partnerId: resolved.partnerId,
      legacyPartner: Boolean(resolved.legacyPartner),
      creditSpendSurface: CREDIT_SURFACE,
    },
  };

  const result = await withTransaction(
    pool,
    async (client) => {
      let spendResult;
      if (resolved.legacyPartner) {
        const purchase = await creditService.purchaseWithCreditInTransaction(client, {
          ...spendBase,
          partnerId: resolved.partnerId,
          currencyCode: currency,
          actorType: 'customer',
        });
        spendResult = { mode: 'debit', surface: CREDIT_SURFACE, partnerId: resolved.partnerId, purchase };
      } else {
        spendResult = await spendWithCreditInTransaction(client, {
          participantRef: resolved.participantRef,
          ...spendBase,
          currency,
          surface: CREDIT_SURFACE,
          isImpersonated: false,
        });
      }

      const updatedInvoice = await syncInvoicePaidFromCreditLedger(client, invoice.id);
      return { spendResult, invoice: updatedInvoice };
    },
    'business_invoice_credit_pay',
  );

  return {
    invoice: result.invoice,
    amountCents,
    currency,
    creditTransactionId:
      result.spendResult?.purchase?.transaction?.id != null
        ? String(result.spendResult.purchase.transaction.id)
        : null,
    idempotencyKey: normalizedKey,
    replayed: Boolean(result.spendResult?.purchase?.replayed),
  };
}

module.exports = {
  CREDIT_REFERENCE_TYPE,
  CREDIT_SURFACE,
  resolveInvoiceParticipantRef,
  evaluateInvoiceCreditEligibility,
  payBusinessInvoiceWithCredit,
  syncInvoicePaidFromCreditLedger,
  loadPayableInvoiceForPayer,
};
