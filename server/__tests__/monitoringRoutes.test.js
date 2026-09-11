'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');

jest.mock('../services/backupMonitor', () => ({
  getStatus: jest.fn(),
  getComplianceStats: jest.fn(),
}));

const monitoringRoutes = require('../routes/monitoring');

const ADMIN_ID = '00000000-0000-4000-8000-000000000990';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/monitoring', monitoringRoutes);
  app.use(errorHandler);
  return app;
}

function adminAuthHeader() {
  const { accessToken } = generateTokens({
    id: ADMIN_ID,
    email: 'admin@example.com',
    role: 'super_admin',
  });
  return `Bearer ${accessToken}`;
}

beforeEach(() => resetMocks());

describe('monitoring routes', () => {
  test('reports safe security posture signals without returning secret values', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 2, enabled: 2 }] });

    const res = await request(buildApp())
      .get('/api/monitoring/security-posture')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      checks: {
        jwtSecret: { status: 'healthy' },
        encryptionKey: { status: 'healthy' },
        adminMfa: { status: 'healthy', total: 2, enabled: 2, missing: 0 },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(process.env.JWT_SECRET);
    expect(JSON.stringify(res.body)).not.toContain(process.env.ENCRYPTION_KEY);
  });

  test('warns when an active admin has not enrolled in MFA', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ total: 3, enabled: 2 }] });

    const res = await request(buildApp())
      .get('/api/monitoring/security-posture')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'warning',
      checks: { adminMfa: { status: 'warning', total: 3, enabled: 2, missing: 1 } },
    });
  });

  test('reports upload scanning policy without exposing scanner configuration', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] });

    const res = await request(buildApp())
      .get('/api/monitoring/upload-security')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: 'static',
      configured: false,
      required: false,
      mode: 'static_validation_only',
      health: { status: 'not_configured', provider: 'static' },
    });
    expect(res.body).not.toHaveProperty('host');
  });

  test('reports a healthy tamper-evident audit chain', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{
        valid: true,
        checked_count: '12',
        broken_count: '0',
        first_broken_id: null,
        first_broken_sequence: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ entry_hash: 'a'.repeat(64), created_at: '2026-09-11T00:00:00.000Z' }] });

    const res = await request(buildApp())
      .get('/api/monitoring/audit-integrity')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      checkedCount: 12,
      brokenCount: 0,
      chainHead: { entry_hash: 'a'.repeat(64) },
    });
    expect(mockQuery.mock.calls.some(([sql]) => /verify_admin_audit_hash_chain/.test(sql))).toBe(true);
  });

  test('raises an integrity failure without exposing audit row contents', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{
        valid: false,
        checked_count: '12',
        broken_count: '1',
        first_broken_id: '99',
        first_broken_sequence: '7',
      }] })
      .mockResolvedValueOnce({ rows: [{ entry_hash: 'b'.repeat(64), created_at: '2026-09-11T00:00:00.000Z' }] });

    const res = await request(buildApp())
      .get('/api/monitoring/audit-integrity')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'integrity_failure',
      checkedCount: 12,
      brokenCount: 1,
      firstBrokenId: '99',
      firstBrokenSequence: 7,
    });
    expect(res.body).not.toHaveProperty('events');
  });

  test('includes durable incident alerts alongside runtime security events', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{
        id: 42,
        type: 'FAILED_LOGIN_SPIKE',
        severity: 'warning',
        message: '101 failed login attempts detected',
        details: { source: 'monitor' },
        occurrence_count: 3,
        created_at: '2026-09-11T00:00:00.000Z',
        last_seen_at: '2026-09-11T00:05:00.000Z',
        acknowledged_at: null,
        resolved_at: null,
      }] });

    const res = await request(buildApp())
      .get('/api/monitoring/security-events?hours=6')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      durableIncidents: 1,
      totalEvents: 1,
      summary: { warningCount: 1 },
      byType: {
        warning: [{
          id: 42,
          source: 'durable',
          occurrenceCount: 3,
          acknowledgedAt: null,
        }],
      },
    });
    expect(mockQuery.mock.calls.some(([sql, params]) => /FROM incident_log/.test(sql) && params[0] === 6)).toBe(true);
  });

  test('acknowledges an open incident and audits the action', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{
        id: 42,
        type: 'HIGH_ERROR_RATE',
        severity: 'critical',
        message: 'Error rate is high',
        occurrence_count: 1,
        created_at: '2026-09-11T00:00:00.000Z',
        last_seen_at: '2026-09-11T00:00:00.000Z',
        acknowledged_at: '2026-09-11T00:10:00.000Z',
        acknowledged_by: ADMIN_ID,
        resolved_at: null,
      }] });

    const res = await request(buildApp())
      .post('/api/monitoring/incidents/42/acknowledge')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, incident: { id: 42, acknowledged_by: ADMIN_ID } });
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE incident_log/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO admin_audit_log/.test(sql))).toBe(true);
  });

  test('rejects malformed incident ids before touching incident storage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] });

    const res = await request(buildApp())
      .post('/api/monitoring/incidents/not-an-id/resolve')
      .set('Authorization', adminAuthHeader())
      .send({ resolutionNotes: 'not used' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Validation failed' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
