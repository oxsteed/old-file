#!/usr/bin/env node
'use strict';

/**
 * Exercises queue publication and recovery against a disposable Redis key
 * namespace. This script never uses the production queue names.
 */

const crypto = require('crypto');

if (process.env.QUEUE_RECOVERY_TEST_MODE !== 'true') {
  throw new Error('Refusing to run queue recovery verification without QUEUE_RECOVERY_TEST_MODE=true.');
}
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required for queue recovery verification.');
}

const {
  addJob,
  deadLetterJob,
  getNextJob,
  reclaimStaleJobs,
  listDeadLetterJobs,
  promoteDueRetries,
  requeueDeadLetterJob,
  redis,
  closeQueue,
} = require('../services/paymentQueue');

const namespace = `queue:verification:${crypto.randomUUID()}`;
const jobId = `${namespace}:job`;
const queueKey = namespace;
const delayedQueueKey = `${queueKey}:delayed`;
const deadLetterQueueKey = `${queueKey}:dead-letter`;
const keysToDelete = [
  queueKey,
  `${queueKey}:processing`,
  `${queueKey}:leases`,
  delayedQueueKey,
  deadLetterQueueKey,
  `job:${jobId}:enqueued`,
  `job:${jobId}:dead-letter`,
  `job:${jobId}:complete`,
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const redisStatus = await redis.ping();
  assert(redisStatus === 'PONG', `Redis ping failed: ${redisStatus}`);

  const first = await addJob(queueKey, { verification: true }, jobId);
  const duplicate = await addJob(queueKey, { verification: true }, jobId);
  const published = await getNextJob(queueKey);
  assert(first === jobId && duplicate === jobId, 'Idempotent enqueue returned an unexpected job ID');
  assert(published?.id === jobId, 'Atomic enqueue did not publish a retrievable payload');

  const crashedJob = { id: `${jobId}:crashed`, attempts: 0, status: 'pending', data: { verification: 'crash-recovery' } };
  const crashedPayload = JSON.stringify(crashedJob);
  await redis.lpush(`${queueKey}:processing`, crashedPayload);
  await redis.zadd(`${queueKey}:leases`, Date.now() - (20 * 60 * 1000), crashedPayload);
  assert(await reclaimStaleJobs(queueKey) === 1, 'Expired worker lease was not reclaimed');
  const reclaimed = await getNextJob(queueKey);
  assert(reclaimed?.id === crashedJob.id, 'Reclaimed job was not returned to the live queue');

  const delayedJob = JSON.stringify({ id: `${jobId}:delayed`, attempts: 1, status: 'pending' });
  await redis.zadd(delayedQueueKey, Date.now() - 1, delayedJob);
  assert(await promoteDueRetries(queueKey) === 1, 'Atomic delayed retry promotion did not move the payload');
  const promoted = await getNextJob(queueKey);
  assert(promoted?.id === `${jobId}:delayed`, 'Promoted retry payload was not retrievable');

  assert(await deadLetterJob(
    queueKey,
    { id: jobId, attempts: 3, data: { verification: true } },
    new Error('isolated provider outage'),
  ), 'Atomic dead-letter publication failed');
  const deadLetters = await listDeadLetterJobs(queueKey);
  assert(deadLetters.length === 1 && deadLetters[0].id === jobId, 'Dead-letter payload was not preserved');

  const recovered = await requeueDeadLetterJob(queueKey, jobId);
  assert(recovered?.id === jobId && recovered.attempts === 0, 'Dead-letter replay did not reset the retry budget');
  assert(recovered.recoveredFromDeadLetter?.attempts === 3, 'Dead-letter failure metadata was not retained');
  const replayed = await getNextJob(queueKey);
  assert(replayed?.id === jobId && replayed.attempts === 0, 'Replayed payload was not returned to the live queue');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    redis: redisStatus,
    namespace,
    atomicEnqueue: true,
    duplicateSuppressed: true,
    delayedRetryPromoted: true,
    staleLeaseReclaimed: true,
    deadLetterPreserved: true,
    deadLetterReplayed: true,
  }, null, 2)}\n`);
}

run()
  .catch((error) => {
    process.stderr.write(`Queue recovery verification failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.del(...keysToDelete).catch(() => {});
    await closeQueue().catch(() => {});
  });
