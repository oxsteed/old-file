// Payment processing queue
// Decouples payment processing from API requests to prevent blocking
// Uses Redis (existing ioredis connection) for job storage and processing

const Redis = require('ioredis');
const logger = require('../utils/logger');

// Connect to Redis (uses existing REDIS_URL env var)
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableReadyCheck: false,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  logger.error('Queue Redis connection error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('Queue Redis connection established');
});

const QUEUES = {
  PAYMENT_CAPTURE: 'queue:payment-capture',
  STRIPE_WEBHOOK: 'queue:stripe-webhook',
  NOTIFICATIONS: 'queue:notifications',
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const JOB_MARKER_TTL_SECONDS = 86400;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 15 * 60 * 1000;

function visibilityTimeoutMs() {
  const configured = Number.parseInt(process.env.PAYMENT_QUEUE_VISIBILITY_TIMEOUT_MS || '', 10);
  return Number.isSafeInteger(configured) && configured >= 30_000
    ? Math.min(configured, 24 * 60 * 60 * 1000)
    : DEFAULT_VISIBILITY_TIMEOUT_MS;
}

function processingQueueKey(queueKey) {
  return `${queueKey}:processing`;
}

function leaseKey(queueKey) {
  return `${queueKey}:leases`;
}

const PUSH_WITH_MARKER_SCRIPT = `local reserved = redis.call('SET', KEYS[1], '1', 'EX', ARGV[2], 'NX')
if not reserved then return 0 end
redis.call('LPUSH', KEYS[2], ARGV[1])
return 1`;

const PROMOTE_RETRY_SCRIPT = `local removed = redis.call('ZREM', KEYS[1], ARGV[1])
if removed ~= 1 then return 0 end
redis.call('LPUSH', KEYS[2], ARGV[1])
return 1`;

const CLAIM_JOB_SCRIPT = `local payload = redis.call('RPOP', KEYS[1])
if not payload then return nil end
redis.call('LPUSH', KEYS[2], payload)
redis.call('ZADD', KEYS[3], ARGV[1], payload)
return payload`;

const COMPLETE_JOB_SCRIPT = `redis.call('LREM', KEYS[1], 1, ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], '1', 'EX', ARGV[2])
return 1`;

const RECLAIM_STALE_JOBS_SCRIPT = `local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
local reclaimed = 0
for _, payload in ipairs(candidates) do
  local removed = redis.call('LREM', KEYS[2], 1, payload)
  if removed == 1 then
    redis.call('ZREM', KEYS[1], payload)
    redis.call('LPUSH', KEYS[3], payload)
    reclaimed = reclaimed + 1
  else
    redis.call('ZREM', KEYS[1], payload)
  end
end
return reclaimed`;

const RETRY_FROM_PROCESSING_SCRIPT = `local removed = redis.call('LREM', KEYS[1], 1, ARGV[1])
if removed ~= 1 then return 0 end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[2], ARGV[3])
return 1`;

const DEAD_LETTER_FROM_PROCESSING_SCRIPT = `local reserved = redis.call('SET', KEYS[1], '1', 'EX', ARGV[3], 'NX')
if not reserved then return 0 end
local removed = redis.call('LREM', KEYS[2], 1, ARGV[1])
if removed ~= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('LPUSH', KEYS[4], ARGV[2])
return 1`;

async function pushWithMarker(queueKey, markerKey, payload) {
  const pushed = await redis.eval(
    PUSH_WITH_MARKER_SCRIPT,
    2,
    markerKey,
    queueKey,
    payload,
    JOB_MARKER_TTL_SECONDS,
  );
  return Number(pushed) === 1;
}

/**
 * Return jobs whose worker lease expired to the live queue. The move is
 * atomic with the lease removal, so a healthy worker acknowledging at the
 * same time wins without creating a duplicate.
 */
const reclaimStaleJobs = async (queueKey, limit = 25) => {
  if (!queueKey) throw new Error('Queue key is required');
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 25;
  const reclaimed = await redis.eval(
    RECLAIM_STALE_JOBS_SCRIPT,
    3,
    leaseKey(queueKey),
    processingQueueKey(queueKey),
    queueKey,
    Date.now() - visibilityTimeoutMs(),
    safeLimit,
  );
  if (Number(reclaimed) > 0) {
    logger.warn('Reclaimed stale payment queue jobs', { queueKey, reclaimed: Number(reclaimed) });
  }
  return Number(reclaimed) || 0;
};

/**
 * Add a job to a queue (FIFO with retry support)
 * @param {string} queueKey - Queue name (QUEUES.*)
 * @param {object} jobData - Job payload
 * @param {string} jobId - Unique job identifier (for deduplication)
 * @returns {Promise<string>} Job ID
 */
const addJob = async (queueKey, jobData, jobId) => {
  if (!queueKey || !jobId) throw new Error('Queue key and job ID are required');
  const markerKey = `job:${jobId}:enqueued`;
  try {
    const job = {
      id: jobId,
      data: jobData,
      attempts: 0,
      createdAt: Date.now(),
      status: 'pending',
    };

    // NX makes enqueue idempotent across API retries and multiple replicas.
    const pushed = await pushWithMarker(queueKey, markerKey, JSON.stringify(job));
    if (!pushed) {
      logger.info('Duplicate job suppressed', { queueKey, jobId });
      return jobId;
    }
    logger.info('Job queued', { queueKey, jobId });
    return jobId;
  } catch (err) {
    logger.error('Failed to queue job', { queueKey, jobId, error: err.message });
    throw err;
  }
};

/**
 * Move due retry jobs back to the live queue. zrem is the atomic ownership
 * check: when several workers promote at once, only one can remove a payload.
 */
const promoteDueRetries = async (queueKey, limit = 25) => {
  const delayedQueueKey = `${queueKey}:delayed`;
  const due = await redis.zrangebyscore(delayedQueueKey, 0, Date.now(), 'LIMIT', 0, limit);
  let promoted = 0;
  for (const jobStr of due || []) {
    const moved = await redis.eval(
      PROMOTE_RETRY_SCRIPT,
      2,
      delayedQueueKey,
      queueKey,
      jobStr,
    );
    if (Number(moved) === 1) promoted += 1;
  }
  return promoted;
};

const isJobCompleted = async (jobId) => {
  if (!jobId) return false;
  return (await redis.get(`job:${jobId}:complete`)) === '1';
};

/**
 * Retrieve next job from queue (for worker to process)
 * @param {string} queueKey - Queue name
 * @returns {Promise<object|null>} Job object or null if queue empty
 */
const getNextJob = async (queueKey) => {
  try {
    await reclaimStaleJobs(queueKey);
    const jobStr = await redis.eval(
      CLAIM_JOB_SCRIPT,
      3,
      queueKey,
      processingQueueKey(queueKey),
      leaseKey(queueKey),
      Date.now() + visibilityTimeoutMs(),
    );
    if (!jobStr) return null;

    const job = JSON.parse(jobStr);
    Object.defineProperty(job, '__queuePayload', { value: jobStr, enumerable: false });
    logger.debug('Retrieved job from queue', { queueKey, jobId: job.id });
    return job;
  } catch (err) {
    logger.error('Failed to retrieve job from queue', { queueKey, error: err.message });
    return null;
  }
};

/**
 * Re-queue job if it failed (with exponential backoff)
 * @param {string} queueKey - Queue name
 * @param {object} job - Job object
 * @returns {Promise<boolean>} true if re-queued, false if max retries exceeded
 */
const retryJob = async (queueKey, job) => {
  try {
    if (job.attempts >= MAX_RETRIES) {
      logger.warn('Job max retries exceeded', { queueKey, jobId: job.id, attempts: job.attempts });
      return false;
    }

    job.attempts += 1;
    job.nextRetryAt = Date.now() + (RETRY_DELAY_MS * job.attempts);

    // Use ZSET for delayed retry (sorted by retry timestamp)
    const delayedQueueKey = `${queueKey}:delayed`;
    const payload = JSON.stringify(job);
    const moved = await redis.eval(
      RETRY_FROM_PROCESSING_SCRIPT,
      3,
      processingQueueKey(queueKey),
      leaseKey(queueKey),
      delayedQueueKey,
      job.__queuePayload || payload,
      job.nextRetryAt,
      payload,
    );
    if (Number(moved) !== 1) {
      // A claimed job that is no longer in processing was either reclaimed by
      // another worker or already acknowledged; do not create a duplicate.
      if (job.__queuePayload) return true;
      await redis.zadd(delayedQueueKey, job.nextRetryAt, payload);
    }
    logger.info('Job re-queued with delay', { queueKey, jobId: job.id, nextRetryMs: job.nextRetryAt - Date.now() });
    return true;
  } catch (err) {
    logger.error('Failed to re-queue job', { queueKey, jobId: job.id, error: err.message });
    return false;
  }
};

/**
 * Preserve a job after its retry budget is exhausted so an operator can
 * inspect or replay it after a provider or infrastructure outage.
 */
const deadLetterJob = async (queueKey, job, error = null) => {
  if (!queueKey || !job?.id) throw new Error('Queue key and job ID are required');
  const markerKey = `job:${job.id}:dead-letter`;
  const deadLetterQueueKey = `${queueKey}:dead-letter`;
  const payload = {
    ...job,
    status: 'dead-lettered',
    deadLetteredAt: Date.now(),
    lastError: String(error?.message || error || 'Job retry budget exhausted').slice(0, 2000),
  };

  if (job.__queuePayload) {
    const moved = await redis.eval(
      DEAD_LETTER_FROM_PROCESSING_SCRIPT,
      4,
      markerKey,
      processingQueueKey(queueKey),
      leaseKey(queueKey),
      deadLetterQueueKey,
      job.__queuePayload,
      JSON.stringify(payload),
      JOB_MARKER_TTL_SECONDS,
    );
    if (Number(moved) !== 1) return false;
    logger.error('Job moved to dead-letter queue', {
      queueKey,
      deadLetterQueueKey,
      jobId: job.id,
      attempts: job.attempts,
      error: payload.lastError,
    });
    return true;
  }

  const pushed = await pushWithMarker(
    deadLetterQueueKey,
    markerKey,
    JSON.stringify(payload),
  );
  if (!pushed) return false;
  logger.error('Job moved to dead-letter queue', {
    queueKey,
    deadLetterQueueKey,
    jobId: job.id,
    attempts: job.attempts,
    error: payload.lastError,
  });
  return true;
};

const listDeadLetterJobs = async (queueKey, limit = 25) => {
  if (!queueKey) throw new Error('Queue key is required');
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 25;
  const payloads = await redis.lrange(`${queueKey}:dead-letter`, 0, safeLimit - 1);
  return (payloads || []).flatMap((payload) => {
    try {
      const job = JSON.parse(payload);
      return job?.id ? [job] : [];
    } catch {
      return [];
    }
  });
};

/**
 * Atomically move one dead-lettered job back to its live queue. Resetting the
 * retry counter gives the recovered provider operation a fresh retry budget;
 * the original dead-letter metadata remains attached for auditability.
 */
const requeueDeadLetterJob = async (queueKey, jobId) => {
  if (!queueKey || !jobId) throw new Error('Queue key and job ID are required');
  const deadLetterQueueKey = `${queueKey}:dead-letter`;
  const payloads = await redis.lrange(deadLetterQueueKey, 0, -1);
  const rawPayload = (payloads || []).find((payload) => {
    try {
      return JSON.parse(payload)?.id === jobId;
    } catch {
      return false;
    }
  });
  if (!rawPayload) return null;

  const job = JSON.parse(rawPayload);
  const recoveredJob = {
    ...job,
    status: 'pending',
    attempts: 0,
    requeuedAt: Date.now(),
    recoveredFromDeadLetter: {
      deadLetteredAt: job.deadLetteredAt || null,
      attempts: Number(job.attempts || 0),
      lastError: job.lastError || null,
    },
  };
  const moved = await redis.eval(
    `local removed = redis.call('LREM', KEYS[1], 1, ARGV[1])
     if removed ~= 1 then return 0 end
     redis.call('LPUSH', KEYS[2], ARGV[2])
     redis.call('DEL', KEYS[3], KEYS[4])
     return 1`,
    4,
    deadLetterQueueKey,
    queueKey,
    `job:${job.id}:dead-letter`,
    `job:${job.id}:complete`,
    rawPayload,
    JSON.stringify(recoveredJob),
  );
  return Number(moved) === 1 ? recoveredJob : null;
};

/**
 * Mark job as completed
 * @param {string} queueKey - Queue name
 * @param {string} jobId - Job ID
 */
const completeJob = async (queueKey, jobId) => {
  try {
    const job = jobId && typeof jobId === 'object' ? jobId : null;
    const id = job?.id || jobId;
    if (job) {
      await redis.eval(
        COMPLETE_JOB_SCRIPT,
        3,
        processingQueueKey(queueKey),
        leaseKey(queueKey),
        `job:${id}:complete`,
        job.__queuePayload || JSON.stringify(job),
        86400,
      );
    } else {
      await redis.setex(`job:${id}:complete`, 86400, '1'); // Keep for 24h
    }
    logger.info('Job completed', { queueKey, jobId: id });
  } catch (err) {
    logger.error('Failed to mark job complete', { jobId: jobId?.id || jobId, error: err.message });
    // A successful processor without a durable acknowledgment must remain
    // retryable; swallowing this error would make the worker report a false
    // success while the claimed job is still recoverable.
    throw err;
  }
};

// Export queue interface
module.exports = {
  // Queue names for workers
  QUEUES,

  // Job management
  addJob,
  promoteDueRetries,
  isJobCompleted,
  getNextJob,
  retryJob,
  deadLetterJob,
  reclaimStaleJobs,
  listDeadLetterJobs,
  requeueDeadLetterJob,
  completeJob,

  // Convenience methods for specific job types
  queuePaymentCapture: async (paymentId, jobId, amount) => {
    return addJob(QUEUES.PAYMENT_CAPTURE, { paymentId, jobId, amount }, `capture-${paymentId}`);
  },

  queueStripeWebhook: async (eventType, eventData) => {
    return addJob(QUEUES.STRIPE_WEBHOOK, { eventType, eventData }, `webhook-${eventData.id}`);
  },

  queueNotification: async (userId, type, data) => {
    return addJob(QUEUES.NOTIFICATIONS, { userId, type, data }, `notif-${userId}-${Date.now()}`);
  },

  // Graceful shutdown
  closeQueue: async () => {
    try {
      await redis.quit();
      logger.info('Queue Redis connection closed gracefully');
    } catch (err) {
      logger.error('Error closing queue Redis', err);
    }
  },

  // Health check
  ping: async () => {
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  },

  // Redis client access (for worker processes)
  redis,
};
