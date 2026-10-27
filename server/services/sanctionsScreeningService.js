'use strict';

/**
 * Sanctions screening checkpoint for the OxSteed Credit compliance
 * perimeter (Phase 5, gap 8).
 *
 * Screened subjects: the funding customer on every fiat funding decision,
 * the partner on every partner funding movement (P3-10-F07), and the
 * payout beneficiary (partner) before every settlement payout.
 * A screening is fresh for OXSTEED_CREDIT_SANCTIONS_SCREENING_TTL_HOURS
 * (default 24); older or missing screenings are re-run.
 *
 * Provider interface: a screening provider exposes
 *   screenSubject({ subjectType, subjectId, attributes }) ->
 *     { result: 'clear'|'hit'|'error', reference, hitContext, details }
 * Register a vendor (e.g. a sanctions-list API) in SCREENING_PROVIDERS.
 * Call sites only touch screenSubjectIfStale / assertSanctionsClear /
 * decideSanctionsScreening, so a vendor never requires touching the money
 * paths.
 *
 * The shipped implementation is a manual review queue
 * (provider 'manual_review'). With no automated vendor contracted, the
 * honest behavior is fail-closed: an unscreened subject screens as a
 * 'hit' with hit_context 'manual_review_required', which blocks the
 * transaction until a super-admin explicitly clears it (with a recorded
 * reason) or confirms the hit in the compliance queue. A provider 'error'
 * also blocks, raises an incident, and never silently passes.
 *
 * This is deliberately conservative: it keeps the rail unusable for real
 * money until a real screening vendor is contracted and the legal review
 * signs off. That vendor contract and the legal sign-off are human /
 * operational steps, not code.
 *
 * P3-10-F20 (informational, by design): with provider 'manual_review'
 * every subject screens as a hit, so each customer needs an admin
 * clearance per SCREENING_TTL_HOURS window (default 24h) before fiat
 * funding or payouts. That per-customer daily clearance burden is the
 * known cost of the fail-closed posture, not a bug. Contracting an
 * automated vendor (OXSTEED_CREDIT_SANCTIONS_PROVIDER) removes it; do
 * not "fix" it by lengthening the TTL or auto-clearing manual_review
 * hits, which would silently re-open the sanctions perimeter.
 */

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { insertAudit } = require('./oxsteedCreditAdminService');
const { recordIncident } = require('./incidentStore');
const { sendNotification } = require('./notificationService');

const SANCTIONS_PROVIDER_NAME = process.env.OXSTEED_CREDIT_SANCTIONS_PROVIDER || 'manual_review';
const SCREENING_TTL_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_SANCTIONS_SCREENING_TTL_HOURS || '24', 10) || 24
);
const SANCTIONS_REVIEW_SLA_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_SANCTIONS_REVIEW_SLA_HOURS || '24', 10) || 24
);

const MANUAL_REVIEW_HIT_CONTEXT = 'manual_review_required';

function normalizeString(value, max = 255) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text.slice(0, max);
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function formatScreening(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    subjectType: row.subject_type,
    subjectId: String(row.subject_id),
    subjectName: row.subject_name || null,
    subjectEmail: row.subject_email || null,
    provider: row.provider,
    result: row.result,
    hitContext: row.hit_context,
    payloadHash: row.payload_hash,
    screenedAt: row.screened_at,
    clearedAt: row.cleared_at,
    clearedBy: row.cleared_by ? String(row.cleared_by) : null,
    clearReason: row.clear_reason,
    slaDueAt: row.sla_due_at,
    createdAt: row.created_at,
  };
}

/**
 * Manual review fallback: without an automated vendor, screening cannot
 * clear anyone by itself. Every unscreened subject returns a hit that
 * routes to the admin compliance queue.
 */
const manualReviewProvider = {
  name: 'manual_review',
  async screenSubject({ subjectType, subjectId }) {
    return {
      result: 'hit',
      reference: `manual:${subjectType}:${subjectId}:${Date.now()}`,
      hitContext: MANUAL_REVIEW_HIT_CONTEXT,
      details: {
        note: 'No automated sanctions vendor is configured. A human reviewer must clear this subject.',
      },
    };
  },
};

// In-house provider over the public official lists (licence readiness:
// no paid vendor). Selected with OXSTEED_CREDIT_SANCTIONS_PROVIDER=
// in_house_lists once the lists are ingested; it fails closed ('error')
// whenever a required list is missing or stale.
const inHouseListsProvider = {
  name: 'in_house_lists',
  screenSubject(args) {
    return require('./creditCompliance/sanctionsListService').inHouseListProvider.screenSubject(args);
  },
};

const SCREENING_PROVIDERS = Object.freeze({
  manual_review: manualReviewProvider,
  in_house_lists: inHouseListsProvider,
});

function getScreeningProvider(name) {
  const provider = SCREENING_PROVIDERS[name || SANCTIONS_PROVIDER_NAME];
  if (!provider) throw new AppError(`Unknown sanctions screening provider '${name}'`, 500, 'credit_sanctions_provider_unknown');
  return provider;
}

async function getLatestScreening(client, { subjectType, subjectId }) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_sanctions_screenings
      WHERE subject_type = $1 AND subject_id = $2
      ORDER BY (confirmed_at IS NOT NULL AND cleared_at IS NULL) DESC, screened_at DESC
      LIMIT 1`,
    [subjectType, subjectId]
  );
  return rows[0] || null;
}

function isConfirmedBlock(screening) {
  return Boolean(screening && screening.confirmed_at && !screening.cleared_at);
}

function isScreeningFresh(screening, now = new Date()) {
  if (!screening) return false;
  // A confirmed true match never expires into a rescreen that could clear it.
  if (isConfirmedBlock(screening)) return true;
  const screenedAt = new Date(screening.screened_at);
  return now.getTime() - screenedAt.getTime() < SCREENING_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Build a minimal identity profile for the screening provider. Raw identity
 * documents and hashes never leave this process; only ordinary identifying
 * attributes needed by the contracted provider are passed through.
 */
async function loadSubjectAttributes(client, { subjectType, subjectId }) {
  if (subjectType === 'customer') {
    const { rows } = await client.query(
      `SELECT u.first_name, u.last_name, u.email, u.phone, u.country,
              iv.verified_name
         FROM users u
         LEFT JOIN LATERAL (
           SELECT verified_name FROM identity_verifications
            WHERE user_id = u.id AND status = 'verified'
            ORDER BY updated_at DESC NULLS LAST LIMIT 1
         ) iv ON TRUE
        WHERE u.id = $1
        LIMIT 1`,
      [subjectId]
    );
    const row = rows[0] || {};
    return Object.fromEntries(Object.entries({
      firstName: row.first_name,
      lastName: row.last_name,
      verifiedName: row.verified_name,
      email: row.email,
      phone: row.phone,
      country: row.country,
    }).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== ''));
  }
  if (subjectType === 'partner') {
    const { rows } = await client.query(
      `SELECT COALESCE(b.business_name, fr.display_name) AS business_name,
              u.first_name, u.last_name, u.email, u.phone, u.country
         FROM oxsteed_credit_partners p
         LEFT JOIN businesses b ON b.id = p.business_id
         LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
         LEFT JOIN users u ON u.id = COALESCE(b.user_id, fr.owner_user_id)
        WHERE p.id = $1
        LIMIT 1`,
      [subjectId]
    );
    const row = rows[0] || {};
    return Object.fromEntries(Object.entries({
      businessName: row.business_name,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      country: row.country,
    }).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== ''));
  }
  return {};
}

/**
 * P3-10-F10: sanctions lifecycle notifications must reach the affected
 * user. Customer subjects are users directly; partner subjects resolve to
 * the owning user so a blocked payout / conversion is not silent either.
 * Returns the user id to notify, or null when it cannot be resolved.
 */
async function resolveNotifyUserId(client, { subjectType, subjectId }) {
  if (subjectType === 'customer') return subjectId;
  if (subjectType === 'partner') {
    const { rows } = await client.query(
      `SELECT COALESCE(b.user_id, fr.owner_user_id) AS owner_user_id
         FROM oxsteed_credit_partners p
         LEFT JOIN businesses b ON b.id = p.business_id
         LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE p.id = $1
        LIMIT 1`,
      [subjectId]
    );
    return rows[0]?.owner_user_id || null;
  }
  return null;
}

/**
 * Run the provider when no fresh screening exists and persist the row.
 * Returns the screening row (fresh or newly created).
 */
async function screenSubjectIfStale(client, { subjectType, subjectId, attributes = {}, force = false, triggerReason = null }) {
  const existing = await getLatestScreening(client, { subjectType, subjectId });
  if (isConfirmedBlock(existing)) return existing;
  if (!force && isScreeningFresh(existing)) return existing;
  const provider = getScreeningProvider();
  const subjectAttributes = await loadSubjectAttributes(client, { subjectType, subjectId });
  const providerAttributes = { ...subjectAttributes, ...(attributes || {}) };
  let outcome;
  try {
    outcome = await provider.screenSubject({ subjectType, subjectId, attributes: providerAttributes, client });
  } catch (error) {
    outcome = { result: 'error', reference: null, hitContext: null, details: { error: error.message } };
  }
  const result = outcome?.result === 'clear' || outcome?.result === 'hit' ? outcome.result : 'error';
  const { rows } = await client.query(
    `INSERT INTO oxsteed_credit_sanctions_screenings
       (subject_type, subject_id, provider, result, hit_context, payload_hash, sla_due_at)
     VALUES ($1, $2, $3, $4::varchar, $5, $6,
             CASE WHEN $4::varchar = 'hit' THEN NOW() + ($7 * INTERVAL '1 hour') ELSE NULL END)
     RETURNING *`,
    [
      subjectType,
      subjectId,
      provider.name,
      result,
      normalizeString(outcome?.hitContext || outcome?.details?.error || null, 1000) || null,
      payloadHash({ subjectType, subjectId, attributes: providerAttributes, reference: outcome?.reference || null }),
      SANCTIONS_REVIEW_SLA_HOURS,
    ]
  );
  if (outcome && outcome.evidence && rows[0]) {
    await require('./creditCompliance/sanctionsListService').recordScreeningEvidence(client, rows[0], {
      subjectType, subjectId, evidence: outcome.evidence, triggerReason,
    });
  }
  return rows[0];
}

/**
 * Gate for money movement. Throws AppError on denial:
 *   - hit without an admin clearance -> 403 credit_sanctions_match
 *   - provider error -> 503 credit_sanctions_screening_unavailable + incident
 * A hit the admin explicitly cleared (cleared_at + reason) passes while the
 * screening is fresh.
 */
async function assertSanctionsClear(client, { subjectType, subjectId, context = {} }) {
  const screening = await screenSubjectIfStale(client, { subjectType, subjectId, attributes: context.attributes });
  if (screening.result === 'clear') return { screening: formatScreening(screening), cleared: false };
  if (screening.result === 'hit' && screening.cleared_at) {
    return { screening: formatScreening(screening), cleared: true };
  }
  if (screening.result === 'error') {
    await recordIncident({
      type: 'oxsteed_credit_sanctions_screening_failed',
      severity: 'critical',
      message: `Sanctions screening provider failed for ${subjectType} ${subjectId}; transaction blocked`,
      dedupeKey: `credit-sanctions-error:${subjectType}:${subjectId}`,
      details: { subjectType, subjectId, provider: screening.provider },
    });
    throw new AppError(
      'Sanctions screening is temporarily unavailable. The transaction was blocked; try again later.',
      503,
      'credit_sanctions_screening_unavailable',
      { subjectType, subjectId: String(subjectId) }
    );
  }
  // P3-10-F10: a blocked hit was silent; the customer discovered it only
  // via repeated funding failures. Notify once per screening (delivery key
  // dedupes retries) so they know credit activity is paused for review.
  const notifyUserId = await resolveNotifyUserId(client, { subjectType, subjectId });
  if (notifyUserId) {
    void sendNotification({
      userId: notifyUserId,
      type: 'credit_sanctions_review_required',
      data: { screeningId: String(screening.id), subjectType },
      action_url: '/wallet',
      idempotencyKey: `credit-sanctions:${screening.id}:review-required`,
    });
  }
  throw new AppError(
    'This transaction is blocked pending sanctions review. An administrator must clear the screening first.',
    403,
    'credit_sanctions_match',
    {
      subjectType,
      subjectId: String(subjectId),
      screeningId: String(screening.id),
      hitContext: screening.hit_context,
    }
  );
}

/**
 * Admin decision on a hit: 'clear' records cleared_at + reason (the hit is
 * then passable while fresh); 'confirm' leaves it blocking and opens a
 * compliance case for investigation.
 */
async function decideSanctionsScreening({ screeningId, decision, actorUserId, reason, requestIp = null }) {
  if (!screeningId) throw new AppError('Screening id is required', 400, 'credit_sanctions_screening_required');
  if (decision !== 'clear' && decision !== 'confirm') {
    throw new AppError("Decision must be 'clear' or 'confirm'", 400, 'credit_sanctions_decision_invalid');
  }
  const normalizedReason = normalizeString(reason, 1000);
  if (!normalizedReason) throw new AppError('A decision reason is required', 400, 'credit_sanctions_reason_required');
  const result = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_sanctions_screenings WHERE id = $1 FOR UPDATE`,
      [screeningId]
    );
    const screening = rows[0];
    if (!screening) throw new AppError('Sanctions screening not found', 404, 'credit_sanctions_not_found');
    if (screening.result !== 'hit') {
      throw new AppError(`Only hits can be decided (current result: '${screening.result}')`, 409, 'credit_sanctions_state_conflict');
    }
    if (decision === 'clear') {
      if (screening.cleared_at) throw new AppError('Screening was already cleared', 409, 'credit_sanctions_state_conflict');
      const { rows: updated } = await client.query(
        `UPDATE oxsteed_credit_sanctions_screenings
            SET cleared_at = NOW(), cleared_by = $2, clear_reason = $3
          WHERE id = $1 AND cleared_at IS NULL
          RETURNING *`,
        [screeningId, actorUserId, normalizedReason]
      );
      if (!updated[0]) throw new AppError('Screening was already cleared', 409, 'credit_sanctions_state_conflict');
      await insertAudit(client, {
        actionType: 'credit.sanctions.screening_cleared',
        actorUserId,
        resourceType: 'credit_sanctions_screening',
        resourceId: screeningId,
        reason: normalizedReason,
        requestIp,
        beforeState: { result: 'hit', clearedAt: null },
        afterState: { result: 'hit', clearedAt: updated[0].cleared_at },
        metadata: { subjectType: screening.subject_type, subjectId: String(screening.subject_id) },
      });
      return { screening: formatScreening(updated[0]) };
    }
    // Confirm: keep blocking (sticky: rescreens cannot replace it) and open
    // a case for investigation.
    await client.query(
      `UPDATE oxsteed_credit_sanctions_screenings SET confirmed_at = NOW(), confirmed_by = $2
        WHERE id = $1 AND confirmed_at IS NULL`,
      [screeningId, actorUserId]
    );
    const { openComplianceCase } = require('./complianceCaseService');
    const opened = await openComplianceCase(client, {
      caseType: 'sanctions_hit',
      subjectType: screening.subject_type,
      subjectId: screening.subject_id,
      severity: 'critical',
      evidence: { screeningId: String(screening.id), hitContext: screening.hit_context },
      dedupeKey: `sanctions_hit:${screening.subject_type}:${screening.subject_id}:${screening.id}`,
    });
    await insertAudit(client, {
      actionType: 'credit.sanctions.hit_confirmed',
      actorUserId,
      resourceType: 'credit_sanctions_screening',
      resourceId: screeningId,
      reason: normalizedReason,
      requestIp,
      beforeState: { result: 'hit' },
      afterState: { result: 'hit', confirmed: true, caseId: opened.case.id },
      metadata: { subjectType: screening.subject_type, subjectId: String(screening.subject_id) },
    });
    return { screening: formatScreening(screening), case: opened.case };
  }, 'credit_sanctions_decide');
  // P3-10-F10: the clear/confirm decision was silent; a cleared customer
  // never learned they could retry funding. Notify after commit so the
  // decision row is durable before the user acts on the notice.
  const decided = result.screening || {};
  if (decided.subjectType && decided.subjectId) {
    const notifyUserId = await resolveNotifyUserId(pool, { subjectType: decided.subjectType, subjectId: decided.subjectId }).catch(() => null);
    if (notifyUserId) {
      void sendNotification({
        userId: notifyUserId,
        type: decision === 'clear' ? 'credit_sanctions_cleared' : 'credit_sanctions_confirmed',
        data: { screeningId: String(screeningId), subjectType: decided.subjectType },
        action_url: '/wallet',
        idempotencyKey: `credit-sanctions:${screeningId}:${decision}`,
      });
    }
  }
  return result;
}

async function listPendingSanctionHits(client, { limit = 50, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT s.*,
            CASE
              WHEN s.subject_type = 'customer' THEN u.email
              WHEN s.subject_type = 'partner' THEN partner_user.email
              ELSE NULL
            END AS subject_email,
            CASE
              WHEN s.subject_type = 'customer' THEN COALESCE(NULLIF(CONCAT_WS(' ', u.first_name, u.last_name), ''), u.email)
              WHEN s.subject_type = 'partner' THEN COALESCE(fr.display_name, b.business_name, CONCAT('Partner ', s.subject_id))
              ELSE NULL
            END AS subject_name
       FROM oxsteed_credit_sanctions_screenings s
       LEFT JOIN users u ON u.id::text = s.subject_id AND s.subject_type = 'customer'
       LEFT JOIN oxsteed_credit_partners p ON p.id::text = s.subject_id AND s.subject_type = 'partner'
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
       LEFT JOIN businesses b ON b.id = p.business_id
       LEFT JOIN users partner_user ON partner_user.id = COALESCE(b.user_id, fr.owner_user_id)
      WHERE s.result = 'hit' AND s.cleared_at IS NULL
      ORDER BY s.screened_at ASC
      LIMIT $1 OFFSET $2`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0)]
  );
  return rows.map((row) => formatScreening(row));
}

module.exports = {
  SANCTIONS_PROVIDER_NAME,
  SCREENING_TTL_HOURS,
  SANCTIONS_REVIEW_SLA_HOURS,
  MANUAL_REVIEW_HIT_CONTEXT,
  SCREENING_PROVIDERS,
  getScreeningProvider,
  getLatestScreening,
  loadSubjectAttributes,
  isScreeningFresh,
  isConfirmedBlock,
  screenSubjectIfStale,
  assertSanctionsClear,
  decideSanctionsScreening,
  listPendingSanctionHits,
  formatScreening,
};
