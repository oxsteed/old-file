const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');

/**
 * Process affiliate commissions batch job
 * Runs daily to calculate pending commissions from completed orders
 * Moves commissions from pending → confirmed status
 */
const JOB_NAME = 'affiliate-commission-batch';

/**
 * Money-flows audit item 44: commission math must be exact integer-cent
 * math. commission_rate is DECIMAL(5,2) percent, so it converts exactly to
 * basis points, and sale cents are integers, so the product is exact and
 * the half-up rounding matches the old Math.round behavior for positive
 * amounts without float error. The old float formula mis-rounds real
 * cases: 5000 cents at 99.99% is exactly 4999.5 (half-up 5000), but
 * float64 computes 4999.499999999999 and rounds down to 4999.
 * Inputs arrive from pg as strings (BIGINT/NUMERIC) or numbers; both are
 * accepted. Anything else fails closed (the caller's per-row catch logs
 * and skips that row).
 */
function commissionCentsForSale(saleAmountCents, commissionRate) {
  let sale;
  if (typeof saleAmountCents === 'bigint') {
    sale = saleAmountCents;
  } else if (typeof saleAmountCents === 'number' && Number.isInteger(saleAmountCents)) {
    sale = BigInt(saleAmountCents);
  } else if (typeof saleAmountCents === 'string' && /^\d+$/.test(saleAmountCents.trim())) {
    sale = BigInt(saleAmountCents.trim());
  } else {
    throw new Error('Commission sale amount must be a non-negative integer number of cents');
  }
  if (sale < 0n) {
    throw new Error('Commission sale amount must be a non-negative integer number of cents');
  }
  const rateText = String(commissionRate ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rateText);
  if (!match) {
    throw new Error('Commission rate must be a non-negative percent with at most two decimals');
  }
  const basisPoints = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0');
  const commission = (sale * basisPoints + 5000n) / 10000n;
  if (commission > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Commission exceeds the safe integer range');
  }
  return Number(commission);
}

// Review P3-870: one runner at a time across restarts and replicas (the
// post-boot run used to overlap the daily run); the unique index from
// migration 771 is the backstop.
async function processAffiliateCommissionBatch() {
  return withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    await runAffiliateCommissionBatch();
  }, 900);
}

async function runAffiliateCommissionBatch() {
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
            AND ac.status <> 'void'
        )
      ORDER BY mo.created_at DESC
      LIMIT 1000
    `);

    logger.info('Found commissions to process', { count: commissionsToProcess.rows.length });

    for (const row of commissionsToProcess.rows) {
      try {
        // Oct 30 item 17: a program with a NULL rate used to throw in
        // commissionCentsForSale on every nightly run, logging forever
        // with no incident while the NOT EXISTS check kept re-selecting
        // the row. Skip it with a deduped incident per program instead.
        if (row.affiliate_program_id && row.commission_rate == null) {
          logger.warn('Skipping commission for affiliate program with no rate', {
            orderId: row.order_id,
            affiliateProgramId: row.affiliate_program_id,
          });
          try {
            await require('../services/incidentStore').recordIncident({
              type: 'affiliate_program_missing_commission_rate',
              severity: 'high',
              message: `Affiliate program ${row.affiliate_program_id} has no commission rate; its commissions are skipped`,
              dedupeKey: `affiliate-program-null-rate:${row.affiliate_program_id}`,
              details: { affiliateProgramId: row.affiliate_program_id, orderId: row.order_id },
            });
          } catch (incidentError) {
            logger.error('Affiliate null-rate incident could not be recorded', { error: incidentError.message });
          }
          continue;
        }
        const commissionCents = commissionCentsForSale(row.sale_amount, row.commission_rate);

        // Create commission record
        if (row.affiliate_program_id) {
          const inserted = await pool.query(
            `INSERT INTO affiliate_commissions
             (order_id, affiliate_program_id, product_id, commission_cents, commission_rate, product_sale_amount_cents, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (order_id, product_id) WHERE status <> 'void' AND legacy_duplicate = FALSE DO NOTHING`,
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

          // Track conversion only for the run that actually created the row.
          if (row.affiliate_link_id && inserted.rowCount > 0) {
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

    // Auto-confirm old pending commissions (30+ days), but never confirm
    // a commission whose order stopped being payable: a refunded or
    // cancelled order, any succeeded refund row against it, or an open or
    // lost Stripe dispute on the order's charge. A won dispute keeps the
    // money, so it does not block; a charge_refunded dispute returned the
    // money, so it blocks like a refund. The dispute link runs through
    // marketplace_transactions.payment_intent_id because no dispute path
    // marks a marketplace order refunded (Oct 30 item 4, chargeback half).
    // Checked at confirm time, not just at creation, because an order can
    // be refunded or disputed after its commission is created.
    const confirmedCount = await pool.query(
      `UPDATE affiliate_commissions
       SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
       WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM affiliate_payouts ap
         WHERE ap.id = affiliate_commissions.payout_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM marketplace_orders mo
         WHERE mo.id = affiliate_commissions.order_id
           AND mo.status IN ('refunded', 'cancelled')
       )
       AND NOT EXISTS (
         SELECT 1 FROM marketplace_transaction_refunds mtr
         WHERE mtr.order_id = affiliate_commissions.order_id
           AND mtr.status = 'succeeded'
       )
       AND NOT EXISTS (
         SELECT 1 FROM marketplace_transactions mt
         JOIN stripe_chargebacks sc
           ON sc.stripe_payment_intent_id = mt.payment_intent_id
         WHERE mt.order_id = affiliate_commissions.order_id
           AND sc.stripe_status IN (
             'needs_response', 'warning_needs_response',
             'under_review', 'warning_under_review',
             'lost', 'charge_refunded'
           )
       )`
    );

    logger.info('Affiliate commission batch job completed', {
      processed: commissionsToProcess.rows.length,
      confirmed: confirmedCount.rowCount
    });
  } catch (error) {
    logger.error('Affiliate commission batch job failed', { error });
    // Oct 30 item 8: the old log-only catch made a failed money job
    // invisible to every incident surface, because the fenced caller then
    // always reported success. Record a deduped incident and rethrow so
    // the failure is visible and the run is not reported as success.
    try {
      await require('../services/incidentStore').recordIncident({
        type: 'affiliate_commission_batch_failed',
        severity: 'high',
        message: 'Affiliate commission batch job failed',
        dedupeKey: 'affiliate-commission-batch-failed',
        details: { error: error.message },
      });
    } catch (incidentError) {
      logger.error('Affiliate commission batch incident could not be recorded', { error: incidentError.message });
    }
    throw error;
  }
}

/**
 * Start the affiliate commission batch job
 * Runs daily at 1 AM UTC
 */
function startAffiliateCommissionBatchJob() {
  const cron = require('node-cron');
  let stopped = false;

  // Run once at startup after a delay (catch-up for downtime). The batch
  // rethrows on failure (Oct 30 item 8), so the timer and the cron
  // callback both log a failed run instead of an unhandled rejection.
  const startupTimer = setTimeout(() => {
    if (!stopped) {
      processAffiliateCommissionBatch().catch((error) => {
        logger.error('Affiliate commission batch startup run failed', { error: error.message });
      });
    }
  }, 60000); // Wait 1 minute

  // Background-jobs audit (finding J4): the old hand-rolled setTimeout
  // chain re-armed as completion + 24h, so every run's duration permanently
  // shifted the next run later ("1 AM UTC" was only true on first boot).
  // node-cron pins the run to 01:00 UTC daily. Overlap is impossible: the
  // batch itself runs under the fenced job lock, so a slow run makes the
  // next tick skip instead of double-running.
  const task = cron.schedule('0 1 * * *', () => {
    if (!stopped) {
      processAffiliateCommissionBatch().catch((error) => {
        logger.error('Affiliate commission batch run failed', { error: error.message });
      });
    }
  }, { timezone: 'UTC' });
  logger.info('Affiliate commission batch scheduled', { cron: '0 1 * * *', timezone: 'UTC' });

  return {
    stop() {
      stopped = true;
      clearTimeout(startupTimer);
      task.stop();
    },
  };
}

module.exports = {
  JOB_NAME,
  commissionCentsForSale,
  processAffiliateCommissionBatch,
  runAffiliateCommissionBatch,
  startAffiliateCommissionBatchJob
};
