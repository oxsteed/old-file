#!/usr/bin/env node
'use strict';

const {
  QUEUES,
  requeueDeadLetterJob,
  closeQueue,
} = require('../services/paymentQueue');

const QUEUE_ALIASES = Object.freeze({
  'payment-capture': QUEUES.PAYMENT_CAPTURE,
  'stripe-webhook': QUEUES.STRIPE_WEBHOOK,
  notifications: QUEUES.NOTIFICATIONS,
});

async function main() {
  const [queueAlias, jobId] = process.argv.slice(2);
  const queueKey = QUEUE_ALIASES[queueAlias];
  if (!queueKey || !jobId) {
    throw new Error('Usage: node scripts/replay-payment-job.js <payment-capture|stripe-webhook|notifications> <job-id>');
  }
  const job = await requeueDeadLetterJob(queueKey, jobId);
  if (!job) throw new Error(`Dead-letter job not found or already claimed: ${jobId}`);
  process.stdout.write(`${JSON.stringify({ requeued: true, queue: queueAlias, jobId: job.id })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeQueue().catch(() => {}));
