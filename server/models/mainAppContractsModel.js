'use strict';

const pool = require('../db');

const PAYOUT_MINIMUM_CENTS = 1000;

function normalizeCurrency(value) {
  return String(value || 'USD').trim().toUpperCase().slice(0, 3);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = String(value.url || value.href || '').trim();
  if (!url) return null;
  return {
    url,
    key: value.key || null,
    name: value.name || value.filename || null,
    type: value.type || value.mimeType || null,
    sizeBytes: Number.isFinite(Number(value.sizeBytes ?? value.size_bytes ?? value.size)) ? Number(value.sizeBytes ?? value.size_bytes ?? value.size) : null,
  };
}

function serializePayoutRequest(row) {
  return {
    id: String(row.id),
    amountCents: Number(row.amount_cents || 0),
    currencyCode: normalizeCurrency(row.currency_code),
    payoutMethod: row.payout_method,
    status: row.status,
    note: row.note || null,
    externalPayoutId: row.external_payout_id || null,
    ledgerEntryId: row.ledger_entry_id ? String(row.ledger_entry_id) : null,
    requestedAt: toIso(row.requested_at),
    processedAt: toIso(row.processed_at),
    cancelledAt: toIso(row.cancelled_at),
  };
}

function serializePaymentRequest(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  const clientMetadata = metadata.clientMetadata && typeof metadata.clientMetadata === 'object' && !Array.isArray(metadata.clientMetadata)
    ? metadata.clientMetadata
    : {};
  const proofAttachment = normalizeAttachment(metadata.proofAttachment) || normalizeAttachment(clientMetadata.proofAttachment);
  const proofLink = metadata.proofLink || clientMetadata.proofLink || proofAttachment?.url || null;
  return {
    id: String(row.id),
    sourceType: row.source_type,
    sourceId: row.source_id || null,
    payerId: row.payer_id ? String(row.payer_id) : null,
    payeeId: row.payee_id ? String(row.payee_id) : null,
    businessId: row.business_id === null || row.business_id === undefined ? null : Number(row.business_id),
    amountCents: Number(row.amount_cents || 0),
    currencyCode: normalizeCurrency(row.currency_code),
    status: row.status,
    settlementMode: row.settlement_mode,
    externalProvider: row.external_provider || null,
    processorPaymentId: row.processor_payment_id || null,
    description: row.description || null,
    idempotencyKey: row.idempotency_key || null,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metadata,
    confirmationCode: metadata.confirmationCode || clientMetadata.confirmationCode || null,
    proofLink,
    proofAttachment,
    proofSubmittedAt: toIso(metadata.proofSubmittedAt),
    proofSubmittedByUserId: metadata.proofSubmittedByUserId ? String(metadata.proofSubmittedByUserId) : null,
    confirmationNote: metadata.confirmationNote || metadata.note || clientMetadata.confirmationNote || clientMetadata.note || null,
    confirmedAt: toIso(metadata.confirmedAt),
    confirmedByUserId: metadata.confirmedByUserId ? String(metadata.confirmedByUserId) : null,
  };
}

function serializeServicePackage(row) {
  const services = Array.isArray(row.services) ? row.services : [];
  return {
    id: String(row.id),
    businessId: Number(row.business_id),
    name: row.name,
    description: row.description || null,
    serviceId: row.service_id ? String(row.service_id) : null,
    services,
    sessionCount: Number(row.total_sessions ?? row.session_count ?? 1),
    priceCents: Number(row.price_cents || 0),
    originalPriceCents: row.original_price_cents === null || row.original_price_cents === undefined ? null : Number(row.original_price_cents),
    validityDays: Number(row.validity_days ?? row.valid_days ?? 365),
    sortOrder: Number(row.sort_order || 0),
    isActive: row.is_active !== false,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function getPayoutBalances(userId) {
  const { rows } = await pool.query(
    `WITH job_earnings AS (
       SELECT COALESCE(SUM(CASE
                WHEN payout_status IN ('earned', 'not_ready')
                THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)
                ELSE 0
              END), 0)::bigint AS earned_cents,
              COALESCE(SUM(CASE
                WHEN payout_status IN ('pending', 'processing')
                THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)
                ELSE 0
              END), 0)::bigint AS job_pending_cents,
              COALESCE(SUM(CASE
                WHEN payout_status = 'paid'
                THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)
                ELSE 0
              END), 0)::bigint AS paid_cents,
              COALESCE(MAX(currency_code), 'USD') AS currency_code
         FROM jobs
        WHERE assigned_helper_id = $1
          AND status = 'completed'
     ),
     request_totals AS (
       SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('pending', 'processing')), 0)::bigint AS requested_cents
         FROM main_app_payout_requests
        WHERE user_id = $1
     )
     SELECT job_earnings.earned_cents,
            job_earnings.job_pending_cents,
            job_earnings.paid_cents,
            request_totals.requested_cents,
            GREATEST(job_earnings.earned_cents - request_totals.requested_cents, 0)::bigint AS available_cents,
            job_earnings.currency_code
       FROM job_earnings, request_totals`,
    [userId]
  );
  return rows[0] || {
    earned_cents: 0,
    job_pending_cents: 0,
    paid_cents: 0,
    requested_cents: 0,
    available_cents: 0,
    currency_code: 'USD',
  };
}

async function createPayoutRequest({ userId, amountCents, currencyCode, payoutMethod, note, metadata }) {
  const { rows } = await pool.query(
    `INSERT INTO main_app_payout_requests
       (user_id, amount_cents, currency_code, payout_method, status, note, metadata)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb)
     RETURNING id, amount_cents, currency_code, payout_method, status, note,
               external_payout_id, ledger_entry_id, requested_at, processed_at, cancelled_at`,
    [
      userId,
      amountCents,
      normalizeCurrency(currencyCode),
      payoutMethod || 'bank_transfer',
      note || null,
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0];
}

async function cancelPayoutRequest({ userId, requestId, reason }) {
  const { rows } = await pool.query(
    `UPDATE main_app_payout_requests
        SET status = 'cancelled',
            note = COALESCE($3, note),
            cancelled_at = NOW(),
            processed_at = COALESCE(processed_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status IN ('pending', 'failed')
      RETURNING id, amount_cents, currency_code, payout_method, status, note,
                external_payout_id, ledger_entry_id, requested_at, processed_at, cancelled_at`,
    [requestId, userId, reason || null]
  );
  return rows[0] || null;
}

async function createPaymentRequest({
  requesterId,
  payerId,
  payeeId,
  businessId,
  sourceType,
  sourceId,
  amountCents,
  currencyCode,
  description,
  settlementMode,
  externalProvider,
  idempotencyKey,
  metadata,
}) {
  const { rows } = await pool.query(
    `INSERT INTO main_app_payment_requests
       (requester_id, payer_id, payee_id, business_id, source_type, source_id,
        amount_cents, currency_code, status, settlement_mode, external_provider,
        description, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested', $9, $10, $11, $12, $13::jsonb)
     ON CONFLICT (requester_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL
     DO UPDATE SET updated_at = main_app_payment_requests.updated_at
     RETURNING id, source_type, source_id, payer_id, payee_id, business_id,
               amount_cents, currency_code, status, settlement_mode, external_provider,
               processor_payment_id, description, idempotency_key, expires_at, metadata,
               created_at, updated_at`,
    [
      requesterId,
      payerId || null,
      payeeId || null,
      businessId || null,
      sourceType,
      sourceId || null,
      amountCents,
      normalizeCurrency(currencyCode),
      settlementMode || 'external_pending',
      externalProvider || null,
      description || null,
      idempotencyKey || null,
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0];
}

async function listPaymentRequests(userId, limit) {
  const { rows } = await pool.query(
    `SELECT id, source_type, source_id, payer_id, payee_id, business_id,
            amount_cents, currency_code, status, settlement_mode, external_provider,
            processor_payment_id, description, idempotency_key, expires_at, metadata,
            created_at, updated_at
       FROM main_app_payment_requests
      WHERE requester_id = $1
         OR payer_id = $1
         OR payee_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function confirmPaymentRequest({
  requestId,
  userId,
  confirmationCode,
  proofLink,
  proofAttachment,
  note,
}) {
  const confirmationMetadata = {
    confirmedAt: new Date().toISOString(),
    confirmedByUserId: String(userId),
    ...(confirmationCode ? { confirmationCode } : {}),
    ...(proofLink ? { proofLink } : {}),
    ...(proofAttachment ? { proofAttachment } : {}),
    ...(note ? { confirmationNote: note } : {}),
  };

  const { rows } = await pool.query(
    `UPDATE main_app_payment_requests
        SET status = 'confirmed',
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1
        AND payee_id = $2
        AND status IN ('requested', 'viewed')
      RETURNING id, source_type, source_id, payer_id, payee_id, business_id,
                amount_cents, currency_code, status, settlement_mode, external_provider,
                processor_payment_id, description, idempotency_key, expires_at, metadata,
                created_at, updated_at`,
    [requestId, userId, JSON.stringify(confirmationMetadata)]
  );

  return rows[0] || null;
}

async function submitPaymentProof({
  requestId,
  userId,
  proofLink,
  proofAttachment,
  confirmationCode,
  note,
}) {
  const proofMetadata = {
    proofSubmittedAt: new Date().toISOString(),
    proofSubmittedByUserId: String(userId),
    ...(proofLink ? { proofLink } : {}),
    ...(proofAttachment ? { proofAttachment } : {}),
    ...(confirmationCode ? { confirmationCode } : {}),
    ...(note ? { proofNote: note } : {}),
  };

  const { rows } = await pool.query(
    `UPDATE main_app_payment_requests
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1
        AND payer_id = $2
        AND status IN ('requested', 'viewed')
      RETURNING id, source_type, source_id, payer_id, payee_id, business_id,
                amount_cents, currency_code, status, settlement_mode, external_provider,
                processor_payment_id, description, idempotency_key, expires_at, metadata,
                created_at, updated_at`,
    [requestId, userId, JSON.stringify(proofMetadata)]
  );

  return rows[0] || null;
}

async function listPublicServicePackages({ businessId, serviceId, limit }) {
  const params = [];
  let where = 'WHERE p.is_active = TRUE';
  if (businessId) {
    params.push(businessId);
    where += ` AND p.business_id = $${params.length}`;
  }
  if (serviceId) {
    params.push(serviceId);
    where += ` AND (p.service_id::text = $${params.length} OR p.services @> jsonb_build_array(jsonb_build_object('serviceId', $${params.length}::text)))`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT p.id, p.business_id, p.name, p.description, p.service_id,
            COALESCE(p.services, '[]'::jsonb) AS services,
            COALESCE(p.total_sessions, p.session_count, 1) AS total_sessions,
            p.price_cents, p.original_price_cents,
            COALESCE(p.validity_days, p.valid_days, 365) AS validity_days,
            COALESCE(p.sort_order, 0) AS sort_order,
            p.is_active, p.created_at, p.updated_at
       FROM business_service_packages p
       ${where}
      ORDER BY COALESCE(p.sort_order, 0), p.price_cents, p.name
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

module.exports = {
  PAYOUT_MINIMUM_CENTS,
  normalizeCurrency,
  serializePayoutRequest,
  serializePaymentRequest,
  submitPaymentProof,
  confirmPaymentRequest,
  serializeServicePackage,
  getPayoutBalances,
  createPayoutRequest,
  cancelPayoutRequest,
  createPaymentRequest,
  listPaymentRequests,
  listPublicServicePackages,
};
