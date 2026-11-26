'use strict';

/**
 * OxSteed Credit Everywhere Phase 1 — participant control plane.
 *
 * A participant is a non-restaurant business or helper approved to accept
 * OxSteed Credit on specific surfaces. Every participant links to a row in
 * oxsteed_credit_partners (the money-side record); the participant row
 * carries the Credit-everywhere metadata the partner table never had:
 * participant type, subject linkage, lifecycle status, Didit flag, and
 * allowed surfaces.
 *
 * Sibling table (migration 725_credit_participants.sql):
 *   credit_participants (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id),
 *     participant_type TEXT NOT NULL,                -- restaurant | business | helper |
 *                                                    -- subscription_merchant | qr_merchant |
 *                                                    -- delivery_merchant | consulting_seller |
 *                                                    -- invoice_seller | product_seller | rental_seller |
 *                                                    -- logistics
 *     restaurant_id BIGINT NULL,                     -- exactly one subject column
 *     business_id INTEGER NULL,                      -- set per type (CHECK enforced)
 *     user_id UUID NULL,
 *     status TEXT NOT NULL DEFAULT 'pending',        -- pending|active|suspended|revoked
 *     didit_verified BOOLEAN NOT NULL DEFAULT FALSE,
 *     didit_verified_at TIMESTAMPTZ,                 -- required when verified
 *     allowed_surfaces TEXT[] NOT NULL DEFAULT '{}', -- constrained value list
 *     max_ticket_cents / daily_cap_cents / lifetime_cap_cents BIGINT NULL,
 *     notes TEXT,
 *     created_at / updated_at TIMESTAMPTZ
 *   )
 *
 * Lifecycle (LOCKED decisions):
 * - Activation (pending→active) ALWAYS goes through the maker-checker
 *   pending-action flow (credit_participant_activation): a different
 *   admin must approve; self-approval is 403.
 * - Activation is blocked unless didit_verified = true (Didit mandatory).
 * - Enrollment is both admin-initiated and self-serve apply; both land
 *   in the same pending queue.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { insertAudit, transitionPartner } = require('./oxsteedCreditAdminService');
const { isDiditVerificationFresh } = require('../utils/diditGate');

const PARTICIPANT_TYPES = new Set([
  'restaurant', 'business', 'helper', 'subscription_merchant', 'qr_merchant',
  'delivery_merchant', 'consulting_seller', 'invoice_seller',
  'product_seller', 'rental_seller', 'logistics',
]);
// Types a self-serve applicant or admin enrollment may create (restaurant
// participants are backfilled from existing partners, never enrolled).
// 'logistics' is the admin-enrolled OxSteed collection entity for Logistics
// buyer payments; it is business-anchored like 'business'.
const ENROLLABLE_TYPES = new Set([
  'business', 'helper', 'subscription_merchant', 'qr_merchant',
  'delivery_merchant', 'consulting_seller', 'invoice_seller',
  'product_seller', 'rental_seller', 'logistics',
]);
const PARTICIPANT_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
// Surfaces a participant may be approved for (must stay in sync with the
// CHECK constraint in 725_credit_participants.sql, extended by 877).
const CREDIT_SURFACES = new Set([
  'food_online', 'food_pos', 'chat', 'jobs', 'direct', 'qr',
  'subscriptions', 'delivery', 'consulting', 'invoices',
  'products', 'rentals', 'logistics',
]);

function normalizeString(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function normalizeSurfaces(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizeString(entry, 32).toLowerCase();
    if (CREDIT_SURFACES.has(normalized) && !seen.has(normalized)) seen.add(normalized);
  }
  return [...seen];
}

function formatParticipant(row) {
  if (!row) return null;
  return {
    participantId: String(row.id),
    partnerId: String(row.partner_id),
    participantType: row.participant_type,
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    businessId: row.business_id === null || row.business_id === undefined ? null : String(row.business_id),
    userId: row.user_id || null,
    status: row.status,
    diditVerified: row.didit_verified === true,
    diditVerifiedAt: row.didit_verified_at || null,
    allowedSurfaces: Array.isArray(row.allowed_surfaces) ? row.allowed_surfaces : [],
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

// Group 13 (655, D-359): the activation checklist is a read-only
// presentation of the three existing activation gates — application
// status, Didit verified, maker-checker approval. It adds no new state
// machine and no new gate; activation itself stays the maker-checker
// flow. States: done = the gate is satisfied; pending = the gate is open
// and can proceed; blocked = the gate cannot proceed until something
// else changes. `approvalRequested` is true when a maker has filed a
// `credit_participant_activation` pending action and the record is
// awaiting its checker.
function buildActivationChecklist(participant, { approvalRequested = false } = {}) {
  const status = participant?.status || 'pending';
  const diditVerified = participant?.diditVerified === true;
  const closed = status === 'suspended' || status === 'revoked';
  const application = { id: 'application', state: 'done', detail: 'submitted' };
  const identity = closed
    ? { id: 'identity', state: 'blocked', detail: 'closed' }
    : diditVerified
      ? { id: 'identity', state: 'done', detail: 'verified' }
      : { id: 'identity', state: 'pending', detail: 'awaiting_verification' };
  let approval;
  if (status === 'active') {
    approval = { id: 'approval', state: 'done', detail: 'approved' };
  } else if (closed) {
    approval = { id: 'approval', state: 'blocked', detail: 'closed' };
  } else if (!diditVerified) {
    approval = { id: 'approval', state: 'blocked', detail: 'needs_verification' };
  } else if (approvalRequested) {
    approval = { id: 'approval', state: 'pending', detail: 'approval_requested' };
  } else {
    approval = { id: 'approval', state: 'pending', detail: 'awaiting_review' };
  }
  return [application, identity, approval];
}

/**
 * Group 13 (694, D-401/D-402): eligibility/status change notice.
 * One notification type (`credit_participant_status_changed`, group
 * `credit`) for every participant status change that exists today —
 * apply/enroll (none -> pending) and activation (pending -> active).
 * There is no suspend/revoke transition in this service to hook (that
 * missing transition is survey defect 1 / item 700 territory), and
 * partner transitions (`transitionPartner`) never touch
 * `credit_participants`, so neither sends a participant notice here.
 * Identity-verdict flips already notify via
 * `credit_identity_verification_approved`/`_rejected` (D-403).
 *
 * Best-effort after commit, following the dispute-notice pattern: a
 * failed send is logged and never blocks or rolls back the transition.
 * The idempotency key binds the participant, the new status, and the
 * row's updated_at, so a retry of the same transition replays silently
 * while a genuinely new transition (a new row, or a new updated_at)
 * notifies again. The localized template body is generic; the caller
 * appends the new state and what it means in English after it, the
 * same shape as the card-frozen reason append (D-362).
 */
const PARTICIPANT_STATUS_NOTICE_COPY = {
  pending: 'Your application is now pending review. We will notify you when a decision is made.',
  active: 'Your participation is now active. You can accept OxSteed Credit on your approved surfaces.',
};

async function resolveParticipantUserIds(client, participant) {
  const ids = [];
  if (participant.userId) ids.push(String(participant.userId));
  if (participant.businessId) {
    const { rows } = await client.query(
      `SELECT user_id FROM businesses WHERE id = $1`,
      [Number(participant.businessId)],
    );
    if (rows[0]?.user_id) ids.push(String(rows[0].user_id));
  }
  if (participant.restaurantId) {
    const { rows } = await client.query(
      `SELECT owner_user_id FROM food_restaurants WHERE id = $1`,
      [Number(participant.restaurantId)],
    );
    if (rows[0]?.owner_user_id) ids.push(String(rows[0].owner_user_id));
  }
  return [...new Set(ids)];
}

async function notifyParticipantStatusChange(participant, { previousStatus = null } = {}) {
  try {
    const status = participant?.status;
    const copy = PARTICIPANT_STATUS_NOTICE_COPY[status];
    if (!copy) return;
    const userIds = await resolveParticipantUserIds(pool, participant);
    if (!userIds.length) return;
    const { sendNotification } = require('./notificationService');
    const updatedAt = participant.updatedAt ? new Date(participant.updatedAt).getTime() : 0;
    for (const userId of userIds) {
      await sendNotification({
        userId,
        type: 'credit_participant_status_changed',
        body: copy,
        data: { participant_id: String(participant.participantId), status, previous_status: previousStatus || null },
        action_url: '/credit/apply',
        idempotencyKey: `credit-participant:${participant.participantId}:${status}:${updatedAt}`,
      });
    }
  } catch (err) {
    logger.warn('Credit participant status notification failed', {
      participantId: participant?.participantId, error: err.message,
    });
  }
}

/**
 * Defensive guard: the sibling agent owns the credit_participants
 * migration. Fail with a clear code (not a raw 42P01) when it has not
 * landed yet.
 */
async function assertCreditParticipantsReady(client) {
  const queryable = client || pool;
  const { rows } = await queryable.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_participants' LIMIT 1`
  );
  if (!rows.length) {
    throw new AppError(
      'Credit participant registry is not ready yet',
      503,
      'credit_participants_not_ready'
    );
  }
}

/**
 * Didit gate (LOCKED): the participant's owners must be Didit-verified
 * before activation. Checks users.didit_status = 'verified' for every
 * linked owner; fails closed when no owner can be resolved.
 */
async function assertOwnersDiditVerified(client, { ownerUserIds, participantId }) {
  const uniqueIds = [...new Set((ownerUserIds || []).filter(Boolean).map(String))];
  if (!uniqueIds.length) {
    throw new AppError(
      'Cannot verify owner identity: no owner is linked to this participant',
      409,
      'credit_participant_owner_required'
    );
  }
  const { rows } = await client.query(
    `SELECT id, didit_status, didit_verified_at FROM users WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const unverified = uniqueIds.filter((id) => {
    const owner = byId.get(id);
    return owner?.didit_status !== 'verified' || !isDiditVerificationFresh(owner.didit_verified_at);
  });
  if (unverified.length) {
    throw new AppError(
      'Owner identity verification (Didit) is required before this participant can be activated',
      409,
      'credit_participant_didit_required',
      { participantId: participantId ? String(participantId) : undefined, unverifiedOwners: unverified.length }
    );
  }
}

/**
 * Resolve owner user ids for a partner: prefer the linked business
 * owner, fall back through the restaurant's business.
 */
async function resolvePartnerOwnerUserIds(client, partnerId) {
  const { rows } = await client.query(
    `SELECT DISTINCT b.user_id AS owner_id
       FROM businesses b
      WHERE b.id IN (
        SELECT p.business_id FROM oxsteed_credit_partners p WHERE p.id = $1 AND p.business_id IS NOT NULL
        UNION
        SELECT fr.business_id FROM food_restaurants fr
        JOIN oxsteed_credit_partners p ON p.restaurant_id = fr.id
        WHERE p.id = $1 AND fr.business_id IS NOT NULL
      )
      AND b.user_id IS NOT NULL`,
    [partnerId]
  );
  return rows.map((r) => r.owner_id).filter(Boolean);
}

/**
 * Self-serve apply (LOCKED: enrollment is both admin-initiated and
 * self-serve). A business owner or helper applies for their business /
 * profile to accept Credit. Creates a pending partner + pending
 * participant; both wait in the admin approval queue.
 */
async function applyForCreditParticipation({ userId, participantType, businessId, notes, allowedSurfaces, requestIp, correlationId }) {
  if (!userId) throw new AppError('Authentication is required to apply', 401, 'credit_apply_auth_required');
  const normalizedType = normalizeString(participantType, 24).toLowerCase();
  if (!ENROLLABLE_TYPES.has(normalizedType)) {
    throw new AppError('participantType must be an enrollable type (business, helper, or merchant)', 400, 'credit_apply_type_invalid');
  }
  const result = await withTransaction(pool, async (client) => {
    await assertCreditParticipantsReady(client);

    // Sibling schema: exactly one subject column per type.
    let restaurantId = null;
    let subjectBusinessId = null;
    let subjectUserId = null;
    if (normalizedType === 'business' || normalizedType === 'delivery_merchant' || normalizedType === 'logistics') {
      const normalizedBusinessId = Number(businessId);
      if (!Number.isSafeInteger(normalizedBusinessId) || normalizedBusinessId <= 0) {
        throw new AppError('A businessId you own is required', 400, 'credit_apply_business_required');
      }
      const { rows } = await client.query(
        `SELECT id, user_id FROM businesses WHERE id = $1`,
        [normalizedBusinessId]
      );
      if (!rows.length) throw new AppError('Business not found', 404, 'credit_apply_business_not_found');
      if (String(rows[0].user_id) !== String(userId)) {
        throw new AppError('You can only apply for businesses you own', 403, 'credit_apply_not_owner');
      }
      subjectBusinessId = normalizedBusinessId;
    } else {
      // Helper / merchant-as-individual: the applicant's own user id.
      // A helper profile is required when applying as a helper.
      if (normalizedType === 'helper') {
        const { rows } = await client.query(
          `SELECT id FROM helper_profiles WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (!rows.length) {
          throw new AppError('A helper profile is required to apply as a helper', 400, 'credit_apply_helper_required');
        }
      }
      subjectUserId = String(userId);
    }

    // Idempotency: one pending/active application per subject (matches the
    // sibling's partial unique indexes).
    const { rows: existing } = await client.query(
      `SELECT id, status FROM credit_participants
        WHERE participant_type = $1
          AND restaurant_id IS NOT DISTINCT FROM $2
          AND business_id IS NOT DISTINCT FROM $3
          AND user_id IS NOT DISTINCT FROM $4::uuid
          AND status IN ('pending', 'active')
        LIMIT 1`,
      [normalizedType, restaurantId, subjectBusinessId, subjectUserId]
    );
    if (existing.length) {
      const { rows: full } = await client.query(
        `SELECT * FROM credit_participants WHERE id = $1`, [existing[0].id]
      );
      return { participant: formatParticipant(full[0] || existing[0]), replayed: true };
    }

    const surfaces = normalizeSurfaces(allowedSurfaces);
    const { rows: partnerRows } = await client.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by, status)
       VALUES (NULL, $1, 'USD', $2, $3, 'pending')
       RETURNING *`,
      [subjectBusinessId, normalizeString(notes, 2000) || null, userId]
    );
    const partnerId = partnerRows[0].id;
    const { rows: participantRows } = await client.query(
      `INSERT INTO credit_participants
         (partner_id, participant_type, restaurant_id, business_id, user_id, status, didit_verified, allowed_surfaces, notes)
       VALUES ($1, $2, $3, $4, $5::uuid, 'pending', FALSE, $6::text[], $7)
       RETURNING *`,
      [
        partnerId,
        normalizedType,
        restaurantId,
        subjectBusinessId,
        subjectUserId,
        surfaces,
        normalizeString(notes, 2000) || null,
      ]
    );
    await insertAudit(client, {
      actionType: 'credit.participant.applied',
      actorUserId: userId,
      partnerId,
      resourceType: 'credit_participant',
      resourceId: String(participantRows[0].id),
      reason: `Self-serve Credit application (${normalizedType})`,
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      afterState: { status: 'pending', participantType: normalizedType },
    });
    return { participant: formatParticipant(participantRows[0]), partnerId: String(partnerId), replayed: false };
  }, 'credit_participant_apply');
  // Group 13 (694): the applicant hears about the new pending status.
  // A replayed duplicate application sends nothing.
  if (result && !result.replayed) {
    await notifyParticipantStatusChange(result.participant, { previousStatus: null });
  }
  return result;
}

/**
 * Admin-initiated enrollment: same pending queue as self-serve, but the
 * actor is an administrator enrolling a subject directly.
 */
async function enrollParticipant({ actorUserId, participantType, businessId, subjectUserId, notes, allowedSurfaces, requestIp, correlationId }) {
  if (!actorUserId) throw new AppError('An administrator is required', 403, 'credit_participant_actor_required');
  const normalizedType = normalizeString(participantType, 24).toLowerCase();
  if (!ENROLLABLE_TYPES.has(normalizedType)) {
    throw new AppError('participantType is invalid', 400, 'credit_participant_type_invalid');
  }
  const result = await withTransaction(pool, async (client) => {
    await assertCreditParticipantsReady(client);
    const surfaces = normalizeSurfaces(allowedSurfaces);
    // Sibling schema: exactly one subject column per type.
    let restaurantId = null;
    let subjectBusinessId = businessId ? Number(businessId) : null;
    let subjectUserIdValue = subjectUserId ? String(subjectUserId) : null;
    if (normalizedType === 'business' || normalizedType === 'delivery_merchant' || normalizedType === 'logistics') {
      if (!subjectBusinessId) {
        throw new AppError('A businessId is required for this participant type', 400, 'credit_participant_business_required');
      }
      subjectUserIdValue = null;
    } else {
      if (!subjectUserIdValue) {
        throw new AppError('A subject user id is required for this participant type', 400, 'credit_participant_user_required');
      }
      subjectBusinessId = null;
    }
    const { rows: partnerRows } = await client.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by, status)
       VALUES (NULL, $1, 'USD', $2, $3, 'pending')
       RETURNING *`,
      [
        subjectBusinessId,
        normalizeString(notes, 2000) || null,
        actorUserId,
      ]
    );
    const partnerId = partnerRows[0].id;
    const { rows: participantRows } = await client.query(
      `INSERT INTO credit_participants
         (partner_id, participant_type, restaurant_id, business_id, user_id, status, didit_verified, allowed_surfaces, notes)
       VALUES ($1, $2, $3, $4, $5::uuid, 'pending', FALSE, $6::text[], $7)
       RETURNING *`,
      [
        partnerId,
        normalizedType,
        restaurantId,
        subjectBusinessId,
        subjectUserIdValue,
        surfaces,
        normalizeString(notes, 2000) || null,
      ]
    );
    await insertAudit(client, {
      actionType: 'credit.participant.enrolled',
      actorUserId,
      partnerId,
      resourceType: 'credit_participant',
      resourceId: String(participantRows[0].id),
      reason: `Admin enrolled ${normalizedType} participant`,
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      afterState: { status: 'pending', participantType: normalizedType },
    });
    return { participant: formatParticipant(participantRows[0]), partnerId: String(partnerId) };
  }, 'credit_participant_enroll');
  // Group 13 (694): the enrolled subject hears about the new pending status.
  if (result?.participant) {
    await notifyParticipantStatusChange(result.participant, { previousStatus: null });
  }
  return result;
}

/**
 * G-25: applicant-side status. The caller's own participant rows: their
 * helper/personal applications plus applications for businesses they own.
 * Restaurant-linked rows are not included (no self-serve restaurant apply
 * exists to resolve ownership from here).
 */
async function listMyParticipants(userId) {
  await assertCreditParticipantsReady(pool);
  const { rows } = await pool.query(
    `SELECT cp.*, p.status AS partner_status FROM credit_participants cp
      LEFT JOIN oxsteed_credit_partners p ON p.id = cp.partner_id
      WHERE cp.user_id = $1::uuid
         OR cp.business_id IN (SELECT id FROM businesses WHERE user_id = $1::uuid)
      ORDER BY cp.created_at DESC`,
    [userId],
  );
  const participants = rows.map((row) => ({ ...formatParticipant(row), partnerStatus: row.partner_status || null }));
  if (!participants.length) return participants;
  // Maker-checker state (655, D-359): an open
  // credit_participant_activation pending action means a maker has filed
  // activation and the record is awaiting its checker. The pending-actions
  // table (migration 640) predates the participant registry, so it exists
  // whenever the registry does.
  const { rows: openApprovals } = await pool.query(
    `SELECT DISTINCT payload ->> 'participantId' AS participant_id
       FROM oxsteed_credit_pending_actions
      WHERE action_type = 'credit_participant_activation' AND status = 'pending'`
  );
  const awaitingChecker = new Set(openApprovals.map((r) => String(r.participant_id)));
  // 700 (D-576): a suspended/terminated partner's removal reason + date,
  // derived read-only from the latest transition audit event (one query
  // for all closed partners). The participant row itself is untouched.
  const closed = participants.filter((p) => p.partnerStatus === 'suspended' || p.partnerStatus === 'terminated');
  const changes = await getPartnerStatusChanges(closed.map((p) => p.partnerId));
  return participants.map((participant) => {
    const base = {
      ...participant,
      activationChecklist: buildActivationChecklist(participant, {
        approvalRequested: awaitingChecker.has(participant.participantId),
      }),
    };
    if (participant.partnerStatus !== 'suspended' && participant.partnerStatus !== 'terminated') {
      return { ...base, partnerStatusChangedAt: null, partnerStatusReason: null };
    }
    const change = changes.get(participant.partnerId);
    return {
      ...base,
      partnerStatusChangedAt: change?.created_at || null,
      partnerStatusReason: change?.reason || null,
    };
  });
}

async function getParticipant(participantId) {
  await assertCreditParticipantsReady(pool);
  const { rows } = await pool.query(
    `SELECT cp.*, p.status AS partner_status
       FROM credit_participants cp
       JOIN oxsteed_credit_partners p ON p.id = cp.partner_id
      WHERE cp.id = $1`,
    [participantId]
  );
  if (!rows.length) throw new AppError('Credit participant not found', 404, 'credit_participant_not_found');
  const participant = { ...formatParticipant(rows[0]), partnerStatus: rows[0].partner_status };
  // 700 (D-576): same read-only derivation as listMyParticipants.
  if (participant.partnerStatus !== 'suspended' && participant.partnerStatus !== 'terminated') {
    return { ...participant, partnerStatusChangedAt: null, partnerStatusReason: null };
  }
  const change = await getPartnerStatusChange({ partnerId: participant.partnerId });
  return {
    ...participant,
    partnerStatusChangedAt: change?.created_at || null,
    partnerStatusReason: change?.reason || null,
  };
}

// Group 13 Slice 4j (700, display-only, D-576): the latest partner
// transition for a partner. The audit event is the only place the
// removal reason is stored (the partner row carries status + updated_at
// only). Read-only: the caller scope is the participant's own partner_id,
// so another participant's reason cannot leak. Mirrors
// getAccountStatusChange (oxsteedCreditService.js); no transition is
// built here, and the participant suspend/revoke transition stays HELD.
async function getPartnerStatusChange({ partnerId }) {
  const { rows } = await pool.query(
    `SELECT reason, created_at FROM oxsteed_credit_audit_events
      WHERE action_type = 'credit.partner.transitioned'
        AND resource_type = 'credit_partner'
        AND resource_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [String(partnerId)],
  );
  return rows[0] || null;
}

// Batch form of getPartnerStatusChange: the latest transition per partner
// id, in one query.
async function getPartnerStatusChanges(partnerIds) {
  if (!partnerIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (resource_id) resource_id, reason, created_at
       FROM oxsteed_credit_audit_events
      WHERE action_type = 'credit.partner.transitioned'
        AND resource_type = 'credit_partner'
        AND resource_id = ANY($1::text[])
      ORDER BY resource_id, created_at DESC, id DESC`,
    [partnerIds.map(String)],
  );
  return new Map(rows.map((row) => [String(row.resource_id), row]));
}

async function listParticipants({ status, participantType, search, limit = 100, offset = 0 } = {}) {
  await assertCreditParticipantsReady(pool);
  const params = [];
  const filters = [];
  if (status && PARTICIPANT_STATUSES.has(status)) {
    params.push(status);
    filters.push(`cp.status = $${params.length}`);
  }
  if (participantType && PARTICIPANT_TYPES.has(participantType)) {
    params.push(participantType);
    filters.push(`cp.participant_type = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().slice(0, 80)}%`);
    filters.push(`(cp.notes ILIKE $${params.length} OR b.name ILIKE $${params.length})`);
  }
  params.push(Math.min(200, Math.max(1, Number(limit) || 100)));
  params.push(Math.max(0, Number(offset) || 0));
  const { rows } = await pool.query(
    `SELECT cp.*, p.status AS partner_status, b.name AS business_name,
            u.didit_status AS owner_didit_status,
            hu.display_name AS helper_name, hu.didit_status AS helper_didit_status
       FROM credit_participants cp
       JOIN oxsteed_credit_partners p ON p.id = cp.partner_id
       LEFT JOIN businesses b ON b.id = cp.business_id
       LEFT JOIN users u ON u.id = b.user_id
       LEFT JOIN users hu ON hu.id = cp.user_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY cp.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map((row) => ({
    ...formatParticipant(row),
    partnerStatus: row.partner_status,
    businessName: row.business_name || row.helper_name || null,
    ownerDiditStatus: row.owner_didit_status || row.helper_didit_status || null,
  }));
}

/**
 * Activation executor (LOCKED: Didit mandatory + maker-checker).
 * Runs inside the pending-action decision transaction when the checker
 * approves. Enforces, in order: participant still pending, Didit
 * verified, then flips participant + partner to active atomically.
 */
async function activateParticipantInTransaction(client, { participantId, actorUserId, reason, requestIp, correlationId }) {
  await assertCreditParticipantsReady(client);
  const { rows } = await client.query(
    `SELECT cp.* FROM credit_participants cp WHERE cp.id = $1 FOR UPDATE`,
    [participantId]
  );
  const participant = rows[0];
  if (!participant) throw new AppError('Credit participant not found', 404, 'credit_participant_not_found');
  if (participant.status === 'active') return { participant: formatParticipant(participant), replayed: true };
  if (participant.status !== 'pending') {
    throw new AppError(`Cannot activate participant from status '${participant.status}'`, 409, 'credit_participant_transition_invalid');
  }
  // Didit gate (LOCKED decision 12): participant flag first, then fall
  // back to the linked owners' users.didit_status.
  if (participant.didit_verified !== true || !isDiditVerificationFresh(participant.didit_verified_at)) {
    const ownerIds = [];
    if (participant.user_id) ownerIds.push(participant.user_id);
    if (participant.business_id) {
      const { rows: bizRows } = await client.query(
        `SELECT user_id FROM businesses WHERE id = $1`,
        [participant.business_id]
      );
      if (bizRows[0]?.user_id) ownerIds.push(bizRows[0].user_id);
    }
    if (participant.restaurant_id) {
      const { rows: restRows } = await client.query(
        `SELECT fr.owner_user_id AS user_id FROM food_restaurants fr WHERE fr.id = $1`,
        [participant.restaurant_id]
      );
      if (restRows[0]?.user_id) ownerIds.push(restRows[0].user_id);
    }
    await assertOwnersDiditVerified(client, { ownerUserIds: ownerIds, participantId });
    // Backfill the flag once owners verify, so later reads are cheap.
    // The sibling CHECK requires didit_verified_at whenever verified.
    await client.query(
      `UPDATE credit_participants SET didit_verified = TRUE, didit_verified_at = NOW() WHERE id = $1`,
      [participant.id]
    );
  }
  const normalizedReason = normalizeString(reason, 2000);
  if (!normalizedReason) throw new AppError('An audit reason is required to activate', 400, 'credit_activation_reason_required');
  await client.query(
    `UPDATE credit_participants SET status = 'active', updated_at = NOW() WHERE id = $1`,
    [participant.id]
  );
  // The linked partner activates alongside (same commit).
  await client.query(
    `UPDATE oxsteed_credit_partners SET status = 'active', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [participant.partner_id]
  );
  await insertAudit(client, {
    actionType: 'credit.participant.activated',
    actorUserId,
    partnerId: participant.partner_id,
    resourceType: 'credit_participant',
    resourceId: String(participant.id),
    reason: normalizedReason,
    correlationId: correlationId || null,
    requestIp: requestIp || null,
    beforeState: { status: 'pending' },
    afterState: { status: 'active' },
  });
  const { rows: updated } = await client.query(
    `SELECT * FROM credit_participants WHERE id = $1`,
    [participant.id]
  );
  return { participant: formatParticipant(updated[0]), replayed: false };
}

async function activateParticipant({ participantId, actorUserId, reason, requestIp, correlationId }) {
  const result = await withTransaction(pool, async (client) =>
    activateParticipantInTransaction(client, { participantId, actorUserId, reason, requestIp, correlationId }),
  'credit_participant_activate');
  // Group 13 (694): the activated subject hears about the new active
  // status. A replay (already active) sends nothing. The maker-checker
  // path does not call this wrapper — it is notified from
  // decidePendingAction instead (same helper, same idempotency key).
  if (result && !result.replayed) {
    await notifyParticipantStatusChange(result.participant, { previousStatus: 'pending' });
  }
  return result;
}

/**
 * Partner activation with guards (LOCKED: Didit mandatory). Used by the
 * maker-checker executor for credit_partner_activation actions.
 *
 * Note: the Didit read happens before transitionPartner's own transaction.
 * Didit verification is a slow human process; it cannot flip in the
 * millisecond window between the check and the transition, and the
 * activation still requires a checker's explicit approval.
 */
async function activatePartnerWithGuards({ partnerId, expectedStatus, reason, actorUserId, requestIp, correlationId }) {
  const ownerIds = await resolvePartnerOwnerUserIds(pool, partnerId);
  await assertOwnersDiditVerified(pool, { ownerUserIds: ownerIds, participantId: partnerId });
  return transitionPartner({
    partnerId,
    targetStatus: 'active',
    expectedStatus: expectedStatus || 'pending',
    reason,
    actorUserId,
    correlationId,
    requestIp,
  });
}

module.exports = {
  PARTICIPANT_TYPES,
  PARTICIPANT_STATUSES,
  CREDIT_SURFACES,
  formatParticipant,
  buildActivationChecklist,
  normalizeSurfaces,
  assertCreditParticipantsReady,
  assertOwnersDiditVerified,
  resolvePartnerOwnerUserIds,
  applyForCreditParticipation,
  enrollParticipant,
  getParticipant,
  listMyParticipants,
  listParticipants,
  activateParticipant,
  activateParticipantInTransaction,
  activatePartnerWithGuards,
  notifyParticipantStatusChange,
};
