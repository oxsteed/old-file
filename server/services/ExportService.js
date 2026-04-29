const pool = require('../utils/db');
const logger = require('../utils/logger');
const { Parser } = require('json2csv');

class ExportService {
  // Export payout history to CSV
  static async exportPayoutsCSV(helper_id, filters = {}) {
    try {
      const query = `
        SELECT
          ap.id,
          ap.period_start,
          ap.period_end,
          ap.gross_payout_cents,
          ap.processor_fee_cents,
          ap.net_payout_cents,
          ap.status,
          ap.payment_processor,
          ap.created_at,
          pm.method_type,
          pm.bank_name,
          pm.paypal_email
        FROM affiliate_payouts ap
        LEFT JOIN payout_methods pm ON ap.payout_method_id = pm.id
        WHERE ap.helper_id = $1
        ORDER BY ap.period_end DESC
      `;

      const result = await pool.query(query, [helper_id]);

      const fields = [
        { label: 'Payout ID', value: 'id' },
        { label: 'Period Start', value: 'period_start' },
        { label: 'Period End', value: 'period_end' },
        { label: 'Gross Amount', value: row => (row.gross_payout_cents / 100).toFixed(2) },
        { label: 'Processor Fee', value: row => (row.processor_fee_cents / 100).toFixed(2) },
        { label: 'Net Amount', value: row => (row.net_payout_cents / 100).toFixed(2) },
        { label: 'Status', value: 'status' },
        { label: 'Payment Method', value: 'method_type' },
        { label: 'Date Created', value: 'created_at' }
      ];

      const parser = new Parser({ fields });
      return parser.parse(result.rows);
    } catch (err) {
      logger.error('Failed to export payouts CSV', { error: err.message });
      throw err;
    }
  }

  // Export analytics metrics to CSV
  static async exportAnalyticsCSV(program_id, helper_id, startDate, endDate) {
    try {
      const query = `
        SELECT
          metric_date,
          total_clicks,
          unique_visitors,
          total_conversions,
          conversion_rate,
          total_order_value_cents,
          average_order_value_cents,
          commission_earned_cents,
          desktop_clicks,
          mobile_clicks,
          tablet_clicks
        FROM affiliate_daily_metrics
        WHERE affiliate_program_id = $1
          AND metric_date BETWEEN $2 AND $3
        ORDER BY metric_date DESC
      `;

      const result = await pool.query(query, [program_id, startDate, endDate]);

      const fields = [
        { label: 'Date', value: 'metric_date' },
        { label: 'Total Clicks', value: 'total_clicks' },
        { label: 'Unique Visitors', value: 'unique_visitors' },
        { label: 'Conversions', value: 'total_conversions' },
        { label: 'Conversion Rate (%)', value: 'conversion_rate' },
        { label: 'Total Revenue', value: row => (row.total_order_value_cents / 100).toFixed(2) },
        { label: 'Avg Order Value', value: row => (row.average_order_value_cents / 100).toFixed(2) },
        { label: 'Commission Earned', value: row => (row.commission_earned_cents / 100).toFixed(2) },
        { label: 'Desktop Clicks', value: 'desktop_clicks' },
        { label: 'Mobile Clicks', value: 'mobile_clicks' },
        { label: 'Tablet Clicks', value: 'tablet_clicks' }
      ];

      const parser = new Parser({ fields });
      return parser.parse(result.rows);
    } catch (err) {
      logger.error('Failed to export analytics CSV', { error: err.message });
      throw err;
    }
  }

  // Export top products to CSV
  static async exportTopProductsCSV(program_id, helper_id, days = 30) {
    try {
      const query = `
        SELECT
          atp.rank,
          mp.title as product_name,
          atp.total_clicks_30d,
          atp.total_conversions_30d,
          atp.conversion_rate_30d,
          atp.total_revenue_30d_cents,
          atp.total_commission_30d_cents
        FROM affiliate_top_products atp
        LEFT JOIN marketplace_products mp ON atp.product_id = mp.id
        WHERE atp.affiliate_program_id = $1
          AND atp.metric_date >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY atp.rank ASC
      `;

      const result = await pool.query(query, [program_id]);

      const fields = [
        { label: 'Rank', value: 'rank' },
        { label: 'Product Name', value: 'product_name' },
        { label: 'Clicks (30d)', value: 'total_clicks_30d' },
        { label: 'Conversions (30d)', value: 'total_conversions_30d' },
        { label: 'Conversion Rate (%)', value: 'conversion_rate_30d' },
        { label: 'Revenue (30d)', value: row => (row.total_revenue_30d_cents / 100).toFixed(2) },
        { label: 'Commission (30d)', value: row => (row.total_commission_30d_cents / 100).toFixed(2) }
      ];

      const parser = new Parser({ fields });
      return parser.parse(result.rows);
    } catch (err) {
      logger.error('Failed to export top products CSV', { error: err.message });
      throw err;
    }
  }

  // Export referrer performance to CSV
  static async exportReferrersCSV(program_id, helper_id, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const query = `
        SELECT
          referrer_source,
          COUNT(*) as session_count,
          COUNT(purchased_at) as conversions,
          ROUND(100.0 * COUNT(purchased_at) / COUNT(*), 2) as conversion_rate,
          AVG(session_duration_seconds) as avg_session_duration,
          AVG(pages_viewed) as avg_pages_viewed
        FROM affiliate_visitor_sessions
        WHERE affiliate_program_id = $1
          AND clicked_at >= $2
        GROUP BY referrer_source
        ORDER BY session_count DESC
      `;

      const result = await pool.query(query, [program_id, startDate.toISOString().split('T')[0]]);

      const fields = [
        { label: 'Referrer Source', value: 'referrer_source' },
        { label: 'Sessions', value: 'session_count' },
        { label: 'Conversions', value: 'conversions' },
        { label: 'Conversion Rate (%)', value: 'conversion_rate' },
        { label: 'Avg Session Duration (sec)', value: 'avg_session_duration' },
        { label: 'Avg Pages Viewed', value: 'avg_pages_viewed' }
      ];

      const parser = new Parser({ fields });
      return parser.parse(result.rows);
    } catch (err) {
      logger.error('Failed to export referrers CSV', { error: err.message });
      throw err;
    }
  }

  // Generate PDF report (using external service - placeholder)
  static async generatePayoutPDF(helper_id, payoutIds = []) {
    try {
      // In production, integrate with a PDF generation library:
      // - Use puppeteer for HTML-to-PDF conversion
      // - Use pdfkit for programmatic PDF generation
      // - Use a service like AWS Lambda + wkhtmltopdf

      const query = `
        SELECT * FROM affiliate_payouts
        WHERE helper_id = $1 ${payoutIds.length > 0 ? `AND id = ANY($2)` : ''}
        ORDER BY period_end DESC
      `;

      const params = payoutIds.length > 0 ? [helper_id, payoutIds] : [helper_id];
      const result = await pool.query(query, params);

      // Return PDF data (would be actual PDF bytes in production)
      logger.info('Generated payout PDF', { helper_id, payout_count: result.rows.length });

      return {
        filename: `payouts-${new Date().toISOString().split('T')[0]}.pdf`,
        data: Buffer.from(JSON.stringify(result.rows)) // Placeholder
      };
    } catch (err) {
      logger.error('Failed to generate payout PDF', { error: err.message });
      throw err;
    }
  }

  // Generate analytics report PDF
  static async generateAnalyticsPDF(program_id, helper_id, metrics, funnel, topProducts) {
    try {
      // In production, create a formatted PDF with charts and summaries
      const timestamp = new Date().toISOString().split('T')[0];

      logger.info('Generated analytics PDF', { program_id, helper_id });

      return {
        filename: `analytics-${timestamp}.pdf`,
        data: Buffer.from(JSON.stringify({ metrics, funnel, topProducts })) // Placeholder
      };
    } catch (err) {
      logger.error('Failed to generate analytics PDF', { error: err.message });
      throw err;
    }
  }
}

module.exports = ExportService;
