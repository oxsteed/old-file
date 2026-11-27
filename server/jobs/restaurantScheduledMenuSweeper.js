'use strict';

// Restaurant scheduled-menu sweeper (Groups 7-8, items 358, 372).
//
// Every 60 seconds, for each active restaurant:
//  1. Apply due scheduled menu changes (effective_at <= NOW(), status
//     'pending') via ownerService.applyDueMenuChanges. The change itself
//     was already created and approved by a manager through
//     POST /ops/menu/scheduled; the sweeper is only the timer that
//     applies it at the effective time. It moves no money: menu price /
//     availability changes are catalog writes, never transfers, refunds
//     or payouts.
//  2. Alert unclaimed pickups via ownerService.alertUnclaimed: ready
//     pickup orders past the location's unclaimed_pickup_minutes get
//     their store managers notified (type restaurant_pickup_unclaimed,
//     idempotent per order + manager). The alert stamps
//     unclaimed_alerted_at only after a successful send (D-637), so a
//     failed send leaves the order unstamped and the next tick retries
//     it; a repeated tick never re-alerts an order that was delivered.
//
// The alert leg runs as a synthetic owner-scoped system context per
// restaurant (no user): alertUnclaimed's permission gate is
// per-restaurant and the sweep is the restaurant's own automation, so
// there is no user to authenticate. The context carries role 'owner'
// with scope mode 'all' (every store of that restaurant) and the
// restaurant's business_id for the store-manager lookup. It grants
// nothing beyond that restaurant.
//
// Fencing mirrors businessAppointmentNoShowSweeper: the running flag
// skips an overlapping tick in this process and withFencedJobLock
// (TTL matches the 60s cadence) skips a concurrent pass on another
// replica. applyDueMenuChanges claims with FOR UPDATE SKIP LOCKED and
// the alert's per-order+manager delivery key dedupes a re-send, so a
// fence breach degrades to a duplicate-safe no-op rather than a double
// apply or double alert.
// A failure on one restaurant is logged and the sweep continues with
// the next; one bad restaurant never kills the tick.

const db = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const ownerService = require('../services/restaurantPersona/ownerService');

const JOB_NAME = 'restaurant-scheduled-menu-sweeper';
const MAX_RESTAURANTS_PER_TICK = 500;

function systemContext(restaurant) {
  return {
    userId: null,
    restaurantId: Number(restaurant.id),
    restaurant: { id: Number(restaurant.id), business_id: restaurant.business_id },
    role: 'owner',
    perms: new Set(['*']),
    scope: { mode: 'all', location_ids: [] },
  };
}

async function sweepScheduledMenus() {
  const { rows: restaurants } = await db.query(
    `SELECT id, business_id FROM food_restaurants WHERE status='active' ORDER BY id LIMIT $1`,
    [MAX_RESTAURANTS_PER_TICK]
  );
  let applied = 0;
  let unclaimed = 0;
  let alerted = 0;
  let failed = 0;
  for (const restaurant of restaurants) {
    try {
      const menu = await ownerService.applyDueMenuChanges({ restaurantId: restaurant.id });
      applied += menu.applied || 0;
      const alerts = await ownerService.alertUnclaimed(systemContext(restaurant));
      unclaimed += alerts.orders || 0;
      alerted += alerts.notified || 0;
    } catch (err) {
      failed += 1;
      logger.warn('Restaurant scheduled-menu sweep failed for restaurant', { restaurantId: restaurant.id, error: err.message });
    }
  }
  if (applied || unclaimed || alerted || failed) {
    logger.info('Restaurant scheduled-menu sweep complete', { restaurants: restaurants.length, applied, unclaimed, alerted, failed });
  }
  return { restaurants: restaurants.length, applied, unclaimed, alerted, failed };
}

// Run every 60 seconds so scheduled menu changes apply promptly at
// their effective time and unclaimed pickups are alerted within a
// minute of passing the location threshold.
function startRestaurantScheduledMenuSweeper() {
  let stopped = false;
  let running = null;
  const tick = () => {
    if (stopped || running) return;
    running = withFencedJobLock(JOB_NAME, async () => {
      await sweepScheduledMenus();
    }, 60)
      .catch((err) => {
        logger.error('Restaurant scheduled-menu sweeper failed', { error: err.message });
      })
      .finally(() => {
        running = null;
      });
  };
  const interval = setInterval(tick, 60 * 1000);
  interval.unref?.();

  logger.info('Restaurant scheduled-menu sweeper started');
  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      return running;
    },
  };
}

module.exports = { startRestaurantScheduledMenuSweeper, sweepScheduledMenus, JOB_NAME };
