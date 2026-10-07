'use strict';

/**
 * Phase 2 — Credit Everywhere: shared spend adapter.
 *
 * Single entry point for every surface that spends OxSteed Credit.
 * Locked per-surface matrix (2026-10-07):
 *   food_online, chat, card_kiosk → immediate debit
 *   pos                           → hold, then finalize = debit then adjust
 *   jobs                          → hold as escrow collateral
 *   default                       → debit unless fulfillment unknown
 *
 * Participant resolution contract (Phase 1 — sibling workstream):
 *   resolveSpendParticipant(client, { type, subjectId }) expects a
 *   `credit_participants` table with (participant_type, subject_id,
 *   partner_id, status). Until that table exists, the adapter falls back
 *   to the legacy restaurant-only lookup on oxsteed_credit_partners.
 *
 * Money rules: fail closed everywhere. Rail + freeze gates run before any
 * spend. Impersonated sessions are rejected on customer-initiated spend.
 * Deterministic idempotency keys when the caller does not supply one.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const creditService = require('./oxsteedCreditService');
const guestPolicy = require('./creditGuestPolicy');
const {
  resolveParticipant,
  assertParticipantActive,
  assertSurfaceAllowed,
} = require('./creditParticipantService');

// Locked per-surface mode matrix (2026-10-07 decisions).
const SURFACE_MODES = Object.freeze({
  food_online: 'debit',
  chat: 'debit',
  card_kiosk: 'debit',
  pos: 'hold',
  jobs: 'hold',
  direct: 'debit',
  qr: 'debit',
  subscriptions: 'debit',
  consulting: 'debit',
  invoices: 'debit',
  rentals: 'debit',
});

const MODES = Object.freeze(['debit', 'hold']);

// Locked decision #1: guest Credit allowed with risk limits.
// Caps live in creditGuestPolicy (single source of truth).
const {
  GUEST_MAX_TICKET_CENTS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_LIFETIME_CAP_CENTS,
} = guestPolicy;
// Back-compat export: the per-spend cap is the ticket cap.
const GUEST_SPEND_CAP_CENTS = GUEST_MAX_TICKET_CENTS;

function normalizeString(value, max = 255) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function parseAmountCents(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new AppError('Amount must be a positive integer number of cents', 400, 'credit_amount_invalid');
  }
  return n;
}

/**
 * Resolve participantRef { type, subjectId } → { partnerId, participant }.
 * Delegates to the Phase 1 creditParticipantService (resolveParticipant).
 * Falls back to the legacy restaurant-only partner lookup when the
 * credit_participants table does not exist yet.
 */
async function resolveSpendParticipant(client, { type, subjectId }, surface) {
  const participantType = normalizeString(type, 40);
  if (!participantType) {
    throw new AppError('participantRef.type is required', 400, 'credit_participant_type_required');
  }
  const subject = subjectId === null || subjectId === undefined ? null : String(subjectId);
  if (!subject) {
    throw new AppError('participantRef.subjectId is required', 400, 'credit_participant_subject_required');
  }

  const { rows: tableCheck } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'credit_participants' LIMIT 1`
  );
  if (tableCheck[0]) {
    const resolved = await resolveParticipant(client, { type: participantType, subjectId: subject });
    if (!resolved) {
      throw new AppError('No Credit participant found for this payee', 403, 'credit_participant_not_found');
    }
    assertParticipantActive(resolved);
    if (surface) assertSurfaceAllowed(resolved.participant, surface);
    return { participant: resolved.participant, partnerId: resolved.partner.id };
  }

  // Legacy fallback: restaurant participants only.
  if (participantType !== 'restaurant') {
    throw new AppError('Credit participants are not yet available for this payee type', 403, 'credit_participant_not_found');
  }
  const restaurantId = Number(subject);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
    throw new AppError('Invalid restaurant participant', 400, 'credit_participant_invalid');
  }
  const { rows } = await client.query(
    `SELECT id FROM oxsteed_credit_partners WHERE restaurant_id = $1 LIMIT 1`,
    [restaurantId]
  );
  if (!rows[0]) {
    throw new AppError('This restaurant does not currently accept OxSteed Credit', 409, 'credit_partner_not_eligible');
  }
  return { participant: null, partnerId: rows[0].id };
}

function assertSurfaceMode(surface, mode) {
  const normalizedSurface = normalizeString(surface, 40);
  if (!normalizedSurface || !SURFACE_MODES[normalizedSurface]) {
    throw new AppError(`Unknown Credit spend surface: ${surface}`, 400, 'credit_surface_unknown');
  }
  const requiredMode = SURFACE_MODES[normalizedSurface];
  const requestedMode = mode ? normalizeString(mode, 16)?.toLowerCase() : requiredMode;
  if (!MODES.includes(requestedMode)) {
    throw new AppError(`Invalid Credit spend mode: ${mode}`, 400, 'credit_mode_invalid');
  }
  if (requestedMode !== requiredMode) {
    throw new AppError(
      `Surface ${normalizedSurface} requires mode ${requiredMode}, got ${requestedMode}`,
      400,
      'credit_surface_mode_mismatch',
      { surface: normalizedSurface, requiredMode, requestedMode }
    );
  }
  return { surface: normalizedSurface, mode: requestedMode };
}

function buildIdempotencyKey({ idempotencyKey, surface, referenceType, referenceId }) {
  const provided = normalizeString(idempotencyKey, 160);
  if (provided) return provided;
  const refType = normalizeString(referenceType, 80) || 'unknown';
  const refId = referenceId === null || referenceId === undefined ? 'noref' : String(referenceId);
  // Deterministic: same surface + reference always yields the same key.
  return `credit-spend:${surface}:${refType}:${refId}`.slice(0, 160);
}

/**
 * Core spend logic. Runs inside the caller's transaction when `client` is
 * supplied, otherwise opens its own.
 */
async function spendWithCreditInTransaction(client, args) {
  const {
    participantRef,
    customerId = null,
    guestSessionId = null,
    amountCents,
    currency,
    surface,
    mode = null,
    referenceType,
    referenceId,
    metadata = {},
    idempotencyKey,
    actorUserId = null,
    isImpersonated = false,
    orderType = null,
    category = null,
    categories = null,
    menuItemId = null,
    menuItemIds = null,
    city = null,
    state = null,
    postalCode = null,
    country = null,
    expiresAt = null,
    description = null,
    correlationId = null,
    requestIp = null,
  } = args;

  // 1. Surface + mode matrix enforcement (fail closed on mismatch).
  const { surface: normalizedSurface, mode: normalizedMode } = assertSurfaceMode(surface, mode);

  // 1b. Guests are debit-only (no customer account for hold lifecycle).
  const normalizedGuestSessionEarly = normalizeString(guestSessionId, 160);
  const isGuestEarly = !customerId && !!normalizedGuestSessionEarly;
  if (isGuestEarly && normalizedMode === 'hold') {
    throw new AppError('Guest Credit does not support hold mode', 403, 'credit_guest_hold_not_supported');
  }

  // 2. Impersonated sessions cannot initiate customer spend.
  if (isImpersonated) {
    throw new AppError('Impersonated sessions cannot spend OxSteed Credit', 403, 'impersonation_blocked');
  }

  // 3. Amount + currency.
  const amount = parseAmountCents(amountCents);
  const currencyCode = normalizeString(currency, 3)?.toUpperCase();
  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
    throw new AppError('Currency is required', 400, 'credit_currency_required');
  }

  // 4. Customer or guest (locked decision #1: guest Credit with risk limits).
  // Guest spend is platform-funded (platform_treasury → partner_payable) and
  // bound to a session fingerprint with ticket/daily/lifetime caps.
  const normalizedGuestSession = normalizeString(guestSessionId, 160);
  let effectiveCustomerId = customerId ? String(customerId) : null;
  let guestFingerprint = null;
  const isGuestSpend = !effectiveCustomerId;
  if (isGuestSpend) {
    if (!normalizedGuestSession) {
      throw new AppError('customerId or guestSessionId is required', 400, 'credit_spender_required');
    }
    guestFingerprint = guestPolicy.buildGuestFingerprint({
      sessionId: normalizedGuestSession,
      ip: requestIp,
      userAgent: metadata?.userAgent || null,
    });
    // Ticket cap enforced here (fail fast); daily/lifetime enforced inside
    // the purchase transaction against the tracking table.
    if (amount > guestPolicy.GUEST_MAX_TICKET_CENTS) {
      throw new AppError(
        `Guest Credit is limited to $${(guestPolicy.GUEST_MAX_TICKET_CENTS / 100).toFixed(0)} per order`,
        403,
        'credit_guest_cap_exceeded',
        { capCents: guestPolicy.GUEST_MAX_TICKET_CENTS }
      );
    }
  }

  // 5. Resolve participant → partner.
  const { partnerId } = await resolveSpendParticipant(client, participantRef, normalizedSurface);

  // 6. Rail + freeze gates (fail closed).
  await creditService.assertCreditRailEnabled(client);

  // 7. Deterministic idempotency key.
  const key = buildIdempotencyKey({ idempotencyKey, surface: normalizedSurface, referenceType, referenceId });
  const normalizedReferenceType = normalizeString(referenceType, 80) || `${normalizedSurface}_spend`;
  const normalizedReferenceId = referenceId === null || referenceId === undefined ? null : String(referenceId);

  const baseMetadata = {
    ...metadata,
    creditSpendSurface: normalizedSurface,
    creditSpendMode: normalizedMode,
    ...(normalizedGuestSession ? { guestSessionId: normalizedGuestSession } : {}),
  };

  if (normalizedMode === 'hold') {
    // POS / jobs: hold now, finalize later via finalizeCreditSpend().
    const hold = await creditService.createCreditHoldInTransaction(client, {
      customerId: effectiveCustomerId,
      partnerId,
      amountCents: amount,
      currencyCode,
      idempotencyKey: key,
      actorUserId: actorUserId || effectiveCustomerId,
      orderType,
      category,
      menuItemId,
      city,
      state,
      postalCode,
      country,
      purpose: normalizedSurface,
      referenceType: normalizedReferenceType,
      referenceId: normalizedReferenceId,
      correlationId,
      requestIp,
      expiresAt,
      metadata: baseMetadata,
    });
    logger.info('credit_spend_adapter.hold_created', {
      surface: normalizedSurface,
      partnerId,
      amountCents: amount,
      currencyCode,
      referenceType: normalizedReferenceType,
    });
    return { mode: 'hold', surface: normalizedSurface, partnerId, hold, idempotencyKey: key };
  }

  // Debit path: immediate purchase.
  // Guests use the platform-funded path (platform_treasury → partner_payable).
  if (isGuestSpend) {
    const purchase = await creditService.purchaseWithGuestCreditInTransaction(client, {
      guestFingerprint,
      partnerId,
      amountCents: amount,
      currencyCode,
      idempotencyKey: key,
      orderType,
      category,
      categories,
      menuItemId,
      menuItemIds,
      city,
      state,
      postalCode,
      country,
      surface: normalizedSurface,
      referenceType: normalizedReferenceType,
      referenceId: normalizedReferenceId,
      correlationId,
      requestIp,
      description: description || `Guest Credit spend · ${normalizedSurface}`,
      metadata: baseMetadata,
    });
    logger.info('credit_spend_adapter.guest_debit_completed', {
      surface: normalizedSurface,
      partnerId,
      amountCents: amount,
      currencyCode,
      referenceType: normalizedReferenceType,
    });
    return { mode: 'debit', surface: normalizedSurface, partnerId, purchase, idempotencyKey: key, guest: true };
  }

  const purchase = await creditService.purchaseWithCreditInTransaction(client, {
    customerId: effectiveCustomerId,
    partnerId,
    amountCents: amount,
    currencyCode,
    idempotencyKey: key,
    actorUserId: actorUserId || effectiveCustomerId,
    actorType: effectiveCustomerId ? 'customer' : 'guest',
    orderType,
    category,
    categories,
    menuItemId,
    menuItemIds,
    city,
    state,
    postalCode,
    country,
    referenceType: normalizedReferenceType,
    referenceId: normalizedReferenceId,
    correlationId,
    requestIp,
    description: description || `${normalizedSurface} Credit spend`,
    metadata: baseMetadata,
  });
  logger.info('credit_spend_adapter.debit_completed', {
    surface: normalizedSurface,
    partnerId,
    amountCents: amount,
    currencyCode,
    referenceType: normalizedReferenceType,
  });
  return { mode: 'debit', surface: normalizedSurface, partnerId, purchase, idempotencyKey: key };
}

/**
 * Finalize a hold created via the adapter: capture (debit), then adjust if
 * the final amount differs from the held amount. POS uses this instead of
 * exact-amount capture.
 */
async function finalizeCreditSpendInTransaction(client, {
  holdId,
  customerId,
  finalAmountCents,
  currencyCode = null,
  idempotencyKey,
  actorUserId,
  actorType = 'system',
  referenceType,
  referenceId,
  metadata = {},
  correlationId = null,
  requestIp = null,
  description = null,
  orderType = null,
  category = null,
  categories = null,
  menuItemId = null,
  menuItemIds = null,
  city = null,
  state = null,
  postalCode = null,
  country = null,
  reason = null,
}) {
  if (!holdId) throw new AppError('holdId is required to finalize Credit spend', 400, 'credit_hold_id_required');
  const amount = parseAmountCents(finalAmountCents);
  const key = normalizeString(idempotencyKey, 160) || `credit-finalize:${String(holdId)}`.slice(0, 160);

  const capture = await creditService.captureCreditHoldInTransaction(client, {
    holdId,
    amountCents: amount,
    currencyCode,
    idempotencyKey: key,
    actorUserId,
    actorType,
    referenceType: normalizeString(referenceType, 80) || 'credit_spend_finalize',
    referenceId: referenceId === null || referenceId === undefined ? null : String(referenceId),
    correlationId,
    requestIp,
    description: description || 'Credit hold finalized',
    // Locked decision #3: POS finalize is debit-then-adjust, not exact-capture.
    allowAmountAdjust: true,
    orderType,
    category,
    categories,
    menuItemId,
    menuItemIds,
    city,
    state,
    postalCode,
    country,
    reason,
    metadata: { ...metadata, creditSpendFinalize: true },
  });
  logger.info('credit_spend_adapter.hold_finalized', { holdId, finalAmountCents: amount });
  return { mode: 'finalize', holdId, capture, idempotencyKey: key };
}

async function spendWithCredit(args) {
  const { client, ...rest } = args || {};
  if (client) return spendWithCreditInTransaction(client, rest);
  return withTransaction(pool, (c) => spendWithCreditInTransaction(c, rest), 'credit_spend_adapter');
}

async function finalizeCreditSpend(args) {
  const { client, ...rest } = args || {};
  if (client) return finalizeCreditSpendInTransaction(client, rest);
  return withTransaction(pool, (c) => finalizeCreditSpendInTransaction(c, rest), 'credit_spend_finalize');
}

module.exports = {
  spendWithCredit,
  spendWithCreditInTransaction,
  finalizeCreditSpend,
  finalizeCreditSpendInTransaction,
  resolveSpendParticipant,
  SURFACE_MODES,
  GUEST_SPEND_CAP_CENTS,
  GUEST_MAX_TICKET_CENTS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_LIFETIME_CAP_CENTS,
};
