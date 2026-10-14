'use strict';

/**
 * adminBundleD.test.js
 *
 * Bundle D (data integrity & audit) of the admin audit:
 * - ADM-045: CCPA export uses an explicit column allowlist (no password_hash/totp_secret in email)
 * - ADM-036: legal-doc publishing has audit writes + maker-checker (maker != checker)
 * - ADM-046: approved appeals deactivate user_restrictions and clear is_suspended
 * - ADM-093: business-launch CSV export runs server-side and is audited
 * - ADM-211: license mutations write admin audit log entries
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    next();
  },
  requireAuth: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    next();
  },
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, res, next) => {
    // routes/admin.js chains requireAdmin without the authenticate middleware,
    // so the mock must establish req.user itself (production requireAdmin reads the JWT).
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.isSuper = req.headers['x-test-super'] === '1' || req.user.role === 'super_admin';
    next();
  },
  requireSuperAdmin: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'super_admin' };
    req.isSuper = true;
    next();
  },
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../middleware/regionAuth', () => ({
  loadAssignedRegions: (req, res, next) => next(),
  requireRegionAccessForUser: () => (req, res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => {
  const pass = (req, res, next) => next();
  return { generalLimiter: pass, strictLimiter: pass, creditAdminMutationLimiter: pass, creditExportLimiter: pass, adminPhoneVerificationLimiter: pass };
});

const express = require('express');
const request = require('supertest');
const legalRoutes = require('../routes/legalDocuments');
const enforcementPolicyRoutes = require('../routes/enforcementPolicy');
const businessLaunchRoutes = require('../routes/businessLaunch');
const adminRoutes = require('../routes/admin');
const { sendEmail } = require('../utils/email');

const ADMIN_1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const ADMIN_2 = 'bbbbbbbb-2222-4222-8222-222222222222';

function headers(userId = ADMIN_1, role = 'admin') {
  return { 'x-test-user': userId, 'x-test-role': role };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/legal', legalRoutes);
  app.use('/api/enforcement-policy', enforcementPolicyRoutes);
  app.use('/api/consulting/business-launch', businessLaunchRoutes);
  app.use('/api/admin', adminRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return app;
}

let app;
beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  app = buildApp();
});

function auditInserts() {
  return mockQuery.mock.calls
    .filter((c) => /INSERT INTO admin_audit_log/.test(c[0]))
    .map((c) => ({ action: c[1][1], targetKey: c[1][4], description: c[1][5] }));
}

// ── ADM-045 ──────────────────────────────────────────────────────────────
describe('ADM-045: CCPA export never leaks credential columns', () => {
  test('emailed profile data excludes password_hash/totp_secret/reset tokens', async () => {
    const requestRow = {
      id: 7, user_id: 'user-1', request_type: 'access', email: 'user@example.com', status: 'completed',
    };
    const userRow = {
      id: 'user-1', email: 'user@example.com', first_name: 'Ada', last_name: 'Lovelace',
      password_hash: '$2b$10$SHOULDNEVERLEAK', totp_secret: 'TOTPSECRET',
      reset_token: 'RESET-TOKEN', reset_token_expires: new Date().toISOString(),
      email_verify_token: 'VERIFY-TOKEN', tax_id_last4: '1234',
      background_check_id: 'CHECKR-ID', last_known_ip_hash: 'IPHASH',
    };
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM ccpa_data_requests/.test(sql)) return { rows: [requestRow], rowCount: 1 };
      if (/FROM users/.test(sql)) {
        // Simulate the real DB: only the projected columns come back, so a
        // SELECT * regression would surface the secrets here and fail.
        const cols = sql.match(/SELECT (.+) FROM users/)[1].split(',').map((s) => s.trim());
        const projected = {};
        for (const c of cols) projected[c] = userRow[c];
        return { rows: [projected], rowCount: 1 };
      }
      if (/FROM messages/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM payments/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    await request(app)
      .post('/api/admin/legal/ccpa-requests/7/send-notification')
      .set(headers())
      .send({ attachData: true })
      .expect(200);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const options = sendEmail.mock.calls[0][2];
    expect(options.template).toBe('ccpa_data_delivery');
    const profile = options.data.profile;
    expect(profile).toBeDefined();
    // Credential/secret columns must not be present
    for (const secret of ['password_hash', 'totp_secret', 'reset_token', 'reset_token_expires',
      'email_verify_token', 'email_verify_expires', 'tax_id_last4', 'background_check_id',
      'background_check_report_id', 'last_known_ip_hash']) {
      expect(profile).not.toHaveProperty(secret);
    }
    // Legitimate profile data still ships
    expect(profile.email).toBe('user@example.com');
    expect(profile.first_name).toBe('Ada');
  });

  test('the profile query is an allowlist projection, not SELECT *', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM ccpa_data_requests/.test(sql)) {
        return { rows: [{ id: 7, user_id: 'user-1', request_type: 'access', email: 'u@e.com', status: 'completed' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await request(app)
      .post('/api/admin/legal/ccpa-requests/7/send-notification')
      .set(headers())
      .send({ attachData: true })
      .expect(200);
    const userSelect = mockQuery.mock.calls.find((c) => /FROM users WHERE id/.test(c[0]));
    expect(userSelect).toBeDefined();
    expect(userSelect[0]).not.toMatch(/SELECT \* FROM users/);
    expect(userSelect[0]).toMatch(/SELECT id, email/);
  });
});

// ── ADM-036 ──────────────────────────────────────────────────────────────
describe('ADM-036: legal document publishing audit + maker-checker', () => {
  const draft = (overrides = {}) => ({
    id: 'terms_of_service_1', title: 'Terms of Service', category: 'terms_of_service',
    description: '', version: 2, status: 'pending_review', sections: [],
    change_summary: '', updated_at: new Date().toISOString(),
    approval_requested_by: ADMIN_1, approval_requested_at: new Date().toISOString(),
    approved_by: null, approved_at: null, updated_by: ADMIN_1,
    ...overrides,
  });

  test('the maker cannot publish their own document (403)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM legal_document_drafts/.test(sql)) return { rows: [draft()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post('/api/admin/legal/documents/terms_of_service_1/approve')
      .set(headers(ADMIN_1))
      .send({})
      .expect(403);
    expect(res.body.error).toMatch(/separation of duties/i);
    // No publish UPDATE and no publish audit row
    expect(mockQuery.mock.calls.some((c) => /UPDATE legal_document_drafts/.test(c[0]))).toBe(false);
    expect(auditInserts().some((a) => a.action === 'legal_document_publish')).toBe(false);
  });

  test('a different admin can approve and the publish is audited', async () => {
    const updated = draft({ status: 'live', version: 3, approved_by: ADMIN_2 });
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM legal_document_drafts/.test(sql)) return { rows: [draft()], rowCount: 1 };
      if (/UPDATE legal_document_drafts/.test(sql)) return { rows: [updated], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post('/api/admin/legal/documents/terms_of_service_1/approve')
      .set(headers(ADMIN_2))
      .send({})
      .expect(200);
    expect(res.body.document.status).toBe('live');
    const publishes = auditInserts().filter((a) => a.action === 'legal_document_publish');
    expect(publishes).toHaveLength(1);
    expect(publishes[0].targetKey).toBe('terms_of_service_1');
  });

  test('approve requires pending_review status (409 otherwise)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM legal_document_drafts/.test(sql)) return { rows: [draft({ status: 'draft' })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await request(app)
      .post('/api/admin/legal/documents/terms_of_service_1/approve')
      .set(headers(ADMIN_2))
      .send({})
      .expect(409);
  });

  test('request-approval records the maker and writes an audit entry', async () => {
    const pending = draft({ status: 'pending_review' });
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM legal_document_drafts/.test(sql)) return { rows: [draft({ status: 'draft' })], rowCount: 1 };
      if (/UPDATE legal_document_drafts/.test(sql)) return { rows: [pending], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .post('/api/admin/legal/documents/terms_of_service_1/request-approval')
      .set(headers(ADMIN_1))
      .send({ changeSummary: 'New payment terms' })
      .expect(200);
    expect(res.body.document.status).toBe('pending_review');
    const updateCall = mockQuery.mock.calls.find((c) => /UPDATE legal_document_drafts/.test(c[0]));
    expect(updateCall[0]).toMatch(/approval_requested_by/);
    const reqs = auditInserts().filter((a) => a.action === 'legal_document_request_approval');
    expect(reqs).toHaveLength(1);
  });
});

// ── ADM-046 ──────────────────────────────────────────────────────────────
describe('ADM-046: approved appeals lift restrictions', () => {
  function mockAppealFlow({ actionType, otherActiveSuspensions = [] }) {
    const appeal = { id: '9', user_id: 'user-9', enforcement_id: 42, status: 'pending' };
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM enforcement_appeals WHERE id/.test(sql)) return { rows: [appeal], rowCount: 1 };
      if (/UPDATE enforcement_appeals/.test(sql)) return { rows: [{ ...appeal, status: 'approved' }], rowCount: 1 };
      if (/UPDATE enforcement_actions/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT action_type, user_id FROM enforcement_actions/.test(sql)) {
        return { rows: [{ action_type: actionType, user_id: 'user-9' }], rowCount: 1 };
      }
      if (/action_type = 'suspension' AND is_active = true/.test(sql)) {
        return { rows: otherActiveSuspensions, rowCount: otherActiveSuspensions.length };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('restriction appeal approval deactivates user_restrictions', async () => {
    mockAppealFlow({ actionType: 'restriction' });
    await request(app)
      .put('/api/enforcement-policy/admin/appeals/9/review')
      .set(headers())
      .send({ decision: 'approved', adminNotes: 'Valid appeal' })
      .expect(200);
    const restrictionLift = mockQuery.mock.calls.find((c) =>
      /UPDATE user_restrictions/.test(c[0]) && /is_active = false/.test(c[0]));
    expect(restrictionLift).toBeDefined();
    expect(restrictionLift[1]).toEqual([42]);
    const audits = auditInserts().filter((a) => a.action === 'enforcement_appeal_approved');
    expect(audits).toHaveLength(1);
  });

  test('suspension appeal clears is_suspended when no other suspension is active', async () => {
    mockAppealFlow({ actionType: 'suspension' });
    await request(app)
      .put('/api/enforcement-policy/admin/appeals/9/review')
      .set(headers())
      .send({ decision: 'approved' })
      .expect(200);
    const unsuspend = mockQuery.mock.calls.find((c) => /SET is_suspended = false/.test(c[0]));
    expect(unsuspend).toBeDefined();
    expect(unsuspend[1]).toEqual(['user-9']);
  });

  test('suspension appeal keeps is_suspended when another suspension is still active', async () => {
    mockAppealFlow({ actionType: 'suspension', otherActiveSuspensions: [{ '1': 1 }] });
    await request(app)
      .put('/api/enforcement-policy/admin/appeals/9/review')
      .set(headers())
      .send({ decision: 'approved' })
      .expect(200);
    const unsuspend = mockQuery.mock.calls.find((c) => /SET is_suspended = false/.test(c[0]));
    expect(unsuspend).toBeUndefined();
  });

  test('denied appeals do not touch restrictions', async () => {
    mockAppealFlow({ actionType: 'restriction' });
    await request(app)
      .put('/api/enforcement-policy/admin/appeals/9/review')
      .set(headers())
      .send({ decision: 'denied' })
      .expect(200);
    expect(mockQuery.mock.calls.some((c) => /UPDATE user_restrictions/.test(c[0]))).toBe(false);
  });
});

// ── ADM-093 ──────────────────────────────────────────────────────────────
describe('ADM-093: business-launch export is server-side and audited', () => {
  test('/requests/export is registered before /requests/:id', () => {
    const paths = businessLaunchRoutes.stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`);
    const exportIdx = paths.indexOf('GET /requests/export');
    const detailIdx = paths.indexOf('GET /requests/:id');
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(detailIdx).toBeGreaterThanOrEqual(0);
    expect(exportIdx).toBeLessThan(detailIdx);
  });

  test('export returns CSV and writes one audit entry', async () => {
    const rows = [{
      first_name: '=cmd|"/c calc"!A0', last_name: 'Attacker', email: 'x@example.com',
      phone: '555-0100', package_selected: 'launch', operating_country: 'US',
      operating_state: 'CA', urgency: 'asap', status: 'pending',
      created_at: '2026-10-01T00:00:00.000Z',
    }];
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM consulting_requests/.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app)
      .get('/api/consulting/business-launch/requests/export?status=pending')
      .set(headers())
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('"Name","Email","Phone","Package","Country","State","Urgency","Status","Submitted"');
    expect(lines).toHaveLength(2);
    // Formula-injection neutralization: leading = is prefixed with a single quote
    expect(lines[1]).toMatch(/^"'=cmd/);
    // The PII payload must not contain anything from outside the export columns
    expect(lines[1]).not.toMatch(/calc"!A0",/);
    const exports = auditInserts().filter((a) => a.action === 'business_launch_export');
    expect(exports).toHaveLength(1);
    const afterState = mockQuery.mock.calls
      .find((c) => /INSERT INTO admin_audit_log/.test(c[0]) && c[1][1] === 'business_launch_export')[1][9];
    expect(JSON.parse(afterState).rowCount).toBe(1);
  });
});

// ── ADM-211 ──────────────────────────────────────────────────────────────
describe('ADM-211: license mutations are audited', () => {
  test('create writes a license_create audit entry', async () => {
    const created = { id: 5, name: 'CPA', category: 'finance', is_active: true };
    mockQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO licenses_lookup/.test(sql)) return { rows: [created], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await request(app)
      .post('/api/admin/licenses-lookup')
      .set(headers())
      .send({ name: 'CPA', category: 'finance' })
      .expect(201);
    const audits = auditInserts().filter((a) => a.action === 'license_create');
    expect(audits).toHaveLength(1);
    expect(audits[0].targetKey).toBe('5');
  });

  test('update writes license_update with before/after', async () => {
    const before = { id: 5, name: 'CPA', category: 'finance', is_active: true };
    const after = { id: 5, name: 'CPA License', category: 'finance', is_active: true };
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, category, is_active FROM licenses_lookup/.test(sql)) return { rows: [before], rowCount: 1 };
      if (/UPDATE licenses_lookup/.test(sql)) return { rows: [after], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await request(app)
      .put('/api/admin/licenses-lookup/5')
      .set(headers())
      .send({ name: 'CPA License' })
      .expect(200);
    const call = mockQuery.mock.calls.find((c) => /INSERT INTO admin_audit_log/.test(c[0]) && c[1][1] === 'license_update');
    expect(call).toBeDefined();
    expect(JSON.parse(call[1][8]).name).toBe('CPA');
    expect(JSON.parse(call[1][9]).name).toBe('CPA License');
  });

  test('soft delete writes license_soft_delete with before-state', async () => {
    const before = { id: 5, name: 'CPA', category: 'finance', is_active: true };
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, category, is_active FROM licenses_lookup/.test(sql)) return { rows: [before], rowCount: 1 };
      if (/UPDATE licenses_lookup SET is_active = false/.test(sql)) return { rows: [{ id: 5 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await request(app)
      .delete('/api/admin/licenses-lookup/5')
      .set(headers())
      .expect(200);
    const audits = auditInserts().filter((a) => a.action === 'license_soft_delete');
    expect(audits).toHaveLength(1);
  });

  test('hard delete writes license_hard_delete', async () => {
    const before = { id: 5, name: 'CPA', category: 'finance', is_active: true };
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT id, name, category, is_active FROM licenses_lookup/.test(sql)) return { rows: [before], rowCount: 1 };
      if (/DELETE FROM licenses_lookup/.test(sql)) return { rows: [{ id: 5 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await request(app)
      .delete('/api/admin/licenses-lookup/5?hard=true')
      .set({ ...headers(), 'x-test-super': '1' })
      .expect(200);
    const audits = auditInserts().filter((a) => a.action === 'license_hard_delete');
    expect(audits).toHaveLength(1);
  });
});
