'use strict';

// The careers AI audit trail (career_ai_runs, spec §6.11). Every model
// call is logged with the input hash, model and pinned digest; inputs
// themselves are never stored.

const crypto = require('crypto');

function inputHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function findCached(db, purpose, hash) {
  const { rows: [run] } = await db.query(
    `SELECT id, output, model, model_digest FROM career_ai_runs
      WHERE purpose = $1 AND input_hash = $2 AND used = TRUE
      ORDER BY created_at DESC LIMIT 1`,
    [purpose, hash]
  );
  return run || null;
}

async function logRun(db, { purpose, openingId = null, hash, result, fallbackReason = null, acceptedBy = null }) {
  const { rows: [run] } = await db.query(
    `INSERT INTO career_ai_runs (purpose, opening_id, model, model_digest, input_hash, output, used, fallback_reason, accepted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [purpose, openingId, result?.model || null, result?.digest || null, hash,
      result ? JSON.stringify(result.output) : null, Boolean(result), fallbackReason, acceptedBy]
  );
  return run.id;
}

module.exports = { inputHash, findCached, logRun };
