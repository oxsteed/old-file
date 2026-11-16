'use strict';

/**
 * Reviewer side of progressive access (spec: "Review queue design",
 * "Proposed reviewer API contracts", "Proposed decision payload and server
 * ordering"). Queue filters and every read/write are bound server-side to
 * the capabilities the reviewer may decide.
 */

const pool = require('../../db');
const registry = require('./policyRegistry');
const lifecycle = require('./lifecycle');
const resolver = require('./resolver');
const access = require('./accessService');
const { lookupGrants } = require('../../middleware/adminAuth');

const { tx, idempotent, writeDecision, enqueue, assertVersion, err, subjectKey } = access._internal;

const REVIEW_PERMISSIONS = Object.freeze([...new Set(registry.listCapabilities().map((c) => c.reviewPermission))]);

/** Load the reviewer's live authority (re-read on every call; never cached). */
async function loadReviewer(user, db = pool) {
  const { rows } = await db.query(
    'SELECT id, role, is_active, deleted_at FROM users WHERE id = $1',
    [user.id],
  );
  const u = rows[0];
  if (!u || u.deleted_at || u.is_active === false) return { id: user.id, role: null, permissions: new Set() };
  const permissions = new Set();
  if (u.role === 'admin') {
    for (const perm of REVIEW_PERMISSIONS) {
      const grants = await lookupGrants(u.id, perm);
      if (grants.some((g) => g.region_id == null)) permissions.add(perm);
    }
  }
  return { id: u.id, role: u.role, isSuper: u.role === 'super_admin', permissions };
}

function reviewableCapabilities(reviewer) {
  return registry.listCapabilities()
    .filter((c) => resolver.canReview(reviewer, { applicant_id: '__none__', capability: c.key }).allowed)
    .map((c) => c.key);
}

function toReviewerView(row, { includeAnswers = true } = {}) {
  const view = access._internal.toApplicantView(row);
  delete view.availableActions;
  return {
    ...view,
    answers: includeAnswers ? view.answers : undefined,
    applicant: {
      id: row.applicant_id,
      displayName: row.applicant_name || null,
      emailVerified: row.applicant_email_verified ?? null,
      identityVerified: row.applicant_identity_verified ?? null,
      memberSince: row.applicant_created_at || null,
    },
    assignedReviewerId: row.assigned_reviewer_id || null,
    reviewerActions: lifecycle.availableReviewerActions(row.status),
  };
}

const REVIEW_SELECT = `
  SELECT r.*,
         NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS applicant_name,
         u.email_verified AS applicant_email_verified,
         u.identity_verified AS applicant_identity_verified,
         u.created_at AS applicant_created_at,
         b.business_name AS subject_name
    FROM access_requests r
    JOIN users u ON u.id = r.applicant_id
    LEFT JOIN businesses b ON r.subject_type = 'business' AND b.id::text = r.subject_id`;

async function listQueue(user, { status = 'submitted', capability = null, limit = 25, after = null } = {}) {
  const reviewer = await loadReviewer(user);
  const allowed = reviewableCapabilities(reviewer);
  if (!allowed.length) throw err(403, 'decision_not_permitted', 'You cannot review access applications.');
  const statuses = status === 'open' ? ['submitted', 'in_review', 'needs_information'] : [status];
  if (!statuses.every((s) => registry.REQUEST_STATUSES.includes(s))) throw err(400, 'validation_failed', 'Invalid status filter.', { fields: { status: 'invalid' } });
  let caps = allowed;
  if (capability) {
    if (!allowed.includes(capability)) throw err(403, 'decision_not_permitted', 'You cannot review that application type.');
    caps = [capability];
  }
  const lim = Math.max(1, Math.min(100, Number(limit) || 25));
  const params = [statuses, caps, lim + 1];
  let cursor = '';
  if (after != null) {
    if (!/^\d{1,18}$/.test(String(after))) throw err(400, 'validation_failed', 'Invalid cursor.', { fields: { after: 'invalid' } });
    params.push(String(after));
    cursor = 'AND r.id > $4';
  }
  const { rows } = await pool.query(
    `${REVIEW_SELECT}
      WHERE r.status = ANY($1::text[]) AND r.capability = ANY($2::text[]) ${cursor}
      ORDER BY r.id ASC LIMIT $3`,
    params,
  );
  const page = rows.slice(0, lim);
  return {
    requests: page.map((r) => toReviewerView(r, { includeAnswers: false })),
    nextCursor: rows.length > lim ? String(page[page.length - 1].id) : null,
    capabilities: allowed,
  };
}

async function getForReview(user, id) {
  if (!/^\d{1,18}$/.test(String(id))) throw err(404, 'access_request_not_found', 'Application not found.');
  const reviewer = await loadReviewer(user);
  const { rows } = await pool.query(`${REVIEW_SELECT} WHERE r.id = $1`, [id]);
  const row = rows[0];
  // Resource hiding: an application outside the reviewer's authority is 404.
  if (!row || !resolver.canReview(reviewer, row).allowed) throw err(404, 'access_request_not_found', 'Application not found.');
  const { rows: history } = await pool.query(
    `SELECT id, action, from_status, to_status, request_version, actor_id, actor_type, reviewer_authority,
            evidence_revision, policy_version, public_reason_code, internal_note, created_at
       FROM access_request_decisions WHERE request_id = $1 ORDER BY request_version`,
    [id],
  );
  const { rows: related } = await pool.query(
    `SELECT id, capability, status, subject_key, created_at FROM access_requests
      WHERE applicant_id = $1 AND id <> $2 ORDER BY id DESC LIMIT 20`,
    [row.applicant_id, id],
  );
  const facts = await access.loadFacts(row.applicant_id);
  return {
    request: toReviewerView(row),
    history,
    related: related.map((r) => ({ ...r, id: String(r.id) })),
    currentAccess: resolver.project(facts).personal,
    policy: registry.publicPolicy(row.capability),
    currentPolicyVersion: (registry.getCapability(row.capability) || {}).version || null,
  };
}

const DECISION_ACTIONS = Object.freeze(['claim', 'request_information', 'approve', 'decline']);

async function decide(user, id, { action, expectedVersion, reasonCode = null, note = null, informationRequest = null, evidenceRevision = null } = {}, { idemKey = null } = {}) {
  if (!DECISION_ACTIONS.includes(action)) throw err(400, 'validation_failed', 'Unknown decision.', { fields: { decision: 'invalid' } });
  if (reasonCode != null && !lifecycle.isPublicReasonCode(reasonCode)) throw err(400, 'validation_failed', 'Unknown reason.', { fields: { reasonCode: 'invalid' } });
  if ((action === 'decline' || action === 'request_information') && !reasonCode) throw err(400, 'validation_failed', 'A reason is required.', { fields: { reasonCode: 'required' } });
  if (action === 'request_information' && (typeof informationRequest !== 'string' || !informationRequest.trim() || informationRequest.length > 1000)) {
    throw err(400, 'validation_failed', 'Tell the applicant what to add.', { fields: { informationRequest: 'required' } });
  }
  if (note != null && (typeof note !== 'string' || note.length > 2000)) throw err(400, 'validation_failed', 'Note too long.', { fields: { note: 'too_long' } });

  return idempotent(user.id, idemKey, `review:${action}`, String(id), { expectedVersion, reasonCode, note, informationRequest, evidenceRevision }, async (client) => {
    if (!/^\d{1,18}$/.test(String(id))) throw err(404, 'access_request_not_found', 'Application not found.');
    const { rows } = await client.query('SELECT * FROM access_requests WHERE id = $1 FOR UPDATE', [id]);
    const row = rows[0];
    // Authority re-resolved INSIDE the lock (revoked reviewers lose the write).
    const reviewer = await loadReviewer(user, client);
    const authority = row ? resolver.canReview(reviewer, row) : { allowed: false };
    if (!row || !authority.allowed) {
      if (row && authority.reason === 'self_review_forbidden') throw err(403, 'self_review_forbidden', 'You cannot review your own application.');
      throw err(404, 'access_request_not_found', 'Application not found.');
    }
    assertVersion(row, expectedVersion);
    const toStatus = lifecycle.reviewerNext(action, row.status);
    if (!toStatus) throw err(409, 'invalid_transition', 'This application cannot do that right now.', { current: access._internal.toApplicantSummary(row) });
    if (evidenceRevision != null && evidenceRevision !== row.evidence_revision) {
      throw err(409, 'request_version_conflict', 'The applicant changed their answers.', { current: access._internal.toApplicantSummary(row) });
    }
    const cap = registry.getCapability(row.capability);
    if (action === 'approve') {
      // Re-validate against the CURRENT policy; a changed policy needs new facts.
      if (row.policy_version !== cap.version) throw err(409, 'policy_changed', 'The policy changed; request updated information first.');
      const check = lifecycle.validateAnswers(row.capability, row.answers || {}, { mode: 'submit' });
      if (!check.ok) throw err(409, 'policy_changed', 'The answers no longer meet the policy.', { fields: check.fields });
      const facts = await access.loadFacts(row.applicant_id, client);
      if (!resolver.accountActive(facts.user)) throw err(409, 'applicant_inactive', 'The applicant account is not active.');
    }

    const decisionId = await writeDecision(client, row, {
      action, toStatus, actorId: user.id, actorType: 'reviewer', authority: authority.reason,
      reasonCode: action === 'approve' ? (reasonCode || 'review_complete') : reasonCode, note,
    });
    const { rows: updated } = await client.query(
      `UPDATE access_requests
          SET status = $2::varchar, version = version + 1, updated_at = NOW(),
              public_reason_code = $3::varchar,
              information_request = CASE WHEN $2::varchar = 'needs_information' THEN $4::varchar ELSE information_request END,
              assigned_reviewer_id = CASE WHEN $5::varchar = 'claim' THEN $6::uuid ELSE assigned_reviewer_id END,
              decided_at = CASE WHEN $2::varchar IN ('approved','declined') THEN NOW() ELSE decided_at END
        WHERE id = $1 RETURNING *`,
      [row.id, toStatus, action === 'approve' ? (reasonCode || 'review_complete') : reasonCode,
        informationRequest ? informationRequest.trim() : null, action, user.id],
    );

    let grantId = null;
    if (action === 'approve') {
      const { rows: g } = await client.query(
        `INSERT INTO access_grants
           (user_id, capability, subject_type, subject_id, subject_key, status, provenance,
            source_request_id, source_decision_id, policy_version, granted_by)
         VALUES ($1,$2,$3,$4,$5,'active','request',$6,$7,$8,$9)
         ON CONFLICT (user_id, capability, subject_key) DO UPDATE
           SET status = 'active', provenance = 'request', source_request_id = EXCLUDED.source_request_id,
               source_decision_id = EXCLUDED.source_decision_id, policy_version = EXCLUDED.policy_version,
               granted_by = EXCLUDED.granted_by, granted_at = NOW(), status_changed_at = NOW(),
               status_changed_by = EXCLUDED.granted_by, status_reason_code = 'review_complete',
               version = access_grants.version + 1, updated_at = NOW()
         RETURNING id`,
        [row.applicant_id, row.capability, row.subject_type, row.subject_id, row.subject_key,
          row.id, decisionId, cap.version, user.id],
      );
      grantId = g[0].id;
    }
    if (['approve', 'decline', 'request_information'].includes(action)) {
      await enqueue(client, {
        eventType: `access_request.${toStatus}`,
        userId: row.applicant_id,
        requestId: row.id,
        grantId,
        payload: { capability: row.capability, reasonCode: updated[0].public_reason_code },
        dedupeKey: `decision:${decisionId}`,
      });
    }
    await access.bumpProjection(client, row.applicant_id);
    return { status: 200, body: { request: toReviewerView(updated[0]), grantId: grantId ? String(grantId) : null } };
  });
}

const GRANT_TRANSITIONS = Object.freeze({
  revoke: { from: ['active', 'suspended'], to: 'revoked' },
  suspend: { from: ['active'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'active' },
});

async function changeGrant(user, grantId, { action, expectedVersion, reasonCode } = {}, { idemKey = null } = {}) {
  const t = GRANT_TRANSITIONS[action];
  if (!t) throw err(400, 'validation_failed', 'Unknown action.', { fields: { action: 'invalid' } });
  if (!reasonCode || !lifecycle.isPublicReasonCode(reasonCode)) throw err(400, 'validation_failed', 'A reason is required.', { fields: { reasonCode: 'required' } });
  return idempotent(user.id, idemKey, `grant:${action}`, String(grantId), { expectedVersion, reasonCode }, async (client) => {
    if (!/^\d{1,18}$/.test(String(grantId))) throw err(404, 'access_grant_not_found', 'Not found.');
    const { rows } = await client.query('SELECT * FROM access_grants WHERE id = $1 FOR UPDATE', [grantId]);
    const g = rows[0];
    const reviewer = await loadReviewer(user, client);
    const authority = g ? resolver.canReview(reviewer, { applicant_id: g.user_id, capability: g.capability }) : { allowed: false };
    if (!g || !authority.allowed) {
      if (g && authority.reason === 'self_review_forbidden') throw err(403, 'self_review_forbidden', 'You cannot change your own access.');
      throw err(404, 'access_grant_not_found', 'Not found.');
    }
    if (g.version !== expectedVersion) throw err(409, 'grant_version_conflict', 'This access changed since you opened it.');
    if (!t.from.includes(g.status)) throw err(409, 'invalid_transition', 'This access cannot do that right now.');
    const { rows: out } = await client.query(
      `UPDATE access_grants SET status = $2, status_changed_at = NOW(), status_changed_by = $3,
              status_reason_code = $4, version = version + 1, updated_at = NOW()
        WHERE id = $1 RETURNING id, user_id, capability, subject_type, subject_id, status, version, provenance`,
      [g.id, t.to, user.id, reasonCode],
    );
    await enqueue(client, {
      eventType: `access_grant.${t.to}`, userId: g.user_id, grantId: g.id,
      payload: { capability: g.capability, reasonCode }, dedupeKey: `grant:${g.id}:${out[0].version}`,
    });
    await access.bumpProjection(client, g.user_id);
    return { status: 200, body: { grant: { ...out[0], id: String(out[0].id) } } };
  });
}

async function listUserGrants(user, userId) {
  const reviewer = await loadReviewer(user);
  if (!reviewableCapabilities(reviewer).length) throw err(403, 'decision_not_permitted', 'You cannot review access.');
  const { rows } = await pool.query(
    `SELECT id, capability, subject_type, subject_id, status, provenance, provenance_reason, granted_at,
            status_changed_at, status_reason_code, version
       FROM access_grants WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows
    .filter((g) => resolver.canReview(reviewer, { applicant_id: userId, capability: g.capability }).allowed)
    .map((g) => ({ ...g, id: String(g.id) }));
}

module.exports = { listQueue, getForReview, decide, changeGrant, listUserGrants, loadReviewer, REVIEW_PERMISSIONS, subjectKey };
