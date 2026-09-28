'use strict';

/**
 * telematicsConnectionService.js
 *
 * Manages `delivery_telematics_connections` rows: provider connections for
 * vehicle telematics, including feed cursors, webhook subscription ids, sync
 * errors, and pause/resume/revoke lifecycle.
 *
 * Security: webhook secrets and provider credentials live in the secure
 * configuration store. Only *references* (`webhook_secret_ref`,
 * `credential_ref`) are stored here. This service never reads, writes, logs,
 * or returns secret values.
 */

const pool = require('../db');
const { getAdapter } = require('./telematics/adapterRegistry');

const MAX_CONSECUTIVE_ERRORS = 5;

function toRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    vehicleId: row.vehicle_id,
    status: row.status,
    cursor: row.cursor,
    webhookSubscriptionId: row.webhook_subscription_id,
    webhookSecretRef: row.webhook_secret_ref,
    credentialRef: row.credential_ref,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    errorCount: row.error_count,
    syncState: row.sync_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireRow(result, connectionId, action) {
  if (!result.rows || result.rows.length === 0) {
    const error = new Error(`Telematics connection ${connectionId} not found for '${action}'.`);
    error.code = 'TELEMATICS_CONNECTION_NOT_FOUND';
    throw error;
  }
  return toRow(result.rows[0]);
}

/**
 * Registers (or re-registers) a provider connection for a vehicle.
 * Throws on unknown providers via the adapter registry.
 */
async function connect({ provider, vehicleId = null, credentialRef = null, webhookSecretRef = null } = {}) {
  getAdapter(provider); // fail fast on unknown provider names
  if (vehicleId === null || vehicleId === undefined) {
    const result = await pool.query(
      `INSERT INTO delivery_telematics_connections
         (provider, vehicle_id, status, credential_ref, webhook_secret_ref)
       VALUES ($1, NULL, 'active', $2, $3)
       RETURNING *`,
      [provider, credentialRef, webhookSecretRef]
    );
    return toRow(result.rows[0]);
  }
  const result = await pool.query(
    `INSERT INTO delivery_telematics_connections
       (provider, vehicle_id, status, credential_ref, webhook_secret_ref)
     VALUES ($1, $2, 'active', $3, $4)
     ON CONFLICT (provider, vehicle_id) WHERE vehicle_id IS NOT NULL
     DO UPDATE SET
       status = 'active',
       credential_ref = EXCLUDED.credential_ref,
       webhook_secret_ref = EXCLUDED.webhook_secret_ref,
       error_count = 0,
       last_error = NULL,
       updated_at = NOW()
     RETURNING *`,
    [provider, vehicleId, credentialRef, webhookSecretRef]
  );
  return toRow(result.rows[0]);
}

/**
 * Persists the provider feed cursor after a successful incremental poll.
 */
async function updateCursor(connectionId, cursor) {
  const result = await pool.query(
    `UPDATE delivery_telematics_connections
     SET cursor = $2, last_sync_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [connectionId, cursor]
  );
  return requireRow(result, connectionId, 'updateCursor');
}

/**
 * Records a sync failure. After MAX_CONSECUTIVE_ERRORS consecutive errors the
 * connection status moves to 'error' so operators can intervene.
 */
async function recordSyncError(connectionId, error) {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown sync error');
  const result = await pool.query(
    `UPDATE delivery_telematics_connections
     SET error_count = error_count + 1,
         last_error = $2,
         status = CASE WHEN error_count + 1 >= $3 THEN 'error' ELSE status END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [connectionId, message.slice(0, 2000), MAX_CONSECUTIVE_ERRORS]
  );
  return requireRow(result, connectionId, 'recordSyncError');
}

/**
 * Records a successful sync: clears the error counter and message, and
 * returns an 'error'-flagged connection back to 'active'.
 */
async function recordSyncSuccess(connectionId) {
  const result = await pool.query(
    `UPDATE delivery_telematics_connections
     SET error_count = 0,
         last_error = NULL,
         last_sync_at = NOW(),
         status = CASE WHEN status = 'error' THEN 'active' ELSE status END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [connectionId]
  );
  return requireRow(result, connectionId, 'recordSyncSuccess');
}

async function setStatus(connectionId, fromStatuses, toStatus, action) {
  const result = await pool.query(
    `UPDATE delivery_telematics_connections
     SET status = $2, updated_at = NOW()
     WHERE id = $1 AND status = ANY($3)
     RETURNING *`,
    [connectionId, toStatus, fromStatuses]
  );
  if (!result.rows || result.rows.length === 0) {
    const error = new Error(
      `Cannot ${action} telematics connection ${connectionId}: not found or not in a valid state.`
    );
    error.code = 'TELEMATICS_CONNECTION_STATE';
    throw error;
  }
  return toRow(result.rows[0]);
}

async function pause(connectionId) {
  return setStatus(connectionId, ['active', 'error'], 'paused', 'pause');
}

async function resume(connectionId) {
  return setStatus(connectionId, ['paused', 'error'], 'active', 'resume');
}

async function revoke(connectionId) {
  return setStatus(connectionId, ['active', 'paused', 'error'], 'revoked', 'revoke');
}

async function getById(connectionId) {
  const result = await pool.query(
    'SELECT * FROM delivery_telematics_connections WHERE id = $1',
    [connectionId]
  );
  return toRow(result.rows[0]);
}

/**
 * Returns active provider connections for a vehicle, newest first.
 */
async function getActiveForVehicle(vehicleId) {
  const result = await pool.query(
    `SELECT * FROM delivery_telematics_connections
     WHERE vehicle_id = $1 AND status = 'active'
     ORDER BY updated_at DESC`,
    [vehicleId]
  );
  return result.rows.map(toRow);
}

module.exports = {
  MAX_CONSECUTIVE_ERRORS,
  connect,
  updateCursor,
  recordSyncError,
  recordSyncSuccess,
  pause,
  resume,
  revoke,
  getById,
  getActiveForVehicle,
};
