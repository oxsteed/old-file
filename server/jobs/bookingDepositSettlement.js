'use strict';

// Review P3-962: sweeper that refunds/voids payments on ended bookings.
const cron = require('node-cron');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const svc = require('../services/bookingDepositService');

const CRON_EXPRESSION = '*/5 * * * *';
const JOB_NAME = 'booking-deposit-settlement';

async function runBookingDepositSettlement({ limit = 50 } = {}) {
  const result = { locked: false, settled: 0, failed: 0, skipped: 0, flagged: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result.locked = true;
    const ids = await svc.findUnsettledTerminalBookings(limit);
    for (const id of ids) {
      try {
        const outcome = await svc.settleTerminalBooking(id, 'sweeper');
        if (['refunded', 'voided'].includes(outcome)) result.settled += 1; else result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        logger.warn('Booking deposit settlement failed for booking', { bookingId: id, error: error.message });
      }
    }
    // Bookings that already hit the attempt cap (including ones that
    // stalled before the exhaustion hook existed): surface them to
    // operators instead of retrying them. No Stripe calls happen here.
    const exhaustedIds = await svc.findExhaustedTerminalBookings(limit);
    for (const id of exhaustedIds) {
      try {
        if ((await svc.flagExhaustedTerminalBooking(id)) === 'flagged') result.flagged += 1;
      } catch (error) {
        result.failed += 1;
        logger.warn('Booking deposit exhaustion flag failed for booking', { bookingId: id, error: error.message });
      }
    }
  }, 300, { throwOnLockError: false });
  if (result.failed) logger.warn('Booking deposit settlement had failures', result);
  return result;
}

function startBookingDepositSettlementJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runBookingDepositSettlement().catch((error) => logger.error('Booking deposit settlement failed', { error: error.message }));
  }, { timezone: 'UTC' });
}

module.exports = { JOB_NAME, runBookingDepositSettlement, startBookingDepositSettlementJob };
