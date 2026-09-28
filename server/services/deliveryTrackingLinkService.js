'use strict';

/**
 * Customer tracking-link service.
 *
 * Signed, expiring public tracking links for delivery recipients who do not
 * have an OxSteed account. Only the SHA-256 hash of a token is ever stored;
 * the raw token is returned once at creation time.
 *
 * Tracking links never mutate delivery_jobs. They are evidence/access only,
 * and every public view goes through the customer-safe projection below,
 * which exposes approximate location only.
 */

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { getCurrentEta } = require('./deliveryEtaService');
const { getObservations } = require('./deliveryGeofenceService');

const TOKEN_BYTES = 32; // 64 hex characters
const PREFIX_CHARS = 8;
const DEFAULT_TTL_HOURS = 72;
const MAX_TTL_HOURS = 24 * 30; // 30 days
const APPROX_DECIMALS = 2; // ~1.1km grid; exact coordinates never leave the server
const APPROX_RADIUS_METERS = 500;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function ttlToExpiresAt(ttlHours) {
  const hours = ttlHours === undefined || ttlHours === null ? DEFAULT_TTL_HOURS : Number(ttlHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new AppError('ttlHours must be a positive number of hours', 400, 'tracking_link_invalid_ttl');
  }
  if (hours > MAX_TTL_HOURS) {
    throw new AppError(`ttlHours cannot exceed ${MAX_TTL_HOURS} hours`, 400, 'tracking_link_invalid_ttl');
  }
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function insertLink(queryable, { deliveryJobId, createdByUserId, ttlHours }) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = sha256Hex(token);
  const prefix = token.slice(0, PREFIX_CHARS);
  const expiresAt = ttlToExpiresAt(ttlHours);

  const { rows } = await queryable.query(
    `INSERT INTO delivery_tracking_links
       (delivery_job_id, token_hash, token_prefix, created_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, token_prefix, expires_at, created_at`,
    [deliveryJobId, tokenHash, prefix, createdByUserId || null, expiresAt.toISOString()]
  );

  return {
    id: rows[0].id,
    token, // raw token: returned once, never stored
    prefix: rows[0].token_prefix,
    expiresAt: rows[0].expires_at,
    createdAt: rows[0].created_at,
  };
}

/**
 * Create a tracking link. Returns the raw token exactly once; only the
 * SHA-256 hash and an 8-char prefix are persisted.
 */
async function createLink({ deliveryJobId, createdByUserId, ttlHours = DEFAULT_TTL_HOURS }) {
  if (!deliveryJobId) {
    throw new AppError('deliveryJobId is required', 400, 'tracking_link_invalid_request');
  }
  return insertLink(pool, { deliveryJobId, createdByUserId, ttlHours });
}

async function revokeRow(queryable, { linkId, deliveryJobId, reason }) {
  const { rows } = await queryable.query(
    `UPDATE delivery_tracking_links
        SET revoked_at = NOW(),
            revoked_reason = $3
      WHERE id = $1
        AND delivery_job_id = $2
        AND revoked_at IS NULL
      RETURNING id, token_prefix, expires_at, revoked_at, revoked_reason, use_count, created_at`,
    [linkId, deliveryJobId, reason ? String(reason).slice(0, 120) : null]
  );
  if (!rows[0]) {
    throw new AppError('Tracking link not found', 404, 'tracking_link_not_found');
  }
  return rows[0];
}

/**
 * Revoke a tracking link immediately. Idempotent per row: revoking an
 * already-revoked link reports not found so callers cannot probe history.
 */
async function revokeLink({ linkId, deliveryJobId, reason }) {
  return revokeRow(pool, { linkId, deliveryJobId, reason });
}

/**
 * Refresh a link: revoke the old one and issue a new raw token, atomically.
 * Returns { link: <new link incl. raw token>, revoked: <old link metadata> }.
 */
async function refreshLink({ linkId, deliveryJobId, createdByUserId, ttlHours = DEFAULT_TTL_HOURS }) {
  return withTransaction(pool, async (client) => {
    const revoked = await revokeRow(client, { linkId, deliveryJobId, reason: 'refreshed' });
    const link = await insertLink(client, { deliveryJobId, createdByUserId, ttlHours });
    return { link, revoked: { id: revoked.id, prefix: revoked.token_prefix } };
  }, 'tracking_link_refresh');
}

/**
 * Resolve a raw token to its link. Validates existence, revocation, and
 * expiry; on success increments use_count/last_used_at. Throws AppError with
 * code tracking_link_invalid (404), tracking_link_expired (410), or
 * tracking_link_revoked (410). Callers must map tracking_link_invalid to a
 * generic 404 so tokens cannot be enumerated.
 */
async function resolveToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new AppError('Tracking link not found', 404, 'tracking_link_invalid');
  }
  const { rows } = await pool.query(
    `SELECT id, delivery_job_id, token_prefix, expires_at, revoked_at,
            revoked_reason, use_count, last_used_at, created_at
       FROM delivery_tracking_links
      WHERE token_hash = $1`,
    [sha256Hex(token)]
  );
  const link = rows[0];
  if (!link) {
    throw new AppError('Tracking link not found', 404, 'tracking_link_invalid');
  }
  if (link.revoked_at) {
    throw new AppError('Tracking link has been revoked', 410, 'tracking_link_revoked');
  }
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    throw new AppError('Tracking link has expired', 410, 'tracking_link_expired');
  }

  await pool.query(
    `UPDATE delivery_tracking_links
        SET use_count = use_count + 1,
            last_used_at = NOW()
      WHERE id = $1`,
    [link.id]
  );

  return { link, deliveryJobId: link.delivery_job_id };
}

/**
 * List link metadata for a job. Never returns token hashes or raw tokens.
 */
async function listLinks(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT id, token_prefix, expires_at, revoked_at, revoked_reason,
            use_count, last_used_at, created_at
       FROM delivery_tracking_links
      WHERE delivery_job_id = $1
      ORDER BY created_at DESC, id DESC`,
    [deliveryJobId]
  );
  return rows;
}

/**
 * Tracking-link cleanup for the background worker: links on terminal jobs
 * (delivered/cancelled/returned) must expire no later than 24h after the job
 * ended. Returns the number of links clamped.
 */
async function expireCompletedLinks() {
  const { rows } = await pool.query(
    `UPDATE delivery_tracking_links l
        SET expires_at = LEAST(l.expires_at, j.job_end + INTERVAL '24 hours')
       FROM (
         SELECT id,
                COALESCE(delivered_at, cancelled_at, returned_at) AS job_end
           FROM delivery_jobs
          WHERE status IN ('delivered', 'cancelled', 'returned')
            AND COALESCE(delivered_at, cancelled_at, returned_at) IS NOT NULL
       ) j
      WHERE l.delivery_job_id = j.id
        AND l.revoked_at IS NULL
        AND l.expires_at > j.job_end + INTERVAL '24 hours'
      RETURNING l.id`
  );
  return { expired: rows.length };
}

// ── Customer-safe projection ────────────────────────────────────────────────
// Everything a recipient may see. Approximate location only: no exact
// coordinates, no driver identity, no tracker IDs, no fulfillment source,
// no private notes.

const STATUS_LABELS = {
  posted: 'Delivery requested',
  assigned: 'Driver assigned',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Delivery failed',
};

const STATUS_ORDER = ['posted', 'assigned', 'picked_up', 'in_transit', 'delivered'];

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Strip the leading street number ("123 Main St" -> "Main St") so the exact
// building is not disclosed, then keep street + city + state.
function maskAddress(address, city, state) {
  const street = String(address || '').trim().replace(/^\s*\d+[A-Za-z-]*(?:\s*[-/]\s*\d+[A-Za-z-]*)?\s+/, '');
  const parts = [street, city, state].map((part) => String(part || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function buildMilestones({ job, scans, observations }) {
  const scanByType = {};
  for (const scan of scans || []) {
    if (!scanByType[scan.scan_type]) scanByType[scan.scan_type] = scan;
  }
  const destinationArrival = (observations || []).find(
    (o) => o.geofence_kind === 'destination' && o.observation === 'arrival'
  );
  const statusIdx = STATUS_ORDER.indexOf(job.status);
  const reachedStatus = (status) => statusIdx >= 0 && STATUS_ORDER.indexOf(status) <= statusIdx;

  const milestones = [
    { key: 'placed', label: 'Delivery requested', reached: true, at: job.created_at || null },
    { key: 'assigned', label: 'Driver assigned', reached: reachedStatus('assigned'), at: job.assigned_at || null },
    {
      key: 'picked_up',
      label: 'Picked up',
      reached: reachedStatus('picked_up') || Boolean(scanByType.pickup),
      at: (scanByType.pickup && scanByType.pickup.scanned_at) || job.picked_up_at || null,
    },
  ];

  if (scanByType.handoff) {
    milestones.push({
      key: 'handoff',
      label: 'Handed off',
      reached: true,
      at: scanByType.handoff.scanned_at || null,
    });
  }

  milestones.push(
    { key: 'in_transit', label: 'On the way', reached: reachedStatus('in_transit'), at: null },
    {
      key: 'approaching',
      label: 'Approaching destination',
      reached: Boolean(destinationArrival),
      at: (destinationArrival && destinationArrival.observed_at) || null,
    },
    {
      key: 'delivered',
      label: 'Delivered',
      reached: job.status === 'delivered',
      at: job.delivered_at || null,
    }
  );

  return milestones;
}

function normalizeEta(eta) {
  if (!eta) return { at: null, freshness: 'unavailable' };
  if (eta.stale || !eta.etaAt) return { at: null, freshness: 'stale' };
  return { at: new Date(eta.etaAt).toISOString(), freshness: 'fresh' };
}

/**
 * Build the customer-safe tracking state from loaded records. Pure: no DB
 * access. latestPoint is the newest valid location point (or null); it is
 * rounded to 2 decimals (~1.1km grid) and paired with a 500m accuracy radius.
 */
function buildCustomerTrackingState({ job, eta, observations, scans, latestPoint }) {
  if (!job) {
    throw new AppError('Delivery job not found', 404, 'delivery_job_not_found');
  }

  let approximateArea = null;
  if (latestPoint && latestPoint.latitude !== null && latestPoint.latitude !== undefined
    && latestPoint.longitude !== null && latestPoint.longitude !== undefined) {
    const lat = Number(latestPoint.latitude);
    const lng = Number(latestPoint.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      approximateArea = {
        approxLat: round2(lat),
        approxLng: round2(lng),
        accuracyRadiusMeters: APPROX_RADIUS_METERS,
      };
    }
  }

  return {
    reference: job.reference,
    status: job.status,
    statusLabel: STATUS_LABELS[job.status] || job.status,
    milestones: buildMilestones({ job, scans, observations }),
    eta: normalizeEta(eta),
    approximateArea,
    maskedPickup: maskAddress(job.origin_address, job.origin_city, job.origin_state),
    maskedDropoff: maskAddress(job.destination_address, job.destination_city, job.destination_state),
  };
}

async function loadLatestValidPoint(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT latitude, longitude, recorded_at
       FROM delivery_location_points
      WHERE delivery_job_id = $1
        AND validation_state = 'valid'
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1`,
    [deliveryJobId]
  );
  return rows[0] || null;
}

async function loadScans(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT scan_type, scanned_at
       FROM delivery_scan_events
      WHERE delivery_job_id = $1
      ORDER BY scanned_at DESC, id DESC`,
    [deliveryJobId]
  );
  return rows;
}

// Customer-safe job columns only: no coordinates, no driver/vehicle identity,
// no notes, no pricing, no fulfillment source.
async function loadCustomerJob(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT id, reference, status, customer_user_id,
            origin_address, origin_city, origin_state,
            destination_address, destination_city, destination_state,
            created_at, assigned_at, picked_up_at, delivered_at, cancelled_at
       FROM delivery_jobs
      WHERE id = $1`,
    [deliveryJobId]
  );
  return rows[0] || null;
}

/**
 * Load everything the customer-safe projection needs for one delivery job.
 */
async function getCustomerTrackingState(deliveryJobId) {
  const job = await loadCustomerJob(deliveryJobId);
  if (!job) {
    throw new AppError('Delivery job not found', 404, 'delivery_job_not_found');
  }
  const eta = await getCurrentEta(deliveryJobId);
  const observations = await getObservations(deliveryJobId);
  const scans = await loadScans(deliveryJobId);
  const latestPoint = await loadLatestValidPoint(deliveryJobId);
  return buildCustomerTrackingState({ job, eta, observations, scans, latestPoint });
}

module.exports = {
  createLink,
  revokeLink,
  refreshLink,
  resolveToken,
  listLinks,
  expireCompletedLinks,
  buildCustomerTrackingState,
  getCustomerTrackingState,
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
};
