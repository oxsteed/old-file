'use strict';
const AppError = require('../utils/appError');
const pool = require('../db');
const supplierService = require('../services/supplierService');
const sourcingService = require('../services/sourcingService');
const { logLogisticsAction, listLogisticsAudit } = require('../services/logisticsAuditService');
const { invalidateCache } = require('../services/logisticsPricingService');

/**
 * Strict numeric parse for money/percent inputs. Rejects NaN, Infinity,
 * non-numeric strings and trailing-garbage strings ('10abc') that
 * parseFloat/Number coercion would silently accept or mangle.
 * Returns null when the value was not provided.
 */
function parseStrictAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

/** Provided money/percent values must be valid, finite, non-negative numbers. */
function requireNonNegativeAmount(value, fieldName) {
  const n = parseStrictAmount(value);
  if (n === null) return null;
  if (!Number.isFinite(n)) throw new AppError(`${fieldName} must be a valid number`, 400, 'validation_failed');
  if (n < 0) throw new AppError(`${fieldName} must not be negative`, 400, 'validation_failed');
  return n;
}

// ─── Dashboard Stats ──────────────────────────────────────────

exports.getStats = async (req, res, next) => {
  try {
    const [
      poStats, shipmentStats, pooledStats, sourcingStats, warehouseStats, claimStats
    ] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) AS count, SUM(total_landed_usd) AS total_value
                  FROM purchase_orders GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) AS count FROM shipment_records GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) AS count FROM pooled_orders GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) AS count FROM sourcing_requests GROUP BY status`),
      pool.query(`SELECT w.name, COUNT(ir.id) AS receipts, SUM(ir.received_qty) AS total_units
                  FROM warehouses w
                  LEFT JOIN inventory_receipts ir ON ir.warehouse_id = w.id
                  GROUP BY w.id`),
      pool.query(`SELECT status, COUNT(*) AS count FROM logistics_claims GROUP BY status`),
    ]);

    res.json({
      success: true,
      data: {
        purchaseOrders: poStats.rows,
        shipments:      shipmentStats.rows,
        pooledOrders:   pooledStats.rows,
        sourcingRequests: sourcingStats.rows,
        warehouses:     warehouseStats.rows,
        claims:         claimStats.rows,
      },
    });
  } catch (err) { next(err); }
};

// ─── Supplier Management (admin) ─────────────────────────────

exports.listSuppliers = async (req, res, next) => {
  try {
    const result = await supplierService.listSuppliers({
      country:     req.query.country,
      category:    req.query.category,
      trustRating: req.query.trust_rating ? parseInt(req.query.trust_rating) : null,
      isActive:    req.query.is_active !== undefined ? req.query.is_active === 'true' : null,
      limit:       Math.min(parseInt(req.query.limit)||50, 200),
      offset:      parseInt(req.query.offset)||0,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getSupplier = async (req, res, next) => {
  try {
    const supplier = await supplierService.getSupplier(req.params.id);
    if (!supplier) return next(new AppError('Supplier not found', 404, 'not_found'));
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

exports.createSupplier = async (req, res, next) => {
  try {
    const { code, company_name, country } = req.body;
    if (!code || !company_name || !country) {
      return next(new AppError('code, company_name, country required', 400, 'validation_failed'));
    }
    const supplier = await supplierService.createSupplier(req.body, req.user.id);
    res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Supplier code already exists', 409, 'duplicate_code'));
    next(err);
  }
};

exports.updateSupplier = async (req, res, next) => {
  try {
    const supplier = await supplierService.updateSupplier(req.params.id, req.body, req.user.id);
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

exports.approveSupplier = async (req, res, next) => {
  try {
    const supplier = await supplierService.approveSupplier(req.params.id, req.user.id);
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
};

exports.approveProduct = async (req, res, next) => {
  try {
    const product = await supplierService.approveSupplierProduct(req.params.productId, req.user.id);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.createSupplierProduct = async (req, res, next) => {
  try {
    const { supplier_id, internal_sku, title, category } = req.body;
    if (!supplier_id || !internal_sku || !title || !category) {
      return next(new AppError('supplier_id, internal_sku, title, category required', 400, 'validation_failed'));
    }
    const product = await supplierService.createSupplierProduct(req.body, req.user.id);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (err.code === '23505') return next(new AppError('SKU already exists', 409, 'duplicate_sku'));
    next(err);
  }
};

exports.listQuotes = async (req, res, next) => {
  try {
    const quotes = await sourcingService.listQuotes({
      status: req.query.status,
      sourcingRequestId: req.query.sourcing_request_id,
      supplierId: req.query.supplier_id,
      limit: Math.min(parseInt(req.query.limit) || 100, 200),
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ success: true, data: quotes });
  } catch (err) { next(err); }
};

// ─── Markup / Fee Rules (super-admin) ────────────────────────

exports.listMarkupRules = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM markup_rules ORDER BY scope, priority`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.createMarkupRule = async (req, res, next) => {
  try {
    const { scope, markup_pct, priority } = req.body;
    if (!scope) return next(new AppError('scope required', 400, 'validation_failed'));
    const pct = requireNonNegativeAmount(markup_pct, 'markup_pct');
    const fixedCents = requireNonNegativeAmount(req.body.markup_fixed_cents, 'markup_fixed_cents');
    const prio = requireNonNegativeAmount(priority, 'priority');
    const result = await pool.query(
      `INSERT INTO markup_rules (scope,scope_id,category,markup_pct,markup_fixed_cents,priority,description,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [scope, req.body.scope_id, req.body.category, pct, fixedCents,
       prio == null ? 0 : Math.trunc(prio), req.body.description, req.user.id]
    );
    invalidateCache();
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.updateMarkupRule = async (req, res, next) => {
  try {
    const pct = requireNonNegativeAmount(req.body.markup_pct, 'markup_pct');
    const prio = requireNonNegativeAmount(req.body.priority, 'priority');
    const result = await pool.query(
      `UPDATE markup_rules SET markup_pct=$1, priority=$2, is_active=$3, description=$4
       WHERE id=$5 RETURNING *`,
      [pct, prio == null ? null : Math.trunc(prio), req.body.is_active, req.body.description, req.params.id]
    );
    invalidateCache();
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.listFeeRules = async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM fee_rules ORDER BY fee_type, priority`);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.updateFeeRule = async (req, res, next) => {
  try {
    const amountCents = requireNonNegativeAmount(req.body.amount_cents, 'amount_cents');
    const pctOfProduct = requireNonNegativeAmount(req.body.pct_of_product, 'pct_of_product');
    const result = await pool.query(
      `UPDATE fee_rules SET amount_cents=$1, pct_of_product=$2, is_active=$3
       WHERE id=$4 RETURNING *`,
      [amountCents, pctOfProduct, req.body.is_active, req.params.id]
    );
    invalidateCache();
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── Claims & Disputes ────────────────────────────────────────

exports.listClaims = async (req, res, next) => {
  try {
    const conditions = ['1=1'];
    const params = [];
    if (req.query.status)    { conditions.push(`c.status = $${params.push(req.query.status)}`); }
    if (req.query.claim_type){ conditions.push(`c.claim_type = $${params.push(req.query.claim_type)}`); }
    const result = await pool.query(
      `SELECT c.*, u.first_name || ' ' || u.last_name AS claimant_name
       FROM logistics_claims c
       LEFT JOIN users u ON u.id = c.claimant_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.created_at DESC LIMIT 200`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.updateClaim = async (req, res, next) => {
  try {
    const { status, approved_amount_usd, resolution_notes } = req.body;
    const result = await pool.query(
      `UPDATE logistics_claims
       SET status=$1, approved_amount_usd=$2, resolution_notes=$3,
           resolved_by=$4, resolved_at=CASE WHEN $1 IN ('approved','rejected','resolved') THEN NOW() ELSE resolved_at END
       WHERE id=$5 RETURNING *`,
      [status, approved_amount_usd, resolution_notes, req.user.id, req.params.id]
    );
    logLogisticsAction('claim', req.params.id, `claim_${status}`, { actorUserId: req.user.id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.listRefundCases = async (req, res, next) => {
  try {
    const conditions = ['1=1'];
    const params = [];
    if (req.query.status) { conditions.push(`rc.status = $${params.push(req.query.status)}`); }
    const result = await pool.query(
      `SELECT rc.*,
              u.first_name || ' ' || u.last_name AS requester_name,
              c.reference AS claim_reference
       FROM logistics_refund_cases rc
       LEFT JOIN users u ON u.id = rc.user_id
       LEFT JOIN logistics_claims c ON c.id = rc.claim_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rc.created_at DESC
       LIMIT 200`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.updateRefundCase = async (req, res, next) => {
  try {
    const { status, approved_amount_usd, notes, stripe_refund_id } = req.body;
    const result = await pool.query(
      `UPDATE logistics_refund_cases
       SET status = COALESCE($1, status),
           approved_amount_usd = COALESCE($2, approved_amount_usd),
           notes = COALESCE($3, notes),
           stripe_refund_id = COALESCE($4, stripe_refund_id),
           processed_by = $5,
           processed_at = CASE WHEN COALESCE($1, status) IN ('approved','processed','rejected') THEN NOW() ELSE processed_at END
       WHERE id = $6
       RETURNING *`,
      [status, approved_amount_usd, notes, stripe_refund_id, req.user.id, req.params.id]
    );
    if (!result.rows[0]) return next(new AppError('Refund case not found', 404, 'not_found'));
    logLogisticsAction('refund_case', req.params.id, `refund_${result.rows[0].status}`, { actorUserId: req.user.id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── Country Access Rules ─────────────────────────────────────

exports.listCountryAccessRules = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM country_access_rules
       WHERE ($1::VARCHAR IS NULL OR category = $1)
         AND ($2::CHAR(2) IS NULL OR country_code = $2)
       ORDER BY category, country_code`,
      [req.query.category || null, req.query.country || null]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.upsertCountryAccessRule = async (req, res, next) => {
  try {
    const { category, country_code, is_visible, is_purchasable, allowed_buyer_types, requires_approval, risk_tier, notes } = req.body;
    if (!category || !country_code) return next(new AppError('category and country_code required', 400, 'validation_failed'));
    const result = await pool.query(
      `INSERT INTO country_access_rules (category,country_code,is_visible,is_purchasable,allowed_buyer_types,requires_approval,risk_tier,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (category,country_code) DO UPDATE SET
         is_visible=$3, is_purchasable=$4, allowed_buyer_types=$5,
         requires_approval=$6, risk_tier=$7, notes=$8
       RETURNING *`,
      [category,country_code,is_visible!==false,is_purchasable!==false,
       allowed_buyer_types||[],requires_approval||false,risk_tier||'low',notes,req.user.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ─── Audit Log ───────────────────────────────────────────────

exports.getAudit = async (req, res, next) => {
  try {
    const { entity_type, entity_id, limit = 100 } = req.query;
    if (!entity_type || !entity_id) {
      return next(new AppError('entity_type and entity_id required', 400, 'validation_failed'));
    }
    const rows = await listLogisticsAudit(entity_type, entity_id, { limit: parseInt(limit) });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ─── Organizer Approval ───────────────────────────────────────

exports.listPendingOrganizerApprovals = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT po.*, u.first_name || ' ' || u.last_name AS organizer_name, u.email AS organizer_email
       FROM pooled_orders po
       JOIN users u ON u.id = po.organizer_user_id
       WHERE po.status = 'draft'
       ORDER BY po.created_at DESC LIMIT 100`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};
