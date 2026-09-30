'use strict';

/**
 * Settings change management (server API, Worker A).
 *
 * Change requests separate proposing a platform_settings / feature_flags
 * change from approving and applying it:
 *   proposed -> approved -> applied            (due immediately)
 *   proposed -> scheduled -> approved -> applied (future effective_at)
 *   proposed/scheduled/approved -> rejected | cancelled
 *
 * Applying a request goes through the exact same validation, versioning, and
 * audit path as the direct updateSetting / updateFeatureFlag routes in
 * superAdminController.js (shared parsePlatformSettingValue /
 * parseStrictBoolean helpers), so the audit trail stays compatible with
 * rollbackSetting / rollbackFeatureFlag.
 *
 * applyChangeRequest(client, request, adminId) is the transactional single-
 * request applier reused by the scheduled settings worker.
 */

const db = require('../db');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');
const { parseBoundedPagination } = require('../utils/pagination');
const {
  parsePlatformSettingValue,
  parseStrictBoolean,
} = require('./superAdminController');

const KINDS = ['setting', 'flag'];
const STATUSES = ['proposed', 'approved', 'rejected', 'scheduled', 'applied', 'cancelled'];
const APPLICABLE_STATUSES = ['approved', 'scheduled'];
const DECIDABLE_STATUSES = ['proposed', 'scheduled', 'approved'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Static map of which runtime consumers read a given setting/flag key.
// Used for the change preview. Keys not listed here report 'unknown consumers'.
const AFFECTED_CONSUMERS = {
  maintenance_mode: 'request pipeline (maintenance gate), public site availability',
  new_user_registrations: 'registration flows (helper/customer/business signup)',
  require_id_verification: 'identity verification gating at onboarding',
  platform_fee_starter: 'feeService: job pricing and payout fee computation',
  platform_fee_pro: 'feeService: job pricing and payout fee computation',
  platform_fee_elite: 'feeService: job pricing and payout fee computation',
  platform_fee_broker: 'feeService: job pricing and payout fee computation',
  broker_cut_rate: 'feeService: broker commission computation',
  max_job_budget: 'job posting validation (budget limits)',
  bid_expiry_hours: 'bid expiry worker',
  escrow_release_delay_hrs: 'escrow release scheduler',
  min_helper_rating: 'matching and search eligibility',
  support_email: 'support contact surfaces (footer, help pages)',
};

function changeError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function sendChangeError(err, res, fallbackMessage, context) {
  logger.error(context, { err });
  if (err && Number.isInteger(err.statusCode)) {
    return res
      .status(err.statusCode)
      .json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  return res.status(500).json({ error: fallbackMessage });
}

function isUuid(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

async function getChangeRequest(id) {
  const { rows } = await db.query('SELECT * FROM settings_change_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Mark an audit payload with the originating surface.
 * Admin UI calls keep the historical shape; connector calls get a
 * [connector] description prefix and source: 'connector' in after_state.
 */
function withAuditSource({ description, after }, auditSource) {
  if (auditSource !== 'connector') {
    return { description, after };
  }
  return {
    description: `[connector] ${description}`,
    after: { ...(after || {}), source: 'connector' },
  };
}

async function auditChangeRequest({ client = null, req = null, adminId, action, request, before, after, description, auditSource = 'admin' }) {
  const marked = withAuditSource({
    description: description || `Change request ${action.replace('settings_change_', '')} for ${request.kind} "${request.key}"`,
    after: after || null,
  }, auditSource);
  await logAdminAction({
    client,
    adminId,
    action,
    targetType: 'settings_change_request',
    targetId: request.id,
    description: marked.description,
    before: before || null,
    after: marked.after,
    req,
    throwOnError: true,
  });
}

/**
 * Apply one approved/scheduled change request transactionally.
 *
 * @param {object} client  pg client (from db.connect()); transaction is managed here
 * @param {object} request change-request row (id at minimum; re-read under FOR UPDATE)
 * @param {string} adminId acting admin id for updated_by / audit (falls back to reviewed_by)
 * @param {string} [auditSource] 'admin' (default) or 'connector'; marks audit rows
 * @returns {Promise<object>} the updated change-request row (status 'applied')
 * @throws changeError with statusCode/code on any validation or applicability failure
 */
async function applyChangeRequest(client, request, adminId, auditSource = 'admin') {
  if (!request || !isUuid(request.id)) {
    throw changeError(404, 'change_request_not_found', 'Change request not found.');
  }
  await client.query('BEGIN');
  try {
    const { rows: locked } = await client.query(
      'SELECT * FROM settings_change_requests WHERE id = $1 FOR UPDATE',
      [request.id]
    );
    const change = locked[0];
    if (!change) {
      throw changeError(404, 'change_request_not_found', 'Change request not found.');
    }
    if (!APPLICABLE_STATUSES.includes(change.status)) {
      throw changeError(
        409,
        'change_request_not_applicable',
        `Change request cannot be applied from status "${change.status}".`
      );
    }
    if (change.effective_at && new Date(change.effective_at) > new Date()) {
      throw changeError(
        409,
        'change_request_not_due',
        'Change request is not due yet (effective_at is in the future).'
      );
    }

    const actorId = adminId || change.reviewed_by || null;

    if (change.kind === 'setting') {
      const { rows: before } = await client.query(
        'SELECT * FROM platform_settings WHERE key = $1 FOR UPDATE',
        [change.key]
      );
      if (!before.length) {
        throw changeError(404, 'setting_not_found', `Setting "${change.key}" not found.`);
      }
      // Same validation + versioning as updateSetting.
      const parsed = parsePlatformSettingValue(before[0], change.proposed_value);
      if (parsed.error) {
        throw changeError(400, 'invalid_setting_value', parsed.error);
      }
      const previousVersion = before[0].version || 1;
      await client.query(
        'UPDATE platform_settings SET value = $1, version = COALESCE(version, 1) + 1, updated_by = $2, updated_at = now() WHERE key = $3',
        [parsed.value, actorId, change.key]
      );
      const settingAudit = withAuditSource({
        description: `Setting "${change.key}" updated via change request ${change.id}`,
        after: { value: parsed.value, version: previousVersion + 1 },
      }, auditSource);
      await logAdminAction({
        client,
        adminId: actorId,
        action: 'platform_setting_updated',
        targetType: 'platform_setting',
        targetKey: change.key,
        description: settingAudit.description,
        before: { value: before[0].value, version: previousVersion },
        after: settingAudit.after,
        throwOnError: true,
      });
    } else if (change.kind === 'flag') {
      // Same strict-boolean parsing + audit as updateFeatureFlag.
      const newEnabled = parseStrictBoolean(change.proposed_value);
      if (newEnabled === null) {
        throw changeError(400, 'invalid_feature_flag_value', 'Feature flags must be true or false.');
      }
      const { rows: before } = await client.query(
        'SELECT is_enabled FROM feature_flags WHERE key = $1 FOR UPDATE',
        [change.key]
      );
      if (!before.length) {
        throw changeError(404, 'flag_not_found', `Feature flag "${change.key}" not found.`);
      }
      await client.query(
        'UPDATE feature_flags SET is_enabled = $1, updated_by = $2, updated_at = now() WHERE key = $3',
        [newEnabled, actorId, change.key]
      );
      const flagAudit = withAuditSource({
        description: `Feature flag "${change.key}" set to ${newEnabled} via change request ${change.id}`,
        after: { is_enabled: newEnabled },
      }, auditSource);
      await logAdminAction({
        client,
        adminId: actorId,
        action: 'feature_flag_updated',
        targetType: 'feature_flag',
        targetKey: change.key,
        description: flagAudit.description,
        before: { is_enabled: before[0].is_enabled },
        after: flagAudit.after,
        throwOnError: true,
      });
    } else {
      throw changeError(400, 'invalid_change_kind', `Unknown change kind "${change.kind}".`);
    }

    const { rows: updated } = await client.query(
      "UPDATE settings_change_requests SET status = 'applied', updated_at = now() WHERE id = $1 RETURNING *",
      [change.id]
    );
    const appliedAudit = withAuditSource({
      description: `Change request for ${change.kind} "${change.key}" applied`,
      after: { status: 'applied' },
    }, auditSource);
    await logAdminAction({
      client,
      adminId: actorId,
      action: 'settings_change_applied',
      targetType: 'settings_change_request',
      targetId: change.id,
      description: appliedAudit.description,
      before: { status: change.status },
      after: appliedAudit.after,
      throwOnError: true,
    });

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already failed; keep original error */ }
    throw err;
  }
}

/**
 * Pure helper: build the preview payload for a change request.
 * currentRow is the live platform_settings / feature_flags row (or null).
 */
function buildPreview(currentRow, request) {
  const kind = request ? request.kind : null;
  const key = request ? request.key : null;
  let current_value = null;
  let current_version = null;
  if (currentRow) {
    if (kind === 'flag') {
      current_value = currentRow.is_enabled == null ? null : currentRow.is_enabled;
    } else {
      current_value = currentRow.value == null ? null : currentRow.value;
      current_version = currentRow.version == null ? null : currentRow.version;
    }
  }
  return {
    key,
    kind,
    current_value,
    current_version,
    proposed_value: request ? request.proposed_value : null,
    affected_consumers: (key && AFFECTED_CONSUMERS[key]) || 'unknown consumers',
  };
}

function parseEffectiveAt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const when = new Date(raw);
  return Number.isNaN(when.getTime()) ? 'invalid' : when;
}

// POST /  body: { kind, key, proposed_value, reason, effective_at?, rollout_percent?, rollout_segment? }
async function proposeChange(req, res) {
  try {
    const {
      kind, key, proposed_value, reason, effective_at, rollout_percent, rollout_segment,
    } = req.body || {};

    if (!KINDS.includes(kind)) {
      return res.status(400).json({ error: 'kind must be "setting" or "flag".', code: 'invalid_change_kind' });
    }
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return res.status(400).json({ error: 'A setting or flag key is required.', code: 'key_required' });
    }
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      return res.status(400).json({ error: 'A reason is required to propose a change.', code: 'reason_required' });
    }
    const when = parseEffectiveAt(effective_at);
    if (when === 'invalid') {
      return res.status(400).json({ error: 'effective_at must be a valid date.', code: 'invalid_effective_at' });
    }
    let parsedRollout = null;
    if (rollout_percent !== undefined && rollout_percent !== null && rollout_percent !== '') {
      const n = Number(rollout_percent);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: 'rollout_percent must be an integer between 0 and 100.', code: 'invalid_rollout_percent' });
      }
      parsedRollout = n;
    }

    // Validate the proposed value up front through the same parse path the
    // direct update routes use, so an invalid proposal fails fast at 400.
    let storedValue;
    if (kind === 'setting') {
      const { rows } = await db.query('SELECT * FROM platform_settings WHERE key = $1', [cleanKey]);
      if (!rows.length) {
        return res.status(404).json({ error: `Setting "${cleanKey}" not found.`, code: 'setting_not_found' });
      }
      const parsed = parsePlatformSettingValue(rows[0], proposed_value);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error, code: 'invalid_setting_value' });
      }
      storedValue = parsed.value; // canonical DB string, same as updateSetting stores
    } else {
      const newEnabled = parseStrictBoolean(proposed_value);
      if (newEnabled === null) {
        return res.status(400).json({ error: 'Feature flags must be true or false.', code: 'invalid_feature_flag_value' });
      }
      const { rows } = await db.query('SELECT key FROM feature_flags WHERE key = $1', [cleanKey]);
      if (!rows.length) {
        return res.status(404).json({ error: `Feature flag "${cleanKey}" not found.`, code: 'flag_not_found' });
      }
      storedValue = newEnabled;
    }

    // A proposal always starts as 'proposed', even when it carries a future
    // effective_at. Only an approver (approve_settings grant) may move a
    // request to 'approved' or 'scheduled' via the approve/schedule endpoints,
    // so a proposer can never schedule a change that applies itself without
    // independent review (separation of duties).
    const status = 'proposed';
    const { rows: created } = await db.query(
      `INSERT INTO settings_change_requests
         (kind, key, proposed_value, reason, status, proposed_by, effective_at, rollout_percent, rollout_segment)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [
        kind,
        cleanKey,
        JSON.stringify(storedValue),
        cleanReason,
        status,
        req.user.id,
        when ? when.toISOString() : null,
        parsedRollout,
        rollout_segment === undefined || rollout_segment === null ? null : JSON.stringify(rollout_segment),
      ]
    );
    const request = created[0];
    await auditChangeRequest({
      req,
      adminId: req.user.id,
      action: 'settings_change_proposed',
      request,
      after: { kind, key: cleanKey, proposed_value: storedValue, status },
    });
    return res.status(201).json({ request });
  } catch (err) {
    return sendChangeError(err, res, 'Failed to propose change.', 'proposeChange error');
  }
}

// GET /  ?status=&page=&limit=  newest first
/**
 * List change requests with an optional status filter and bounded pagination.
 * Shared by the admin settings UI and the connector API.
 *
 * @param {object} args
 * @param {string} [args.status]
 * @param {object} [args.pagination] raw query object for parseBoundedPagination
 * @returns {Promise<{requests: object[], page: number, limit: number, total: number}>}
 * @throws changeError (400 invalid_status) on a bad status filter
 */
async function listChangeRequests({ status, pagination = {} } = {}) {
  if (status !== undefined && status !== '' && !STATUSES.includes(status)) {
    throw changeError(400, 'invalid_status', 'Invalid status filter.');
  }
  const { page, limit, offset } = parseBoundedPagination(pagination, { defaultLimit: 25 });
  const params = [];
  let whereSql = '';
  if (status) {
    params.push(status);
    whereSql = `WHERE status = $${params.length}`;
  }
  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(
      `SELECT * FROM settings_change_requests ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total FROM settings_change_requests ${whereSql}`,
      params
    ),
  ]);
  return { requests: rows, page, limit, total: countRows[0] ? countRows[0].total : rows.length };
}

async function listChanges(req, res) {
  try {
    const { status } = req.query || {};
    const result = await listChangeRequests({ status, pagination: req.query || {} });
    return res.json(result);
  } catch (err) {
    return sendChangeError(err, res, 'Failed to list change requests.', 'listChanges error');
  }
}

// GET /:id/preview -> { key, kind, current_value, current_version, proposed_value, affected_consumers }
async function previewChange(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ error: 'Change request not found.', code: 'change_request_not_found' });
    }
    const request = await getChangeRequest(id);
    if (!request) {
      return res.status(404).json({ error: 'Change request not found.', code: 'change_request_not_found' });
    }
    let currentRow = null;
    if (request.kind === 'setting') {
      const { rows } = await db.query('SELECT * FROM platform_settings WHERE key = $1', [request.key]);
      currentRow = rows[0] || null;
    } else {
      const { rows } = await db.query('SELECT key, is_enabled FROM feature_flags WHERE key = $1', [request.key]);
      currentRow = rows[0] || null;
    }
    return res.json(buildPreview(currentRow, request));
  } catch (err) {
    return sendChangeError(err, res, 'Failed to build change preview.', 'previewChange error');
  }
}

// POST /:id/approve  (approve_settings grant; separation of duties enforced)
/**
 * Approve a change request as the given admin. Applies immediately when due.
 * Shared by the admin settings UI and the connector API.
 *
 * @param {object} args
 * @param {string} args.id change-request id
 * @param {string} args.approverId acting admin id
 * @param {object} [args.req] express req for audit metadata
 * @param {string} [args.auditSource] 'admin' (default) or 'connector'
 * @returns {Promise<{request: object, applied: boolean}>}
 * @throws changeError (404/403/409) on any rule violation
 */
async function approveChangeRequest({ id, approverId, req = null, auditSource = 'admin' }) {
  const adminId = approverId;
  const request = await getChangeRequest(id);
  if (!request) {
    throw changeError(404, 'change_request_not_found', 'Change request not found.');
  }
  if (request.proposed_by === adminId) {
    throw changeError(
      403,
      'separation_of_duties',
      'The admin who proposed a change cannot approve it (separation of duties).'
    );
  }
  if (!DECIDABLE_STATUSES.includes(request.status)) {
    throw changeError(
      409,
      'change_request_not_applicable',
      `Change request cannot be approved from status "${request.status}".`
    );
  }

  let client;
  try {
    client = await db.connect();
    const due = !request.effective_at || new Date(request.effective_at) <= new Date();

    if (due) {
      // Approve and apply immediately. The approve marker is committed on its
      // own first so a failed apply still leaves a consistent approved state
      // for the scheduled worker to pick up.
      await client.query(
        "UPDATE settings_change_requests SET status = 'approved', reviewed_by = $1, decided_at = now(), updated_at = now() WHERE id = $2",
        [adminId, id]
      );
      const applied = await applyChangeRequest(
        client,
        { ...request, status: 'approved', reviewed_by: adminId },
        adminId,
        auditSource
      );
      await auditChangeRequest({
        client,
        req,
        adminId,
        action: 'settings_change_approved',
        request,
        before: { status: request.status },
        after: { status: 'applied' },
        description: `Change request for ${request.kind} "${request.key}" approved and applied`,
        auditSource,
      });
      return { request: applied, applied: true };
    }

    const { rows: updated } = await client.query(
      "UPDATE settings_change_requests SET status = 'approved', reviewed_by = $1, decided_at = now(), updated_at = now() WHERE id = $2 RETURNING *",
      [adminId, id]
    );
    await auditChangeRequest({
      client,
      req,
      adminId,
      action: 'settings_change_approved',
      request,
      before: { status: request.status },
      after: { status: 'approved', effective_at: request.effective_at },
      auditSource,
    });
    return { request: updated[0], applied: false };
  } finally {
    if (client) { try { client.release(); } catch { /* ignore */ } }
  }
}

async function approveChange(req, res) {
  try {
    const { request, applied } = await approveChangeRequest({
      id: req.params.id,
      approverId: req.user.id,
      req,
    });
    return res.json({ request, applied });
  } catch (err) {
    return sendChangeError(err, res, 'Failed to approve change request.', 'approveChange error');
  }
}

// POST /:id/reject  body: { reason } (required)
/**
 * Reject a change request with a required reason.
 * Shared by the admin settings UI and the connector API.
 *
 * @param {object} args
 * @param {string} args.id change-request id
 * @param {string} args.reason rejection reason (required, non-blank)
 * @param {string} args.rejectorId acting admin id
 * @param {object} [args.req] express req for audit metadata
 * @param {string} [args.auditSource] 'admin' (default) or 'connector'
 * @returns {Promise<object>} updated change-request row
 * @throws changeError (400/404/409) on any rule violation
 */
async function rejectChangeRequest({ id, reason, rejectorId, req = null, auditSource = 'admin' }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw changeError(400, 'reason_required', 'A reason is required to reject a change.');
  }
  const request = await getChangeRequest(id);
  if (!request) {
    throw changeError(404, 'change_request_not_found', 'Change request not found.');
  }
  if (!DECIDABLE_STATUSES.includes(request.status)) {
    throw changeError(
      409,
      'change_request_not_applicable',
      `Change request cannot be rejected from status "${request.status}".`
    );
  }
  const { rows: updated } = await db.query(
    "UPDATE settings_change_requests SET status = 'rejected', reviewed_by = $1, decided_at = now(), updated_at = now() WHERE id = $2 RETURNING *",
    [rejectorId, id]
  );
  await auditChangeRequest({
    req,
    adminId: rejectorId,
    action: 'settings_change_rejected',
    request,
    before: { status: request.status },
    after: { status: 'rejected', reason: cleanReason },
    auditSource,
  });
  return updated[0];
}

async function rejectChange(req, res) {
  try {
    const result = await rejectChangeRequest({
      id: req.params.id,
      reason: req.body && req.body.reason,
      rejectorId: req.user.id,
      req,
    });
    return res.json({ request: result });
  } catch (err) {
    return sendChangeError(err, res, 'Failed to reject change request.', 'rejectChange error');
  }
}

// POST /:id/schedule  body: { effective_at } (must be in the future)
async function scheduleChange(req, res) {
  try {
    const { id } = req.params;
    const when = parseEffectiveAt(req.body && req.body.effective_at);
    if (when === 'invalid' || when === null || when <= new Date()) {
      return res.status(400).json({ error: 'effective_at must be a valid date in the future.', code: 'invalid_effective_at' });
    }
    const request = await getChangeRequest(id);
    if (!request) {
      return res.status(404).json({ error: 'Change request not found.', code: 'change_request_not_found' });
    }
    if (!['proposed', 'approved'].includes(request.status)) {
      return res.status(409).json({
        error: `Change request cannot be scheduled from status "${request.status}".`,
        code: 'change_request_not_applicable',
      });
    }
    const { rows: updated } = await db.query(
      'UPDATE settings_change_requests SET status = $1, effective_at = $2, updated_at = now() WHERE id = $3 RETURNING *',
      ['scheduled', when.toISOString(), id]
    );
    await auditChangeRequest({
      req,
      adminId: req.user.id,
      action: 'settings_change_scheduled',
      request,
      before: { status: request.status, effective_at: request.effective_at },
      after: { status: 'scheduled', effective_at: when.toISOString() },
    });
    return res.json({ request: updated[0] });
  } catch (err) {
    return sendChangeError(err, res, 'Failed to schedule change request.', 'scheduleChange error');
  }
}

// POST /:id/cancel  (proposer, reviewer, or super_admin; from proposed/scheduled/approved)
async function cancelChange(req, res) {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const request = await getChangeRequest(id);
    if (!request) {
      return res.status(404).json({ error: 'Change request not found.', code: 'change_request_not_found' });
    }
    const isParticipant = request.proposed_by === adminId || request.reviewed_by === adminId;
    if (!isParticipant && !req.isSuper) {
      return res.status(403).json({
        error: 'Only the proposer, the reviewer, or a super-admin can cancel a change request.',
        code: 'cancel_not_allowed',
      });
    }
    if (!DECIDABLE_STATUSES.includes(request.status)) {
      return res.status(409).json({
        error: `Change request cannot be cancelled from status "${request.status}".`,
        code: 'change_request_not_applicable',
      });
    }
    const { rows: updated } = await db.query(
      "UPDATE settings_change_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
    await auditChangeRequest({
      req,
      adminId,
      action: 'settings_change_cancelled',
      request,
      before: { status: request.status },
      after: { status: 'cancelled' },
    });
    return res.json({ request: updated[0] });
  } catch (err) {
    return sendChangeError(err, res, 'Failed to cancel change request.', 'cancelChange error');
  }
}

module.exports = {
  applyChangeRequest,
  buildPreview,
  proposeChange,
  listChanges,
  listChangeRequests,
  previewChange,
  approveChange,
  approveChangeRequest,
  rejectChange,
  rejectChangeRequest,
  scheduleChange,
  cancelChange,
};
