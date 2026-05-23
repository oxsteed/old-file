'use strict';
/**
 * OxSteed Logistics — Finance / Profitability controller
 * Buyer-facing: landed-cost rollups, payment schedule, fee transparency.
 * Admin/super-admin: profitability across lanes, suppliers, campaigns; margin auditing.
 */
const pool = require('../db');
const AppError = require('../utils/AppError');
const { resolveLogisticsRole } = require('../middleware/requireLogisticsAccess');

// ─── Buyer payment schedule + outstanding balances ────────────

exports.getMyPaymentSchedule = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [posRes, popsRes, refundsRes] = await Promise.all([
      pool.query(
        `SELECT id, reference, status, total_landed_usd,
                deposit_due_usd, deposit_paid_usd, deposit_paid_at,
                final_due_usd, final_paid_usd, final_paid_at,
                expected_arrival_date, lane_id
         FROM purchase_orders
         WHERE buyer_user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT pop.*, po.title AS pooled_title, po.status AS pooled_status,
                po.expected_ship_date, po.expected_arrival_date
         FROM pooled_order_participants pop
         JOIN pooled_orders po ON po.id = pop.pooled_order_id
         WHERE pop.user_id = $1
         ORDER BY pop.created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT id, reference, status, requested_amount_usd, approved_amount_usd, created_at
         FROM logistics_refund_cases
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ),
    ]);

    // Build the payment schedule
    const schedule = [];
    for (const po of posRes.rows) {
      const depOutstanding = (parseFloat(po.deposit_due_usd) || 0) - (parseFloat(po.deposit_paid_usd) || 0);
      const finOutstanding = (parseFloat(po.final_due_usd) || 0) - (parseFloat(po.final_paid_usd) || 0);
      if (depOutstanding > 0.01) {
        schedule.push({
          kind: 'po_deposit', po_id: po.id, reference: po.reference, status: po.status,
          amount_usd: depOutstanding, due_when: 'before_supplier_placement',
        });
      }
      if (finOutstanding > 0.01) {
        schedule.push({
          kind: 'po_final', po_id: po.id, reference: po.reference, status: po.status,
          amount_usd: finOutstanding, due_when: 'before_release',
          expected_arrival_date: po.expected_arrival_date,
        });
      }
    }
    for (const pop of popsRes.rows) {
      if (pop.status === 'pledged' || pop.status === 'invited') {
        const dep = parseFloat(pop.deposit_amount_usd) || 0;
        if (dep > 0) schedule.push({
          kind: 'pooled_deposit', participant_id: pop.id, pooled_order_id: pop.pooled_order_id,
          title: pop.pooled_title, amount_usd: dep, due_when: 'pooled_deposit_window',
        });
      } else if (pop.status === 'confirmed' || pop.status === 'locked') {
        const fin = parseFloat(pop.final_payment_usd) || 0;
        if (fin > 0) schedule.push({
          kind: 'pooled_final', participant_id: pop.id, pooled_order_id: pop.pooled_order_id,
          title: pop.pooled_title, amount_usd: fin, due_when: 'pooled_final_window',
        });
      }
    }

    res.json({
      success: true,
      data: {
        purchaseOrders: posRes.rows,
        pooledParticipations: popsRes.rows,
        refunds: refundsRes.rows,
        schedule,
      },
    });
  } catch (err) { next(err); }
};

// ─── Buyer landed-cost rollup per PO ──────────────────────────

exports.getPoLandedCostBreakdown = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await pool.query(
      `SELECT po.*, l.name AS lane_name, l.code AS lane_code
       FROM purchase_orders po
       LEFT JOIN logistics_lanes l ON l.id = po.lane_id
       WHERE po.id = $1`,
      [id]
    );
    const po = r.rows[0];
    if (!po) return next(new AppError('PO not found', 404, 'not_found'));
    if (po.buyer_user_id !== req.user.id) {
      const role = await resolveLogisticsRole(req.user);
      if (!['admin', 'super_admin'].includes(role)) {
        return next(new AppError('Not authorized', 403, 'forbidden'));
      }
    }
    res.json({
      success: true,
      data: {
        purchase_order: po,
        breakdown: [
          { label: 'Product cost',         amount: po.total_product_usd },
          { label: 'Origin handling',      amount: po.origin_handling_usd },
          { label: 'Sourcing fee',         amount: po.sourcing_fee_usd },
          { label: 'OxSteed markup',       amount: po.oxsteed_markup_usd },
          { label: 'Freight estimate',     amount: po.freight_est_usd },
          { label: 'Customs / admin',      amount: po.customs_admin_usd },
          { label: 'Warehouse fee',        amount: po.warehouse_fee_usd },
          { label: 'Last-mile',            amount: po.last_mile_usd },
          { label: 'Risk surcharge',       amount: po.risk_surcharge_usd },
        ],
        landed_total: po.total_landed_usd,
        currency: po.currency || 'USD',
      },
    });
  } catch (err) { next(err); }
};

// ─── Admin: profitability dashboard ───────────────────────────

exports.getProfitabilitySummary = async (req, res, next) => {
  try {
    const role = await resolveLogisticsRole(req.user);
    if (!['admin', 'super_admin'].includes(role)) {
      return next(new AppError('Not authorized', 403, 'forbidden'));
    }

    const [byLane, bySupplier, byCampaign, recent] = await Promise.all([
      pool.query(
        `SELECT l.id, l.code, l.name, l.origin_country, l.destination_country,
                COUNT(po.id)::int                 AS po_count,
                COALESCE(SUM(po.total_landed_usd),0)::numeric AS revenue_usd,
                COALESCE(SUM(po.total_product_usd),0)::numeric AS cogs_usd,
                COALESCE(SUM(po.oxsteed_markup_usd + po.sourcing_fee_usd + po.warehouse_fee_usd),0)::numeric AS gross_margin_usd
         FROM logistics_lanes l
         LEFT JOIN purchase_orders po ON po.lane_id = l.id AND po.status NOT IN ('draft','cancelled')
         GROUP BY l.id ORDER BY revenue_usd DESC`
      ),
      pool.query(
        `SELECT s.id, s.code, s.company_name, s.country,
                COUNT(po.id)::int               AS po_count,
                COALESCE(SUM(po.total_product_usd),0)::numeric AS spend_usd,
                COALESCE(SUM(po.oxsteed_markup_usd),0)::numeric AS markup_usd
         FROM supplier_profiles s
         LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND po.status NOT IN ('draft','cancelled')
         GROUP BY s.id ORDER BY spend_usd DESC LIMIT 20`
      ),
      pool.query(
        `SELECT pold.id, pold.reference, pold.title, pold.status,
                pold.target_moq, pold.current_committed_qty,
                COALESCE(SUM(pop.subtotal_usd),0)::numeric AS revenue_usd,
                COUNT(pop.id)::int                          AS participant_count
         FROM pooled_orders pold
         LEFT JOIN pooled_order_participants pop ON pop.pooled_order_id = pold.id
         GROUP BY pold.id ORDER BY pold.created_at DESC LIMIT 20`
      ),
      pool.query(
        `SELECT 'po' AS kind, id, reference, status, total_landed_usd AS amount_usd, created_at
         FROM purchase_orders
         ORDER BY created_at DESC LIMIT 25`
      ),
    ]);

    res.json({
      success: true,
      data: {
        byLane: byLane.rows,
        bySupplier: bySupplier.rows,
        byCampaign: byCampaign.rows,
        recent: recent.rows,
      },
    });
  } catch (err) { next(err); }
};
