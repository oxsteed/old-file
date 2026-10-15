'use strict';
/**
 * OxSteed Logistics — Phase 3 quote lifecycle + buyer checkout context.
 *
 * Owns the versioned buyer-quote lifecycle that gates every installment
 * collection:
 *   - Staff create a draft quote version (POST /finance/quotes).
 *   - Staff publish the draft (POST /finance/quotes/:id/publish): the new
 *     version becomes 'active' (awaiting buyer acceptance); old versions
 *     are never mutated, and a previously 'accepted' version stays as
 *     immutable history with its collected payments.
 *   - The buyer explicitly accepts the pending version
 *     (POST /finance/quotes/:id/accept); accepted_at + accepted_by are
 *     recorded. Payment collection requires the LATEST version to be
 *     accepted (see logisticsPaymentService.assertQuoteCollectible), so a
 *     new or increased quote can never be collected silently.
 *   - GET /finance/checkout-context assembles the order/campaign, the
 *     actionable quote (itemized costs, payment schedule with paid /
 *     outstanding amounts in integer cents, deadlines, cancellation
 *     terms), and the available payment methods.
 *   - GET /finance/payment-history lists the buyer's own attempts.
 *
 * Money rules (fail closed):
 *   - Integer minor units everywhere; USD only. The client never computes
 *     amounts; the server derives deposit/final from the quote totals.
 *   - Acceptance is a state transition on the published version only;
 *     concurrent accepts converge on one winner via a guarded UPDATE.
 *   - Never alter already-posted transactions: quote revisions never
 *     rewrite paid amounts (paid cents live on the subject rows).
 *   - All endpoints using this module sit behind LOGISTICS_PAYMENTS_ENABLED.
 */
const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const {
  publicAttempt,
  assertBuyerOwnsSubject,
} = require('./logisticsPaymentService');

const SUBJECT_TYPES = new Set(['purchase_order', 'pooled_participant']);
const QUOTE_STATUSES = new Set(['draft', 'active', 'accepted', 'rejected', 'superseded', 'expired']);

/** Spec default: 30% deposit unless the approved quote says otherwise. */
const DEFAULT_DEPOSIT_PCT = 0.3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function quoteReference() {
  return `LQ-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function toInt(value, { min = 0, field = 'value' } = {}) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) {
    throw new AppError(`${field} must be an integer >= ${min}`, 400, 'validation_failed');
  }
  return n;
}

function parseOptionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${field} must be a valid date`, 400, 'validation_failed');
  }
  return d.toISOString();
}

function normalizeSubjectInput({ subjectType, purchaseOrderId, participantId }) {
  if (!SUBJECT_TYPES.has(subjectType)) {
    throw new AppError('subject_type must be purchase_order or pooled_participant', 400, 'validation_failed');
  }
  const poId = subjectType === 'purchase_order' ? toInt(purchaseOrderId, { min: 1, field: 'purchase_order_id' }) : null;
  const partId = subjectType === 'pooled_participant' ? toInt(participantId, { min: 1, field: 'participant_id' }) : null;
  return { subjectType, purchaseOrderId: poId, participantId: partId };
}

// ─── Subject resolution (display + ownership) ─────────────────

async function loadSubjectDetail(client, subject) {
  if (subject.subjectType === 'purchase_order') {
    const { rows } = await client.query(
      `SELECT po.id, po.reference, po.status, po.qty_ordered,
              po.expected_arrival_date, po.buyer_user_id,
              po.deposit_paid_cents, po.final_paid_cents,
              l.name AS lane_name,
              sp.company_name AS supplier_name,
              sprod.title AS product_title
         FROM purchase_orders po
         LEFT JOIN logistics_lanes l ON l.id = po.lane_id
         LEFT JOIN supplier_profiles sp ON sp.id = po.supplier_id
         LEFT JOIN supplier_products sprod ON sprod.id = po.supplier_product_id
        WHERE po.id = $1`,
      [subject.purchaseOrderId]
    );
    const po = rows[0];
    if (!po) throw new AppError('Purchase order not found', 404, 'not_found');
    return {
      kind: 'purchase_order',
      id: po.id,
      reference: po.reference,
      title: po.product_title || `Purchase order ${po.reference}`,
      qty: po.qty_ordered,
      lane_name: po.lane_name,
      supplier_name: po.supplier_name,
      expected_arrival_date: po.expected_arrival_date,
      status: po.status,
      ownerUserId: po.buyer_user_id,
      depositPaidCents: Number(po.deposit_paid_cents || 0),
      finalPaidCents: Number(po.final_paid_cents || 0),
    };
  }
  const { rows } = await client.query(
    `SELECT part.id, part.user_id, part.committed_qty, part.status,
            part.deposit_paid_cents, part.final_paid_cents,
            pord.reference AS campaign_reference, pord.title,
            pord.expected_arrival_date,
            l.name AS lane_name
       FROM pooled_order_participants part
       JOIN pooled_orders pord ON pord.id = part.pooled_order_id
       LEFT JOIN logistics_lanes l ON l.id = pord.lane_id
      WHERE part.id = $1`,
    [subject.participantId]
  );
  const part = rows[0];
  if (!part) throw new AppError('Participation not found', 404, 'not_found');
  return {
    kind: 'pooled_participant',
    id: part.id,
    reference: part.campaign_reference,
    title: part.title,
    qty: part.committed_qty,
    lane_name: part.lane_name,
    supplier_name: null,
    expected_arrival_date: part.expected_arrival_date,
    status: part.status,
    ownerUserId: part.user_id,
    depositPaidCents: Number(part.deposit_paid_cents || 0),
    finalPaidCents: Number(part.final_paid_cents || 0),
  };
}

// ─── Quote reads ──────────────────────────────────────────────

function quoteWhere(subject) {
  return {
    text: `subject_type = $1
        AND (
          ($2::int IS NOT NULL AND purchase_order_id = $2)
          OR
          ($3::int IS NOT NULL AND participant_id = $3)
        )`,
    params: [subject.subjectType, subject.purchaseOrderId, subject.participantId],
  };
}

async function getLatestQuote(client, subject) {
  const w = quoteWhere(subject);
  const { rows } = await client.query(
    `SELECT * FROM logistics_buyer_quotes WHERE ${w.text} ORDER BY version DESC LIMIT 1`,
    w.params
  );
  return rows[0] || null;
}

async function getAcceptedQuote(client, subject) {
  const w = quoteWhere(subject);
  const { rows } = await client.query(
    `SELECT * FROM logistics_buyer_quotes WHERE ${w.text} AND status = 'accepted' ORDER BY version DESC LIMIT 1`,
    w.params
  );
  return rows[0] || null;
}

async function getInflightInstallments(client, subject) {
  const w = quoteWhere(subject);
  const { rows } = await client.query(
    `SELECT DISTINCT installment FROM logistics_payment_attempts
      WHERE subject_type = $1
        AND (
          ($2::int IS NOT NULL AND purchase_order_id = $2)
          OR
          ($3::int IS NOT NULL AND participant_id = $3)
        )
        AND status IN ('pending', 'processing')`,
    w.params
  );
  const set = new Set();
  for (const r of rows) set.add(r.installment);
  return set;
}

function publicQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    version: row.version,
    status: row.status,
    accepted_at: row.accepted_at,
    valid_until: row.valid_until,
    currency: row.currency,
    line_items: row.line_items || [],
    subtotal_cents: Number(row.subtotal_cents),
    fees_cents: Number(row.fees_cents),
    tax_cents: Number(row.tax_cents),
    total_cents: Number(row.total_cents),
    deposit_cents: Number(row.deposit_cents),
    final_cents: Number(row.final_cents),
    deposit_pct: row.deposit_pct === null || row.deposit_pct === undefined ? null : Number(row.deposit_pct),
    deposit_due_at: row.deposit_due_at,
    final_due_at: row.final_due_at,
    cancellation_terms: row.cancellation_terms,
    created_at: row.created_at,
  };
}

function buildSchedule(quote, { depositPaidCents, finalPaidCents }, inflight) {
  const legs = [
    { installment: 'deposit', due: Number(quote.deposit_cents), paid: depositPaidCents, due_at: quote.deposit_due_at },
    { installment: 'final', due: Number(quote.final_cents), paid: finalPaidCents, due_at: quote.final_due_at },
  ];
  return legs
    .filter((leg) => leg.due > 0)
    .map((leg) => ({
      installment: leg.installment,
      amount_cents: leg.due,
      paid_cents: leg.paid,
      outstanding_cents: Math.max(0, leg.due - leg.paid),
      status: leg.paid >= leg.due
        ? 'settled'
        : inflight.has(leg.installment)
          ? 'processing'
          : 'unpaid',
      due_at: leg.due_at,
    }));
}

function diffLineItems(previousItems, nextItems) {
  const prev = new Map();
  for (const item of previousItems || []) {
    prev.set(String(item.label), Number(item.amount_cents) || 0);
  }
  const next = new Map();
  for (const item of nextItems || []) {
    next.set(String(item.label), Number(item.amount_cents) || 0);
  }
  const changes = [];
  for (const [label, current] of next) {
    if (!prev.has(label)) {
      changes.push({ label, kind: 'added', previous_cents: null, current_cents: current });
    } else if (prev.get(label) !== current) {
      changes.push({ label, kind: 'changed', previous_cents: prev.get(label), current_cents: current });
    }
  }
  for (const [label, previous] of prev) {
    if (!next.has(label)) {
      changes.push({ label, kind: 'removed', previous_cents: previous, current_cents: null });
    }
  }
  return changes;
}

function buildPendingVersion(pending, accepted) {
  const prevTotal = accepted ? Number(accepted.total_cents) : 0;
  return {
    id: pending.id,
    version: pending.version,
    line_items: pending.line_items || [],
    total_cents: Number(pending.total_cents),
    vs_version: accepted ? accepted.version : null,
    changes: diffLineItems(accepted ? accepted.line_items : [], pending.line_items),
    total_delta_cents: Number(pending.total_cents) - prevTotal,
  };
}

// ─── Checkout context ─────────────────────────────────────────

async function getCheckoutContext(userId, { orderId, participantId, isStaff = false } = {}) {
  const poId = orderId === undefined || orderId === null || orderId === ''
    ? null : toInt(orderId, { min: 1, field: 'orderId' });
  const partId = participantId === undefined || participantId === null || participantId === ''
    ? null : toInt(participantId, { min: 1, field: 'participantId' });
  if ((poId && partId) || (!poId && !partId)) {
    throw new AppError('Provide exactly one of orderId or participantId', 400, 'validation_failed');
  }
  const subject = poId
    ? { subjectType: 'purchase_order', purchaseOrderId: poId, participantId: null }
    : { subjectType: 'pooled_participant', purchaseOrderId: null, participantId: partId };

  // Ownership: the buyer (or a business member) sees their own checkout;
  // staff may preview any checkout for support.
  try {
    await assertBuyerOwnsSubject(db, userId, subject);
  } catch (err) {
    if (!isStaff || err.statusCode === 404) throw err;
    // Staff preview of another buyer's subject: fall through.
  }

  const detail = await loadSubjectDetail(db, subject);
  const {rows: activeAttempts}=await db.query(`SELECT * FROM logistics_payment_attempts
    WHERE subject_type=$1 AND purchase_order_id IS NOT DISTINCT FROM $2::int
    AND participant_id IS NOT DISTINCT FROM $3::int AND status IN ('pending','processing') ORDER BY id`,
    [subject.subjectType,subject.purchaseOrderId||null,subject.participantId||null]);
  detail.depositPaidCents=Math.max(0,detail.depositPaidCents-await require('./logisticsPaymentBalance').refundedCents(db,subject,'deposit'));
  detail.finalPaidCents=Math.max(0,detail.finalPaidCents-await require('./logisticsPaymentBalance').refundedCents(db,subject,'final'));
  const latest = await getLatestQuote(db, subject);
  const accepted = await getAcceptedQuote(db, subject);

  // The actionable quote: a published ('active') newer version needs
  // acceptance before any payment; otherwise the accepted version is the
  // collectible truth. A bare draft (or no quote at all) means there is
  // nothing to pay against yet.
  let quote = null;
  let pendingVersion = null;
  if (latest && latest.status === 'active' && (!accepted || accepted.version < latest.version)) {
    quote = publicQuote(latest);
    pendingVersion = buildPendingVersion(latest, accepted);
  } else if (accepted) {
    // Note: when the latest version itself is 'accepted', it IS the
    // accepted row, so this branch covers it.
    quote = publicQuote(accepted);
  }

  let schedule = [];
  if (quote) {
    const inflight = await getInflightInstallments(db, subject);
    schedule = buildSchedule(quote, detail, inflight);
    quote.schedule = schedule;
    quote.pending_version = pendingVersion;
  }

  // Payment methods: Stripe is available when the secret key is
  // configured; Credit availability comes from the Credit workstream's
  // read-only probe (rail, freeze, participant gates). There is currently
  // no per-user balance probe, so balance_cents is null ("unknown") and
  // the client must not treat it as zero; the server enforces balance at
  // execution time.
  let creditAvailability;
  try {
    // Lazy require: the Credit workstream owns this module.
    const { getLogisticsCreditPayAvailability } = require('./logisticsCreditPayService');
    creditAvailability = await getLogisticsCreditPayAvailability();
  } catch (err) {
    logger.warn('[logistics-quotes] credit availability probe failed', { error: err.message });
    creditAvailability = { available: false, code: 'credit_availability_unavailable' };
  }
  const credit = {
    rail_enabled: creditAvailability.available === true,
    eligible: creditAvailability.available === true,
    balance_cents: null,
    code: creditAvailability.code || null,
  };

  return {
    active_attempts: activeAttempts.map(publicAttempt),
    subject: {
      kind: detail.kind,
      id: detail.id,
      reference: detail.reference,
      title: detail.title,
      qty: detail.qty,
      lane_name: detail.lane_name,
      supplier_name: detail.supplier_name,
      expected_arrival_date: detail.expected_arrival_date,
      status: detail.status,
    },
    quote,
    credit,
    methods: {
      stripe: { enabled: Boolean(process.env.STRIPE_SECRET_KEY) },
      credit,
    },
    return_label: detail.reference || detail.title,
  };
}

// ─── Quote creation (staff) ───────────────────────────────────

function validateLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new AppError('line_items must be a non-empty array', 400, 'validation_failed');
  }
  if (lineItems.length > 200) {
    throw new AppError('line_items is limited to 200 entries', 400, 'validation_failed');
  }
  return lineItems.map((item, idx) => {
    const label = item && typeof item.label === 'string' ? item.label.trim() : '';
    if (!label || label.length > 200) {
      throw new AppError(`line_items[${idx}].label must be 1-200 characters`, 400, 'validation_failed');
    }
    return {
      label,
      amount_cents: toInt(item.amount_cents, { min: 0, field: `line_items[${idx}].amount_cents` }),
    };
  });
}

async function createQuote(staffUserId, body = {}) {
  const subject = normalizeSubjectInput({
    subjectType: body.subject_type,
    purchaseOrderId: body.purchase_order_id,
    participantId: body.participant_id,
  });
  const lineItems = validateLineItems(body.line_items);
  const feesCents = body.fees_cents === undefined || body.fees_cents === null
    ? 0 : toInt(body.fees_cents, { min: 0, field: 'fees_cents' });
  const taxCents = body.tax_cents === undefined || body.tax_cents === null
    ? 0 : toInt(body.tax_cents, { min: 0, field: 'tax_cents' });
  let depositPct = DEFAULT_DEPOSIT_PCT;
  if (body.deposit_pct !== undefined && body.deposit_pct !== null && body.deposit_pct !== '') {
    depositPct = Number(body.deposit_pct);
    if (!Number.isFinite(depositPct) || depositPct <= 0 || depositPct > 1) {
      throw new AppError('deposit_pct must be a number in (0, 1]', 400, 'validation_failed');
    }
    // NUMERIC(5,4): keep 4 decimal places.
    depositPct = Math.round(depositPct * 10000) / 10000;
  }
  const subtotalCents = lineItems.reduce((sum, i) => sum + i.amount_cents, 0);
  const totalCents = subtotalCents + feesCents + taxCents;
  if (totalCents <= 0) {
    throw new AppError('Quote total must be greater than zero', 400, 'validation_failed');
  }
  // Integer math only: deposit rounds to the cent, final takes the rest,
  // so deposit + final === total exactly (matches the table CHECK).
  const depositCents = Math.round(totalCents * depositPct);
  const finalCents = totalCents - depositCents;
  const depositDueAt = parseOptionalDate(body.deposit_due_at, 'deposit_due_at');
  const finalDueAt = parseOptionalDate(body.final_due_at, 'final_due_at');
  const validUntil = parseOptionalDate(body.valid_until, 'valid_until');
  const cancellationTerms = body.cancellation_terms === undefined || body.cancellation_terms === null
    ? null : String(body.cancellation_terms).slice(0, 5000);

  return withTransaction(db, async (client) => {
    // The subject must exist before a quote can reference it.
    await loadSubjectDetail(client, subject);

    const w = quoteWhere(subject);
    // One retry on version races: two staff publishing at once converge
    // on distinct versions via the subject/version unique index.
    let attemptNo = 0;
    for (;;) {
      attemptNo += 1;
      const { rows: maxRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS max_version FROM logistics_buyer_quotes WHERE ${w.text}`,
        w.params
      );
      const version = Number(maxRows[0].max_version) + 1;
      const reference = quoteReference();
      try {
        const { rows } = await client.query(
          `INSERT INTO logistics_buyer_quotes
             (reference, subject_type, purchase_order_id, participant_id,
              version, status, currency, line_items,
              subtotal_cents, fees_cents, tax_cents, total_cents,
              deposit_cents, final_cents, deposit_pct,
              deposit_due_at, final_due_at, cancellation_terms, valid_until,
              created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,'draft','USD',$6::jsonb,
                   $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING *`,
          [
            reference, subject.subjectType, subject.purchaseOrderId, subject.participantId,
            version, JSON.stringify(lineItems),
            subtotalCents, feesCents, taxCents, totalCents,
            depositCents, finalCents, depositPct,
            depositDueAt, finalDueAt, cancellationTerms, validUntil,
            staffUserId,
          ]
        );
        const created = rows[0];
        logger.info('[logistics-quotes] draft quote created', {
          quoteId: created.id, reference, version, subjectType: subject.subjectType,
        });
        return publicQuote(created);
      } catch (err) {
        if (err && err.code === '23505' && attemptNo < 3) continue;
        throw err;
      }
    }
  }, 'logistics_create_quote');
}

// ─── Quote publication (staff) ─────────────────────────────────

function notifyQuoteEvent({ userId, type, title, body, data, actionUrl, idempotencyKey }) {
  // Best-effort, after the money-adjacent state is committed.
  setImmediate(() => {
    const { sendNotification } = require('./notificationService');
    sendNotification({
      userId, type, title, body, data, action_url: actionUrl, idempotencyKey,
    }).catch((err) => logger.warn('[logistics-quotes] quote notification failed', {
      userId, type, error: err.message,
    }));
  });
}

function checkoutUrlFor(subject) {
  return subject.subjectType === 'purchase_order'
    ? `/logistics/checkout?purchase_order_id=${subject.purchaseOrderId}`
    : `/logistics/checkout?participant_id=${subject.participantId}`;
}

async function publishQuote(staffUserId, quoteId) {
  const id = toInt(quoteId, { min: 1, field: 'quote id' });
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM logistics_buyer_quotes WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const quote = rows[0];
    if (!quote) throw new AppError('Quote not found', 404, 'not_found');
    if (quote.status !== 'draft') {
      throw new AppError(
        `Quote ${quote.reference} v${quote.version} is ${quote.status}; only drafts can be published`,
        409,
        'quote_not_draft'
      );
    }
    const subject = {
      subjectType: quote.subject_type,
      purchaseOrderId: quote.purchase_order_id,
      participantId: quote.participant_id,
    };
    const table=subject.subjectType==='purchase_order'?'purchase_orders':'pooled_order_participants';
    await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[subject.purchaseOrderId||subject.participantId]);
    const inflight=await getInflightInstallments(client,subject);
    if(inflight.size) throw new AppError('Finish the pending payment before publishing a revised quote',409,'payment_in_progress');
    // Fail closed: a draft that is no longer the newest version for its
    // subject can never be published over the newer one.
    const w = quoteWhere(subject);
    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM logistics_buyer_quotes WHERE ${w.text}`,
      w.params
    );
    if (Number(maxRows[0].max_version) !== quote.version) {
      throw new AppError(
        `Quote ${quote.reference} v${quote.version} is not the latest version and cannot be published`,
        409,
        'quote_not_latest'
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE logistics_buyer_quotes
          SET status = 'active', updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );
    // Retire any other still-'active' version for this subject. Previously
    // 'accepted' versions are deliberately left untouched: they are the
    // immutable record of what the buyer agreed to (and paid against).
    await client.query(
      `UPDATE logistics_buyer_quotes
          SET status = 'superseded', updated_at = NOW()
        WHERE id <> $1
          AND subject_type = $2
          AND (
            ($3::int IS NOT NULL AND purchase_order_id = $3)
            OR
            ($4::int IS NOT NULL AND participant_id = $4)
          )
          AND status = 'active'`,
      [id, subject.subjectType, subject.purchaseOrderId, subject.participantId]
    );

    const detail = await loadSubjectDetail(client, subject);
    logger.info('[logistics-quotes] quote published', {
      quoteId: id, version: quote.version, subjectType: subject.subjectType,
    });

    if (detail.ownerUserId) {
      notifyQuoteEvent({
        userId: detail.ownerUserId,
        type: 'logistics:quote_published',
        title: 'New quote needs your acceptance',
        body: `Version ${quote.version} of your logistics quote (${quote.reference}) is ready. Review and accept it before paying.`,
        data: { quote_id: id, version: quote.version, reference: quote.reference },
        actionUrl: checkoutUrlFor(subject),
        idempotencyKey: `logistics:quote:published:${id}`,
      });
    }
    const published = publicQuote(updated[0]);
    published.pending_version = buildPendingVersion(quote, null);
    return published;
  }, 'logistics_publish_quote');
}

// ─── Quote acceptance (buyer) ──────────────────────────────────

async function acceptQuote(userId, quoteId, { idempotencyKey } = {}) {
  const id = toInt(quoteId, { min: 1, field: 'quote id' });
  if (!idempotencyKey || !UUID_RE.test(String(idempotencyKey))) {
    throw new AppError('idempotency_key must be a client-generated UUID', 400, 'validation_failed');
  }

  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM logistics_buyer_quotes WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const quote = rows[0];
    if (!quote) throw new AppError('Quote not found', 404, 'not_found');

    const subject = {
      subjectType: quote.subject_type,
      purchaseOrderId: quote.purchase_order_id,
      participantId: quote.participant_id,
    };
    // Only the buyer who owns the subject may accept its quote.
    await assertBuyerOwnsSubject(client, userId, subject);

    // Acceptance targets the newest version only: accepting a stale
    // version is rejected, never silently applied to the new one.
    const w = quoteWhere(subject);
    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM logistics_buyer_quotes WHERE ${w.text}`,
      w.params
    );
    if (Number(maxRows[0].max_version) !== quote.version) {
      throw new AppError(
        `Quote ${quote.reference} v${quote.version} was superseded by a newer version; review the latest version before accepting`,
        409,
        'quote_superseded'
      );
    }

    // Idempotent: the same buyer accepting twice converges on the single
    // accepted row (covers double-click retries with a fresh key).
    if (quote.status === 'accepted') {
      if (String(quote.accepted_by_user_id) === String(userId)) {
        logger.info('[logistics-quotes] idempotent quote acceptance replay', { quoteId: id });
        const acceptedQuote = publicQuote(quote);
        acceptedQuote.pending_version = null;
        return { quote: acceptedQuote, idempotentReplay: true };
      }
      throw new AppError('This quote was already accepted', 409, 'quote_already_accepted');
    }
    if (quote.status !== 'active') {
      const code = quote.status === 'draft' ? 'quote_not_published'
        : quote.status === 'expired' ? 'quote_expired'
        : 'quote_not_acceptable';
      throw new AppError(
        `Quote ${quote.reference} v${quote.version} cannot be accepted while ${quote.status}`,
        409,
        code
      );
    }
    if (quote.valid_until && new Date(quote.valid_until).getTime() < Date.now()) {
      throw new AppError(
        `Quote ${quote.reference} v${quote.version} expired on ${quote.valid_until}`,
        409,
        'quote_expired'
      );
    }

    // Guarded transition: exactly one concurrent accept wins; the loser
    // re-reads and converges via the idempotent branch above.
    const { rows: won } = await client.query(
      `UPDATE logistics_buyer_quotes
          SET status = 'accepted', accepted_at = NOW(),
              accepted_by_user_id = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [id, userId]
    );
    if (!won.length) {
      const { rows: reread } = await client.query(
        `SELECT * FROM logistics_buyer_quotes WHERE id = $1`, [id]
      );
      const current = reread[0];
      if (current && current.status === 'accepted'
          && String(current.accepted_by_user_id) === String(userId)) {
        const acceptedQuote = publicQuote(current);
        acceptedQuote.pending_version = null;
        return { quote: acceptedQuote, idempotentReplay: true };
      }
      throw new AppError('Quote acceptance raced; please reload and try again', 409, 'quote_accept_conflict');
    }

    const detail = await loadSubjectDetail(client, subject);
    logger.info('[logistics-quotes] quote accepted', {
      quoteId: id, version: quote.version, acceptedBy: userId,
    });
    if (quote.created_by_user_id && String(quote.created_by_user_id) !== String(userId)) {
      notifyQuoteEvent({
        userId: quote.created_by_user_id,
        type: 'logistics:quote_accepted',
        title: 'Buyer accepted a logistics quote',
        body: `The buyer accepted quote ${quote.reference} v${quote.version}. Installments can now be collected against it.`,
        data: { quote_id: id, version: quote.version, reference: quote.reference },
        actionUrl: checkoutUrlFor(subject),
        idempotencyKey: `logistics:quote:accepted:${id}`,
      });
    }

    const acceptedQuote = publicQuote(won[0]);
    acceptedQuote.pending_version = null;
    return { quote: acceptedQuote, idempotentReplay: false };
  }, 'logistics_accept_quote');
}

// ─── Buyer payment history ────────────────────────────────────

async function getPaymentHistory(userId, { limit = 50, offset = 0, subjectType, purchaseOrderId, participantId } = {}) {
  const params = [userId];
  const where = ['buyer_user_id = $1'];
  if (subjectType) {
    if (!SUBJECT_TYPES.has(subjectType)) {
      throw new AppError('subject_type must be purchase_order or pooled_participant', 400, 'validation_failed');
    }
    params.push(subjectType);
    where.push(`subject_type = $${params.length}`);
  }
  if (purchaseOrderId !== undefined && purchaseOrderId !== null && purchaseOrderId !== '') {
    params.push(toInt(purchaseOrderId, { min: 1, field: 'purchase_order_id' }));
    where.push(`purchase_order_id = $${params.length}`);
  }
  if (participantId !== undefined && participantId !== null && participantId !== '') {
    params.push(toInt(participantId, { min: 1, field: 'participant_id' }));
    where.push(`participant_id = $${params.length}`);
  }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await db.query(
    `SELECT * FROM logistics_payment_attempts
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM logistics_payment_attempts WHERE ${where.join(' AND ')}`,
    params
  );
  return {
    attempts: rows.map(publicAttempt),
    total: countRows[0] ? countRows[0].total : 0,
    limit: lim,
    offset: off,
  };
}

module.exports = {
  getCheckoutContext,
  createQuote,
  publishQuote,
  acceptQuote,
  getPaymentHistory,
  // exposed for tests
  publicQuote,
  buildSchedule,
  diffLineItems,
};

module.exports.listStaffQuotes=async (input)=>{
 const subject=normalizeSubjectInput({subjectType:input.subject_type,purchaseOrderId:input.purchase_order_id,participantId:input.participant_id});
 const w=quoteWhere(subject);const {rows}=await db.query(`SELECT * FROM logistics_buyer_quotes WHERE ${w.text} ORDER BY version DESC LIMIT 50`,w.params);
 return rows.map(publicQuote);
};
