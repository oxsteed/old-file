// ATTACK #10 FIX: Affiliate Commission Fraud Detection
// Identifies and prevents fraudulent commission claims

const pool = require('../db');
const logger = require('../utils/logger');
const { createFraudCase } = require('./fraudCaseService');

/**
 * Detect suspicious affiliate patterns that indicate fraud
 *
 * Red flags:
 * 1. Helper purchasing their own products
 * 2. Multiple orders from same IP/location in short timeframe
 * 3. Commission greater than order value (impossible)
 * 4. High frequency of orders from same customer
 * 5. Orders immediately refunded after commission payout
 */
async function detectAffiliateeFraud(orderId, affiliateId) {
  try {
    // Get order details
    const { rows: orderRows } = await pool.query(
      `SELECT id, customer_id, amount_cents, created_at, ip_address FROM marketplace_orders WHERE id = $1`,
      [orderId]
    );

    if (!orderRows[0]) return null;
    const order = orderRows[0];

    const fraudFlags = [];

    // RED FLAG #1: Helper buying from their own affiliate link
    // This is impossible - affiliates shouldn't be purchasing their own products
    if (order.customer_id === affiliateId) {
      fraudFlags.push({
        flag: 'self_purchase',
        severity: 'critical',
        message: 'Helper purchased their own product'
      });
    }

    // RED FLAG #2: Rapid-fire orders from affiliate account
    const { rows: recentOrders } = await pool.query(
      `SELECT COUNT(*) as count FROM marketplace_orders
       WHERE customer_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [order.customer_id]
    );
    if (parseInt(recentOrders[0]?.count || 0) > 5) {
      fraudFlags.push({
        flag: 'rapid_orders',
        severity: 'high',
        message: `${recentOrders[0].count} orders in last hour from same customer`
      });
    }

    // RED FLAG #3: Same IP as affiliate
    if (order.ip_address) {
      const { rows: affiliateRows } = await pool.query(
        `SELECT u.id FROM users u
         WHERE u.id = $1 AND u.last_login_ip = $2`,
        [affiliateId, order.ip_address]
      );
      if (affiliateRows[0]) {
        fraudFlags.push({
          flag: 'same_ip_as_affiliate',
          severity: 'critical',
          message: 'Order placed from same IP as affiliate account'
        });
      }
    }

    // RED FLAG #4: Commission percentage check
    // Commission should never exceed 50% of order value (sanity check)
    const { rows: commRows } = await pool.query(
      `SELECT SUM(amount_cents) as total FROM affiliate_commissions
       WHERE order_id = $1 AND status IN ('confirmed', 'paid')`,
      [orderId]
    );
    const commission = parseInt(commRows[0]?.total || 0);
    if (commission > order.amount_cents * 0.5) {
      fraudFlags.push({
        flag: 'excessive_commission',
        severity: 'high',
        message: `Commission (${commission}¢) exceeds 50% of order value (${order.amount_cents}¢)`
      });
    }

    // RED FLAG #5: Refund immediately after payout
    const { rows: refundRows } = await pool.query(
      `SELECT id, refund_date FROM marketplace_orders
       WHERE id = $1 AND refund_date IS NOT NULL
       AND refund_date <= NOW() + INTERVAL '7 days'`,
      [orderId]
    );
    if (refundRows[0]) {
      fraudFlags.push({
        flag: 'refund_after_payout',
        severity: 'high',
        message: 'Order refunded shortly after commission payment'
      });
    }

    // Open a fraud case for investigation when any flag is raised. Dedupe in
    // createFraudCase collapses repeat detections for the same order/affiliate.
    // Case creation must not change the detection result on failure.
    if (fraudFlags.length > 0) {
      try {
        const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
        const maxSeverity = fraudFlags.reduce(
          (max, f) => (severityRank[f.severity] ?? 0) > (severityRank[max] ?? 0) ? f.severity : max,
          'low'
        );
        await createFraudCase({
          subjectType: 'user',
          subjectId: affiliateId,
          category: 'affiliate_fraud',
          severity: maxSeverity,
          source: 'auto_rule',
          sourceRef: `affiliate_fraud:${affiliateId}:${orderId}`,
          summary: `Affiliate fraud flags for affiliate ${affiliateId} on order ${orderId}: ${fraudFlags.map((f) => f.flag).join(', ')}`,
          evidence: {
            order_id: orderId,
            affiliate_id: affiliateId,
            flags: fraudFlags,
          },
        });
      } catch (err) {
        logger.error('Failed to create affiliate fraud case', { orderId, affiliateId, error: err.message });
      }
    }

    return {
      order_id: orderId,
      affiliate_id: affiliateId,
      fraud_risk: fraudFlags.length > 0 ? 'HIGH' : 'LOW',
      flags: fraudFlags,
      should_block: fraudFlags.some(f => f.severity === 'critical'),
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    logger.error('Affiliate fraud detection error', { orderId, affiliateId, error: err.message });
    return null;
  }
}

/**
 * Block or flag suspicious commissions before payout
 */
async function blockSuspiciousCommissions(affiliateId, periodStart, periodEnd) {
  try {
    // Get all commissions in the period
    const { rows: commissions } = await pool.query(
      `SELECT ac.id, ac.order_id FROM affiliate_commissions ac
       WHERE ac.affiliate_id = $1
       AND ac.created_at BETWEEN $2 AND $3
       AND ac.status = 'confirmed'`,
      [affiliateId, periodStart, periodEnd]
    );

    const suspicious = [];
    for (const commission of commissions) {
      const fraudAnalysis = await detectAffiliateeFraud(commission.order_id, affiliateId);
      if (fraudAnalysis && fraudAnalysis.should_block) {
        suspicious.push(commission.id);
      }
    }

    // Mark suspicious commissions as 'disputed'
    if (suspicious.length > 0) {
      await pool.query(
        `UPDATE affiliate_commissions SET status = 'disputed' WHERE id = ANY($1)`,
        [suspicious]
      );

      logger.warn('Affiliate commissions blocked for fraud investigation', {
        affiliateId,
        blockedCount: suspicious.length
      });
    }

    return {
      total_commissions: commissions.length,
      suspicious_commissions: suspicious.length,
      blocked_commissions: suspicious
    };
  } catch (err) {
    logger.error('Failed to block suspicious commissions', { affiliateId, error: err.message });
    return null;
  }
}

module.exports = {
  detectAffiliateeFraud,
  blockSuspiciousCommissions
};
