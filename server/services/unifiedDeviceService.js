'use strict';

// F-26 convergence: the single device-identity read/write model.
//
// Three pairing systems coexist (restaurant_app_devices incl. managed screens
// v2, display_pairings from PR #612, manual hub designations). Migration 996
// added restaurant_devices as the canonical registry: one row per device
// with role, store and capabilities, kept in sync by triggers. This service
// is the only writer new code should use; the legacy tables remain the
// pairing-flow sources of truth behind adapters (see
// docs/restaurant-device-convergence.md) so live pairing flows keep working.

const AppError = require('../utils/appError');

const DEVICE_ROLES = new Set([
  'pos', 'kitchen', 'display', 'kiosk', 'printer',
  'runner', 'manager', 'hub', 'inventory', 'crew',
]);

function normalizeId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`A valid ${field} is required`, 400, 'validation_failed');
  return id;
}

function deviceShape(row) {
  return {
    id: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    locationId: row.location_id == null ? null : Number(row.location_id),
    locationName: row.location_name || null,
    deviceRole: row.device_role,
    capabilities: row.capabilities || {},
    pairingSource: row.pairing_source,
    sourceAppDeviceId: row.source_app_device_id == null ? null : Number(row.source_app_device_id),
    sourceDisplayPairingId: row.source_display_pairing_id == null ? null : Number(row.source_display_pairing_id),
    deviceName: row.device_name || null,
    status: row.status,
    lastSeenAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function listDevices(client, restaurantId, { locationId = null, role = null, status = null } = {}) {
  if (role != null && !DEVICE_ROLES.has(role)) throw new AppError('Unsupported device role', 400, 'validation_failed');
  const { rows } = await client.query(
    `SELECT d.*, l.name AS location_name,
            ad.device_name AS app_device_name, dp.label AS display_label
       FROM restaurant_devices d
       LEFT JOIN restaurant_locations l
         ON l.restaurant_id = d.restaurant_id AND l.id = d.location_id
       LEFT JOIN restaurant_app_devices ad ON ad.id = d.source_app_device_id
       LEFT JOIN display_pairings dp ON dp.id = d.source_display_pairing_id
      WHERE d.restaurant_id = $1
        AND ($2::bigint IS NULL OR d.location_id = $2)
        AND ($3::text IS NULL OR d.device_role = $3)
        AND ($4::text IS NULL OR d.status = $4)
      ORDER BY d.last_seen_at DESC NULLS LAST, d.id DESC`,
    [restaurantId, locationId, role, status]
  );
  return rows.map((row) => deviceShape({
    ...row,
    device_name: row.app_device_name || row.display_label || row.device_name,
  }));
}

async function getDevice(client, restaurantId, deviceId, { allowedLocationIds = null, lock = false } = {}) {
  const {rows:[row]}=await client.query(`SELECT * FROM restaurant_devices
    WHERE restaurant_id=$1 AND id=$2 AND ($3::bigint[] IS NULL OR location_id=ANY($3::bigint[]))${lock?' FOR UPDATE':''}`,
    [restaurantId,normalizeId(deviceId,'device'),allowedLocationIds]);
  if(!row)throw new AppError('Device not found',404,'device_not_found');
  return deviceShape(row);
}

// Disabling is the safe lifecycle operation: it revokes the device's ability
// to authenticate everywhere by writing through to the pairing source.
async function setDeviceStatus(client, { restaurantId, deviceId, status, actorUserId = null, allowedLocationIds = null }) {
  if (!['active', 'disabled'].includes(status)) throw new AppError('Unsupported device status', 400, 'validation_failed');
  const device = await getDevice(client, restaurantId, deviceId, { allowedLocationIds, lock: true });
  if (device.sourceDisplayPairingId && status === 'active' && device.status === 'disabled') {
    throw new AppError('Pair this display again before enabling it', 409, 'device_pairing_required');
  }
  await client.query(
    `UPDATE restaurant_devices SET status = $2, updated_at = NOW() WHERE id = $1`,
    [device.id, status]
  );
  if (device.sourceAppDeviceId) {
    await client.query(
      `UPDATE restaurant_app_devices
          SET status = $2, updated_at = NOW()
        WHERE id = $1`,
      [device.sourceAppDeviceId, status === 'disabled' ? 'disabled' : 'paired']
    );
  }
  if (device.sourceDisplayPairingId && status === 'disabled') {
    // Keep the claimed-row CHECK valid while revoking BOTH token generations.
    await client.query(
      `UPDATE display_pairings SET pairing_token_expires_at=NOW(),
         pairing_token_hash_prev=NULL,pairing_token_prev_expires_at=NULL,
         pairing_token_encrypted=NULL WHERE id = $1`,
      [device.sourceDisplayPairingId]
    );
  }
  void actorUserId;
  return { ...device, status };
}

async function designateHubDevice(client, { restaurantId, locationId, name, actorUserId = null }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_devices
       (restaurant_id, location_id, device_role, capabilities, pairing_source, source_key, created_by)
     VALUES ($1, $2, 'hub', $3, 'manual', $4, $5)
     RETURNING *`,
    [
      restaurantId, locationId,
      JSON.stringify({ hub: true, name: String(name || '').slice(0, 160) }),
      `hub:${restaurantId}:${locationId}:${Date.now()}`,
      actorUserId,
    ]
  );
  return deviceShape(row);
}

module.exports = {
  DEVICE_ROLES: [...DEVICE_ROLES],
  listDevices,
  getDevice,
  setDeviceStatus,
  designateHubDevice,
  deviceShape,
};
