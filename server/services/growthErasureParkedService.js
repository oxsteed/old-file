'use strict';

// Domain 8 #17: operator reset path for parked growth-erasure rows.
//
// The worker (jobs/growthErasure.js) parks a batch after repeated
// verification failures and the rows leave the worker's selection:
// without this service the park was terminal except by direct SQL.
// listParked / resetParked back the admin review queue; reset returns
// a parked row to 'pending' with a zeroed attempt count and the parked
// flag cleared, so the hourly worker picks it up again.

async function listParked(db, { limit = 25, offset = 0 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { rows } = await db.query(
    `SELECT id, subject_key, reason, status, requested_at, verification_attempts, verification,
            COUNT(*) OVER()::int AS total
       FROM growth_erasure_queue WHERE status = 'parked'
      ORDER BY requested_at, id LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );
  const total = Number(rows[0]?.total || 0);
  return {
    rows,
    pagination: { limit: safeLimit, offset: safeOffset, total, hasMore: safeOffset + rows.length < total },
  };
}

async function resetParked(db, { id }) {
  const { rows: [before] } = await db.query(
    'SELECT * FROM growth_erasure_queue WHERE id = $1',
    [id],
  );
  if (!before || before.status !== 'parked') return null;
  const { rows: [row] } = await db.query(
    `UPDATE growth_erasure_queue
        SET status = 'pending', verification_attempts = 0,
            verification = COALESCE(verification, '{}'::jsonb) - 'parked'
      WHERE id = $1 AND status = 'parked'
      RETURNING *`,
    [id],
  );
  if (!row) return null;
  return { row, before };
}

module.exports = { listParked, resetParked };
