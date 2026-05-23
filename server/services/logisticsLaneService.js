'use strict';
const pool = require('../db');

let _laneCache = null;
let _laneCacheAt = 0;
const CACHE_TTL_MS = 120_000;

async function getLane(laneId) {
  const result = await pool.query(
    'SELECT * FROM logistics_lanes WHERE id = $1 AND is_active = TRUE',
    [laneId]
  );
  return result.rows[0] || null;
}

async function getLaneByCode(code) {
  const result = await pool.query(
    'SELECT * FROM logistics_lanes WHERE code = $1 AND is_active = TRUE',
    [code]
  );
  return result.rows[0] || null;
}

async function listLanes({ originCountry, destCountry, riskTier, isActive = true } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (isActive !== null) { conditions.push(`l.is_active = $${params.push(isActive)}`); }
  if (originCountry)     { conditions.push(`l.origin_country = $${params.push(originCountry)}`); }
  if (destCountry)       { conditions.push(`l.destination_country = $${params.push(destCountry)}`); }
  if (riskTier)          { conditions.push(`l.risk_tier = $${params.push(riskTier)}`); }
  const result = await pool.query(
    `SELECT l.*, COUNT(po.id) AS active_po_count
     FROM logistics_lanes l
     LEFT JOIN purchase_orders po ON po.lane_id = l.id AND po.status NOT IN ('closed','cancelled')
     WHERE ${conditions.join(' AND ')}
     GROUP BY l.id
     ORDER BY l.name`,
    params
  );
  return result.rows;
}

/**
 * Check whether a user/role/country combination is allowed to buy on a lane.
 * Returns { allowed: boolean, reason?: string }
 */
async function checkLaneAccess(laneId, { userRole, buyerCountry, isBusinessVerified = false } = {}) {
  const lane = await getLane(laneId);
  if (!lane) return { allowed: false, reason: 'lane_not_found' };
  if (!lane.is_active) return { allowed: false, reason: 'lane_inactive' };

  if (lane.allowed_buyer_countries && lane.allowed_buyer_countries.length > 0) {
    if (!lane.allowed_buyer_countries.includes(buyerCountry)) {
      return { allowed: false, reason: 'buyer_country_not_allowed' };
    }
  }
  if (lane.allowed_buyer_roles && lane.allowed_buyer_roles.length > 0) {
    if (!lane.allowed_buyer_roles.includes(userRole)) {
      return { allowed: false, reason: 'buyer_role_not_allowed' };
    }
  }
  if (lane.requires_business_verification && !isBusinessVerified) {
    return { allowed: false, reason: 'business_verification_required' };
  }
  return { allowed: true, requiresManualApproval: lane.requires_manual_approval };
}

async function createLane(data, createdBy) {
  const {
    code, name, description, origin_country, destination_country,
    allowed_buyer_countries, allowed_buyer_roles, restricted_categories,
    doc_requirements, freight_options, customs_complexity, risk_tier,
    fulfillment_model, default_markup_pct, default_sourcing_fee_cents,
    default_freight_est_cents, default_customs_fee_cents, default_warehouse_fee_cents,
    default_last_mile_cents, requires_business_verification, requires_manual_approval,
    requires_reseller_approval, notes,
  } = data;

  const result = await pool.query(
    `INSERT INTO logistics_lanes
       (code,name,description,origin_country,destination_country,
        allowed_buyer_countries,allowed_buyer_roles,restricted_categories,
        doc_requirements,freight_options,customs_complexity,risk_tier,
        fulfillment_model,default_markup_pct,default_sourcing_fee_cents,
        default_freight_est_cents,default_customs_fee_cents,default_warehouse_fee_cents,
        default_last_mile_cents,requires_business_verification,requires_manual_approval,
        requires_reseller_approval,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      code,name,description,origin_country,destination_country,
      allowed_buyer_countries||[],allowed_buyer_roles||[],restricted_categories||[],
      JSON.stringify(doc_requirements||[]),freight_options||[],
      customs_complexity||1,risk_tier||'low',fulfillment_model||'direct',
      default_markup_pct||0.15,default_sourcing_fee_cents||0,
      default_freight_est_cents||0,default_customs_fee_cents||0,
      default_warehouse_fee_cents||0,default_last_mile_cents||0,
      requires_business_verification||false,requires_manual_approval||false,
      requires_reseller_approval||false,notes,createdBy,
    ]
  );
  return result.rows[0];
}

async function updateLane(laneId, data, updatedBy) {
  const allowed = [
    'name','description','allowed_buyer_countries','allowed_buyer_roles',
    'restricted_categories','doc_requirements','freight_options','customs_complexity',
    'risk_tier','fulfillment_model','default_markup_pct','default_sourcing_fee_cents',
    'default_freight_est_cents','default_customs_fee_cents','default_warehouse_fee_cents',
    'default_last_mile_cents','requires_business_verification','requires_manual_approval',
    'requires_reseller_approval','is_active','notes',
  ];
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k)) {
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (!sets.length) throw new Error('No valid fields to update');
  params.push(laneId);
  const result = await pool.query(
    `UPDATE logistics_lanes SET ${sets.join(',')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows[0];
}

module.exports = { getLane, getLaneByCode, listLanes, checkLaneAccess, createLane, updateLane };
