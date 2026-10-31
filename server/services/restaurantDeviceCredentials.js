'use strict';

const crypto = require('crypto');
const AppError = require('../utils/appError');

function tokenHash(token) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 200)
    throw new AppError('Device credential is invalid', 401, 'invalid_device_credential');
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Legacy app IDs remain wire-compatible; the registry controls standing and
// store identity. No manually designated registry row is a credential.
async function authenticateAppDevice(client, { restaurantId, deviceId, token }) {
  const { rows: [device] } = await client.query(
    `SELECT a.*, r.id AS registry_id, r.device_role AS registry_role
       FROM restaurant_app_devices a
       JOIN restaurant_devices r ON r.source_app_device_id=a.id
        AND r.restaurant_id=a.restaurant_id AND r.status='active'
        AND r.location_id IS NOT DISTINCT FROM a.location_id
      WHERE a.id=$1 AND a.restaurant_id=$2 AND a.status='paired'
        AND a.device_token_hash=$3
        AND a.device_token_expires_at>NOW()`,
    [deviceId, restaurantId, tokenHash(token)],
  );
  if (!device) throw new AppError('Device credential is invalid', 401, 'invalid_device_credential');
  return device;
}

async function authenticateRegistryDevice(client,{restaurantId,registryId,token}) {
  const hash=tokenHash(token);
  const {rows:[row]}=await client.query(`SELECT r.id,r.restaurant_id,r.location_id,r.device_role,r.source_app_device_id,r.source_display_pairing_id
    FROM restaurant_devices r LEFT JOIN restaurant_app_devices a ON a.id=r.source_app_device_id
    LEFT JOIN display_pairings p ON p.id=r.source_display_pairing_id
    WHERE r.id=$1 AND r.restaurant_id=$2 AND r.status='active' AND (
      (a.restaurant_id=r.restaurant_id AND a.location_id IS NOT DISTINCT FROM r.location_id AND a.status='paired'
        AND a.device_token_hash=$3 AND a.device_token_expires_at>NOW())
      OR (p.restaurant_id=r.restaurant_id AND p.location_id IS NOT DISTINCT FROM r.location_id AND p.paired_at IS NOT NULL
        AND ((p.pairing_token_hash=$3 AND (p.pairing_token_expires_at IS NULL OR p.pairing_token_expires_at>NOW()))
          OR (p.pairing_token_hash_prev=$3 AND p.pairing_token_prev_expires_at>NOW()))))`,[registryId,restaurantId,hash]);
  if(!row)throw new AppError('Device credential is invalid',401,'invalid_device_credential');
  return {deviceId:Number(row.id),restaurantId:Number(row.restaurant_id),locationId:Number(row.location_id),role:row.device_role,
    sourceAppDeviceId:row.source_app_device_id?Number(row.source_app_device_id):null,
    sourceDisplayPairingId:row.source_display_pairing_id?Number(row.source_display_pairing_id):null};
}
module.exports = { authenticateAppDevice, authenticateRegistryDevice, tokenHash };
