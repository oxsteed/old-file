'use strict';

/**
 * server/controllers/connectorController.js
 *
 * Thin HTTP handlers for the OxSteed connector API
 * (server/routes/connector.js, mounted at /api/connector/v1).
 *
 * Every handler runs behind connectorAuth (admin-only API key) and delegates
 * to the same service/controller cores as the admin UI. Mutations always
 * audit with the connector user as actor and auditSource 'connector' so the
 * audit trail records source: 'connector'.
 */

const db = require('../db');
const reconService = require('../services/reconciliationExceptions');
const incidentStore = require('../services/incidentStore');
const fraudCaseService = require('../services/fraudCaseService');
const settingsChanges = require('./settingsChangeController');
const opsActions = require('./opsActionsController');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BOOKING_STATUSES = new Set(['pending', 'accepted', 'declined', 'expired', 'cancelled']);
const PAYOUT_STATUSES = new Set(['initiated', 'processing', 'completed', 'failed', 'refunded']);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function parseLimit(value, def = DEFAULT_LIMIT) {
  if (value === undefined || value === null || value === '') return def;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, MAX_LIMIT);
}

function badRequest(code, message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  return err;
}

/**
 * Map a coded service error to the connector HTTP contract.
 * Returns true when the error was handled.
 */
function sendCodedError(res, error) {
  if (!error || !Number.isInteger(error.statusCode)) return false;
  const body = { error: error.message || 'Request failed.' };
  if (error.code) body.code = error.code;
  res.status(error.statusCode).json(body);
  return true;
}

function connectorError(res, next, error) {
  if (sendCodedError(res, error)) return;
  return next(error);
}

function requireResourceId(req) {
  const { id } = req.params || {};
  if (!isUuid(id)) {
    throw badRequest('invalid_id', 'A valid resource id (UUID) is required.');
  }
  return id.trim();
}

function actorId(req) {
  return req.connectorUser && req.connectorUser.id;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getMe(req, res) {
  return res.json({ user: req.connectorUser });
}

async function listBookings(req, res, next) {
  try {
    const { status } = req.query || {};
    if (status && !BOOKING_STATUSES.has(status)) {
      throw badRequest('invalid_status', `Invalid status filter. Must be one of: ${[...BOOKING_STATUSES].join(', ')}`);
    }
    const limit = parseLimit(req.query && req.query.limit);
    if (limit === null) {
      throw badRequest('invalid_limit', 'limit must be a positive integer.');
    }
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total FROM booking_requests ${where}`, params),
      db.query(
        `SELECT id, customer_id, helper_id, service_name, requested_date,
                requested_start_time, requested_end_time, service_location,
                description, status, expires_at, accepted_at, declined_at,
                created_at, updated_at
           FROM booking_requests ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length + 1}`,
        [...params, limit]
      ),
    ]);
    return res.json({
      data: rows,
      pagination: { limit, total: countRows[0] ? countRows[0].total : rows.length },
    });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function getBooking(req, res, next) {
  try {
    const id = requireResourceId(req);
    const { rows } = await db.query(
      `SELECT id, customer_id, helper_id, service_name, requested_date,
              requested_start_time, requested_end_time, service_location,
              description, status, expires_at, accepted_at, declined_at,
              created_at, updated_at
         FROM booking_requests WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      const err = new Error('Booking not found.');
      err.statusCode = 404;
      err.code = 'not_found';
      throw err;
    }
    return res.json({ data: rows[0] });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function listPayouts(req, res, next) {
  try {
    const { status } = req.query || {};
    if (status && !PAYOUT_STATUSES.has(status)) {
      throw badRequest('invalid_status', `Invalid status filter. Must be one of: ${[...PAYOUT_STATUSES].join(', ')}`);
    }
    const limit = parseLimit(req.query && req.query.limit);
    if (limit === null) {
      throw badRequest('invalid_limit', 'limit must be a positive integer.');
    }
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE transaction_status = $${params.length}`;
    }
    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total FROM payout_transactions ${where}`, params),
      db.query(
        `SELECT id, payout_id, transaction_status, external_transaction_id,
                failure_reason, created_at, updated_at
           FROM payout_transactions ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length + 1}`,
        [...params, limit]
      ),
    ]);
    return res.json({
      data: rows,
      pagination: { limit, total: countRows[0] ? countRows[0].total : rows.length },
    });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function listReconExceptions(req, res, next) {
  try {
    const limit = parseLimit(req.query && req.query.limit);
    if (limit === null) {
      throw badRequest('invalid_limit', 'limit must be a positive integer.');
    }
    const { status } = req.query || {};
    const { rows, total, page, limit: safeLimit } = await reconService.listExceptions({
      status: status || undefined,
      limit,
    });
    return res.json({ data: rows, pagination: { page, limit: safeLimit, total } });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function listIncidents(req, res, next) {
  try {
    const { status } = req.query || {};
    const limit = parseLimit(req.query && req.query.limit);
    if (limit === null) {
      throw badRequest('invalid_limit', 'limit must be a positive integer.');
    }
    const incidents = await incidentStore.listIncidents({
      status: status || undefined,
      limit,
    });
    return res.json({ data: incidents });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function listFraudCases(req, res, next) {
  try {
    const { status } = req.query || {};
    const limit = parseLimit(req.query && req.query.limit);
    if (limit === null) {
      throw badRequest('invalid_limit', 'limit must be a positive integer.');
    }
    const data = await fraudCaseService.listFraudCases({
      status: status || undefined,
      limit,
    });
    return res.json({ data });
  } catch (error) {
    if (error && error.code === 'validation_failed') {
      return res.status(400).json({ error: error.message, code: error.code, fields: error.fields });
    }
    return connectorError(res, next, error);
  }
}

async function listSettingsChanges(req, res, next) {
  try {
    const { status } = req.query || {};
    const limit = parseLimit(req.query && req.query.limit);
    if (limit === null) {
      throw badRequest('invalid_limit', 'limit must be a positive integer.');
    }
    const result = await settingsChanges.listChangeRequests({
      status: status || undefined,
      pagination: { ...(req.query || {}), limit },
    });
    return res.json(result);
  } catch (error) {
    return connectorError(res, next, error);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function acknowledgeReconException(req, res, next) {
  try {
    const id = requireResourceId(req);
    const data = await reconService.transitionException({
      id,
      kind: 'acknowledge',
      actorId: actorId(req),
      req,
      auditSource: 'connector',
    });
    return res.json({ data });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function assignReconException(req, res, next) {
  try {
    const id = requireResourceId(req);
    const assigneeId = req.body && req.body.assignee_id;
    if (!isUuid(assigneeId)) {
      throw badRequest('invalid_assignee_id', 'assignee_id must be a valid UUID.');
    }
    const data = await reconService.assignException({
      id,
      ownerAdminId: assigneeId.trim(),
      actorId: actorId(req),
      req,
      auditSource: 'connector',
    });
    return res.json({ data });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function resolveReconException(req, res, next) {
  try {
    const id = requireResourceId(req);
    const rawNotes = req.body && req.body.resolution_notes;
    let resolutionNotes;
    if (rawNotes !== undefined && rawNotes !== null && String(rawNotes).trim() !== '') {
      resolutionNotes = String(rawNotes);
    }
    const data = await reconService.transitionException({
      id,
      kind: 'resolve',
      actorId: actorId(req),
      req,
      resolutionNotes,
      auditSource: 'connector',
    });
    return res.json({ data });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function requeueDeadLetter(req, res, next) {
  try {
    // Dead-letter job ids are opaque queue-job identifiers, not UUIDs.
    const { id } = req.params || {};
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw badRequest('invalid_id', 'A dead-letter job id is required.');
    }
    const { queue } = (req.body || {});
    const { queue: foundQueue, job } = await opsActions.requeueDeadLetterById({
      jobId: id.trim(),
      queue,
      actorId: actorId(req),
      req,
      auditSource: 'connector',
    });
    return res.json({ success: true, queue: foundQueue, job });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function retryWebhook(req, res, next) {
  try {
    const webhookId = req.body && req.body.webhook_id;
    if (!isUuid(webhookId)) {
      throw badRequest('invalid_webhook_id', 'webhook_id must be a valid UUID.');
    }
    const delivery = await opsActions.retryWebhookDeliveryById({
      deliveryId: webhookId.trim(),
      actorId: actorId(req),
      req,
      auditSource: 'connector',
    });
    return res.json({ success: true, delivery });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function approveSettingsChange(req, res, next) {
  try {
    const id = requireResourceId(req);
    const { request, applied } = await settingsChanges.approveChangeRequest({
      id,
      approverId: actorId(req),
      req,
      auditSource: 'connector',
    });
    return res.json({ request, applied });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

async function rejectSettingsChange(req, res, next) {
  try {
    const id = requireResourceId(req);
    const reason = req.body && req.body.reason;
    if (!reason || String(reason).trim().length === 0) {
      throw badRequest('missing_reason', 'A rejection reason is required.');
    }
    const request = await settingsChanges.rejectChangeRequest({
      id,
      reason: String(reason).trim(),
      rejectorId: actorId(req),
      req,
      auditSource: 'connector',
    });
    return res.json({ request });
  } catch (error) {
    return connectorError(res, next, error);
  }
}

module.exports = {
  getMe,
  listBookings,
  getBooking,
  listPayouts,
  listReconExceptions,
  listIncidents,
  listFraudCases,
  listSettingsChanges,
  acknowledgeReconException,
  assignReconException,
  resolveReconException,
  requeueDeadLetter,
  retryWebhook,
  approveSettingsChange,
  rejectSettingsChange,
};
