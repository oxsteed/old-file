'use strict';

/**
 * Bundle K-flags regression tests (P3-7 feature flags/launch visibility,
 * P3-13 rate limiting/abuse, P3-14 session/device management).
 */

const fs = require('fs');
const path = require('path');

const { mockQuery, resetMocks } = require('./setup');

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ─── P3-13-F16: origin lock fails closed at boot in production ───────────────

describe('P3-13-F16: origin lock boot check fails closed', () => {
  const { assertOriginLockBoot } = require('../middleware/originLock');

  test('throws in production without ORIGIN_SHARED_SECRET', () => {
    expect(() =>
      assertOriginLockBoot({ env: { NODE_ENV: 'production' } })
    ).toThrow(/ORIGIN_SHARED_SECRET/);
  });

  test('passes in production with the secret set', () => {
    expect(() =>
      assertOriginLockBoot({ env: { NODE_ENV: 'production', ORIGIN_SHARED_SECRET: 's3cret' } })
    ).not.toThrow();
  });

  test('passes in production with an explicit opt-out', () => {
    expect(() =>
      assertOriginLockBoot({ env: { NODE_ENV: 'production', ORIGIN_LOCK_DISABLED: 'true' } })
    ).not.toThrow();
  });

  test('passes outside production without the secret (local/dev)', () => {
    expect(() =>
      assertOriginLockBoot({ env: { NODE_ENV: 'development' } })
    ).not.toThrow();
    expect(() =>
      assertOriginLockBoot({ env: { NODE_ENV: 'test' } })
    ).not.toThrow();
  });

  test('index.js enforces the boot check', () => {
    const src = readSource('index.js');
    expect(src).toMatch(/assertOriginLockBoot\(\)/);
  });
});

// ─── P3-13-F19: server-side timeouts ─────────────────────────────────────────

describe('P3-13-F19: http server timeouts are bounded', () => {
  test('index.js sets headersTimeout/requestTimeout/keepAliveTimeout', () => {
    const src = readSource('index.js');
    expect(src).toMatch(/httpServer\.headersTimeout\s*=\s*30\s*\*\s*1000/);
    expect(src).toMatch(/httpServer\.requestTimeout\s*=\s*120\s*\*\s*1000/);
    expect(src).toMatch(/httpServer\.keepAliveTimeout\s*=\s*5\s*\*\s*1000/);
  });
});

// ─── P3-13-F22: no silent skip on unauthenticated requests ───────────────────

describe('P3-13-F22: limiters stay active without req.user (fail-closed)', () => {
  test('no limiter uses skip: (req) => !req.user', () => {
    const src = readSource('middleware/rateLimiter.js');
    // Match actual code lines (trailing comma), not the explanatory comment.
    expect(src).not.toMatch(/^\s*skip:\s*\(req\)\s*=>\s*!req\.user,/m);
  });

  test('every keyGenerator falls back to req.ip for anonymous requests', () => {
    const limiter = require('../middleware/rateLimiter');
    void limiter;
    const src = readSource('middleware/rateLimiter.js');
    // Each rateLimit({ ... }) block that keys by user must also key by IP.
    const blocks = src.split('rateLimit({');
    const offenders = [];
    for (const block of blocks.slice(1)) {
      const body = block.slice(0, block.indexOf('});'));
      if (/req\.user\??\.(id|phone)/.test(body) && !/req\.ip/.test(body)) {
        offenders.push(body.slice(0, 60));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─── P3-7-F07: maintenance_mode and new_user_registrations are live ──────────

describe('P3-7-F07: maintenance gate', () => {
  const { createMaintenanceGate, assertRegistrationsOpen } = require('../middleware/maintenanceGate');
  const settingsCache = require('../services/platformSettingsCache');

  beforeEach(() => {
    settingsCache._clearCacheForTests();
  });

  function settingRow(value) {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM platform_settings/.test(sql)) return { rows: [{ value }] };
      return { rows: [], rowCount: 0 };
    });
  }

  test('503s non-exempt traffic when maintenance_mode is true', async () => {
    settingRow('true');
    const res = responseDouble();
    const next = jest.fn();
    await createMaintenanceGate()({ path: '/api/jobs' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'maintenance_mode' }));
  });

  test('lets health checks, admin API and the admin UI through during maintenance', async () => {
    settingRow('true');
    for (const p of ['/health', '/readyz', '/api/health', '/api/admin/super/users', '/admin/login', '/admin/dashboard']) {
      const res = responseDouble();
      const next = jest.fn();
      await createMaintenanceGate()({ path: p }, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      settingsCache._clearCacheForTests();
    }
  });

  test('passes everything through when maintenance_mode is false', async () => {
    settingRow('false');
    const res = responseDouble();
    const next = jest.fn();
    await createMaintenanceGate()({ path: '/api/jobs' }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('defaults to no-maintenance when the setting row is missing', async () => {
    const res = responseDouble();
    const next = jest.fn();
    await createMaintenanceGate()({ path: '/api/jobs' }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('registration gate throws 503 when new_user_registrations is false', async () => {
    settingRow('false');
    await expect(assertRegistrationsOpen()).rejects.toMatchObject({
      status: 503,
      code: 'registrations_disabled',
    });
  });

  test('registration gate passes when registrations are enabled', async () => {
    settingRow('true');
    await expect(assertRegistrationsOpen()).resolves.toBeUndefined();
  });

  test('registration gate fails open when the setting cannot be read', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    await expect(assertRegistrationsOpen()).resolves.toBeUndefined();
  });

  test('both signup controllers enforce the gate after validation', () => {
    expect(readSource('controllers/authController.js')).toMatch(/await assertRegistrationsOpen\(\);/);
    expect(readSource('controllers/helperRegistrationController.js')).toMatch(/await assertRegistrationsOpen\(\);/);
  });
});

// ─── P3-7-F10: two-person approval required to enable the money rail ─────────

jest.mock('../services/oxsteedCreditService', () => ({
  getCreditRailStatus: jest.fn(),
  setCreditRailStatus: jest.fn(),
}));

describe('P3-7-F10: rail activation requires two-person approval', () => {
  const creditService = require('../services/oxsteedCreditService');
  const controller = require('../controllers/oxsteedCreditController');

  function railReq(enabled) {
    return {
      user: { id: '11111111-1111-4111-8111-111111111111' },
      body: { enabled, reason: 'test' },
      correlationId: 'corr-1',
      ip: '127.0.0.1',
      get: () => undefined,
    };
  }

  beforeEach(() => {
    creditService.getCreditRailStatus.mockReset();
    creditService.setCreditRailStatus.mockReset();
  });

  test('single-admin direct enable is rejected with 409', async () => {
    creditService.getCreditRailStatus.mockResolvedValue({ enabled: false, status: 'suspended' });
    const res = responseDouble();
    const next = jest.fn();
    await controller.updateAdminCreditRail(railReq(true), res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'credit_rail_enable_requires_approval' })
    );
    expect(creditService.setCreditRailStatus).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('single-admin suspend still works (emergency stop stays unilateral)', async () => {
    creditService.setCreditRailStatus.mockResolvedValue({ rail: { enabled: false }, changed: true });
    const res = responseDouble();
    const next = jest.fn();
    await controller.updateAdminCreditRail(railReq(false), res, next);
    expect(creditService.setCreditRailStatus).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(res.json).toHaveBeenCalled();
  });

  test('enable while already enabled is an idempotent replay', async () => {
    creditService.getCreditRailStatus.mockResolvedValue({ enabled: true, status: 'enabled' });
    creditService.setCreditRailStatus.mockResolvedValue({ rail: { enabled: true }, changed: false, replayed: true });
    const res = responseDouble();
    const next = jest.fn();
    await controller.updateAdminCreditRail(railReq(true), res, next);
    expect(creditService.setCreditRailStatus).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(res.json).toHaveBeenCalled();
  });

  test('rail-controlled flags route through the rail service on change-request apply', () => {
    const src = readSource('controllers/settingsChangeController.js');
    expect(src).toMatch(/RAIL_CONTROLLED_FLAGS\.has\(String\(change\.key/);
    expect(src).toMatch(/setCreditRailStatus\(\{/);
  });

  test('applyChangeRequest applies a rail enable via setCreditRailStatus, never a raw UPDATE', async () => {
    const db = require('../db');
    const creditService = require('../services/oxsteedCreditService');
    const { applyChangeRequest } = require('../controllers/settingsChangeController');
    const client = await db.connect();
    const requestId = '11111111-1111-4111-8111-111111111111';
    const request = {
      id: requestId,
      kind: 'flag',
      key: 'oxsteed_credit_enabled',
      proposed_value: true,
      proposed_by: '22222222-2222-4222-8222-222222222222',
      reason: 'Custody review passed',
      status: 'approved',
      effective_at: null,
    };
    creditService.setCreditRailStatus.mockResolvedValue({ rail: { enabled: true }, changed: true });
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FROM settings_change_requests/.test(q) && /FOR UPDATE/.test(q)) return { rows: [request] };
      if (/FROM feature_flags/.test(q)) return { rows: [{ is_enabled: false }] };
      if (/UPDATE settings_change_requests/.test(q)) return { rows: [{ ...request, status: 'applied' }] };
      return { rows: [], rowCount: 0 };
    });
    await applyChangeRequest(client, request, '33333333-3333-4333-8333-333333333333');
    expect(creditService.setCreditRailStatus).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, reason: 'Custody review passed' })
    );
    // No raw flag UPDATE may happen for rail-controlled keys...
    expect(
      mockQuery.mock.calls.some(([sql]) => /UPDATE feature_flags/.test(String(sql)))
    ).toBe(false);
    // ...and the existence check must not hold FOR UPDATE (self-deadlock
    // with the rail service's own connection).
    const flagSelect = mockQuery.mock.calls.find(([sql]) => /FROM feature_flags/.test(String(sql)));
    expect(flagSelect).toBeDefined();
    expect(String(flagSelect[0])).not.toMatch(/FOR UPDATE/);
  });
});

// ─── P3-14-F15: admins can list another user's sessions ──────────────────────

describe('P3-14-F15: admin session visibility', () => {
  const superAdminController = require('../controllers/superAdminController');

  const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
  const TARGET_ID = '22222222-2222-4222-8222-222222222222';

  function adminReq() {
    return {
      user: { id: ADMIN_ID, role: 'super_admin' },
      params: { userId: TARGET_ID },
      ip: '127.0.0.1',
      headers: {},
      get: () => undefined,
    };
  }

  test('lists sessions without ever returning token material', async () => {
    const sessionRow = {
      id: 7,
      created_at: '2026-10-01T00:00:00Z',
      expires_at: '2026-10-08T00:00:00Z',
      absolute_expires_at: null,
      last_used_at: '2026-10-02T00:00:00Z',
      ip_address: '203.0.113.9',
      user_agent: 'TestAgent/1.0',
      is_valid: true,
      is_revoked: false,
      revoked_at: null,
    };
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM users/.test(sql)) return { rows: [{ id: TARGET_ID, email: 'u@example.com' }] };
      if (/FROM sessions/.test(sql)) {
        expect(sql).not.toMatch(/refresh_token/);
        expect(sql).not.toMatch(/access_token_hash/);
        return { rows: [sessionRow] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = responseDouble();
    await superAdminController.listUserSessions(adminReq(), res);
    expect(res.json).toHaveBeenCalledWith({
      user: { id: TARGET_ID, email: 'u@example.com' },
      sessions: [sessionRow],
    });
  });

  test('404s for an unknown user', async () => {
    const res = responseDouble();
    await superAdminController.listUserSessions(adminReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('route is mounted behind requireSuperAdmin', () => {
    const src = readSource('routes/admin.js');
    expect(src).toMatch(/router\.get\('\/super\/users\/:userId\/sessions',\s*requireSuperAdmin,\s*superCtrl\.listUserSessions\)/);
  });
});

// ─── P3-7-F05 / F08: dead flags removed ──────────────────────────────────────

describe('P3-7-F05/F08: dead feature flags are removed', () => {
  test('migration 825 deletes the dead seeded keys and the redundant setting', () => {
    const sql = readSource('migrations/825_remove_dead_feature_flags.sql');
    for (const key of [
      'referral_system_enabled',
      'referral_program',
      'tier3_payments_enabled',
      'escrow_payments',
      'maintenance_mode',
      'tool_rental',
      'mobile_app',
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toContain("DELETE FROM platform_settings WHERE key = 'require_id_verification'");
    // The live credit-rail flag is never in the DELETE list (it appears only
    // in the header comment explaining what is kept).
    const deleteList = sql.slice(sql.indexOf('DELETE FROM feature_flags'), sql.indexOf(');'));
    expect(deleteList).not.toMatch(/oxsteed_credit_enabled/);
  });
});

// ─── P3-7-F09: launch-visibility endpoint ────────────────────────────────────

describe('P3-7-F09: server exposes launch state', () => {
  test('index.js serves GET /api/launch-visibility from the env flag', () => {
    const src = readSource('index.js');
    expect(src).toMatch(/app\.get\('\/api\/launch-visibility'/);
    expect(src).toMatch(/envFlagEnabled\('OXSTEED_MEDIA_LAUNCHED', false\)/);
  });
});
