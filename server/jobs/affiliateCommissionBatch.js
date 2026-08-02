const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Process affiliate commissions batch job
 * Runs daily to calculate pending commissions from completed orders
 * Moves commissions from pending → confirmed status
 */
async function processAffiliateCommissionBatch() {
  try {
    logger.info('Starting affiliate commission batch job');

    // Find all orders with items that have affiliate URLs and are marked as paid
    const commissionsToProcess = await pool.query(`
      SELECT
        oi.order_id,
        oi.product_id,
        oi.total_price_cents as sale_amount,
        mo.customer_id,
        mo.created_at as order_date,
        mp.affiliate_url,
        mp.source as product_source,
        al.id as affiliate_link_id,
        ap.id as affiliate_program_id,
        ap.commission_rate
      FROM marketplace_order_items oi
      JOIN marketplace_orders mo ON oi.order_id = mo.id
      JOIN marketplace_products mp ON oi.product_id = mp.id
      LEFT JOIN shopping_carts sc ON mo.cart_id = sc.id
      LEFT JOIN affiliate_links_log al ON mp.affiliate_url = al.affiliate_url
      LEFT JOIN LATERAL (
        SELECT ap2.*
        FROM affiliate_programs ap2
        WHERE ap2.helper_id = sc.helper_id
          AND ap2.status = 'active'
          AND ap2.program_type = CASE
            WHEN lower(COALESCE(mp.source, '')) LIKE '%depot%'
              OR lower(COALESCE(mp.affiliate_url, '')) LIKE '%homedepot%'
              OR lower(COALESCE(mp.affiliate_url, '')) LIKE '%home%depot%'
            THEN 'home_depot'
            ELSE 'custom'
          END
        LIMIT 1
      ) ap ON true
      WHERE
        mo.status = 'paid'
        AND mo.completed_at IS NOT NULL
        AND mp.affiliate_url IS NOT NULL
        AND sc.helper_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM affiliate_commissions ac
          WHERE ac.order_id = oi.order_id AND ac.product_id = oi.product_id
        )
      ORDER BY mo.created_at DESC
      LIMIT 1000
    `);

    logger.info('Found commissions to process', { count: commissionsToProcess.rows.length });

    for (const row of commissionsToProcess.rows) {
      try {
        const commissionCents = Math.round(row.sale_amount * (row.commission_rate / 100));

        // Create commission record
        if (row.affiliate_program_id) {
          await pool.query(
            `INSERT INTO affiliate_commissions
             (order_id, affiliate_program_id, product_id, commission_cents, commission_rate, product_sale_amount_cents, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [
              row.order_id,
              row.affiliate_program_id,
              row.product_id,
              commissionCents,
              row.commission_rate,
              row.sale_amount,
              'pending'
            ]
          );

          // Track conversion
          if (row.affiliate_link_id) {
            await pool.query(
              `UPDATE affiliate_links_log
               SET conversions = conversions + 1, confirmed_conversions = confirmed_conversions + 1
               WHERE id = $1`,
              [row.affiliate_link_id]
            );
          }

          logger.debug('Commission created', {
            orderId: row.order_id,
            affiliateId: row.affiliate_program_id,
            commission: commissionCents
          });
        }
      } catch (error) {
        logger.error('Error processing individual commission', { error, orderId: row.order_id });
        continue;
      }
    }

    // Auto-confirm old pending commissions (30+ days)
    const confirmedCount = await pool.query(
      `UPDATE affiliate_commissions
       SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
       WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM affiliate_payouts ap
         WHERE ap.id = affiliate_commissions.payout_id
       )`
    );

    logger.info('Affiliate commission batch job completed', {
      processed: commissionsToProcess.rows.length,
      confirmed: confirmedCount.rowCount
    });
  } catch (error) {
    logger.error('Affiliate commission batch job failed', { error });
  }
}

/**
 * Start the affiliate commission batch job
 * Runs daily at 1 AM UTC
 */
function startAffiliateCommissionBatchJob() {
  let stopped = false;
  let dailyTimer = null;

  // Run once at startup after a delay
  const startupTimer = setTimeout(async () => {
    if (!stopped) await processAffiliateCommissionBatch();
  }, 60000); // Wait 1 minute

  // Schedule daily at 1 AM UTC
  const now = new Date();
  const target = new Date(now.getTime());
  target.setUTCHours(1, 0, 0, 0);

  if (target < now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const delay = target.getTime() - now.getTime();
  logger.info('Affiliate commission batch scheduled', { delayMs: delay, nextRun: target.toISOString() });

  const dailySchedule = () => {
    if (stopped) return;
    processAffiliateCommissionBatch().finally(() => {
      // Schedule next run in 24 hours
      if (!stopped) dailyTimer = setTimeout(dailySchedule, 24 * 60 * 60 * 1000);
    });
  };

  dailyTimer = setTimeout(dailySchedule, delay);

  return {
    stop() {
      stopped = true;
      clearTimeout(startupTimer);
      clearTimeout(dailyTimer);
    },
  };
}

module.exports = {
  processAffiliateCommissionBatch,
  startAffiliateCommissionBatchJob
};
