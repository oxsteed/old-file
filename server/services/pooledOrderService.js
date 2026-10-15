'use strict';
const pool = require('../db');
const crypto = require('crypto');
const { logLogisticsAction } = require('./logisticsAuditService');
const { calculateLandedCost } = require('./logisticsPricingService');
const { approval: approvalMachine, pooled: pooledMachine, applyTransition } = require('./logisticsStateMachine');
const accessService = require('./logisticsAccessService');
const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');

// Roles (besides platform admins) allowed to review campaign drafts.
const REVIEW_OPS_ROLES = new Set(['sourcing_operator', 'logistics_coordinator']);

function svcError(message, status, code, details) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

// English fallback messages for approval blockers. The client localizes by
// `code` (logistics.campaigns.approval.blocker_<code>); the message is kept
// for non-UI clients and logs.
const BLOCKER_MESSAGES = {
  missing_title: 'Add a campaign title.',
  missing_description: 'Add a description of what buyers are getting.',
  missing_lane: 'Choose a trade lane.',
  missing_moq: 'Set a minimum quantity of at least 1.',
  missing_close_date: 'Set a pledge close date.',
  close_date_past: 'The pledge close date must be in the future.',
  missing_pricing: 'Add a unit cost or freight estimate for the pricing sketch.',
  business_verification_required: 'This lane requires a verified business. Complete business verification first.',
  lane_access_blocked: 'This trade lane is not available for your market.',
};

// Best-effort lookup of the user's active business and its KYB status.
async function getUserBusinessVerification(userId) {
  try {
    const r = await pool.query(
      `SELECT id, kyb_verified FROM businesses
        WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
      [userId]
    );
    return {
      hasBusiness: r.rows.length > 0,
      isVerified: r.rows.length > 0 && Boolean(r.rows[0].kyb_verified),
      businessId: r.rows.length ? r.rows[0].id : null,
    };
  } catch (_) {
    return { hasBusiness: false, isVerified: false, businessId: null };
  }
}

// Compute the blockers that prevent a draft from being submitted for review.
// Every blocker is { code, field, message }; the UI localizes via `code`.
async function evaluateCampaignBlockers(order, { userId = null, userCountry = null, userRole = null } = {}) {
  const blockers = [];
  const push = (code, field) =>
    blockers.push({ code, field, message: BLOCKER_MESSAGES[code] });

  if (!order.title || !String(order.title).trim()) push('missing_title', 'title');
  if (!order.description || !String(order.description).trim()) push('missing_description', 'description');
  if (!order.lane_id) push('missing_lane', 'lane_id');
  if (!order.target_moq || Number(order.target_moq) < 1) push('missing_moq', 'target_moq');
  if (!order.close_date) push('missing_close_date', 'close_date');
  else if (new Date(order.close_date).getTime() <= Date.now()) push('close_date_past', 'close_date');
  if (!order.unit_landed_cost_usd && !order.unit_product_cost_usd) push('missing_pricing', 'unit_product_cost_usd');

  if (order.lane_id) {
    let lane = null;
    try {
      lane = (await pool.query(
        'SELECT id, requires_business_verification FROM logistics_lanes WHERE id = $1',
        [order.lane_id]
      )).rows[0] || null;
    } catch (_) { /* leave lane null; lane check below stays best-effort */ }
    if (!lane) {
      push('missing_lane', 'lane_id');
    } else {
      const business = userId ? await getUserBusinessVerification(userId) : { isVerified: false };
      if (lane.requires_business_verification && !business.isVerified) {
        push('business_verification_required', 'organizer_business_id');
      }
      try {
        const access = await accessService.evaluateAccess({
          laneId: order.lane_id,
          buyerCountry: userCountry,
          userRole: userRole || 'individual_buyer',
          isBusinessVerified: business.isVerified,
        });
        if (!access.allowed) push('lane_access_blocked', 'lane_id');
      } catch (_) { /* lane check is a hard gate on the write path, not here */ }
    }
  }
  return blockers;
}

// Server-side capability, business-membership, verification, and lane checks
// applied when a draft is first created.
async function assertCanCreateCampaign({ userId, userCountry, userRole, laneId, organizerBusinessId }) {
  let lane = null;
  try {
    lane = (await pool.query(
      'SELECT id, requires_business_verification FROM logistics_lanes WHERE id = $1',
      [laneId]
    )).rows[0] || null;
  } catch (_) { /* fall through to not-found below */ }
  if (!lane) throw svcError('Trade lane not found', 400, 'lane_not_found');

  // Business-membership: an explicitly attached business must belong to the
  // organizer and be active.
  if (organizerBusinessId !== undefined && organizerBusinessId !== null && organizerBusinessId !== '') {
    const b = await pool.query(
      'SELECT id, kyb_verified FROM businesses WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
      [organizerBusinessId, userId]
    );
    if (!b.rows.length) {
      throw svcError('Business not found or not owned by the organizer', 403, 'not_business_member');
    }
  }

  const business = await getUserBusinessVerification(userId);
  // Verification: lanes that require business verification reject unverified organizers.
  if (lane.requires_business_verification && !business.isVerified) {
    throw svcError(
      'This lane requires a verified business',
      403,
      'business_verification_required'
    );
  }

  // Lane check: country/trade-rule access for the organizer's market.
  const access = await accessService.evaluateAccess({
    laneId: lane.id,
    buyerCountry: userCountry,
    userRole: userRole || 'individual_buyer',
    isBusinessVerified: business.isVerified,
  });
  if (!access.allowed) {
    throw svcError(
      'This trade lane is not available for your market',
      403,
      'lane_access_denied',
      { blockers: access.blockers }
    );
  }
  return { lane, business };
}

async function generatePooledRef() {
  const year = new Date().getFullYear();
  return `PO-${year}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

async function listPooledOrders({
  status, laneId, organizerUserId, open = null, limit = 50, offset = 0, publicSafe = true,
  search = null, excludeDrafts = false,
} = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (status)          { conditions.push(`po.status = $${params.push(status)}`); }
  if (laneId)          { conditions.push(`po.lane_id = $${params.push(laneId)}`); }
  if (organizerUserId) { conditions.push(`po.organizer_user_id = $${params.push(organizerUserId)}`); }
  if (open === true)   { conditions.push(`po.status IN ('open','pledging','deposit_phase')`); }
  // Phase 1 public visibility: guests must only see published/approved
  // campaigns. Drafts are organizer-owned working copies until staff approve
  // publication (Phase 2 approval workflow).
  if (excludeDrafts)   { conditions.push(`po.status <> 'draft'`); }
  if (search) {
    // Literal ILIKE match on title/description. Escape LIKE wildcards so a
    // query such as "100%" cannot act as a wildcard.
    const escaped = String(search).replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const pattern = `%${escaped}%`;
    conditions.push(
      `(po.title ILIKE $${params.push(pattern)} ESCAPE '\\' OR ` +
      `po.description ILIKE $${params.push(pattern)} ESCAPE '\\')`
    );
  }

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM pooled_orders po WHERE ${conditions.join(' AND ')}`, params
  );
  const orderFields = publicSafe
    ? `po.id, po.reference, po.title, po.description, po.lane_id, po.supplier_product_id,
       po.organizer_user_id, po.status, po.approval_state, po.target_moq, po.current_committed_qty,
       po.unit_landed_cost_usd, po.deposit_pct, po.final_payment_pct,
       po.open_date, po.close_date, po.lock_date, po.expected_ship_date,
       po.expected_arrival_date, po.cancellation_policy, po.max_participants`
    : 'po.*';
  const rows = await pool.query(
    `SELECT ${orderFields},
            ll.name AS lane_name, ll.origin_country, ll.destination_country,
            u.first_name || ' ' || u.last_name AS organizer_name,
            sp.title AS product_title, sp.category AS product_category,
            (SELECT COUNT(*) FROM pooled_order_participants pp WHERE pp.pooled_order_id = po.id AND pp.status NOT IN ('refunded','disputed')) AS participant_count,
            ROUND(po.current_committed_qty::numeric / NULLIF(po.target_moq,0) * 100) AS moq_pct
     FROM pooled_orders po
     LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
     LEFT JOIN users u ON u.id = po.organizer_user_id
     LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY po.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { orders: rows.rows, total: parseInt(countRes.rows[0].count) };
}

async function listOrganizerCampaigns(organizerUserId, { status, search, limit = 50, offset = 0 } = {}) {
  // Organizer-scoped listing: the organizer's own campaigns, including drafts,
  // which the public endpoint never returns. Full (non-public-safe) fields so
  // the organizer workspace can render approval state and review notes.
  return listPooledOrders({
    status: status || undefined,
    organizerUserId,
    search: typeof search === 'string' && search.trim() ? search.trim() : null,
    excludeDrafts: false,
    publicSafe: false,
    limit,
    offset,
  });
}

async function getPooledOrder(id, { viewerUserId = null, includePrivate = false } = {}) {
  const orderFields = includePrivate
    ? 'po.*'
    : `po.id, po.reference, po.title, po.description, po.lane_id, po.supplier_product_id,
       po.organizer_user_id, po.status, po.approval_state, po.target_moq, po.current_committed_qty,
       po.unit_landed_cost_usd, po.deposit_pct, po.final_payment_pct,
       po.open_date, po.close_date, po.lock_date, po.expected_ship_date,
       po.expected_arrival_date, po.cancellation_policy, po.max_participants`;
  const result = await pool.query(
    `SELECT ${orderFields},
            ll.name AS lane_name, ll.origin_country, ll.destination_country,
            ll.risk_tier, ll.customs_complexity, ll.freight_options,
            ll.requires_business_verification, ll.requires_manual_approval, ll.requires_reseller_approval,
            u.first_name || ' ' || u.last_name AS organizer_name,
            sp.title AS product_title, sp.category AS product_category,
            sp.specs AS product_specs, sp.image_urls AS product_images,
            (SELECT COUNT(*) FROM pooled_order_participants pp
             WHERE pp.pooled_order_id = po.id AND pp.status NOT IN ('refunded','disputed')) AS participant_count
     FROM pooled_orders po
     LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
     LEFT JOIN users u ON u.id = po.organizer_user_id
     LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
     WHERE po.id = $1
     GROUP BY po.id, ll.id, u.id, sp.id`,
    [id]
  );
  const order = result.rows[0];
  if (!order) return null;

  const participants = await pool.query(
    includePrivate
      ? `SELECT * FROM pooled_order_participants WHERE pooled_order_id = $1 ORDER BY created_at`
      : `SELECT id, committed_qty, status, delivery_preference
           FROM pooled_order_participants
          WHERE pooled_order_id = $1 AND status NOT IN ('refunded','disputed')
          ORDER BY created_at`,
    [id]
  );
  order.participants = participants.rows;

  if (viewerUserId) {
    const mine = await pool.query(
      `SELECT * FROM pooled_order_participants WHERE pooled_order_id = $1 AND user_id = $2 LIMIT 1`,
      [id, viewerUserId]
    );
    order.my_participation = mine.rows[0] || null;
  } else {
    order.my_participation = null;
  }
  return order;
}

async function createPooledOrder(data, organizerUserId, { userCountry = null, userRole = null } = {}) {
  const ref = await generatePooledRef();
  const {
    title, description, lane_id, supplier_product_id, supplier_quote_id,
    organizer_business_id, target_moq, unit_product_cost_usd,
    unit_freight_est_usd, close_date, lock_date, expected_ship_date,
    expected_arrival_date, cancellation_policy, deposit_pct,
    max_participants, destination_warehouse_id, notes,
  } = data;

  // Server-side capability / business-membership / verification / lane checks.
  // Drafts are cheap, but they must already sit on a lane the organizer is
  // allowed to run, otherwise submission can never succeed.
  await assertCanCreateCampaign({
    userId: organizerUserId,
    userCountry,
    userRole,
    laneId: lane_id,
    organizerBusinessId: organizer_business_id,
  });

  if (deposit_pct !== undefined && deposit_pct !== null
      && (!Number.isFinite(Number(deposit_pct)) || Number(deposit_pct) < 0 || Number(deposit_pct) > 1)) {
    throw svcError('deposit_pct must be between 0 and 1', 400, 'validation_failed');
  }

  // Calculate landed cost
  let unitLandedCostUSD = null;
  let unitMarkupUSD = null;
  let unitFeesUSD = null;
  if (unit_product_cost_usd) {
    const pricing = await calculateLandedCost({
      unitProductCostUSD: unit_product_cost_usd,
      qty: target_moq,
      laneId: lane_id,
      freightEstUSD: unit_freight_est_usd,
      isPooled: true,
    });
    unitLandedCostUSD = pricing.unitCost.landed;
    unitMarkupUSD     = pricing.unitCost.markup;
    unitFeesUSD       = pricing.unitCost.sourcingFee + pricing.unitCost.customsAdmin +
                        pricing.unitCost.warehouse + pricing.unitCost.lastMile +
                        pricing.unitCost.riskSurcharge;
  }

  const result = await pool.query(
    `INSERT INTO pooled_orders
       (reference,title,description,lane_id,supplier_product_id,supplier_quote_id,
        organizer_user_id,organizer_business_id,target_moq,unit_product_cost_usd,
        unit_freight_est_usd,unit_markup_usd,unit_fees_usd,unit_landed_cost_usd,
        close_date,lock_date,expected_ship_date,expected_arrival_date,
        cancellation_policy,deposit_pct,max_participants,
        destination_warehouse_id,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      ref,title,description,lane_id,supplier_product_id,supplier_quote_id,
      organizerUserId,organizer_business_id,target_moq,unit_product_cost_usd,
      unit_freight_est_usd,unitMarkupUSD,unitFeesUSD,unitLandedCostUSD,
      close_date,lock_date,expected_ship_date,expected_arrival_date,
      cancellation_policy,deposit_pct||0.30,max_participants,
      destination_warehouse_id,notes,
    ]
  );
  const order = result.rows[0];
  logLogisticsAction('pooled_order', order.id, 'created', { actorUserId: organizerUserId });
  return order;
}

// Draft fields the organizer may edit. Ownership and identity fields
// (organizer_user_id, supplier product/quote, business, warehouse, notes)
// are intentionally not editable through this endpoint.
const DRAFT_EDITABLE_FIELDS = [
  'title', 'description', 'lane_id', 'target_moq',
  'close_date', 'lock_date', 'expected_ship_date', 'expected_arrival_date',
  'unit_product_cost_usd', 'unit_freight_est_usd', 'deposit_pct',
  'cancellation_policy', 'max_participants',
];

function nullIfBlank(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Organizer edits their campaign draft. Transactional: the row is locked,
 * ownership and approval state are re-checked inside the transaction, and
 * the pricing sketch is recomputed when cost/freight/MOQ change.
 *
 * Only the owning organizer may edit, and only while approval_state is
 * 'draft' or 'revisions_requested'. Editing never changes the approval
 * state; resubmission goes through submitCampaignForReview.
 */
async function updateCampaignDraft(id, userId, data, { userCountry = null, userRole = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'SELECT * FROM pooled_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    const order = res.rows[0];
    if (!order) throw svcError('Pooled order not found', 404, 'pooled_order_not_found');
    // Ownership check: only the organizing user may edit their draft.
    if (String(order.organizer_user_id) !== String(userId)) {
      throw svcError('Only the campaign organizer can edit this draft', 403, 'not_owner');
    }
    const approvalState = order.approval_state || 'draft';
    if (!['draft', 'revisions_requested'].includes(approvalState)) {
      throw svcError(
        `Campaign drafts can only be edited while in draft or revisions_requested (current: ${approvalState})`,
        409,
        'campaign_not_editable'
      );
    }

    const body = data || {};
    const patch = {};
    for (const field of DRAFT_EDITABLE_FIELDS) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    if (Object.keys(patch).length === 0) {
      throw svcError('No editable draft fields provided', 400, 'validation_failed');
    }

    // Field-level validation (mirrors the create path).
    if (patch.title !== undefined && !String(patch.title).trim()) {
      throw svcError('title must not be empty', 400, 'validation_failed');
    }
    if (patch.target_moq !== undefined && !(Number(patch.target_moq) >= 1)) {
      throw svcError('target_moq must be at least 1', 400, 'validation_failed');
    }
    if (patch.deposit_pct !== undefined) {
      const cleaned = nullIfBlank(patch.deposit_pct);
      if (cleaned !== null && (!Number.isFinite(Number(cleaned)) || Number(cleaned) < 0 || Number(cleaned) > 1)) {
        throw svcError('deposit_pct must be between 0 and 1', 400, 'validation_failed');
      }
    }
    for (const moneyField of ['unit_product_cost_usd', 'unit_freight_est_usd']) {
      const cleaned = patch[moneyField] !== undefined ? nullIfBlank(patch[moneyField]) : 'skip';
      if (cleaned !== 'skip' && cleaned !== null && Number(cleaned) < 0) {
        throw svcError(`${moneyField} must not be negative`, 400, 'validation_failed');
      }
    }
    if (patch.max_participants !== undefined) {
      const cleaned = nullIfBlank(patch.max_participants);
      if (cleaned !== null && !(Number(cleaned) >= 1)) {
        throw svcError('max_participants must be at least 1', 400, 'validation_failed');
      }
    }

    // Lane changes re-run the create-time lane checks: a draft must always
    // sit on a lane the organizer is allowed to run.
    const effectiveLaneId = patch.lane_id !== undefined ? patch.lane_id : order.lane_id;
    if (patch.lane_id !== undefined && String(patch.lane_id) !== String(order.lane_id)) {
      await assertCanCreateCampaign({
        userId,
        userCountry,
        userRole,
        laneId: patch.lane_id,
        organizerBusinessId: order.organizer_business_id,
      });
    }

    // Recompute the landed-cost sketch when cost, freight, or MOQ changes,
    // using the effective (post-edit) values.
    const pricingTouched = ['unit_product_cost_usd', 'unit_freight_est_usd', 'target_moq']
      .some((field) => patch[field] !== undefined);
    let unitLandedCostUSD = order.unit_landed_cost_usd;
    let unitMarkupUSD = order.unit_markup_usd;
    let unitFeesUSD = order.unit_fees_usd;
    if (pricingTouched) {
      const effective = (field) => (patch[field] !== undefined ? nullIfBlank(patch[field]) : order[field]);
      const cost = effective('unit_product_cost_usd');
      if (cost !== null && Number(cost)) {
        const freight = effective('unit_freight_est_usd');
        const moq = effective('target_moq');
        const pricing = await calculateLandedCost({
          unitProductCostUSD: Number(cost),
          qty: Number(moq),
          laneId: effectiveLaneId,
          freightEstUSD: freight !== null ? Number(freight) : null,
          isPooled: true,
        });
        unitLandedCostUSD = pricing.unitCost.landed;
        unitMarkupUSD     = pricing.unitCost.markup;
        unitFeesUSD       = pricing.unitCost.sourcingFee + pricing.unitCost.customsAdmin +
                            pricing.unitCost.warehouse + pricing.unitCost.lastMile +
                            pricing.unitCost.riskSurcharge;
      } else {
        unitLandedCostUSD = null;
        unitMarkupUSD = null;
        unitFeesUSD = null;
      }
    }

    const sets = [];
    const values = [];
    const setCol = (col, val) => { sets.push(`${col} = $${sets.length + 1}`); values.push(val); };
    for (const field of DRAFT_EDITABLE_FIELDS) {
      if (patch[field] === undefined) continue;
      const cleaned = nullIfBlank(patch[field]);
      let value = cleaned;
      if (['title', 'description', 'cancellation_policy'].includes(field)) {
        value = cleaned; // blank clears the text field
      } else if (field === 'lane_id') {
        value = Number(cleaned);
      } else if (['target_moq', 'max_participants', 'unit_product_cost_usd', 'unit_freight_est_usd'].includes(field)) {
        value = cleaned === null ? null : Number(cleaned);
      } else if (field === 'deposit_pct') {
        // An empty deposit keeps the existing value; the form always sends
        // one, so this only matters for partial API updates.
        if (cleaned === null) continue;
        value = Number(cleaned);
      } else {
        value = cleaned; // date fields: blank clears the date
      }
      setCol(field, value);
    }
    if (pricingTouched) {
      setCol('unit_markup_usd', unitMarkupUSD);
      setCol('unit_fees_usd', unitFeesUSD);
      setCol('unit_landed_cost_usd', unitLandedCostUSD);
    }

    const updated = await client.query(
      `UPDATE pooled_orders SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${sets.length + 1} RETURNING *`,
      [...values, id]
    );
    await client.query('COMMIT');
    logLogisticsAction('pooled_order', id, 'draft_updated', {
      actorUserId: userId,
      beforeState: { approval_state: approvalState },
      afterState: { approval_state: approvalState },
    });
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function joinPooledOrder(pooledOrderId, userId, { committedQty, businessId, destinationCountry, destinationAddress, deliveryPreference } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the pooled order row
    const orderRes = await client.query(
      `SELECT * FROM pooled_orders WHERE id = $1 FOR UPDATE`, [pooledOrderId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new Error('pooled_order_not_found');
    if (!['open','pledging'].includes(order.status)) throw new Error('pooled_order_not_open');
    if (order.close_date && new Date() > new Date(order.close_date)) throw new Error('pooled_order_closed');

    // Upsert participant
    const subtotalUSD = order.unit_landed_cost_usd
      ? parseFloat(order.unit_landed_cost_usd) * committedQty
      : null;
    const depositUSD = subtotalUSD ? subtotalUSD * parseFloat(order.deposit_pct) : null;

    const partResult = await client.query(
      `INSERT INTO pooled_order_participants
         (pooled_order_id,user_id,business_id,status,committed_qty,unit_price_usd,
          subtotal_usd,deposit_amount_usd,destination_country,destination_address,delivery_preference)
       VALUES ($1,$2,$3,'pledged',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (pooled_order_id,user_id) DO UPDATE
         SET committed_qty = $4, subtotal_usd = $6, deposit_amount_usd = $7,
             destination_country = $8, destination_address = $9, delivery_preference = $10,
             status = CASE WHEN pooled_order_participants.status = 'invited' THEN 'pledged'
                           ELSE pooled_order_participants.status END
       RETURNING *`,
      [
        pooledOrderId, userId, businessId, committedQty,
        order.unit_landed_cost_usd, subtotalUSD, depositUSD,
        destinationCountry, destinationAddress, deliveryPreference||'warehouse_pickup',
      ]
    );

    // Recalculate committed qty
    await client.query(
      `UPDATE pooled_orders
       SET current_committed_qty = (
         SELECT COALESCE(SUM(committed_qty),0) FROM pooled_order_participants
         WHERE pooled_order_id = $1 AND status NOT IN ('refunded','disputed')
       ), status = CASE WHEN status = 'open' THEN 'pledging' ELSE status END
       WHERE id = $1`,
      [pooledOrderId]
    );

    await client.query('COMMIT');
    logLogisticsAction('pooled_order', pooledOrderId, 'participant_joined', { actorUserId: userId });
    return partResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updatePooledOrderStatus(id, status, actorUserId, notes) {
  // Transactional: the current status is re-read with FOR UPDATE inside the
  // state machine's transaction and the move is validated against the
  // canonical pooled-order graph (previously any status could be written).
  const result = await applyTransition(pool, {
    entityType: 'pooled_order',
    id,
    to: status,
    actorUserId,
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      throw svcError('Pooled order not found', 404, 'pooled_order_not_found');
    }
    throw svcError(
      `Cannot transition campaign from ${result.from || 'unknown'} to ${status}`,
      409,
      'invalid_transition',
      { from: result.from, to: status, allowed: result.allowed }
    );
  }
  logLogisticsAction('pooled_order', id, `status_to_${status}`, {
    actorUserId,
    beforeState: { status: result.from },
    afterState: { status },
    notes,
  });
  return result.record;
}

async function recordApprovalDecision(client, { pooledOrderId, decision, fromState, toState, decidedByUserId, reason = null }) {
  const res = await client.query(
    `INSERT INTO logistics_campaign_approval_decisions
       (pooled_order_id, decision, from_state, to_state, decided_by_user_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [pooledOrderId, decision, fromState, toState, decidedByUserId, reason]
  );
  return res.rows[0];
}

/**
 * Organizer submits a draft for Operations review.
 * Validates ownership, draft/pending state, and submission blockers
 * transactionally; records the decision in the approval history.
 */
async function submitCampaignForReview(id, userId, { userCountry = null, userRole = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT po.*, ll.requires_business_verification
         FROM pooled_orders po
         LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
        WHERE po.id = $1 FOR UPDATE`,
      [id]
    );
    const order = res.rows[0];
    if (!order) throw svcError('Pooled order not found', 404, 'pooled_order_not_found');
    // Ownership check: only the organizing user may submit their draft.
    if (String(order.organizer_user_id) !== String(userId)) {
      throw svcError('Only the campaign organizer can submit it for review', 403, 'not_owner');
    }
    if (order.status !== 'draft') {
      throw svcError('Only draft campaigns can be submitted for review', 409, 'campaign_not_draft');
    }
    const fromState = order.approval_state || 'draft';
    approvalMachine.assertTransition(fromState, 'pending_review');

    const blockers = await evaluateCampaignBlockers(order, {
      userId, userCountry, userRole,
    });
    if (blockers.length) {
      throw svcError(
        'Campaign is not ready for review',
        422,
        'approval_blockers',
        { blockers }
      );
    }

    await client.query(
      `UPDATE pooled_orders SET approval_state = 'pending_review', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    const decision = await recordApprovalDecision(client, {
      pooledOrderId: id,
      decision: 'submitted_for_review',
      fromState,
      toState: 'pending_review',
      decidedByUserId: userId,
    });
    await client.query('COMMIT');
    logLogisticsAction('pooled_order', id, 'submitted_for_review', {
      actorUserId: userId,
      afterState: { approval_state: 'pending_review' },
    });
    return { ...order, approval_state: 'pending_review', latest_decision: decision };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Operations review of a pending campaign.
 * decision: 'approve' (publishes: approval approved + fulfillment draft→open)
 *           | 'request_changes' (returns to the organizer with a required reason)
 *           | 'reject' (terminal for this review round: the organizer must
 *             resubmit a fresh draft; reason required)
 * Self-review is forbidden: the organizer cannot approve their own campaign,
 * even when they also hold an Operations role.
 */
async function reviewCampaign(id, reviewerUserId, { decision, reason = null } = {}) {
  if (!['approve', 'request_changes', 'reject'].includes(decision)) {
    throw svcError('decision must be approve, request_changes, or reject', 400, 'invalid_review_decision');
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'request_changes' && !trimmedReason) {
    throw svcError('A reason is required when requesting revisions', 400, 'review_reason_required');
  }
  if (decision === 'reject' && !trimmedReason) {
    throw svcError('A reason is required when rejecting a campaign', 400, 'review_reason_required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'SELECT * FROM pooled_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    const order = res.rows[0];
    if (!order) throw svcError('Pooled order not found', 404, 'pooled_order_not_found');
    const fromState = order.approval_state || 'draft';
    if (fromState !== 'pending_review') {
      throw svcError('Only campaigns pending review can be reviewed', 409, 'campaign_not_pending_review');
    }
    if (String(order.organizer_user_id) === String(reviewerUserId)) {
      throw svcError('Reviewers cannot approve their own campaign', 403, 'self_approval');
    }

    const toState = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revisions_requested';
    approvalMachine.assertTransition(fromState, toState);

    let nextStatus = order.status;
    if (decision === 'approve' && order.status === 'draft') {
      // Approval publishes the campaign: fulfillment draft → open.
      pooledMachine.assertTransition(order.status, 'open');
      nextStatus = 'open';
    }

    await client.query(
      `UPDATE pooled_orders
          SET approval_state = $2, status = $3, updated_at = NOW()
        WHERE id = $1`,
      [id, toState, nextStatus]
    );
    const decisionRow = await recordApprovalDecision(client, {
      pooledOrderId: id,
      decision: toState,
      fromState,
      toState,
      decidedByUserId: reviewerUserId,
      reason: trimmedReason || null,
    });
    await client.query('COMMIT');
    logLogisticsAction('pooled_order', id, `approval_${toState}`, {
      actorUserId: reviewerUserId,
      beforeState: { approval_state: fromState, status: order.status },
      afterState: { approval_state: toState, status: nextStatus },
      notes: trimmedReason || undefined,
    });
    // Best-effort organizer notification: the review decision is committed
    // first, so a notification failure must never roll it back.
    notifyOrganizerOfReviewDecision({
      order: { ...order, approval_state: toState, status: nextStatus },
      decision,
      reason: trimmedReason,
      decisionId: decisionRow.id,
    }).catch((err) => logger.warn('logistics: review decision notification failed', {
      campaignId: id,
      decision,
      error: err.message,
    }));
    return {
      ...order,
      approval_state: toState,
      status: nextStatus,
      latest_decision: decisionRow,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Organizer withdraws a campaign that is awaiting Operations review.
 * Guards: only the owning organizer may withdraw, and only while the
 * approval state is pending_review (never after a decision was made).
 * The campaign returns to draft; the reserved 'withdrawn' decision is
 * recorded in the approval history.
 */
async function withdrawCampaign(id, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'SELECT * FROM pooled_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    const order = res.rows[0];
    if (!order) throw svcError('Pooled order not found', 404, 'pooled_order_not_found');
    if (String(order.organizer_user_id) !== String(userId)) {
      throw svcError('Only the campaign organizer can withdraw it from review', 403, 'not_owner');
    }
    const fromState = order.approval_state || 'draft';
    if (fromState !== 'pending_review') {
      throw svcError('Only campaigns pending review can be withdrawn', 409, 'campaign_not_pending_review');
    }
    approvalMachine.assertTransition(fromState, 'draft');

    await client.query(
      `UPDATE pooled_orders SET approval_state = 'draft', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    const decision = await recordApprovalDecision(client, {
      pooledOrderId: id,
      decision: 'withdrawn',
      fromState,
      toState: 'draft',
      decidedByUserId: userId,
    });
    await client.query('COMMIT');
    logLogisticsAction('pooled_order', id, 'withdrawn_from_review', {
      actorUserId: userId,
      beforeState: { approval_state: fromState, status: order.status },
      afterState: { approval_state: 'draft', status: order.status },
    });
    return { ...order, approval_state: 'draft', latest_decision: decision };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Notification types for campaign review decisions, keyed by the review
// endpoint's decision values. Copy lives in utils/campaignReviewNotifications
// (localized via tNotif in notificationService).
const REVIEW_DECISION_NOTIFICATION_TYPES = {
  approve: 'logistics_campaign_approved',
  request_changes: 'logistics_campaign_revisions_requested',
  reject: 'logistics_campaign_rejected',
};

/**
 * Notify the organizing user about an Operations review decision.
 * Email, in-app and push are all handled by sendNotification according to
 * the user's preferences; the campaign title and (for revisions/rejection)
 * the reviewer note are appended as quoted user-generated content after the
 * localized notification copy. Never throws: notification failures must not
 * break the review flow.
 */
async function notifyOrganizerOfReviewDecision({ order, decision, reason = '', decisionId = null }) {
  const type = REVIEW_DECISION_NOTIFICATION_TYPES[decision];
  if (!type || !order?.organizer_user_id) return;
  try {
    const quotedTitle = `"${order.title || 'Untitled campaign'}"`;
    const body = reason ? `${quotedTitle}: "${reason}"` : quotedTitle;
    await sendNotification({
      userId: order.organizer_user_id,
      type,
      body,
      data: {
        campaign_id: String(order.id),
        decision,
        reason: reason || undefined,
      },
      action_url: `/logistics/campaigns/${order.id}`,
      idempotencyKey: `logistics:review:${order.id}:${decisionId || 'unknown'}:${decision}`,
    });
  } catch (err) {
    logger.warn('logistics: review decision notification failed', {
      campaignId: order.id,
      decision,
      error: err.message,
    });
  }
}

/**
 * Immutable approval history for one campaign (who / when / reason).
 * The permission check lives with the caller; this returns the rows.
 */
async function getApprovalHistory(pooledOrderId) {
  const res = await pool.query(
    `SELECT d.id, d.pooled_order_id, d.decision, d.from_state, d.to_state,
            d.decided_by_user_id, d.reason, d.created_at,
            u.first_name || ' ' || u.last_name AS reviewer_name,
            u.email AS reviewer_email
       FROM logistics_campaign_approval_decisions d
       LEFT JOIN users u ON u.id = d.decided_by_user_id
      WHERE d.pooled_order_id = $1
      ORDER BY d.created_at ASC`,
    [pooledOrderId]
  );
  return res.rows;
}

/**
 * Server-derived capabilities for the UI: which actions the viewer may take
 * on this campaign, plus the blockers currently preventing submission.
 */
async function describeActions(order, {
  isOwner = false, isOps = false, isAdmin = false,
  userId = null, userCountry = null, userRole = null,
} = {}) {
  const approvalState = order.approval_state || 'draft';
  const actions = [];
  let blockers = [];

  if (isOwner && ['draft', 'revisions_requested'].includes(approvalState)) {
    actions.push('edit_draft', 'submit_for_review');
    // Blocker evaluation uses the organizer's own market/business context.
    blockers = await evaluateCampaignBlockers(order, { userId, userCountry, userRole });
  }
  if (isOwner && approvalState === 'pending_review') {
    actions.push('withdraw_from_review');
  }
  if ((isOps || isAdmin) && approvalState === 'pending_review') {
    actions.push('approve_campaign', 'request_revisions', 'reject_campaign');
  }
  if (isOwner || isOps || isAdmin) {
    actions.push('view_approval_history');
  }
  return { actions, blockers };
}

module.exports = {
  listPooledOrders, listOrganizerCampaigns, getPooledOrder, createPooledOrder,
  updateCampaignDraft,
  joinPooledOrder, updatePooledOrderStatus,
  submitCampaignForReview, reviewCampaign, withdrawCampaign, getApprovalHistory, describeActions,
  evaluateCampaignBlockers,
  REVIEW_OPS_ROLES: Array.from(REVIEW_OPS_ROLES),
};
