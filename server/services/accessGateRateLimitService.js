/**
 * Access gate rate limiter + lockout state.
 *
 * Layered on top of the existing logistics_internal_access_credentials gate
 * (controllers/logisticsInternalAccessController.js, migrations 276/277).
 *
 * Semantics:
 *
 *   - Each verify attempt is logged unconditionally into access_gate_attempts.
 *
 *   - The lockout key is (ip, normalized_name) — so 3 wrong guesses against
 *     "emile" from one IP locks (ip + emile), but doesn't lock other names
 *     from the same IP (per the answer you picked).
 *
 *   - The window is sliding: failures older than ACCESS_GATE_LOCKOUT_HOURS
 *     (default 24h) are ignored when computing fail_count. Once fail_count
 *     reaches ACCESS_GATE_MAX_FAILS (default 3), the (ip, name) pair is
 *     blocked until lifted by super-admin (UI), an authorized recovery email
 *     link, the CLI script, OR the natural 24h window passes after the third
 *     failure (auto_window_expired).
 *
 *   - On success, the active lockout row (if any) is auto-lifted and the
 *     attempt is recorded with success=TRUE.
 *
 * The service exposes three primitives the controller calls:
 *
 *   - checkLockout({ ip, claimedName })  → { locked, lockedUntil, attemptsLeft, lockoutId }
 *   - recordFailure({ ip, claimedName, scope, errorCode, userAgent })
 *   - recordSuccess({ ip, claimedName, scope, matchedUserId, userAgent })
 *
 * Plus admin/super-admin operations: list, lift, list attempts.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const MAX_FAILS = Math.max(1, Number(process.env.ACCESS_GATE_MAX_FAILS) || 3);
const LOCKOUT_HOURS = Math.max(1, Number(process.env.ACCESS_GATE_LOCKOUT_HOURS) || 24);

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeIp(value) {
  // Trim brackets from IPv6 literal, take left-most XFF entry only.
  const head = String(value || '').split(',')[0].trim();
  return head.replace(/^\[/, '').replace(/\]$/, '').slice(0, 64) || 'unknown';
}

/**
 * Returns the current active lockout row for (ip, name), if any, plus the
 * sliding-window failure count. If the active row's last_fail_at is older
 * than the lockout window, treat it as expired and auto-lift.
 */
async function checkLockout({ ip, claimedName }) {
  const normIp = normalizeIp(ip);
  const normName = normalizeName(claimedName);
  if (!normName) {
    return { locked: false, lockedUntil: null, attemptsLeft: MAX_FAILS, lockoutId: null, ip: normIp, normalizedName: normName };
  }

  // Look up any active lockout. The partial unique index ensures at most one.
  const { rows } = await pool.query(
    `SELECT id, fail_count, locked_until, last_fail_at, first_fail_at
       FROM access_gate_lockouts
      WHERE ip = $1
        AND normalized_name = $2
        AND lifted_at IS NULL
      LIMIT 1`,
    [normIp, normName]
  );

  const row = rows[0];
  if (!row) {
    return {
      locked: false,
      lockedUntil: null,
      attemptsLeft: MAX_FAILS,
      lockoutId: null,
      ip: normIp,
      normalizedName: normName,
    };
  }

  // Auto-lift if the lockout window has fully passed since last fail.
  const lockExpiry = row.locked_until ? new Date(row.locked_until) : null;
  const now = new Date();
  if (lockExpiry && lockExpiry <= now) {
    await pool.query(
      `UPDATE access_gate_lockouts
          SET lifted_at = NOW(),
              lift_source = 'auto_window_expired',
              updated_at = NOW()
        WHERE id = $1`,
      [row.id]
    );
    return {
      locked: false,
      lockedUntil: null,
      attemptsLeft: MAX_FAILS,
      lockoutId: null,
      ip: normIp,
      normalizedName: normName,
    };
  }

  return {
    locked: true,
    lockedUntil: lockExpiry,
    attemptsLeft: 0,
    lockoutId: row.id,
    ip: normIp,
    normalizedName: normName,
    failCount: row.fail_count,
  };
}

/**
 * Append an attempt audit row. Never throws — observability must not break
 * the auth flow.
 */
async function logAttempt({ ip, userAgent, claimedName, normalizedName, scope, success, errorCode, matchedUserId }) {
  try {
    await pool.query(
      `INSERT INTO access_gate_attempts (
         ip, user_agent, claimed_name, normalized_name, scope, success, error_code, matched_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ip,
        userAgent || null,
        String(claimedName || '').slice(0, 120),
        normalizedName,
        scope,
        !!success,
        errorCode || null,
        matchedUserId || null,
      ]
    );
  } catch (err) {
    logger.warn('Failed to log access gate attempt', { error: err.message });
  }
}

/**
 * Recompute the rolling 24h failure count for (ip, name) directly from the
 * append-only attempts log. Authoritative — the lockouts table is just a
 * denormalized cache of this for fast UI.
 */
async function recentFailureCount({ ip, normalizedName }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM access_gate_attempts
      WHERE ip = $1
        AND normalized_name = $2
        AND success = FALSE
        AND created_at > NOW() - ($3 || ' hours')::interval`,
    [ip, normalizedName, String(LOCKOUT_HOURS)]
  );
  return rows[0]?.n || 0;
}

/**
 * Record a failed verify attempt. Updates the lockout counter and, when the
 * fail count crosses MAX_FAILS, sets locked_until = NOW() + LOCKOUT_HOURS.
 *
 * Returns { lockedUntil, attemptsLeft, justLocked } so the caller can
 * surface the right status to the client.
 */
async function recordFailure({ ip, claimedName, scope, errorCode, userAgent }) {
  const normIp = normalizeIp(ip);
  const normName = normalizeName(claimedName);
  if (!normName) {
    await logAttempt({ ip: normIp, userAgent, claimedName, normalizedName: '', scope, success: false, errorCode });
    return { lockedUntil: null, attemptsLeft: MAX_FAILS, justLocked: false };
  }

  // Append the audit row first so the count below sees it.
  await logAttempt({
    ip: normIp,
    userAgent,
    claimedName,
    normalizedName: normName,
    scope,
    success: false,
    errorCode,
  });

  const failsInWindow = await recentFailureCount({ ip: normIp, normalizedName: normName });
  const shouldLock = failsInWindow >= MAX_FAILS;

  // Upsert the lockouts row. The partial unique index on (ip, normalized_name)
  // WHERE lifted_at IS NULL means at most one active row per pair.
  const client = await pool.connect();
  let justLocked = false;
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, fail_count, locked_until
         FROM access_gate_lockouts
        WHERE ip = $1
          AND normalized_name = $2
          AND lifted_at IS NULL
        FOR UPDATE`,
      [normIp, normName]
    );

    if (existing.rows.length === 0) {
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_HOURS * 3_600_000) : null;
      await client.query(
        `INSERT INTO access_gate_lockouts (
           ip, normalized_name, display_name, fail_count,
           first_fail_at, last_fail_at, locked_until
         ) VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)`,
        [normIp, normName, String(claimedName || '').slice(0, 120), failsInWindow, lockedUntil]
      );
      justLocked = !!lockedUntil;
    } else {
      const wasLocked = !!existing.rows[0].locked_until;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_HOURS * 3_600_000) : existing.rows[0].locked_until;
      justLocked = !wasLocked && !!lockedUntil;
      await client.query(
        `UPDATE access_gate_lockouts
            SET fail_count = $2,
                last_fail_at = NOW(),
                locked_until = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [existing.rows[0].id, failsInWindow, lockedUntil]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Failed to update access gate lockout', { error: err.message, ip: normIp, normName });
  } finally {
    client.release();
  }

  const attemptsLeft = Math.max(0, MAX_FAILS - failsInWindow);
  const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_HOURS * 3_600_000) : null;
  if (justLocked) {
    logger.warn('Access gate lockout triggered', { ip: normIp, normalizedName: normName, scope });
  }
  return { lockedUntil, attemptsLeft, justLocked };
}

/**
 * Record a successful verify attempt and auto-lift any active lockout for
 * the (ip, name) pair so the user isn't immediately re-locked on the next
 * fail.
 */
async function recordSuccess({ ip, claimedName, scope, matchedUserId, userAgent }) {
  const normIp = normalizeIp(ip);
  const normName = normalizeName(claimedName);
  await logAttempt({
    ip: normIp,
    userAgent,
    claimedName,
    normalizedName: normName,
    scope,
    success: true,
    matchedUserId,
  });
  if (!normName) return;
  await pool.query(
    `UPDATE access_gate_lockouts
        SET lifted_at = NOW(),
            lift_source = 'auto_window_expired',
            lift_reason = 'cleared on successful verify',
            updated_at = NOW()
      WHERE ip = $1
        AND normalized_name = $2
        AND lifted_at IS NULL`,
    [normIp, normName]
  );
}

/**
 * List currently-locked rows. Used by super-admin lockouts page.
 */
async function listActiveLockouts({ limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT id, ip, normalized_name AS "normalizedName", display_name AS "displayName",
            fail_count AS "failCount", first_fail_at AS "firstFailAt",
            last_fail_at AS "lastFailAt", locked_until AS "lockedUntil", created_at AS "createdAt"
       FROM access_gate_lockouts
      WHERE lifted_at IS NULL
        AND locked_until IS NOT NULL
        AND locked_until > NOW()
      ORDER BY locked_until DESC
      LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset]
  );
  return rows;
}

/**
 * Super-admin lift of a single lockout row.
 */
async function liftLockout({ lockoutId, byUserId, reason, source = 'super_admin_ui' }) {
  const { rows } = await pool.query(
    `UPDATE access_gate_lockouts
        SET lifted_at = NOW(),
            lifted_by_user_id = $2,
            lift_reason = $3,
            lift_source = $4,
            updated_at = NOW()
      WHERE id = $1
        AND lifted_at IS NULL
      RETURNING id, ip, normalized_name AS "normalizedName", display_name AS "displayName"`,
    [lockoutId, byUserId || null, (reason || '').toString().slice(0, 500) || null, source]
  );
  return rows[0] || null;
}

/**
 * Lift every active lockout matching (ip, normalizedName). Used by recovery
 * email + CLI flows where the requester knows their own (IP, name) pair but
 * doesn't have an admin UI to click "lift" in.
 */
async function liftLockoutsByKey({ ip, normalizedName, byUserId, reason, source }) {
  const normIp = normalizeIp(ip);
  const normName = normalizeName(normalizedName);
  if (!normIp || !normName) return 0;
  const { rowCount } = await pool.query(
    `UPDATE access_gate_lockouts
        SET lifted_at = NOW(),
            lifted_by_user_id = $3,
            lift_reason = $4,
            lift_source = $5,
            updated_at = NOW()
      WHERE ip = $1
        AND normalized_name = $2
        AND lifted_at IS NULL`,
    [normIp, normName, byUserId || null, (reason || '').toString().slice(0, 500) || null, source || 'recovery_email']
  );
  return rowCount;
}

async function liftAllActiveLockouts({ byUserId, reason, source = 'cli' }) {
  const { rowCount } = await pool.query(
    `UPDATE access_gate_lockouts
        SET lifted_at = NOW(),
            lifted_by_user_id = $1,
            lift_reason = $2,
            lift_source = $3,
            updated_at = NOW()
      WHERE lifted_at IS NULL`,
    [byUserId || null, (reason || '').toString().slice(0, 500) || null, source]
  );
  return rowCount;
}

/**
 * Recent attempts log for super-admin audit.
 */
async function listRecentAttempts({ limit = 100, offset = 0, success = null, ip = null, name = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const conditions = [];
  const params = [];
  if (success !== null) {
    params.push(success);
    conditions.push(`success = $${params.length}`);
  }
  if (ip) {
    params.push(normalizeIp(ip));
    conditions.push(`ip = $${params.length}`);
  }
  if (name) {
    params.push(normalizeName(name));
    conditions.push(`normalized_name = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(safeLimit, safeOffset);
  const { rows } = await pool.query(
    `SELECT id, ip, claimed_name AS "claimedName", normalized_name AS "normalizedName",
            scope, success, error_code AS "errorCode",
            matched_user_id AS "matchedUserId", user_agent AS "userAgent",
            created_at AS "createdAt"
       FROM access_gate_attempts
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

module.exports = {
  MAX_FAILS,
  LOCKOUT_HOURS,
  normalizeName,
  normalizeIp,
  checkLockout,
  recordFailure,
  recordSuccess,
  listActiveLockouts,
  liftLockout,
  liftLockoutsByKey,
  liftAllActiveLockouts,
  listRecentAttempts,
  recentFailureCount,
};
