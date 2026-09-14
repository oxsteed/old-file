const pool = require('../db');
const logger = require('../utils/logger');
const { Parser } = require('@json2csv/plainjs');
const PDFDocument = require('pdfkit');

function createPdfBuffer(render) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      render(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function formatCents(value) {
  const cents = Number(value);
  return Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : 'N/A';
}

function writeReportTitle(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(18).text(title);
  doc.moveDown(0.35).font('Helvetica').fontSize(9).fillColor('#555555').text(subtitle);
  doc.moveDown(1).fillColor('#000000');
}

function writeKeyValue(doc, label, value) {
  doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(String(value ?? 'N/A'));
}

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

  // Generate a self-contained payout report without an external renderer.
  static async generatePayoutPDF(helper_id, payoutIds = []) {
    try {
      const query = `
        SELECT id, period_start, period_end, gross_payout_cents,
               processor_fee_cents, net_payout_cents, status,
               payment_processor, created_at
        FROM affiliate_payouts
        WHERE helper_id = $1 ${payoutIds.length > 0 ? `AND id = ANY($2)` : ''}
        ORDER BY period_end DESC
      `;

      const params = payoutIds.length > 0 ? [helper_id, payoutIds] : [helper_id];
      const result = await pool.query(query, params);

      const reportDate = new Date().toISOString().split('T')[0];
      const data = await createPdfBuffer((doc) => {
        writeReportTitle(doc, 'OxSteed Payout Report', `Helper ${helper_id} | Generated ${reportDate}`);
        if (result.rows.length === 0) {
          doc.font('Helvetica').fontSize(11).text('No payouts matched the requested filters.');
          return;
        }

        result.rows.forEach((payout, index) => {
          if (index > 0) doc.moveDown(0.8).moveTo(48, doc.y).lineTo(564, doc.y).strokeColor('#cccccc').stroke().moveDown(0.8);
          doc.font('Helvetica-Bold').fontSize(12).text(`Payout #${payout.id}`);
          doc.moveDown(0.25);
          writeKeyValue(doc, 'Period', `${formatDate(payout.period_start)} to ${formatDate(payout.period_end)}`);
          writeKeyValue(doc, 'Status', payout.status);
          writeKeyValue(doc, 'Payment processor', payout.payment_processor || 'N/A');
          writeKeyValue(doc, 'Gross amount', formatCents(payout.gross_payout_cents));
          writeKeyValue(doc, 'Processor fee', formatCents(payout.processor_fee_cents));
          writeKeyValue(doc, 'Net amount', formatCents(payout.net_payout_cents));
          writeKeyValue(doc, 'Created', formatDate(payout.created_at));
        });
      });

      logger.info('Generated payout PDF', { helper_id, payout_count: result.rows.length });

      return {
        filename: `payouts-${reportDate}.pdf`,
        data,
      };
    } catch (err) {
      logger.error('Failed to generate payout PDF', { error: err.message });
      throw err;
    }
  }

  // Generate analytics report PDF
  static async generateAnalyticsPDF(program_id, helper_id, metrics, funnel, topProducts) {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const metricRows = Array.isArray(metrics) ? metrics : [];
      const funnelRows = Array.isArray(funnel) ? funnel : [];
      const productRows = Array.isArray(topProducts) ? topProducts : [];
      const data = await createPdfBuffer((doc) => {
        writeReportTitle(doc, 'OxSteed Affiliate Analytics', `Program ${program_id} | Helper ${helper_id} | Generated ${timestamp}`);
        doc.font('Helvetica-Bold').fontSize(12).text('Summary');
        doc.moveDown(0.35);
        if (metricRows.length === 0) {
          doc.font('Helvetica').fontSize(10).text('No daily metrics were supplied.');
        } else {
          metricRows.slice(0, 90).forEach((metric) => {
            writeKeyValue(doc, formatDate(metric.metric_date || metric.date), [
              `${metric.total_clicks ?? metric.clicks ?? 0} clicks`,
              `${metric.total_conversions ?? metric.conversions ?? 0} conversions`,
              `${metric.conversion_rate ?? metric.conversionRate ?? 0}% conversion`,
              `revenue ${formatCents(metric.total_order_value_cents ?? metric.revenueCents)}`,
            ].join(' | '));
          });
        }

        doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).text('Conversion funnel');
        doc.moveDown(0.35);
        if (funnelRows.length === 0) doc.font('Helvetica').fontSize(10).text('No funnel data were supplied.');
        else funnelRows.slice(0, 30).forEach((row) => writeKeyValue(doc, row.stage || row.name || 'Stage', row.count ?? row.value ?? 0));

        doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).text('Top products');
        doc.moveDown(0.35);
        if (productRows.length === 0) doc.font('Helvetica').fontSize(10).text('No product data were supplied.');
        else productRows.slice(0, 50).forEach((product, index) => writeKeyValue(doc, `${product.rank ?? index + 1}. ${product.product_name || product.productName || 'Product'}`, [
          `${product.total_clicks_30d ?? product.clicks ?? 0} clicks`,
          `${product.total_conversions_30d ?? product.conversions ?? 0} conversions`,
          `revenue ${formatCents(product.total_revenue_30d_cents ?? product.revenueCents)}`,
        ].join(' | ')));
      });

      logger.info('Generated analytics PDF', { program_id, helper_id });

      return {
        filename: `analytics-${timestamp}.pdf`,
        data,
      };
    } catch (err) {
      logger.error('Failed to generate analytics PDF', { error: err.message });
      throw err;
    }
  }
}

module.exports = ExportService;
