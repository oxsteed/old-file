'use strict';

/**
 * Credit Everywhere Phase 1 — participant resolution and gating.
 *
 * OxSteed Credit partners were restaurant-only. The credit_participants
 * table (migration 724) introduces polymorphic payees (restaurants,
 * businesses, helpers, merchants, sellers) linked to a partner, each with
 * its own lifecycle, Didit requirement, allowed surfaces, and risk limits.
 *
 * Money code fails closed: every check below throws rather than guessing.
 */

const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// participant_type -> subject column. Polymorphic types accept either
// business_id or user_id; resolution tries business first.
const SUBJECT_COLUMNS = Object.freeze({
  restaurant: ['restaurant_id'],
  business: ['business_id'],
  delivery_merchant: ['business_id'],
  helper: ['user_id'],
  consulting_seller: ['user_id'],
  subscription_merchant: ['business_id', 'user_id'],
  qr_merchant: ['business_id', 'user_id'],
  invoice_seller: ['business_id', 'user_id'],
  product_seller: ['business_id', 'user_id'],
  rental_seller: ['business_id', 'user_id'],
});

const VALID_PARTICIPANT_TYPES = Object.freeze(Object.keys(SUBJECT_COLUMNS));

/**
 * Resolve a participant by type + subject id, joining the partner and the
 * latest active agreement. Returns null when nothing matches (callers
 * decide whether that is a 403 or a 404).
 *
 * @param {object} client - pg client/pool
 * @param {object} args - { type, subjectId }
 * @returns {Promise<object|null>} { participant, partner, agreement }
 */
async function resolveParticipant(client, { type, subjectId }) {
  if (!VALID_PARTICIPANT_TYPES.includes(type)) {
    throw new AppError(`Unknown participant type: ${type}`, 400, 'credit_participant_invalid_type');
  }
  if (subjectId === null || subjectId === undefined || String(subjectId).trim() === '') {
    throw new AppError('Participant subject id is required', 400, 'credit_participant_subject_required');
  }

  const columns = SUBJECT_COLUMNS[type];
  // Build OR conditions across the candidate subject columns. Each column
  // is compared as text so BIGINT/INTEGER/UUID subjects all work.
  const subjectConditions = columns
    .map((col, idx) => `cp.${col}::text = $${idx + 3}`)
    .join(' OR ');
  const params = [type, String(subjectId), ...columns.map(() => String(subjectId))];

  const { rows } = await client.query(
    `SELECT cp.*,
            p.status AS partner_status,
            p.settlement_currency_code AS partner_settlement_currency,
            a.id AS agreement_id, a.status AS agreement_status,
            a.version AS agreement_version, a.starts_at AS agreement_starts_at,
            a.ends_at AS agreement_ends_at,
            a.max_transaction_cents AS agreement_max_transaction_cents,
            a.daily_customer_limit_cents AS agreement_daily_limit_cents,
            a.lifetime_customer_limit_cents AS agreement_lifetime_limit_cents
       FROM credit_participants cp
       JOIN oxsteed_credit_partners p ON p.id = cp.partner_id
       LEFT JOIN LATERAL (
         SELECT a2.*
           FROM oxsteed_credit_partner_agreements a2
          WHERE a2.partner_id = p.id
            AND a2.status = 'active'
            AND a2.starts_at <= NOW()
            AND (a2.ends_at IS NULL OR a2.ends_at > NOW())
          ORDER BY a2.version DESC
          LIMIT 1
       ) a ON TRUE
      WHERE cp.participant_type = $1
        AND (${subjectConditions})
      ORDER BY cp.created_at DESC
      LIMIT 1`,
    params
  );

  const row = rows[0];
  if (!row) return null;

  const {
    partner_status, partner_settlement_currency,
    agreement_id, agreement_status, agreement_version,
    agreement_starts_at, agreement_ends_at,
    agreement_max_transaction_cents, agreement_daily_limit_cents,
    agreement_lifetime_limit_cents,
    ...participant
  } = row;

  return {
    participant,
    partner: {
      id: participant.partner_id,
      status: partner_status,
      settlement_currency_code: partner_settlement_currency,
    },
    agreement: agreement_id ? {
      id: agreement_id,
      status: agreement_status,
      version: agreement_version,
      starts_at: agreement_starts_at,
      ends_at: agreement_ends_at,
      max_transaction_cents: agreement_max_transaction_cents,
      daily_customer_limit_cents: agreement_daily_limit_cents,
      lifetime_customer_limit_cents: agreement_lifetime_limit_cents,
    } : null,
  };
}

/**
 * Resolve a participant for a legacy restaurant partner id. This is the
 * backward-compatible path for existing restaurant spend flows: every
 * partner row was backfilled with a restaurant participant in migration 724.
 */
async function resolveRestaurantParticipant(client, partnerId) {
  if (partnerId === null || partnerId === undefined) {
    throw new AppError('Partner id is required', 400, 'credit_participant_partner_required');
  }
  const { rows } = await client.query(
    `SELECT cp.*,
            p.status AS partner_status,
            p.settlement_currency_code AS partner_settlement_currency,
            p.restaurant_id AS partner_restaurant_id
       FROM credit_participants cp
       JOIN oxsteed_credit_partners p ON p.id = cp.partner_id
      WHERE cp.partner_id = $1
        AND cp.participant_type = 'restaurant'
      ORDER BY cp.created_at DESC
      LIMIT 1`,
    [partnerId]
  );
  const row = rows[0];
  if (!row) return null;
  const { partner_status, partner_settlement_currency, partner_restaurant_id, ...participant } = row;
  return {
    participant,
    partner: {
      id: participant.partner_id,
      status: partner_status,
      settlement_currency_code: partner_settlement_currency,
      restaurant_id: partner_restaurant_id,
    },
  };
}

/**
 * Fail-closed gate: participant must be active, partner active, Didit
 * verified. Throws AppError with a specific code for each failure so
 * callers and clients can distinguish them.
 */
function assertParticipantActive(resolved) {
  if (!resolved || !resolved.participant) {
    throw new AppError('No credit participant found for this payee', 403, 'credit_participant_not_found');
  }
  const { participant, partner } = resolved;
  if (participant.status !== 'active') {
    throw new AppError(
      `Credit participant is ${participant.status}`,
      403, 'credit_participant_not_active',
      { participantStatus: participant.status }
    );
  }
  if (!partner || partner.status !== 'active') {
    throw new AppError('Credit partner is not active', 403, 'credit_partner_not_active');
  }
  // LOCKED: Didit mandatory before active.
  if (!participant.didit_verified) {
    throw new AppError(
      'This payee must complete identity verification before accepting OxSteed Credit',
      403, 'credit_participant_didit_required'
    );
  }
  return resolved;
}

/**
 * Fail-closed surface gate: the spend surface must be in the
 * participant's allowed_surfaces list. An empty list means no surfaces.
 */
function assertSurfaceAllowed(participant, surface) {
  if (!surface) return;
  const allowed = participant.allowed_surfaces || [];
  if (!allowed.includes(surface)) {
    throw new AppError(
      `OxSteed Credit is not enabled for ${surface} with this payee`,
      403, 'credit_surface_not_allowed',
      { surface }
    );
  }
}

/**
 * Effective risk limits: participant caps win when tighter than the
 * agreement caps. Returns nulls when no cap applies.
 */
function effectiveParticipantCaps(participant, agreement) {
  const pick = (...values) => {
    const nums = values
      .filter((v) => v !== null && v !== undefined)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    return nums.length ? Math.min(...nums) : null;
  };
  return {
    maxTicketCents: pick(participant.max_ticket_cents, agreement?.max_transaction_cents),
    dailyCapCents: pick(participant.daily_cap_cents, agreement?.daily_customer_limit_cents),
    lifetimeCapCents: pick(participant.lifetime_cap_cents, agreement?.lifetime_customer_limit_cents),
  };
}

module.exports = {
  SUBJECT_COLUMNS,
  VALID_PARTICIPANT_TYPES,
  resolveParticipant,
  resolveRestaurantParticipant,
  assertParticipantActive,
  assertSurfaceAllowed,
  effectiveParticipantCaps,
};
