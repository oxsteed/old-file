const pool = require('../db');
const logger = require('../utils/logger');
const { sendError } = require('../utils/apiError');

function clampInteger(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function verifyProgramOwnership(programId, helperId) {
  const ownerQuery = 'SELECT id FROM affiliate_programs WHERE id = $1 AND helper_id = $2';
  const ownerResult = await pool.query(ownerQuery, [programId, helperId]);
  return ownerResult.rows.length > 0;
}

class AffiliateAnalyticsController {
  // Get time-series metrics for a program
  static async getMetricsTimeSeries(req, res) {
    try {
      const { program_id } = req.params;
      const helper_id = req.user.id; // programs keyed by user.id
      const days = clampInteger(req.query.days, 30, 1, 365);

      if (!(await verifyProgramOwnership(program_id, helper_id))) {
        return sendError(res, 403, 'Unauthorized');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const query = `
        SELECT
          metric_date,
          total_clicks,
          unique_visitors,
          total_conversions,
          conversion_rate,
          total_order_value_cents / 100.0 as total_order_value,
          average_order_value_cents / 100.0 as average_order_value,
          commission_earned_cents / 100.0 as commission_earned,
          desktop_clicks,
          mobile_clicks,
          tablet_clicks
        FROM affiliate_daily_metrics
        WHERE affiliate_program_id = $1
          AND metric_date >= $2
        ORDER BY metric_date ASC
      `;

      const result = await pool.query(query, [program_id, startDate.toISOString().split('T')[0]]);

      // Calculate aggregates
      const aggregates = {
        total_clicks: result.rows.reduce((sum, row) => sum + (row.total_clicks || 0), 0),
        total_conversions: result.rows.reduce((sum, row) => sum + (row.total_conversions || 0), 0),
        total_commission: result.rows.reduce((sum, row) => sum + (row.commission_earned || 0), 0),
        average_conversion_rate: result.rows.length > 0
          ? (result.rows.reduce((sum, row) => sum + (row.conversion_rate || 0), 0) / result.rows.length).toFixed(2)
          : 0
      };

      res.json({
        success: true,
        metrics: result.rows,
        aggregates,
        period_days: days,
        data_points: result.rows.length
      });
    } catch (err) {
      logger.error('Failed to get metrics time series', { error: err.message });
      sendError(res, 500, 'Failed to retrieve metrics');
    }
  }

  // Get conversion funnel data
  static async getConversionFunnel(req, res) {
    try {
      const { program_id } = req.params;
      const helper_id = req.user.id; // programs keyed by user.id
      const days = clampInteger(req.query.days, 30, 1, 365);

      if (!(await verifyProgramOwnership(program_id, helper_id))) {
        return sendError(res, 403, 'Unauthorized');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const query = `
        SELECT
          funnel_date,
          stage_click_count,
          stage_landing_count,
          stage_product_view_count,
          stage_add_to_cart_count,
          stage_checkout_count,
          stage_purchase_count,
          landing_rate,
          product_rate,
          cart_rate,
          checkout_rate,
          purchase_rate
        FROM affiliate_conversion_funnel
        WHERE affiliate_program_id = $1
          AND funnel_date >= $2
        ORDER BY funnel_date ASC
      `;

      const result = await pool.query(query, [program_id, startDate.toISOString().split('T')[0]]);

      // Calculate averages
      const averages = result.rows.length > 0 ? {
        avg_landing_rate: (result.rows.reduce((sum, r) => sum + (r.landing_rate || 0), 0) / result.rows.length).toFixed(2),
        avg_product_rate: (result.rows.reduce((sum, r) => sum + (r.product_rate || 0), 0) / result.rows.length).toFixed(2),
        avg_cart_rate: (result.rows.reduce((sum, r) => sum + (r.cart_rate || 0), 0) / result.rows.length).toFixed(2),
        avg_checkout_rate: (result.rows.reduce((sum, r) => sum + (r.checkout_rate || 0), 0) / result.rows.length).toFixed(2),
        avg_purchase_rate: (result.rows.reduce((sum, r) => sum + (r.purchase_rate || 0), 0) / result.rows.length).toFixed(2)
      } : {};

      // Current funnel snapshot (latest data)
      const latestQuery = `
        SELECT * FROM affiliate_conversion_funnel
        WHERE affiliate_program_id = $1
        ORDER BY funnel_date DESC
        LIMIT 1
      `;

      const latestResult = await pool.query(latestQuery, [program_id]);

      res.json({
        success: true,
        funnel_timeline: result.rows,
        current_funnel: latestResult.rows[0] || null,
        averages,
        period_days: days
      });
    } catch (err) {
      logger.error('Failed to get conversion funnel', { error: err.message });
      sendError(res, 500, 'Failed to retrieve funnel data');
    }
  }

  // Get top performing products
  static async getTopProducts(req, res) {
    try {
      const { program_id } = req.params;
      const helper_id = req.user.id; // programs keyed by user.id
      const limit = clampInteger(req.query.limit, 10, 1, 50);
      const days = clampInteger(req.query.days, 30, 1, 365);

      if (!(await verifyProgramOwnership(program_id, helper_id))) {
        return sendError(res, 403, 'Unauthorized');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = `
        SELECT
          atp.rank,
          atp.product_id,
          mp.name as title,
          mp.description,
          mp.image_url,
          atp.total_clicks_30d,
          atp.total_conversions_30d,
          atp.conversion_rate_30d,
          atp.total_revenue_30d_cents / 100.0 as total_revenue_30d,
          atp.total_commission_30d_cents / 100.0 as total_commission_30d
        FROM affiliate_top_products atp
        LEFT JOIN marketplace_products mp ON atp.product_id = mp.id
        WHERE atp.affiliate_program_id = $1
          AND atp.metric_date >= $2
        ORDER BY atp.rank ASC
        LIMIT $3
      `;

      const result = await pool.query(query, [program_id, startDate.toISOString().split('T')[0], limit]);

      res.json({
        success: true,
        top_products: result.rows,
        limit: parseInt(limit),
        period_days: days
      });
    } catch (err) {
      logger.error('Failed to get top products', { error: err.message });
      sendError(res, 500, 'Failed to retrieve top products');
    }
  }

  // Get product-level analytics
  static async getProductAnalytics(req, res) {
    try {
      const { program_id, product_id } = req.params;
      const helper_id = req.user.id; // programs keyed by user.id
      const days = clampInteger(req.query.days, 30, 1, 365);

      if (!(await verifyProgramOwnership(program_id, helper_id))) {
        return sendError(res, 403, 'Unauthorized');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const query = `
        SELECT
          metric_date,
          total_clicks,
          total_conversions,
          conversion_rate,
          total_revenue_cents / 100.0 as total_revenue,
          commission_earned_cents / 100.0 as commission_earned,
          views_count,
          add_to_cart_count
        FROM affiliate_product_metrics
        WHERE affiliate_program_id = $1
          AND product_id = $2
          AND metric_date >= $3
        ORDER BY metric_date ASC
      `;

      const result = await pool.query(query, [program_id, product_id, startDate.toISOString().split('T')[0]]);

      // Get product details
      const productQuery = `SELECT id, name as title, description, image_url, price_cents FROM marketplace_products WHERE id = $1`;
      const productResult = await pool.query(productQuery, [product_id]);

      // Calculate totals
      const totals = result.rows.length > 0 ? {
        total_clicks: result.rows.reduce((sum, r) => sum + (r.total_clicks || 0), 0),
        total_conversions: result.rows.reduce((sum, r) => sum + (r.total_conversions || 0), 0),
        total_revenue: result.rows.reduce((sum, r) => sum + (r.total_revenue || 0), 0),
        total_commission: result.rows.reduce((sum, r) => sum + (r.commission_earned || 0), 0),
        avg_conversion_rate: (result.rows.reduce((sum, r) => sum + (r.conversion_rate || 0), 0) / result.rows.length).toFixed(2)
      } : {};

      res.json({
        success: true,
        product: productResult.rows[0] || null,
        metrics_timeline: result.rows,
        totals,
        period_days: days
      });
    } catch (err) {
      logger.error('Failed to get product analytics', { error: err.message });
      sendError(res, 500, 'Failed to retrieve product analytics');
    }
  }

  // Get visitor funnel (session progression)
  static async getVisitorFunnel(req, res) {
    try {
      const { program_id } = req.params;
      const helper_id = req.user.id; // programs keyed by user.id
      const days = clampInteger(req.query.days, 7, 1, 365);

      if (!(await verifyProgramOwnership(program_id, helper_id))) {
        return sendError(res, 403, 'Unauthorized');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const query = `
        SELECT
          session_stage,
          COUNT(*) as session_count,
          COUNT(DISTINCT visitor_ip) as unique_visitors,
          COUNT(purchased_at) as conversions,
          AVG(session_duration_seconds) as avg_session_duration,
          AVG(pages_viewed) as avg_pages_viewed
        FROM affiliate_visitor_sessions
        WHERE affiliate_program_id = $1
          AND clicked_at >= $2
        GROUP BY session_stage
        ORDER BY
          CASE
            WHEN session_stage = 'click' THEN 1
            WHEN session_stage = 'landing' THEN 2
            WHEN session_stage = 'product_view' THEN 3
            WHEN session_stage = 'add_to_cart' THEN 4
            WHEN session_stage = 'checkout' THEN 5
            WHEN session_stage = 'purchase' THEN 6
            ELSE 7
          END
      `;

      const result = await pool.query(query, [program_id, startDate.toISOString().split('T')[0]]);

      // Calculate drop-off rates
      const funnel = result.rows.map((row, idx, arr) => ({
        ...row,
        drop_off_rate: idx > 0
          ? ((1 - row.session_count / arr[0].session_count) * 100).toFixed(2)
          : 0
      }));

      res.json({
        success: true,
        visitor_funnel: funnel,
        period_days: days
      });
    } catch (err) {
      logger.error('Failed to get visitor funnel', { error: err.message });
      sendError(res, 500, 'Failed to retrieve visitor funnel');
    }
  }

  // Get device/source breakdown
  static async getSourceBreakdown(req, res) {
    try {
      const { program_id } = req.params;
      const helper_id = req.user.id; // programs keyed by user.id
      const days = clampInteger(req.query.days, 30, 1, 365);

      if (!(await verifyProgramOwnership(program_id, helper_id))) {
        return sendError(res, 403, 'Unauthorized');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      // Device breakdown
      const deviceQuery = `
        SELECT
          'mobile' as device_type,
          SUM(mobile_clicks) as total_clicks,
          COUNT(*) as days
        FROM affiliate_daily_metrics
        WHERE affiliate_program_id = $1 AND metric_date >= $2
        UNION ALL
        SELECT 'desktop', SUM(desktop_clicks), COUNT(*)
        FROM affiliate_daily_metrics
        WHERE affiliate_program_id = $1 AND metric_date >= $2
        UNION ALL
        SELECT 'tablet', SUM(tablet_clicks), COUNT(*)
        FROM affiliate_daily_metrics
        WHERE affiliate_program_id = $1 AND metric_date >= $2
      `;

      const deviceResult = await pool.query(deviceQuery, [program_id, startDate.toISOString().split('T')[0]]);

      // Top referrers
      const referrerQuery = `
        SELECT
          referrer_source,
          COUNT(*) as session_count,
          COUNT(purchased_at) as conversions,
          ROUND(100.0 * COUNT(purchased_at) / COUNT(*), 2) as conversion_rate
        FROM affiliate_visitor_sessions
        WHERE affiliate_program_id = $1
          AND clicked_at >= $2
          AND referrer_source IS NOT NULL
        GROUP BY referrer_source
        ORDER BY session_count DESC
        LIMIT 10
      `;

      const referrerResult = await pool.query(referrerQuery, [program_id, startDate.toISOString().split('T')[0]]);

      res.json({
        success: true,
        device_breakdown: deviceResult.rows,
        top_referrers: referrerResult.rows,
        period_days: days
      });
    } catch (err) {
      logger.error('Failed to get source breakdown', { error: err.message });
      sendError(res, 500, 'Failed to retrieve source breakdown');
    }
  }
}

module.exports = AffiliateAnalyticsController;
