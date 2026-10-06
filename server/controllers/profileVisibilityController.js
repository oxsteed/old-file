// server/controllers/profileVisibilityController.js
// Admin control over public profile visibility for helpers, businesses, and
// restaurants. Each profile type already has an owner-facing visibility flag
// (helper_profiles.is_listed, businesses.is_listed,
// food_restaurants.discovery_status), but owners can flip those back, so they
// cannot serve as compliance holds. This controller manages the sticky admin
// override instead: when is_hidden_by_admin is TRUE the public profile
// endpoints treat the profile as hidden no matter what the owner-facing flag
// says. Requires the manage_profile_visibility grant (see routes/admin.js).
//
// Workstream A additions: active-work warnings, canonical-URL preview, bulk
// hide/restore with dry-run and idempotent replay, undo against the
// append-only audit log, timezone-aware scheduled actions, and CSV export.
// Workstream B (approvals + owner notifications) is consumed defensively:
// those modules may not exist yet, and their absence must never break an
// admin moderation request except where an approval gate is explicitly
// required (bulk > 10 items, hiding with active work, scheduled actions).

const crypto = require('crypto');
const db     = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const { getActiveWork } = require('../services/profileVisibilityActiveWork');
const { withTransaction } = require('../utils/transaction');

const PROFILE_TYPES = ['helper', 'business', 'restaurant'];
const REASONS = ['incomplete_profile', 'non_compliance', 'admin_decision', 'other'];

const TABLE_BY_TYPE = {
  helper:     { table: 'helper_profiles',  idCol: 'user_id', targetType: 'helper_profile' },
  business:   { table: 'businesses',       idCol: 'id',      targetType: 'business' },
  restaurant: { table: 'food_restaurants', idCol: 'id',      targetType: 'restaurant' },
};

// ─── Shared profile directory CTE ────────────────────────────────────────────
// One source of truth for the admin directory; reused by search (paginated)
// and export (capped, unbounded pagination-free).
const PROFILES_CTE = `
profiles AS (
  SELECT 'helper'::text AS profile_type,
         u.id::text AS profile_id,
         COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS display_name,
         u.email::text AS detail,
         COALESCE(hp.is_hidden_by_admin, FALSE) AS is_hidden_by_admin,
         hp.hidden_reason,
         COALESCE(hp.is_listed, TRUE) AS owner_visible,
         (u.deleted_at IS NULL) AS is_active,
         u.created_at AS created_at
    FROM users u
    JOIN helper_profiles hp ON hp.user_id = u.id
  UNION ALL
  SELECT 'business'::text,
         b.id::text,
         COALESCE(NULLIF(TRIM(b.business_name), ''), NULLIF(TRIM(u.email), ''), 'Business ' || b.id::text)::text,
         u.email::text,
         COALESCE(b.is_hidden_by_admin, FALSE),
         b.hidden_reason,
         COALESCE(b.is_listed, TRUE),
         COALESCE(b.is_active, TRUE),
         b.created_at
    FROM businesses b
    LEFT JOIN users u ON u.id = b.user_id
   WHERE b.deleted_at IS NULL
  UNION ALL
  SELECT 'restaurant'::text,
         fr.id::text,
         COALESCE(NULLIF(TRIM(fr.display_name), ''), NULLIF(TRIM(b.business_name), ''), 'Restaurant ' || fr.id::text)::text,
         COALESCE(NULLIF(TRIM(b.business_name), ''), 'Restaurant ' || fr.id::text)::text,
         COALESCE(fr.is_hidden_by_admin, FALSE),
         fr.hidden_reason,
         (fr.discovery_status = 'visible'),
         TRUE,
         fr.created_at
    FROM food_restaurants fr
    JOIN businesses b ON b.id = fr.business_id
   WHERE b.deleted_at IS NULL
)`;

// $1 = q ('' means browse), $2 = ILIKE pattern, $3 = type filter,
// $4 = visibility filter. Same semantics as the search endpoint.
const PROFILES_FILTER = `
  ($1 = '' OR display_name ILIKE $2 OR detail ILIKE $2)
  AND ($3 = 'all' OR profile_type = $3)
  AND ($4 = 'all'
    OR ($4 = 'hidden' AND is_hidden_by_admin)
    OR ($4 = 'visible' AND NOT is_hidden_by_admin AND owner_visible AND is_active)
    OR ($4 = 'unlisted' AND NOT is_hidden_by_admin AND NOT owner_visible)
    OR ($4 = 'active' AND is_active)
    OR ($4 = 'inactive' AND NOT is_active))`;

function validateProfileItem(item) {
  const spec = TABLE_BY_TYPE[item?.profile_type];
  if (!spec) return 'profile_type must be helper, business, or restaurant.';
  if (item.profile_id === undefined || item.profile_id === null || String(item.profile_id).trim() === '') {
    return 'profile_id is required.';
  }
  if (typeof item.is_visible !== 'boolean') return 'is_visible must be a boolean.';
  if (item.reason !== undefined && item.reason !== null && item.reason !== '' && !REASONS.includes(item.reason)) {
    return `reason must be one of: ${REASONS.join(', ')}.`;
  }
  return null;
}

// ─── Workstream B integration (defensive) ────────────────────────────────────
// These modules are owned by workstream B and may not exist yet. Everything
// here is guarded so their absence degrades to an explicit 409 (approval
// required) or a skipped notification, never a 500.
function loadApprovals() {
  try {
    return require('../services/profileVisibilityApprovals');
  } catch (err) {
    return null;
  }
}
function loadNotifications() {
  try {
    return require('../services/profileVisibilityNotifications');
  } catch (err) {
    return null;
  }
}

async function verifyApproval({ approvalId, actionType, payload }) {
  // Workstream B binds approvals to the exact reviewed payload via a
  // sha256 fingerprint, so verification must pass the canonical payload the
  // approval was requested with (see build*ApprovalPayload below).
  const approvals = loadApprovals();
  if (!approvals || typeof approvals.verifyApprovalForAction !== 'function' || !approvalId) return null;
  try {
    const row = await approvals.verifyApprovalForAction({ approvalId, actionType, payload });
    return row || null;
  } catch (err) {
    logger.warn('profileVisibility approval verification failed', { error: err.message });
    return null;
  }
}

async function requestSingleApproval({ adminId, payload }) {
  const approvals = loadApprovals();
  if (!approvals || typeof approvals.requestApproval !== 'function') return null;
  try {
    const { approval } = await approvals.requestApproval({
      actionType: 'single',
      payload,
      requestedBy: adminId,
      idempotencyKey: `pv-single-${payload.profile_type}-${payload.profile_id}-${adminId}`.slice(0, 200),
    });
    return approval || null;
  } catch (err) {
    logger.warn('profileVisibility approval request failed', { error: err.message });
    return null;
  }
}

async function consumeApprovalQuietly(approvalId) {
  const approvals = loadApprovals();
  if (approvals && typeof approvals.consumeApproval === 'function' && approvalId) {
    try {
      await approvals.consumeApproval(approvalId);
    } catch (err) {
      logger.warn('profileVisibility approval consume failed', { error: err.message, approvalId });
    }
  }
}

// Canonical approval payloads. Workstream B fingerprints the exact payload
// that was reviewed, so the approval request (frontend / B approvals UI) and
// the verification here must build byte-identical payloads: same keys, same
// scalar types, items in the same order. Optional keys are omitted when
// empty rather than sent as null.
function canonicalBulkItem(item) {
  const out = {
    profile_type: String(item.profile_type).toLowerCase(),
    profile_id: String(item.profile_id),
    is_visible: item.is_visible === true,
  };
  if (item.reason != null && item.reason !== '') out.reason = item.reason;
  if (item.note != null && item.note !== '') out.note = item.note;
  return out;
}

function buildBulkApprovalPayload(items) {
  return { items: items.map(canonicalBulkItem) };
}

function buildScheduledApprovalPayload({ profile_type, profile_id, is_visible, scheduled_at, reason, note }) {
  const out = {
    profile_type: String(profile_type).toLowerCase(),
    profile_id: String(profile_id),
    is_visible: is_visible === true,
    scheduled_at,
  };
  if (reason != null && reason !== '') out.reason = reason;
  if (note != null && note !== '') out.note = note;
  return out;
}

function buildSingleApprovalPayload({ profile_type, profile_id, is_visible }) {
  return {
    profile_type: String(profile_type).toLowerCase(),
    profile_id: String(profile_id),
    is_visible: is_visible === true,
  };
}

async function notifyOwnerQuietly({ profileType, profileId, isVisible, actorId, idempotencyKey }) {
  const notifier = loadNotifications();
  if (notifier && typeof notifier.notifyOwnerOfVisibilityChange === 'function') {
    try {
      // Workstream B's notifier is idempotent on idempotencyKey and never
      // throws; failures are recorded for its retry job.
      await notifier.notifyOwnerOfVisibilityChange({ profileType, profileId, isVisible, actorId, idempotencyKey });
    } catch (err) {
      // Notifications must never fail the moderation request itself.
      logger.warn('profileVisibility owner notification failed', { error: err.message, profileType, profileId });
    }
  }
}

// ─── GET /api/admin/profile-visibility/search ────────────────────────────────
// Returns a bounded, unified directory. An empty q intentionally means
// "browse" so the admin page can show the first page without an unbounded
// query. Filters and pagination are applied to the combined profile stream.

exports.searchProfiles = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'all').toLowerCase();
    const visibility = String(req.query.visibility || 'all').toLowerCase();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    if (q.length === 1) return res.json({ results: [] });
    if (!['all', ...PROFILE_TYPES].includes(type)) {
      return res.status(400).json({ error: 'Invalid profile type.' });
    }
    if (!['all', 'visible', 'hidden', 'unlisted', 'active', 'inactive'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility filter.' });
    }

    const like = `%${q}%`;
    const { rows } = await db.query(
      `WITH ${PROFILES_CTE}, filtered AS (
         SELECT *, COUNT(*) OVER()::int AS total_count
           FROM profiles
          WHERE ${PROFILES_FILTER}
       )
       SELECT * FROM filtered
        ORDER BY created_at DESC NULLS LAST, display_name ASC
        LIMIT $5 OFFSET $6`,
      [q, like, type, visibility, limit, offset]
    );

    const total = rows[0]?.total_count || 0;
    return res.json({
      results: rows.map((r) => ({
        profile_type: r.profile_type,
        profile_id: r.profile_id,
        display_name: r.display_name,
        detail: r.detail,
        is_hidden_by_admin: !!r.is_hidden_by_admin,
        hidden_reason: r.hidden_reason,
        owner_visible: !!r.owner_visible,
        is_active: !!r.is_active,
        is_visible: !r.is_hidden_by_admin && !!r.owner_visible && !!r.is_active,
      })),
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    logger.error('profileVisibility search error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Search failed.' });
  }
};

// ─── GET /api/admin/profile-visibility/:type/:id/history ────────────────────
// Visibility changes are recorded in the append-only admin audit log. Expose a
// narrow, read-only projection here instead of allowing the page to query the
// general audit endpoint or reveal unrelated administrative activity.
exports.getProfileHistory = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });

    const { rows } = await db.query(
      `SELECT a.id, a.action, a.description, a.before_state, a.after_state,
              a.created_at, a.admin_id,
              COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email, 'Admin') AS actor_name
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.admin_id
        WHERE a.target_type = $1
          AND (a.target_id::text = $2 OR a.target_key = $2)
          AND a.action IN ('profile_visibility_hidden', 'profile_visibility_restored')
        ORDER BY a.created_at DESC
        LIMIT 50`,
      [spec.targetType, profileId]
    );
    return res.json({ history: rows });
  } catch (err) {
    logger.error('profileVisibility history error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load profile history.' });
  }
};

// ─── Shared apply logic ──────────────────────────────────────────────────────
// Performs the sticky-flag update and writes the audit row. Callers own the
// approval/active-work gating; this never blocks on notifications.
async function applyVisibilityChange({ adminId, profileType, profileId, isVisible, reason, note, req, client = null }) {
  const spec = TABLE_BY_TYPE[profileType];
  const hide = !isVisible;
  const reasonCode = hide ? (reason || 'admin_decision') : null;
  const runner = client || db;
  const { rows } = await runner.query(
    `UPDATE ${spec.table}
        SET is_hidden_by_admin = $1,
            hidden_reason      = $2,
            hidden_at          = CASE WHEN $1 THEN NOW() ELSE NULL END,
            hidden_by          = CASE WHEN $1 THEN $3::uuid ELSE NULL END,
            updated_at         = NOW()
      WHERE ${spec.idCol} = $4
      RETURNING is_hidden_by_admin, hidden_reason, hidden_at`,
    [hide, reasonCode, adminId, profileId]
  );
  if (!rows.length) {
    const err = new Error('Profile not found.');
    err.statusCode = 404;
    throw err;
  }

  try {
    await logAdminAction({
      adminId,
      action: hide ? 'profile_visibility_hidden' : 'profile_visibility_restored',
      targetType: spec.targetType,
      targetId: String(profileId),
      before: { is_hidden_by_admin: !hide },
      after: { is_hidden_by_admin: hide, hidden_reason: reasonCode },
      description: [reasonCode, note].filter(Boolean).join(' - ') || null,
      req,
      client,
      throwOnError: Boolean(client),
    });
  } catch (e) {
    if (!client) { /* standalone audit logging remains best effort */ }
    else throw e;
  }

  return { spec, hide, reasonCode, row: rows[0] };
}

async function loadCurrentHidden(profileType, profileId) {
  const spec = TABLE_BY_TYPE[profileType];
  const { rows } = await db.query(
    `SELECT is_hidden_by_admin, hidden_reason FROM ${spec.table} WHERE ${spec.idCol} = $1 LIMIT 1`,
    [profileId]
  );
  return rows.length ? rows[0] : null;
}

// ─── PUT /api/admin/profile-visibility ───────────────────────────────────────
// Body: { profile_type: 'helper'|'business'|'restaurant', profile_id,
//         is_visible: boolean, reason?: ..., note?: string, approval_id?: string }
//
// Hiding a profile that has active work requires a workstream B approval: if
// approval_id verifies, the hide proceeds (and the approval is consumed);
// otherwise an approval request is created and the caller gets 409 with the
// new approval id so the UI can route into the approval flow.
exports.setProfileVisibility = async (req, res) => {
  try {
    const { profile_type, profile_id, is_visible, reason, note, approval_id } = req.body || {};
    const validationError = validateProfileItem({ profile_type, profile_id, is_visible, reason });
    if (validationError) return res.status(400).json({ error: validationError });

    const current = await loadCurrentHidden(profile_type, profile_id);
    if (!current) return res.status(404).json({ error: 'Profile not found.' });

    const hide = !is_visible;
    const singlePayload = () => buildSingleApprovalPayload({ profile_type, profile_id, is_visible });
    if (hide) {
      const activeWork = await getActiveWork(profile_type, String(profile_id));
      if (activeWork.has_active_work) {
        const approvals = loadApprovals();
        if (!approvals || typeof approvals.requestApproval !== 'function') {
          return res.status(409).json({
            approval_required: true,
            active_work: activeWork,
            error: 'This profile has active work. An approval is required before hiding it.',
          });
        }
        if (approval_id) {
          const verified = await verifyApproval({ approvalId: approval_id, actionType: 'single', payload: singlePayload() });
          if (!verified) {
            return res.status(409).json({
              approval_required: true,
              active_work: activeWork,
              error: 'The approval is invalid, expired, or was approved for a different change.',
            });
          }
        } else {
          // Auto-create the approval request so the UI can route the admin
          // straight into the two-person review flow.
          const created = await requestSingleApproval({ adminId: req.user.id, payload: singlePayload() });
          return res.status(409).json({
            approval_required: true,
            approval_id: created?.id || null,
            active_work: activeWork,
            error: 'This profile has active work. An approval request was created; the hide will proceed once a second admin approves it.',
          });
        }
      }
    }

    const { row } = await applyVisibilityChange({
      adminId: req.user.id,
      profileType: profile_type,
      profileId: profile_id,
      isVisible: is_visible,
      reason,
      note,
      req,
    });

    // Consume a verified approval so it cannot be replayed for another hide.
    if (approval_id) await consumeApprovalQuietly(approval_id);

    await notifyOwnerQuietly({
      profileType: profile_type,
      profileId: String(profile_id),
      isVisible: is_visible,
      actorId: req.user.id,
    });

    return res.json({
      success: true,
      profile_type,
      profile_id,
      is_hidden_by_admin: row.is_hidden_by_admin,
      hidden_reason: row.hidden_reason,
      is_visible,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    logger.error('profileVisibility set error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not update profile visibility.' });
  }
};

// ─── GET /api/admin/profile-visibility/:type/:id/active-work ─────────────────
// Active-work snapshot used by the UI warning before hiding.
exports.getProfileActiveWork = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });
    const current = await loadCurrentHidden(profileType, profileId);
    if (!current) return res.status(404).json({ error: 'Profile not found.' });
    const work = await getActiveWork(profileType, profileId);
    return res.json({ profile_type: profileType, profile_id: profileId, ...work });
  } catch (err) {
    logger.error('profileVisibility active-work error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load active work.' });
  }
};

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/$/, '');
}

const CANONICAL_PATH_BY_TYPE = {
  helper: (id) => `/helpers/${id}`,
  business: (id) => `/businesses/public/${id}`,
  restaurant: (id) => `/restaurants/r/${id}`,
};

// ─── GET /api/admin/profile-visibility/:type/:id/preview ─────────────────────
// What the profile looks like publicly: canonical URL, names, and the
// effective visibility computation, so the admin can open the public page.
exports.getProfilePreview = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });

    let row;
    if (profileType === 'helper') {
      ({ rows: [row] } = await db.query(
        `SELECT COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS display_name,
                COALESCE(hp.is_hidden_by_admin, FALSE) AS is_hidden_by_admin,
                COALESCE(hp.is_listed, TRUE) AS owner_visible,
                (u.deleted_at IS NULL) AS is_active
           FROM users u
           JOIN helper_profiles hp ON hp.user_id = u.id
          WHERE u.id = $1::uuid LIMIT 1`,
        [profileId]
      ));
    } else if (profileType === 'business') {
      ({ rows: [row] } = await db.query(
        `SELECT COALESCE(NULLIF(TRIM(b.business_name), ''), 'Business ' || b.id::text) AS display_name,
                COALESCE(b.is_hidden_by_admin, FALSE) AS is_hidden_by_admin,
                COALESCE(b.is_listed, TRUE) AS owner_visible,
                COALESCE(b.is_active, TRUE) AS is_active
           FROM businesses b
          WHERE b.id = $1::bigint AND b.deleted_at IS NULL LIMIT 1`,
        [profileId]
      ));
    } else {
      ({ rows: [row] } = await db.query(
        `SELECT COALESCE(NULLIF(TRIM(fr.display_name), ''), NULLIF(TRIM(b.business_name), ''), 'Restaurant ' || fr.id::text) AS display_name,
                COALESCE(fr.is_hidden_by_admin, FALSE) AS is_hidden_by_admin,
                (fr.discovery_status = 'visible') AS owner_visible,
                TRUE AS is_active
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
          WHERE fr.id = $1::bigint AND b.deleted_at IS NULL LIMIT 1`,
        [profileId]
      ));
    }
    if (!row) return res.status(404).json({ error: 'Profile not found.' });

    const isHiddenByAdmin = !!row.is_hidden_by_admin;
    const ownerVisible = !!row.owner_visible;
    const isActive = !!row.is_active;
    return res.json({
      profile_type: profileType,
      profile_id: profileId,
      canonical_url: publicBaseUrl() + CANONICAL_PATH_BY_TYPE[profileType](encodeURIComponent(profileId)),
      display_name: row.display_name,
      is_hidden_by_admin: isHiddenByAdmin,
      owner_visible: ownerVisible,
      is_visible: !isHiddenByAdmin && ownerVisible && isActive,
    });
  } catch (err) {
    logger.error('profileVisibility preview error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load profile preview.' });
  }
};

// ─── POST /api/admin/profile-visibility/bulk ─────────────────────────────────
// Body: { items: [{ profile_type, profile_id, is_visible, reason?, note? }],
//         idempotency_key: string (required), dry_run?: boolean,
//         approval_id?: string }
//
// dry_run returns per-item analysis without writing anything. Otherwise the
// request is idempotent: a repeated idempotency_key replays the stored
// response without re-applying changes. Bulk requests over 10 items require a
// workstream B approval verified before any item is processed.
exports.bulkUpdateVisibility = async (req, res) => {
  try {
    const { items, idempotency_key, dry_run, approval_id } = req.body || {};
    if (!idempotency_key || String(idempotency_key).trim() === '') {
      return res.status(400).json({ error: 'idempotency_key is required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array.' });
    }
    if (items.length > 100) {
      return res.status(400).json({ error: 'A maximum of 100 items per bulk request is allowed.' });
    }

    if (dry_run) {
      const results = [];
      for (const item of items) {
        const validationError = validateProfileItem(item);
        if (validationError) {
          results.push({ profile_type: item?.profile_type || null, profile_id: item?.profile_id ?? null, ok: false, error: validationError });
          continue;
        }
        const current = await loadCurrentHidden(item.profile_type, item.profile_id);
        if (!current) {
          results.push({ profile_type: item.profile_type, profile_id: item.profile_id, ok: false, error: 'Profile not found.' });
          continue;
        }
        const currentHidden = !!current.is_hidden_by_admin;
        const resultingAction = !item.is_visible && !currentHidden ? 'hide'
          : item.is_visible && currentHidden ? 'restore' : 'no_change';
        const activeWork = await getActiveWork(item.profile_type, String(item.profile_id));
        results.push({
          profile_type: item.profile_type,
          profile_id: item.profile_id,
          ok: true,
          current_hidden: currentHidden,
          resulting_action: resultingAction,
          active_work: activeWork,
        });
      }
      return res.json({ dry_run: true, results });
    }

    const canonicalFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify(buildBulkApprovalPayload(items)))
      .digest('hex');

    // Claim before applying any side effects. This closes the race where two
    // requests with the same key both pass the old read-then-write check.
    // An abandoned claim can be reclaimed after ten minutes, allowing a
    // crashed worker/request to be retried without leaving the key stuck.
    const { rows: claimed } = await db.query(
      `WITH inserted AS (
         INSERT INTO bulk_visibility_idempotency
           (idempotency_key, request_fingerprint, request_payload, status, response, claimed_at, created_by)
         VALUES ($1, $2, $3::jsonb, 'processing', '{"status":"processing"}'::jsonb, NOW(), $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING idempotency_key, request_fingerprint, status, response
       ), reclaimed AS (
         UPDATE bulk_visibility_idempotency
            SET request_fingerprint = COALESCE(request_fingerprint, $2),
                request_payload = COALESCE(request_payload, $3::jsonb),
                status = 'processing',
                response = '{"status":"processing"}'::jsonb,
                claimed_at = NOW(),
                completed_at = NULL,
                created_by = COALESCE(created_by, $4)
          WHERE idempotency_key = $1
            AND status = 'processing'
            AND claimed_at < NOW() - INTERVAL '10 minutes'
            AND (request_fingerprint IS NULL OR request_fingerprint = $2)
         RETURNING idempotency_key, request_fingerprint, status, response
       )
       SELECT * FROM inserted
       UNION ALL
       SELECT * FROM reclaimed
       LIMIT 1`,
      [idempotency_key, canonicalFingerprint, JSON.stringify(items.map(canonicalBulkItem)), req.user.id]
    );
    if (!claimed.length) {
      const { rows: existing } = await db.query(
        'SELECT request_fingerprint, status, response FROM bulk_visibility_idempotency WHERE idempotency_key = $1 LIMIT 1',
        [idempotency_key]
      );
      if (existing.length && existing[0].request_fingerprint && existing[0].request_fingerprint !== canonicalFingerprint) {
        return res.status(409).json({ error: 'idempotency_key_reused_with_different_items' });
      }
      if (existing[0]?.status === 'completed') return res.json(existing[0].response);
      return res.status(409).json({ error: 'bulk_request_in_progress', retryable: true });
    }

    // Approval gate for large batches and for any hide that currently has
    // active work. The approval is fingerprint-bound to the exact item list,
    // so verification rebuilds the canonical payload. Small batches must not
    // bypass the same safety boundary merely because they contain fewer rows.
    let activeWorkRequiresApproval = false;
    for (const item of items) {
      if (item?.is_visible) continue;
      const validationError = validateProfileItem(item);
      if (validationError) continue;
      const current = await loadCurrentHidden(item.profile_type, item.profile_id);
      if (!current || current.is_hidden_by_admin) continue;
      const activeWork = await getActiveWork(item.profile_type, String(item.profile_id));
      if (activeWork.has_active_work) {
        activeWorkRequiresApproval = true;
        break;
      }
    }

    if (items.length > 10 || activeWorkRequiresApproval) {
      const verified = await verifyApproval({
        approvalId: approval_id,
        actionType: 'bulk',
        payload: buildBulkApprovalPayload(items),
      });
      if (!verified) {
        await db.query(
          `DELETE FROM bulk_visibility_idempotency
            WHERE idempotency_key = $1
              AND status = 'processing'
              AND request_fingerprint = $2`,
          [idempotency_key, canonicalFingerprint]
        );
        return res.status(409).json({
          approval_required: true,
          error: activeWorkRequiresApproval
            ? 'Hiding profiles with active work requires an approved request for this exact item list.'
            : 'Bulk updates of more than 10 profiles require an approved approval request for this exact item list.',
        });
      }
    }

    const results = [];
    for (const [itemIndex, item] of items.entries()) {
      const validationError = validateProfileItem(item);
      if (validationError) {
        results.push({ profile_type: item?.profile_type || null, profile_id: item?.profile_id ?? null, ok: false, action: null, error: validationError });
        continue;
      }
      try {
        const { rows: priorOutcomes } = await db.query(
          `SELECT result
             FROM bulk_visibility_idempotency_items
            WHERE idempotency_key = $1 AND item_index = $2
            LIMIT 1`,
          [idempotency_key, itemIndex]
        );
        if (priorOutcomes[0]?.result) {
          results.push(priorOutcomes[0].result);
          continue;
        }

        if (!item.is_visible) {
          const current = await loadCurrentHidden(item.profile_type, item.profile_id);
          if (current && !current.is_hidden_by_admin) {
            const activeWork = await getActiveWork(item.profile_type, String(item.profile_id));
            if (activeWork.has_active_work && !approval_id) {
              throw Object.assign(new Error('Approval required for active work.'), { statusCode: 409 });
            }
          }
        }
        const result = await withTransaction(db, async (client) => {
          const { hide } = await applyVisibilityChange({
            adminId: req.user.id,
            profileType: item.profile_type,
            profileId: item.profile_id,
            isVisible: item.is_visible,
            reason: item.reason,
            note: item.note,
            req,
            client,
          });
          const outcome = {
            profile_type: item.profile_type,
            profile_id: item.profile_id,
            ok: true,
            action: hide ? 'hide' : 'restore',
            error: null,
          };
          await client.query(
            `INSERT INTO bulk_visibility_idempotency_items
              (idempotency_key, item_index, profile_type, profile_id, result)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             ON CONFLICT (idempotency_key, item_index) DO NOTHING`,
            [idempotency_key, itemIndex, item.profile_type, String(item.profile_id), JSON.stringify(outcome)]
          );
          return outcome;
        }, 'profile_visibility_bulk_item');
        results.push(result);
        await notifyOwnerQuietly({
          profileType: item.profile_type,
          profileId: String(item.profile_id),
          isVisible: item.is_visible,
          actorId: req.user.id,
          idempotencyKey: `pv-bulk-${idempotency_key}-${item.profile_type}-${item.profile_id}`.slice(0, 200),
        });
      } catch (itemErr) {
        // Partial failure: record the item error and continue the batch.
        results.push({
          profile_type: item.profile_type,
          profile_id: item.profile_id,
          ok: false,
          action: null,
          error: itemErr.statusCode === 404
            ? 'Profile not found.'
            : itemErr.statusCode === 409
              ? 'Approval required for active work.'
              : 'Could not update profile visibility.',
        });
      }
    }

    const responseBody = { dry_run: false, results };
    const { rows: stored } = await db.query(
      `UPDATE bulk_visibility_idempotency
          SET response = $2::jsonb, status = 'completed', completed_at = NOW()
        WHERE idempotency_key = $1
          AND status = 'processing'
          AND request_fingerprint = $3
        RETURNING response`,
      [idempotency_key, JSON.stringify(responseBody), canonicalFingerprint]
    );
    // A verified bulk approval is single-use: consume it so it cannot
    // authorize a second, different batch.
    if (approval_id) await consumeApprovalQuietly(approval_id);
    return res.json(stored[0]?.response || responseBody);
  } catch (err) {
    logger.error('profileVisibility bulk error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Bulk update failed.' });
  }
};

// ─── GET /api/admin/profile-visibility/bulk-operations/stale ────────────────
// A crashed request remains processing until the normal reclaim window. This
// projection gives authorized operators explicit visibility into those claims
// and the exact canonical payload needed to retry one safely.
exports.listStaleBulkOperations = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const { rows } = await db.query(
      `SELECT b.idempotency_key, b.request_fingerprint, b.request_payload,
              b.claimed_at, b.created_at, b.created_by,
              COUNT(i.item_index)::int AS completed_items
         FROM bulk_visibility_idempotency b
         LEFT JOIN bulk_visibility_idempotency_items i
           ON i.idempotency_key = b.idempotency_key
        WHERE b.status = 'processing'
          AND b.claimed_at < NOW() - INTERVAL '10 minutes'
        GROUP BY b.idempotency_key, b.request_fingerprint, b.request_payload,
                 b.claimed_at, b.created_at, b.created_by
        ORDER BY b.claimed_at ASC
        LIMIT $1`,
      [limit]
    );
    return res.json({ operations: rows });
  } catch (err) {
    logger.error('profileVisibility stale operations error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load stale bulk operations.' });
  }
};

// Force a stale claim into the existing safe reclaim window. This does not
// apply a mutation; the caller must retry the original payload, and all
// completed per-item outcomes will be replayed transactionally.
exports.reclaimStaleBulkOperation = async (req, res) => {
  const key = String(req.params.idempotencyKey || '').trim();
  if (!key || key.length > 200) return res.status(400).json({ error: 'Invalid idempotency key.' });
  try {
    const { rows } = await db.query(
      `UPDATE bulk_visibility_idempotency
          SET claimed_at = NOW() - INTERVAL '10 minutes 1 second'
        WHERE idempotency_key = $1
          AND status = 'processing'
          AND claimed_at < NOW() - INTERVAL '10 minutes'
        RETURNING idempotency_key, request_fingerprint, request_payload, claimed_at`,
      [key]
    );
    if (!rows.length) return res.status(409).json({ error: 'Operation is not stale or no longer processing.' });
    await logAdminAction({
      adminId: req.user.id,
      action: 'profile_visibility_bulk_reclaimed',
      targetType: 'bulk_visibility_idempotency',
      targetKey: `bulk_visibility:${key}`,
      description: `Reclaimed stale profile visibility batch ${key}`,
      after: { idempotency_key: key },
      req,
      throwOnError: true,
    });
    return res.json({ operation: rows[0], retryable: true });
  } catch (err) {
    logger.error('profileVisibility reclaim stale operation error', { err, adminId: req.user?.id, key });
    return res.status(500).json({ error: 'Could not reclaim stale bulk operation.' });
  }
};

// ─── POST /api/admin/profile-visibility/:type/:id/undo ───────────────────────
// Reverts the most recent hide/restore recorded in the append-only audit log.
// If the profile's current flag no longer matches that audit row's after
// state, the world changed underneath us and we refuse with 409 instead of
// guessing. History is never rewritten: the undo writes its own audit row.
exports.undoVisibilityChange = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });

    const { rows } = await db.query(
      `SELECT before_state, after_state
         FROM admin_audit_log
        WHERE target_type = $1
          AND (target_id::text = $2 OR target_key = $2)
          AND action IN ('profile_visibility_hidden', 'profile_visibility_restored')
        ORDER BY created_at DESC
        LIMIT 1`,
      [spec.targetType, profileId]
    );
    if (!rows.length) return res.status(404).json({ error: 'No visibility change to undo.' });

    const before = rows[0].before_state || {};
    const after = rows[0].after_state || {};
    const current = await loadCurrentHidden(profileType, profileId);
    if (!current) return res.status(404).json({ error: 'Profile not found.' });

    if (!!current.is_hidden_by_admin !== !!after.is_hidden_by_admin) {
      return res.status(409).json({ error: 'state_changed' });
    }

    const restoreHidden = !!before.is_hidden_by_admin;
    const restoreReason = before.hidden_reason !== undefined
      ? before.hidden_reason
      : (restoreHidden ? 'admin_decision' : null);
    const { rows: updated } = await db.query(
      `UPDATE ${spec.table}
          SET is_hidden_by_admin = $1,
              hidden_reason      = $2,
              hidden_at          = CASE WHEN $1 THEN COALESCE(hidden_at, NOW()) ELSE NULL END,
              hidden_by          = CASE WHEN $1 THEN COALESCE(hidden_by, $3::uuid) ELSE NULL END,
              updated_at         = NOW()
        WHERE ${spec.idCol} = $4
        RETURNING is_hidden_by_admin, hidden_reason`,
      [restoreHidden, restoreReason, req.user.id, profileId]
    );

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'profile_visibility_undone',
        targetType: spec.targetType,
        targetId: profileId,
        before: { is_hidden_by_admin: !!current.is_hidden_by_admin },
        after: { is_hidden_by_admin: restoreHidden, hidden_reason: restoreReason },
        description: 'Undid the most recent visibility change.',
        req,
      });
    } catch (e) { /* audit logging must not block the undo */ }

    return res.json({
      success: true,
      profile_type: profileType,
      profile_id: profileId,
      is_hidden_by_admin: updated[0].is_hidden_by_admin,
      hidden_reason: updated[0].hidden_reason,
    });
  } catch (err) {
    logger.error('profileVisibility undo error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not undo the visibility change.' });
  }
};

function isValidIanaTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

// ─── POST /api/admin/profile-visibility/schedule ─────────────────────────────
// Body: { profile_type, profile_id, is_visible, scheduled_for (ISO 8601),
//         timezone (IANA), idempotency_key (required), reason?, note?,
//         approval_id (required) }
//
// Scheduled actions always require a workstream B approval. The row is durable
// in profile_visibility_scheduled_actions and applied by the minute worker.
exports.scheduleVisibilityAction = async (req, res) => {
  try {
    const { profile_type, profile_id, is_visible, scheduled_for, timezone, idempotency_key, reason, note, approval_id } = req.body || {};
    const validationError = validateProfileItem({ profile_type, profile_id, is_visible, reason });
    if (validationError) return res.status(400).json({ error: validationError });
    if (!idempotency_key || String(idempotency_key).trim() === '') {
      return res.status(400).json({ error: 'idempotency_key is required.' });
    }
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ error: 'timezone must be a valid IANA timezone name.' });
    }
    const when = new Date(scheduled_for);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'scheduled_for must be a valid ISO 8601 date-time.' });
    }
    if (when.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'scheduled_for must be in the future.' });
    }

    const current = await loadCurrentHidden(profile_type, profile_id);
    if (!current) return res.status(404).json({ error: 'Profile not found.' });

    const scheduledAt = when.toISOString();
    const scheduledPayload = buildScheduledApprovalPayload({
      profile_type, profile_id, is_visible, scheduled_at: scheduledAt, reason, note,
    });
    const verified = await verifyApproval({ approvalId: approval_id, actionType: 'scheduled', payload: scheduledPayload });
    if (!verified) {
      return res.status(409).json({
        approval_required: true,
        error: 'Scheduling a visibility change requires an approved approval request for this exact change.',
      });
    }

    const { rows } = await db.query(
      `INSERT INTO profile_visibility_scheduled_actions
         (profile_type, profile_id, is_visible, scheduled_for, timezone,
          idempotency_key, approval_id, reason, note, created_by)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, profile_type, profile_id, is_visible, scheduled_for,
                 timezone, status, reason, note, created_at`,
      [profile_type, String(profile_id), is_visible, scheduledAt, timezone,
       idempotency_key, approval_id || null, reason || null, note || null, req.user.id]
    );
    if (!rows.length) {
      // A row with this idempotency key already exists: replay its identity.
      const { rows: dup } = await db.query(
        `SELECT id, profile_type, profile_id, is_visible, scheduled_for,
                timezone, status, reason, note, created_at
           FROM profile_visibility_scheduled_actions
          WHERE idempotency_key = $1 LIMIT 1`,
        [idempotency_key]
      );
      return res.status(200).json({ scheduled: dup[0], duplicate: true });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'profile_visibility_scheduled',
        targetType: TABLE_BY_TYPE[profile_type].targetType,
        targetId: String(profile_id),
        before: { is_hidden_by_admin: !!current.is_hidden_by_admin },
        after: { scheduled_is_visible: is_visible, scheduled_for: when.toISOString(), scheduled_action_id: rows[0].id },
        description: [reason || null, note || null].filter(Boolean).join(' - ') || null,
        req,
      });
    } catch (e) { /* audit logging must not block scheduling */ }

    return res.status(201).json({ scheduled: rows[0], duplicate: false });
  } catch (err) {
    logger.error('profileVisibility schedule error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not schedule the visibility change.' });
  }
};

// ─── GET /api/admin/profile-visibility/scheduled ─────────────────────────────
exports.listScheduledActions = async (req, res) => {
  try {
    const status = String(req.query.status || 'all').toLowerCase();
    if (!['all', 'pending', 'applied', 'cancelled', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' });
    }
    const { rows } = await db.query(
      `SELECT id, profile_type, profile_id, is_visible, scheduled_for, timezone,
              status, reason, note, approval_id, created_by, created_at, applied_at,
              cancelled_by, cancelled_at, failure_reason
         FROM profile_visibility_scheduled_actions
        WHERE ($1 = 'all' OR status = $1)
        ORDER BY scheduled_for ASC
        LIMIT 500`,
      [status]
    );
    return res.json({ actions: rows });
  } catch (err) {
    logger.error('profileVisibility scheduled list error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not list scheduled actions.' });
  }
};

// ─── DELETE /api/admin/profile-visibility/scheduled/:id ──────────────────────
// Only pending actions can be cancelled; applied/cancelled/failed are history.
exports.cancelScheduledAction = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Scheduled action id is required.' });

    const { rows } = await db.query(
      `UPDATE profile_visibility_scheduled_actions
          SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW()
        WHERE id = $1::uuid AND status = 'pending'
        RETURNING id, profile_type, profile_id, is_visible, status`,
      [id, req.user.id]
    );
    if (!rows.length) {
      const { rows: found } = await db.query(
        'SELECT id FROM profile_visibility_scheduled_actions WHERE id = $1::uuid LIMIT 1',
        [id]
      );
      if (!found.length) return res.status(404).json({ error: 'Scheduled action not found.' });
      return res.status(409).json({ error: 'Only pending actions can be cancelled.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'profile_visibility_scheduled_cancelled',
        targetType: TABLE_BY_TYPE[rows[0].profile_type].targetType,
        targetId: String(rows[0].profile_id),
        before: { scheduled_action_id: rows[0].id, status: 'pending' },
        after: { scheduled_action_id: rows[0].id, status: 'cancelled' },
        description: 'Cancelled a scheduled visibility change.',
        req,
      });
    } catch (e) { /* audit logging must not block cancellation */ }

    return res.json({ success: true, cancelled: rows[0] });
  } catch (err) {
    logger.error('profileVisibility scheduled cancel error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not cancel the scheduled action.' });
  }
};

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── GET /api/admin/profile-visibility/export ────────────────────────────────
// Same directory CTE and filters as search, but without pagination: capped at
// 5000 rows and returned as CSV for the "export all pages" control.
exports.exportAllProfiles = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'all').toLowerCase();
    const visibility = String(req.query.visibility || 'all').toLowerCase();
    if (!['all', ...PROFILE_TYPES].includes(type)) {
      return res.status(400).json({ error: 'Invalid profile type.' });
    }
    if (!['all', 'visible', 'hidden', 'unlisted', 'active', 'inactive'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility filter.' });
    }

    const like = `%${q}%`;
    const { rows } = await db.query(
      `WITH ${PROFILES_CTE}
       SELECT profile_type, display_name, detail,
              is_hidden_by_admin, hidden_reason, owner_visible, is_active,
              (NOT is_hidden_by_admin AND owner_visible AND is_active) AS is_visible
         FROM profiles
        WHERE ${PROFILES_FILTER}
        ORDER BY created_at DESC NULLS LAST, display_name ASC
        LIMIT 5001`,
      [q, like, type, visibility]
    );

    const lines = ['Type,Name,Detail,Visibility,Owner status,Reason'];
    for (const r of rows.slice(0, 5000)) {
      lines.push([
        csvEscape(r.profile_type),
        csvEscape(r.display_name),
        csvEscape(r.detail),
        r.is_visible ? 'Visible' : 'Hidden',
        r.owner_visible ? 'Listed' : 'Unlisted',
        csvEscape(r.hidden_reason),
      ].join(','));
    }
    const csv = lines.join('\r\n') + '\r\n';

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="profile-visibility-export.csv"');
    return res.send(csv);
  } catch (err) {
    logger.error('profileVisibility export error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Export failed.' });
  }
};

exports.PROFILE_TYPES = PROFILE_TYPES;
exports.REASONS = REASONS;
exports.TABLE_BY_TYPE = TABLE_BY_TYPE;
exports.buildBulkApprovalPayload = buildBulkApprovalPayload;
exports.buildScheduledApprovalPayload = buildScheduledApprovalPayload;
exports.buildSingleApprovalPayload = buildSingleApprovalPayload;

// Workstream B's approval executor (executeBulkAction) applies approved bulk
// items through this helper when it is available, falling back to its own
// inline UPDATE + audit otherwise. opts: { reason, note, actorId }.
exports.applySingleVisibility = async (profileType, profileId, isVisible, opts = {}) => {
  const type = String(profileType || '').toLowerCase();
  if (!TABLE_BY_TYPE[type]) {
    const err = new Error(`Unknown profile_type: ${profileType}`);
    err.statusCode = 400;
    throw err;
  }
  if (typeof isVisible !== 'boolean') {
    const err = new Error('is_visible must be a boolean.');
    err.statusCode = 400;
    throw err;
  }
  await applyVisibilityChange({
    adminId: opts.actorId,
    profileType: type,
    profileId: String(profileId),
    isVisible,
    reason: opts.reason,
    note: opts.note,
    req: null,
  });
  await notifyOwnerQuietly({
    profileType: type,
    profileId: String(profileId),
    isVisible,
    actorId: opts.actorId,
  });
  return { profileType: type, profileId: String(profileId), isVisible };
};

// ─── GET /api/admin/profile-visibility/:type/:id/impact ──────────────────────
// Blast-radius preview before hiding: active work plus 30-day engagement and
// revenue figures so the admin sees what hiding this profile costs.
exports.getImpactPreview = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });

    const work = await getActiveWork(profileType, profileId);

    // 30-day engagement: best-effort counts, 0 when the source table is absent.
    let views30d = 0;
    let followers = 0;
    try {
      const idParam = profileType === 'helper' ? '$1::uuid' : '$1::bigint';
      const v = await db.query(
        `SELECT COUNT(*)::int AS c FROM profile_views
          WHERE profile_type = $1 AND profile_id = ${idParam}
            AND viewed_at >= now() - interval '30 days'`,
        [profileType, profileId]
      );
      views30d = v.rows[0]?.c || 0;
    } catch { /* table absent */ }
    try {
      const idParam = profileType === 'helper' ? '$1::uuid' : '$1::bigint';
      const f = await db.query(
        `SELECT COUNT(*)::int AS c FROM profile_followers
          WHERE profile_type = $1 AND profile_id = ${idParam}`,
        [profileType, profileId]
      );
      followers = f.rows[0]?.c || 0;
    } catch { /* table absent */ }

    return res.json({
      profile_type: profileType,
      profile_id: profileId,
      active_jobs: work.active_jobs || 0,
      upcoming_bookings: work.upcoming_bookings || 0,
      open_orders: work.open_orders || 0,
      has_active_work: !!work.has_active_work,
      views_30d: views30d,
      followers,
    });
  } catch (err) {
    logger.error('profileVisibility impact error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load impact preview.' });
  }
};

// ─── GET /api/admin/profile-visibility/:type/:id/timeline ────────────────────
// Per-profile visibility timeline: hide/restore events paired with durations.
exports.getVisibilityTimeline = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });

    const { rows } = await db.query(
      `SELECT a.id, a.action, a.description, a.created_at,
              COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email, 'Admin') AS actor_name
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.admin_id
        WHERE a.target_type = $1
          AND (a.target_id::text = $2 OR a.target_key = $2)
          AND a.action IN ('profile_visibility_hidden', 'profile_visibility_restored')
        ORDER BY a.created_at ASC
        LIMIT 200`,
      [spec.targetType, profileId]
    );

    // Pair hides with restores to compute durations.
    const events = [];
    let pendingHide = null;
    for (const r of rows) {
      if (r.action === 'profile_visibility_hidden') {
        if (pendingHide) {
          events.push({ ...pendingHide, duration_days: null, still_hidden: true });
        }
        pendingHide = {
          id: r.id, action: 'hidden', actor_name: r.actor_name,
          created_at: r.created_at, description: r.description,
        };
      } else {
        if (pendingHide) {
          const ms = new Date(r.created_at) - new Date(pendingHide.created_at);
          events.push({ ...pendingHide, duration_days: Math.round(ms / 86400000), restored_at: r.created_at, restored_by: r.actor_name });
          pendingHide = null;
        }
        events.push({ id: r.id, action: 'restored', actor_name: r.actor_name, created_at: r.created_at, description: r.description });
      }
    }
    if (pendingHide) events.push({ ...pendingHide, duration_days: null, still_hidden: true });

    return res.json({ timeline: events.reverse() });
  } catch (err) {
    logger.error('profileVisibility timeline error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load timeline.' });
  }
};

// ─── GET /api/admin/profile-visibility/stale ─────────────────────────────────
// Profiles hidden longer than the threshold (default 180 days) or hidden
// without owner notification: hides that may have rotted.
exports.listStaleHides = async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 180, 7), 3650);
    const { rows } = await db.query(
      `SELECT 'helper'::text AS profile_type, u.id::text AS profile_id,
              COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS display_name,
              hp.hidden_at, hp.hidden_reason
         FROM helper_profiles hp JOIN users u ON u.id = hp.user_id
        WHERE COALESCE(hp.is_hidden_by_admin, FALSE) = TRUE
          AND hp.hidden_at < now() - ($1 || ' days')::interval
        UNION ALL
       SELECT 'business'::text, b.id::text, b.name, b.hidden_at, b.hidden_reason
         FROM businesses b
        WHERE COALESCE(b.is_hidden_by_admin, FALSE) = TRUE
          AND b.hidden_at < now() - ($1 || ' days')::interval
        UNION ALL
       SELECT 'restaurant'::text, fr.id::text, fr.name, fr.hidden_at, fr.hidden_reason
         FROM food_restaurants fr
        WHERE COALESCE(fr.is_hidden_by_admin, FALSE) = TRUE
          AND fr.hidden_at < now() - ($1 || ' days')::interval
        ORDER BY hidden_at ASC LIMIT 200`,
      [String(days)]
    );
    return res.json({ days, stale: rows });
  } catch (err) {
    logger.error('profileVisibility stale error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load stale hides.' });
  }
};

// ─── GET /api/admin/profile-visibility/:type/:id/restore-checklist ───────────
// For restores: what was missing when hidden and whether it is fixed now.
exports.getRestoreChecklist = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    const spec = TABLE_BY_TYPE[profileType];
    if (!spec || !profileId) return res.status(400).json({ error: 'Invalid profile reference.' });

    const items = [];
    if (profileType === 'helper') {
      const { rows: [r] } = await db.query(
        `SELECT u.avatar_url, u.phone_verified, hp.bio, hp.hourly_rate_cents,
                (SELECT COUNT(*)::int FROM helper_services WHERE user_id = u.id) AS service_count
           FROM users u JOIN helper_profiles hp ON hp.user_id = u.id
          WHERE u.id = $1::uuid LIMIT 1`, [profileId]);
      if (!r) return res.status(404).json({ error: 'Profile not found.' });
      items.push(
        { key: 'photo', label: 'Profile photo', present: !!r.avatar_url },
        { key: 'phone', label: 'Phone verified', present: !!r.phone_verified },
        { key: 'bio', label: 'Bio written', present: !!(r.bio && r.bio.trim().length >= 20) },
        { key: 'rate', label: 'Hourly rate set', present: r.hourly_rate_cents > 0 },
        { key: 'services', label: 'At least one service', present: r.service_count > 0 },
      );
    } else if (profileType === 'business') {
      const { rows: [r] } = await db.query(
        `SELECT name, logo_url, description, phone FROM businesses WHERE id = $1::bigint LIMIT 1`, [profileId]);
      if (!r) return res.status(404).json({ error: 'Profile not found.' });
      items.push(
        { key: 'name', label: 'Business name', present: !!r.name },
        { key: 'logo', label: 'Logo uploaded', present: !!r.logo_url },
        { key: 'description', label: 'Description written', present: !!(r.description && r.description.trim().length >= 20) },
        { key: 'phone', label: 'Phone number', present: !!r.phone },
      );
    } else {
      const { rows: [r] } = await db.query(
        `SELECT name, logo_url, description FROM food_restaurants WHERE id = $1::bigint LIMIT 1`, [profileId]);
      if (!r) return res.status(404).json({ error: 'Profile not found.' });
      items.push(
        { key: 'name', label: 'Restaurant name', present: !!r.name },
        { key: 'logo', label: 'Logo uploaded', present: !!r.logo_url },
        { key: 'description', label: 'Description written', present: !!(r.description && r.description.trim().length >= 20) },
      );
    }
    return res.json({ items, all_clear: items.every((i) => i.present) });
  } catch (err) {
    logger.error('profileVisibility checklist error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load restore checklist.' });
  }
};

// ─── Appeals ─────────────────────────────────────────────────────────────────
exports.listAppeals = async (req, res) => {
  try {
    const status = String(req.query.status || 'pending').toLowerCase();
    if (!['pending', 'approved', 'denied', 'all'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' });
    }
    const { rows } = await db.query(
      `SELECT a.id, a.profile_type, a.profile_id, a.message, a.status,
              a.created_at, a.reviewed_at, a.review_note,
              COALESCE(NULLIF(TRIM(COALESCE(app.first_name, '') || ' ' || COALESCE(app.last_name, '')), ''), app.email) AS appellant_name,
              COALESCE(NULLIF(TRIM(COALESCE(rev.first_name, '') || ' ' || COALESCE(rev.last_name, '')), ''), rev.email) AS reviewer_name
         FROM profile_visibility_appeals a
         JOIN users app ON app.id = a.appellant_id
         LEFT JOIN users rev ON rev.id = a.reviewed_by
        WHERE ($1 = 'all' OR a.status = $1)
        ORDER BY a.created_at DESC LIMIT 200`,
      [status]
    );
    return res.json({ appeals: rows });
  } catch (err) {
    logger.error('profileVisibility appeals list error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load appeals.' });
  }
};

exports.resolveAppeal = async (req, res) => {
  try {
    const appealId = String(req.params.id || '').trim();
    const decision = String(req.body?.decision || '').toLowerCase();
    const note = String(req.body?.note || '').trim().slice(0, 2000);
    if (!['approved', 'denied'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approved or denied.' });
    }
    const { rows } = await db.query(
      `UPDATE profile_visibility_appeals
          SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = NULLIF($4, '')
        WHERE id = $1::uuid AND status = 'pending'
        RETURNING id, profile_type, profile_id`,
      [appealId, decision, req.user.id, note]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appeal not found or already resolved.' });
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, description)
       VALUES ($1, 'profile_visibility_appeal_' || $2, 'profile_visibility_appeal', $3,
               'Appeal ' || $2 || COALESCE(': ' || NULLIF($4, ''), ''))`,
      [req.user.id, decision, appealId, note]
    );
    return res.json({ ok: true, appeal: rows[0] });
  } catch (err) {
    logger.error('profileVisibility appeal resolve error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not resolve appeal.' });
  }
};
