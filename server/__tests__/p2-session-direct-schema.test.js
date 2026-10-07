'use strict';

/**
 * P2 findings #15 and #17 regression tests.
 *
 * #15 — session is_valid/is_revoked split:
 *   - Migration 714 rewrites the migration-200 trigger function so the
 *     invalidate_previous_sessions() trigger dual-writes
 *     is_revoked = TRUE AND is_valid = FALSE (migration 200 itself is
 *     already applied and must stay untouched).
 *   - Every read path on the sessions table must treat a session as dead
 *     if EITHER flag says so.
 *
 * #17 — Direct TIMESTAMP columns must all be covered by the TIMESTAMPTZ
 *   conversion in migration 715 (named migrations 374/375/376/416/417/418).
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SERVER_DIR = path.join(__dirname, '..');

function readMigration(name) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
}

// ─── #15a: migration 714 trigger body sets BOTH flags ───────────────────────

describe('P2 #15: session trigger dual-writes is_valid + is_revoked', () => {
  test('migration 200 is left untouched (already applied)', () => {
    const sql200 = readMigration('200_session_fixation_prevention.sql');
    // The original one-flag body must still be there: the fix belongs in 714.
    expect(sql200).toMatch(/UPDATE sessions SET is_revoked = TRUE/);
  });

  test('migration 714 replaces the trigger function with a dual-write body', () => {
    const sql714 = readMigration('716_session_trigger_dual_flags.sql');
    expect(sql714).toMatch(/CREATE OR REPLACE FUNCTION invalidate_previous_sessions\(\)/);
    const m = sql714.match(/UPDATE\s+sessions\s+SET\s+([^;]+);/is);
    expect(m).not.toBeNull();
    const setClause = m[1].replace(/\s+/g, ' ').toUpperCase();
    expect(setClause).toContain('IS_REVOKED = TRUE');
    expect(setClause).toContain('IS_VALID = FALSE');
  });

  test('trigger body behavior: previous sessions for the user get both flags set', () => {
    let pgMem;
    try {
      // Optional: only exercised where pg-mem is installed (verification env).
      pgMem = require('pg-mem');
    } catch {
      pgMem = null;
    }
    if (!pgMem) {
      // eslint-disable-next-line no-console
      console.warn('pg-mem not installed; skipping trigger behavior simulation');
      return;
    }
    const sql714 = readMigration('716_session_trigger_dual_flags.sql');
    const body = sql714.match(/BEGIN([\s\S]*?)RETURN NEW;/i)[1];
    const updateTpl = body.match(/UPDATE\s+sessions[\s\S]*?;/i)[0];
    const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const nowTs = new Date();
    const newId = 4;
    // pg-mem has an internal bug with bound parameters in this shape of
    // UPDATE, so substitute literals (test-only simulation of NEW).
    const iso = (d) => d.toISOString().replace('T', ' ').replace('Z', '+00');
    const update = updateTpl
      .replace(/NEW\.user_id/g, `'${userA}'`)
      .replace(/NEW\.id/g, String(newId))
      .replace(/NEW\.created_at/g, `TIMESTAMPTZ '${iso(nowTs)}'`);

    const db = pgMem.newDb();
    db.public.none(`CREATE TABLE sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID,
      is_valid BOOLEAN NOT NULL DEFAULT true,
      is_revoked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
    db.public.none(
      `INSERT INTO sessions (user_id, created_at) VALUES
        ('${userA}', now() - interval '2 hours'),
        ('${userA}', now() - interval '1 hour'),
        ('${userB}', now() - interval '2 hours')`
    );
    // Simulate the trigger firing for a brand-new session of userA.
    db.public.none(update);

    const rows = db.public.many('SELECT id, is_valid, is_revoked FROM sessions ORDER BY id');
    expect(rows[0]).toEqual({ id: 1, is_valid: false, is_revoked: true });
    expect(rows[1]).toEqual({ id: 2, is_valid: false, is_revoked: true });
    // Other users are untouched.
    expect(rows[2]).toEqual({ id: 3, is_valid: true, is_revoked: false });
  });
});

// ─── #15b: read side treats a session as dead if EITHER flag says so ────────

describe('P2 #15: session read paths honor both flags', () => {
  function serverFilesReadingSessions() {
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
          walk(full);
        } else if (/\.js$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          if (/FROM\s+sessions\b/i.test(src)) hits.push({ file: full, src });
        }
      }
    };
    walk(SERVER_DIR);
    return hits;
  }

  test('no sessions read path checks only one flag', () => {
    const readers = serverFilesReadingSessions();
    expect(readers.length).toBeGreaterThan(0);
    for (const { file, src } of readers) {
      const mentionsValid = /\bis_valid\b/.test(src);
      const mentionsRevoked = /\bis_revoked\b/.test(src);
      // A sessions read that honors only one flag would let a half-dead
      // session through: fail loudly naming the file.
      if (!(mentionsValid && mentionsRevoked)) {
        throw new Error(
          `${path.relative(SERVER_DIR, file)} reads sessions but does not reference both flags`
        );
      }
    }
  });

  test('refresh path kills the family on either flag (OR semantics)', () => {
    const src = fs.readFileSync(
      path.join(SERVER_DIR, 'controllers', 'authController.js'), 'utf8');
    expect(src).toMatch(/isInvalid\s*\|\|\s*isRevoked/);
  });

  test('session-list path requires both flags live (AND semantics)', () => {
    const src = fs.readFileSync(
      path.join(SERVER_DIR, 'controllers', 'adminSelfSettingsController.js'), 'utf8');
    expect(src).toMatch(/is_valid\s*=\s*true\s+AND\s+is_revoked\s*=\s*false/);
  });
});

// ─── #17: migration 715 covers every TIMESTAMP column of the named tables ───

describe('P2 #17: Direct timestamptz conversion column coverage', () => {
  // Exact (table, column) list taken from migrations 374, 375, 376, 416, 417, 418.
  const EXPECTED = [
    ['quote_requests', 'created_at'],
    ['quote_requests', 'updated_at'],
    ['quote_requests', 'scheduled_start_at'],
    ['quote_requests', 'scheduled_end_at'],
    ['quote_requests', 'proof_received_at'],
    ['quote_requests', 'accepted_at'],
    ['quote_requests', 'completed_at'],
    ['quote_requests', 'closed_at'],
    ['quote_requests', 'assigned_at'],
    ['direct_service_profiles', 'created_at'],
    ['direct_service_profiles', 'updated_at'],
    ['direct_customer_locations', 'created_at'],
    ['direct_customer_locations', 'updated_at'],
    ['direct_request_messages', 'created_at'],
    ['direct_request_events', 'created_at'],
    ['direct_calendar_blocks', 'starts_at'],
    ['direct_calendar_blocks', 'ends_at'],
    ['direct_calendar_blocks', 'created_at'],
    ['direct_calendar_blocks', 'updated_at'],
    ['direct_calendar_audit_history', 'created_at'],
    ['direct_quote_lookup_challenges', 'code_expires_at'],
    ['direct_quote_lookup_challenges', 'verified_at'],
    ['direct_quote_lookup_challenges', 'created_at'],
    ['direct_quote_lookup_challenges', 'updated_at'],
  ];

  test('migration 715 converts every expected column with UTC semantics', () => {
    const sql = readMigration('717_direct_timestamptz.sql');
    for (const [table, column] of EXPECTED) {
      const re = new RegExp(
        `ALTER\\s+COLUMN\\s+${column}\\s+TYPE\\s+TIMESTAMPTZ\\s+USING\\s+${column}\\s+AT\\s+TIME\\s+ZONE\\s+'UTC'`,
        'i'
      );
      if (!re.test(sql)) {
        throw new Error(`${table}.${column} is not converted with UTC semantics in 715`);
      }
    }
    expect(EXPECTED.length).toBe(24);
  });
});
