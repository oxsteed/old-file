'use strict';

/**
 * Shared dispute read model (review P3-817, P3-820).
 *
 * The dispute pages render job_title, job_amount, against_user_name,
 * resolution_notes, evidence_deadline and evidence/message counts; the API
 * used to return none of them. Every dispute read goes through this select so
 * customer, helper and admin views stay in step.
 */

function evidenceWindowDays() {
  const n = Number.parseInt(process.env.DISPUTE_EVIDENCE_WINDOW_DAYS || '7', 10);
  return Number.isInteger(n) && n > 0 && n <= 90 ? n : 7;
}

const DISPUTE_VIEW_FROM = `
  FROM disputes d
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN payments p ON p.id = COALESCE(
    d.payment_id,
    (SELECT id FROM payments WHERE job_id = d.job_id ORDER BY id DESC LIMIT 1)
  )
  LEFT JOIN users u_op ON u_op.id = d.opened_by
  LEFT JOIN users u_against ON u_against.id = COALESCE(
    d.against_user,
    CASE WHEN d.opened_by = j.client_id THEN j.assigned_helper_id ELSE j.client_id END
  )
  LEFT JOIN users u_res ON u_res.id = d.resolved_by`;

function disputeViewSelect() {
  const days = evidenceWindowDays();
  return `
    d.*,
    j.title AS job_title,
    COALESCE(p.amount, j.final_price, j.job_value) AS job_amount,
    j.client_id,
    j.assigned_helper_id,
    u_against.id AS against_user_id,
    NULLIF(TRIM(COALESCE(u_against.first_name, '') || ' ' || COALESCE(u_against.last_name, '')), '') AS against_user_name,
    u_against.profile_photo_url AS against_user_avatar,
    u_op.profile_photo_url AS opened_by_avatar,
    u_op.first_name || ' ' || u_op.last_name AS opener_full_name,
    u_op.email AS opened_by_email,
    u_res.first_name || ' ' || u_res.last_name AS resolved_by_name,
    d.admin_notes AS resolution_notes,
    (COALESCE(d.opened_at, d.created_at) + INTERVAL '${days} days') AS evidence_deadline,
    (SELECT COUNT(*) FROM dispute_evidence de WHERE de.dispute_id = d.id)::int AS evidence_count,
    (SELECT COUNT(*) FROM dispute_messages dm WHERE dm.dispute_id = d.id AND dm.is_admin_only = FALSE)::int AS message_count`;
}

/** SQL predicate: $n is a party to the dispute (opener, accused, or job party). */
function partyPredicate(param) {
  return `(d.opened_by = ${param} OR d.against_user = ${param}
           OR j.client_id = ${param} OR j.assigned_helper_id = ${param})`;
}

/** In-memory check for a dispute row joined with its job. */
function isDisputeParty(row, userId) {
  if (!row || !userId) return false;
  const id = String(userId);
  return [row.opened_by, row.against_user, row.client_id, row.assigned_helper_id]
    .some((v) => v != null && String(v) === id);
}

module.exports = { DISPUTE_VIEW_FROM, disputeViewSelect, partyPredicate, isDisputeParty, evidenceWindowDays };
