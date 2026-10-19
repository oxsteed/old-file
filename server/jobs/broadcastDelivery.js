'use strict';

// Fenced business broadcast delivery worker (analytics decision 1). One tick
// at a time per cluster (withFencedJobLock); inside, deliveries carry their
// own lease tokens, so even an overlapping tick could not double-record.
const db = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const broadcasts = require('../services/broadcastDeliveryService');

const BATCH = Math.max(1, Math.min(500, Number(process.env.BROADCAST_DELIVERY_BATCH || 100)));
const MAX_BATCHES_PER_TICK = Math.max(1, Number(process.env.BROADCAST_DELIVERY_MAX_BATCHES || 10));

async function runBroadcastDeliveryTick(deps = {}) {
  const pool = deps.db || db;
  let delivered = 0, recorded = 0;
  const promoted = await broadcasts.promoteScheduled(pool);
  for (let i = 0; i < MAX_BATCHES_PER_TICK; i += 1) {
    if (deps.fence) deps.fence.assertActive();
    const batch = await broadcasts.claimDeliveries(pool, { limit: BATCH });
    if (!batch.length) break;
    for (const delivery of batch) {
      if (deps.fence) deps.fence.assertActive();
      delivered += 1;
      if (await broadcasts.deliverOne(pool, delivery, deps)) recorded += 1;
    }
  }
  const finished = await broadcasts.finalizeBroadcasts(pool);
  return { promoted, delivered, recorded, finished };
}

function runBroadcastDelivery() {
  return withFencedJobLock('business-broadcast-delivery', (fence) => runBroadcastDeliveryTick({ fence }), 300);
}

function startBroadcastDelivery() {
  if (process.env.BROADCAST_DELIVERY_ENABLED === 'false') return { stop() {} };
  let stopped = false, running = null;
  const tick = () => {
    if (stopped || running) return;
    running = runBroadcastDelivery()
      .then(result => { if (result?.delivered || result?.finished?.length) logger.info('Broadcast delivery tick', result); })
      .catch(error => logger.warn('Broadcast delivery will retry', { error: error.message }))
      .finally(() => { running = null; });
  };
  const intervalMs = Math.max(5000, Number(process.env.BROADCAST_DELIVERY_INTERVAL_MS || 30000));
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  const first = setTimeout(tick, 15000); first.unref?.();
  return { stop() { stopped = true; clearTimeout(first); clearInterval(timer); }, kick: tick };
}

module.exports = { runBroadcastDeliveryTick, runBroadcastDelivery, startBroadcastDelivery };
