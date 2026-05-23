'use strict';
/**
 * OxSteed Logistics — Compliance controller
 * Exposes manual-review queues, lane / category restrictions, document checks,
 * and the per-buyer "what can I see / buy" evaluator.
 */
const pool    = require('../db');
const AppError = require('../utils/appError');
const accessService = require('../services/logisticsAccessService');
const { logLogisticsAction } = require('../services/logisticsAuditService');
const { resolveLogisticsRole } = require('../middleware/requireLogisticsAccess');

// ─── Buyer-facing access evaluation ───────────────────────────

exports.evaluateAccess = async (req, res, next) => {
  try {
    const { lane_id, category, supplier_product_id } = req.query;
    let restrictedMarkets = [];
    let complianceFlags = [];
    if (supplier_product_id) {
      const r = await pool.query(
        `SELECT restricted_markets, compliance_flags, category FROM supplier_products WHERE id = $1`,
        [supplier_product_id]
      );
      if (r.rows[0]) {
        restrictedMarkets = r.rows[0].restricted_markets || [];
        complianceFlags   = r.rows[0].compliance_flags || [];
      }
    }
    const role = await resolveLogisticsRole(req.user);
    const country = req.user?.country || req.query.country;
    const access = await accessService.evaluateAccess({
      laneId: lane_id ? parseInt(lane_id, 10) : null,
      category,
      productRestrictedMarkets: restrictedMarkets,
      complianceFlags,
      buyerCountry: country,
      userRole: role,
    });
    res.json({ success: true, data: access });
  } catch (err) { next(err); }
};

// ─── Restrictions overview (buyer-readable summary) ────────────

exports.getRestrictionsForUser = async (req, res, next) => {
  try {
    const role = await resolveLogisticsRole(req.user);
    const country = req.user?.country || req.query.country;
    const [lanesRes, tradeRes, carRes] = await Promise.all([
      pool.query(`SELECT id, code, name, origin_country, destination_country,
                         allowed_buyer_countries, allowed_buyer_roles, restricted_categories,
                         risk_tier, requires_business_verification, requires_manual_approval,
                         requires_reseller_approval, is_active
                  FROM logistics_lanes
                  WHERE is_active = TRUE
                  ORDER BY name`),
      pool.query(`SELECT id, lane_id, rule_type, country_code, category, description,
                         severity, doc_required
                  FROM trade_rules
                  WHERE is_active = TRUE AND ($1::text IS NULL OR country_code = $1::text OR country_code IS NULL)
                  ORDER BY severity DESC, category`,
        [country || null]),
      pool.query(`SELECT category, country_code, is_visible, is_purchasable,
                         allowed_buyer_types, requires_approval, risk_tier
                  FROM country_access_rules
                  WHERE $1::text IS NULL OR country_code = $1::text`,
        [country || null]),
    ]);
    res.json({
      success: true,
      data: {
        userCountry: country,
        userRole: role,
        lanes: lanesRes.rows,
        tradeRules: tradeRes.rows,
        countryRules: carRes.rows,
      },
    });
  } catch (err) { next(err); }
};

// ─── Compliance review queue (for compliance_reviewer + admin) ─

exports.listReviewQueue = async (req, res, next) => {
  try {
    const role = await resolveLogisticsRole(req.user);
    if (!['admin', 'super_admin', 'compliance_reviewer'].includes(role)) {
      return next(new AppError('Not authorized', 403, 'forbidden'));
    }
    const { status, limit = 50, offset = 0 } = req.query;
    // Items needing review: lanes/shipments held at customs, claims open,
    // restricted-tier POs, manual approval pending.
    const [shipments, claims, restrictedPOs] = await Promise.all([
      pool.query(
        `SELECT id, reference, status, lane_id, customs_filed_at, exception_reason, created_at
         FROM shipment_records
         WHERE status IN ('customs_hold','customs_review','exception')
         ORDER BY created_at DESC LIMIT 100`
      ),
      pool.query(
        `SELECT id, reference, claim_type, status, claimed_amount_usd, created_at, claimant_user_id
         FROM logistics_claims
         WHERE status IN ('open','under_review','escalated')
         ORDER BY created_at DESC LIMIT 100`
      ),
      pool.query(
        `SELECT po.id, po.reference, po.status, po.lane_id, l.risk_tier, po.created_at
         FROM purchase_orders po
         JOIN logistics_lanes l ON l.id = po.lane_id
         WHERE l.risk_tier IN ('restricted','prohibited')
           AND po.status IN ('draft','quoted','approved','awaiting_deposit')
         ORDER BY po.created_at DESC LIMIT 100`
      ),
    ]);
    res.json({
      success: true,
      data: {
        shipmentsNeedingReview: shipments.rows,
        openClaims: claims.rows,
        restrictedPurchaseOrders: restrictedPOs.rows,
      },
    });
  } catch (err) { next(err); }
};

// ─── Approve / deny a restricted PO or shipment ────────────────

exports.approveRestrictedPO = async (req, res, next) => {
  try {
    const role = await resolveLogisticsRole(req.user);
    if (!['admin', 'super_admin', 'compliance_reviewer'].includes(role)) {
      return next(new AppError('Not authorized', 403, 'forbidden'));
    }
    const { decision, notes } = req.body;
    if (!['approve', 'deny'].includes(decision)) {
      return next(new AppError('decision must be approve|deny', 400, 'validation_failed'));
    }
    const id = parseInt(req.params.id, 10);
    const newStatus = decision === 'approve' ? 'approved' : 'cancelled';
    const r = await pool.query(
      `UPDATE purchase_orders
       SET status = $1, approved_by = $2, approved_at = NOW(), internal_notes = COALESCE(internal_notes,'') || $3
       WHERE id = $4 RETURNING *`,
      [newStatus, req.user.id, `\n[COMPLIANCE ${decision}] ${notes || ''}`, id]
    );
    if (!r.rows.length) return next(new AppError('PO not found', 404, 'not_found'));
    logLogisticsAction('purchase_order', id, `compliance_${decision}`, {
      actorUserId: req.user.id, notes,
    });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
};

// ─── Document checklist for a shipment ─────────────────────────

exports.getShipmentDocChecklist = async (req, res, next) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const [shipRes, docsRes, laneRes] = await Promise.all([
      pool.query(`SELECT * FROM shipment_records WHERE id = $1`, [shipmentId]),
      pool.query(`SELECT doc_type, file_url, filename, uploaded_at FROM shipment_documents WHERE shipment_id = $1`, [shipmentId]),
      pool.query(`SELECT doc_requirements FROM logistics_lanes WHERE id = (SELECT lane_id FROM shipment_records WHERE id = $1)`, [shipmentId]),
    ]);
    if (!shipRes.rows[0]) return next(new AppError('Shipment not found', 404, 'not_found'));
    const required = (laneRes.rows[0]?.doc_requirements) || [];
    const present  = new Set(docsRes.rows.map(d => d.doc_type));
    const missing  = required.filter(r => r.required && !present.has(r.doc));
    res.json({
      success: true,
      data: {
        shipment: shipRes.rows[0],
        required, missing,
        uploaded: docsRes.rows,
      },
    });
  } catch (err) { next(err); }
};
