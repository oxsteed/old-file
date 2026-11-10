const { uuidv4 } = require('../../utils/uuid');
const pool = require('../../db');

async function createTranslationRequest({
  requesterUserId = null,
  requestType = 'sync',
  sourceText = null,
  normalizedSourceText = null,
  sourceLanguage = null,
  targetLanguage = null,
  tone = null,
  glossaryId = null,
  glossaryVersion = null,
  metadata = {},
}) {
  const id = uuidv4();
  await pool.query(
    `INSERT INTO translation_requests (
       id,
       requester_user_id,
       request_type,
       source_text,
       normalized_source_text,
       source_language_code,
       target_language_code,
       tone,
       glossary_id,
       glossary_version,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      requesterUserId,
      requestType,
      sourceText,
      normalizedSourceText,
      sourceLanguage,
      targetLanguage,
      tone,
      glossaryId,
      glossaryVersion,
      metadata,
    ]
  );
  return id;
}

async function completeTranslationRequest(requestId, {
  status = 'completed',
  provider = null,
  model = null,
  latencyMs = null,
  tokenCostEstimate = null,
  cacheKey = null,
  cached = false,
  confidence = null,
  warnings = [],
  metadata = null,
}) {
  await pool.query(
    `UPDATE translation_requests
        SET status = $2,
            provider = $3,
            model = $4,
            latency_ms = $5,
            token_cost_estimate = $6,
            cache_key = $7,
            cached = $8,
            confidence = $9,
            warnings = $10,
            metadata = COALESCE($11, metadata)
      WHERE id = $1`,
    [requestId, status, provider, model, latencyMs, tokenCostEstimate, cacheKey, cached, confidence, warnings, metadata]
  );
}

async function failTranslationRequest(requestId, { errorCode, errorMessage, warnings = [] }) {
  await pool.query(
    `UPDATE translation_requests
        SET status = 'failed',
            error_code = $2,
            error_message = $3,
            warnings = $4
      WHERE id = $1`,
    [requestId, errorCode, errorMessage, warnings]
  );
}

async function findApprovedTranslationByCacheKey(cacheKey) {
  const { rows } = await pool.query(
    `SELECT id,
            translated_text AS "translatedText",
            source_language_code AS "sourceLanguage",
            target_language_code AS "targetLanguage",
            quality_score AS "qualityScore",
            provider,
            model,
            glossary_version AS "glossaryVersion",
            metadata,
            created_at AS "createdAt"
       FROM translations
      WHERE cache_key = $1
        AND review_status = 'approved'
      ORDER BY created_at DESC
      LIMIT 1`,
    [cacheKey]
  );
  return rows[0] || null;
}

async function saveTranslation({
  translationRequestId = null,
  normalizedSourceText,
  sourceLanguage,
  targetLanguage,
  translatedText,
  tone = null,
  qualityScore = null,
  cacheKey,
  glossaryId = null,
  glossaryVersion = null,
  provider = null,
  model = null,
  reviewStatus = 'approved',
  metadata = {},
}) {
  const id = uuidv4();
  const { rows } = await pool.query(
    `INSERT INTO translations (
       id,
       translation_request_id,
       normalized_source_text,
       source_language_code,
       target_language_code,
       translated_text,
       tone,
       quality_score,
       cache_key,
       glossary_id,
       glossary_version,
       provider,
       model,
       review_status,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (cache_key)
     DO UPDATE SET
       translated_text = EXCLUDED.translated_text,
       quality_score = EXCLUDED.quality_score,
       glossary_id = EXCLUDED.glossary_id,
       glossary_version = EXCLUDED.glossary_version,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       review_status = EXCLUDED.review_status,
       metadata = EXCLUDED.metadata
     RETURNING id,
               translated_text AS "translatedText",
               source_language_code AS "sourceLanguage",
               target_language_code AS "targetLanguage",
               quality_score AS "qualityScore",
               provider,
               model,
               review_status AS "reviewStatus",
               created_at AS "createdAt"`,
    [
      id,
      translationRequestId,
      normalizedSourceText,
      sourceLanguage,
      targetLanguage,
      translatedText,
      tone,
      qualityScore,
      cacheKey,
      glossaryId,
      glossaryVersion,
      provider,
      model,
      reviewStatus,
      metadata,
    ]
  );
  return rows[0];
}

async function getTranslationById(translationId) {
  const { rows } = await pool.query(
    `SELECT id,
            translated_text AS "translatedText",
            normalized_source_text AS "normalizedSourceText",
            source_language_code AS "sourceLanguage",
            target_language_code AS "targetLanguage",
            quality_score AS "qualityScore",
            provider,
            model,
            review_status AS "reviewStatus",
            metadata,
            created_at AS "createdAt"
       FROM translations
      WHERE id = $1
      LIMIT 1`,
    [translationId]
  );
  return rows[0] || null;
}

// F-18: owner-scoped read for the public API. The translations table is a
// shared cache, so a row is returned only to a signed-in user who has a
// translation request for the same cache key. Guests receive their result
// inline from POST /api/translate and cannot look rows up by id.
async function getTranslationForRequester(translationId, requesterUserId) {
  if (!requesterUserId) return null;
  const { rows } = await pool.query(
    `SELECT t.id,
            t.translated_text AS "translatedText",
            t.normalized_source_text AS "normalizedSourceText",
            t.source_language_code AS "sourceLanguage",
            t.target_language_code AS "targetLanguage",
            t.quality_score AS "qualityScore",
            t.provider,
            t.model,
            t.review_status AS "reviewStatus",
            t.metadata,
            t.created_at AS "createdAt"
       FROM translations t
      WHERE t.id = $1
        AND EXISTS (
          SELECT 1 FROM translation_requests r
           WHERE r.cache_key = t.cache_key
             AND r.requester_user_id = $2
        )
      LIMIT 1`,
    [translationId, requesterUserId]
  );
  return rows[0] || null;
}

async function listTranslationHistory({ requesterUserId, limit = 25, offset = 0 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM translation_requests
      WHERE requester_user_id = $1`,
    [requesterUserId]
  );
  const { rows } = await pool.query(
    `SELECT id,
            request_type AS "requestType",
            status,
            source_text AS "sourceText",
            source_language_code AS "sourceLanguage",
            target_language_code AS "targetLanguage",
            tone,
            provider,
            model,
            latency_ms AS "latencyMs",
            cached,
            confidence,
            warnings,
            created_at AS "createdAt"
       FROM translation_requests
      WHERE requester_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [requesterUserId, safeLimit, safeOffset]
  );
  return { items: rows, total: countRes.rows[0]?.total || 0, limit: safeLimit, offset: safeOffset };
}

async function createTranslationJob({
  requesterUserId = null,
  sourceLanguage = null,
  targetLanguage,
  tone = null,
  glossaryId = null,
  glossaryVersion = null,
  itemCount,
  inputPayload,
}) {
  const id = uuidv4();
  const { rows } = await pool.query(
    `INSERT INTO translation_jobs (
       id,
       requester_user_id,
       source_language_code,
       target_language_code,
       tone,
       glossary_id,
       glossary_version,
       item_count,
       input_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id,
               status,
               item_count AS "itemCount",
               completed_count AS "completedCount",
               progress,
               created_at AS "createdAt"`,
    [id, requesterUserId, sourceLanguage, targetLanguage, tone, glossaryId, glossaryVersion, itemCount, inputPayload]
  );
  return rows[0];
}

async function claimNextQueuedTranslationJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id,
              requester_user_id AS "requesterUserId",
              source_language_code AS "sourceLanguage",
              target_language_code AS "targetLanguage",
              tone,
              glossary_id AS "glossaryId",
              glossary_version AS "glossaryVersion",
              item_count AS "itemCount",
              completed_count AS "completedCount",
              retry_count AS "retryCount",
              input_payload AS "inputPayload"
         FROM translation_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );

    const job = rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }

    await client.query(
      `UPDATE translation_jobs
          SET status = 'processing',
              started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [job.id]
    );
    await client.query('COMMIT');
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateTranslationJobProgress(jobId, {
  completedCount,
  itemCount,
  resultPayload,
  retryCount,
  status,
  errorMessage = null,
}) {
  const progress = itemCount > 0 ? Number(((completedCount / itemCount) * 100).toFixed(2)) : 0;
  await pool.query(
    `UPDATE translation_jobs
        SET completed_count = $2,
            progress = $3,
            result_payload = COALESCE($4, result_payload),
            retry_count = COALESCE($5, retry_count),
            status = COALESCE($6, status),
            error_message = COALESCE($7, error_message),
            updated_at = CURRENT_TIMESTAMP,
            completed_at = CASE
              WHEN COALESCE($6, status) IN ('completed', 'failed', 'partial')
              THEN CURRENT_TIMESTAMP
              ELSE completed_at
            END
      WHERE id = $1`,
    [jobId, completedCount, progress, resultPayload, retryCount, status, errorMessage]
  );
}

// `scope: 'requester'` (the public API) binds the read to the caller: a
// signed-in user sees only their own jobs and a guest only guest-created
// (requester-less) jobs, never another user's (F-18). Internal callers that
// omit the scope keep the unscoped lookup.
async function getTranslationJobById(jobId, requesterUserId = null, { scope = null } = {}) {
  const params = [jobId];
  let userClause = '';
  if (requesterUserId) {
    userClause = 'AND requester_user_id = $2';
    params.push(requesterUserId);
  } else if (scope === 'requester') {
    userClause = 'AND requester_user_id IS NULL';
  }

  const { rows } = await pool.query(
    `SELECT id,
            status,
            source_language_code AS "sourceLanguage",
            target_language_code AS "targetLanguage",
            tone,
            glossary_id AS "glossaryId",
            glossary_version AS "glossaryVersion",
            item_count AS "itemCount",
            completed_count AS "completedCount",
            retry_count AS "retryCount",
            progress,
            input_payload AS "inputPayload",
            result_payload AS "resultPayload",
            error_message AS "errorMessage",
            started_at AS "startedAt",
            completed_at AS "completedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
       FROM translation_jobs
      WHERE id = $1
        ${userClause}
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  getTranslationForRequester,
  createTranslationRequest,
  completeTranslationRequest,
  failTranslationRequest,
  findApprovedTranslationByCacheKey,
  saveTranslation,
  getTranslationById,
  listTranslationHistory,
  createTranslationJob,
  claimNextQueuedTranslationJob,
  updateTranslationJobProgress,
  getTranslationJobById,
};
