/**
 * WS5 — audit-evidence fixes: M16 (dead credit-audit rules), M17 (hash-chain
 * verification job), L6 (audit-table delete guards), H6 (RESTRICT guards),
 * M19a (537 repair), L3 (privacy fail-closed), H7 (dead report endpoint).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATION_624 = fs.readFileSync(
  path.join(__dirname, '../migrations/624_ws5_audit_evidence_guards.sql'),
  'utf8'
);

jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, incident: { id: 'incident-1' } }),
}));

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('migration 624 contains the audit-evidence guards', () => {
  test('M16: dead DO INSTEAD NOTHING rules are dropped', () => {
    expect(MIGRATION_624).toMatch(/DROP\s+RULE\s+IF\s+EXISTS\s+\w*credit_audit_no_update/i);
    expect(MIGRATION_624).toMatch(/DROP\s+RULE\s+IF\s+EXISTS\s+\w*credit_audit_no_delete/i);
    expect(MIGRATION_624).toMatch(/oxsteed_credit_audit_events/i);
  });

  test('H6/M15: CASCADE audit evidence FKs become RESTRICT', () => {
    ['business_audit_log', 'restaurant_inventory_audit_events', 'food_customer_wallet_operator_audit_events'].forEach((t) => {
      expect(MIGRATION_624).toMatch(new RegExp(`${t}[\\s\\S]{0,600}ON DELETE RESTRICT`));
    });
    // M15: legal document holds
    expect(MIGRATION_624).toMatch(/legal_compliance_holds[\s\S]{0,600}ON DELETE RESTRICT/);
  });

  test('L6: DELETE against admin audit tables raises instead of being swallowed', () => {
    expect(MIGRATION_624).toMatch(/admin_audit_log_no_delete/i);
    expect(MIGRATION_624).toMatch(/admin_user_action_log_no_delete/i);
    expect(MIGRATION_624).toMatch(/append-only; DELETE is not permitted/i);
  });

  test('L6: TRUNCATE is revoked from the current role where possible', () => {
    expect(MIGRATION_624).toMatch(/REVOKE\s+TRUNCATE\s+ON\s+%I\s+FROM\s+PUBLIC/i);
  });

  test('H7: dead compliance_audit_log table is dropped', () => {
    expect(MIGRATION_624).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+compliance_audit_log/i);
  });

  test('M19a: idempotent 537 end-state repair without editing 537', () => {
    expect(MIGRATION_624).toMatch(/booking_requests_requester_check/);
    expect(MIGRATION_624).toMatch(/counter_proposed/);
    expect(MIGRATION_624).toMatch(/WHERE filename = '537_chat_booking_requests\.sql'/);
    expect(MIGRATION_624).toMatch(/SET status = 'applied'/);
  });

  test('M19c: seed user hash rotated to an unverifiable value', () => {
    expect(MIGRATION_624).toMatch(/00000000-0000-4000-8000-000000000001/);
    expect(MIGRATION_624).toMatch(/'!'/);
  });
});

describe('M17: admin audit hash-chain verification job', () => {
  beforeEach(() => {
    Pool.mockQuery.mockReset();
  });

  test('broken chain records a critical incident', async () => {
    const incidentStore = require('../services/incidentStore');

    Pool.mockQuery.mockResolvedValueOnce({
      rows: [{ valid: false, checked_count: 1000, broken_count: 3, first_broken_id: 42, first_broken_sequence: 7 }],
    });

    const { runAdminAuditChainVerification } = require('../jobs/adminAuditChainVerification');
    const result = await runAdminAuditChainVerification();

    expect(result.ok).toBe(false);
    expect(result.brokenCount).toBe(3);
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'admin_audit_chain_integrity_failure',
        severity: 'critical',
        details: expect.objectContaining({ firstBrokenId: 42 }),
      })
    );
  });

  test('healthy chain records no incident', async () => {
    const incidentStore = require('../services/incidentStore');
    incidentStore.recordIncident.mockClear();

    Pool.mockQuery.mockResolvedValueOnce({
      rows: [{ valid: true, checked_count: 1000, broken_count: 0, first_broken_id: null, first_broken_sequence: null }],
    });

    const { runAdminAuditChainVerification } = require('../jobs/adminAuditChainVerification');
    const result = await runAdminAuditChainVerification();

    expect(result.ok).toBe(true);
    expect(incidentStore.recordIncident).not.toHaveBeenCalled();
  });
});

describe('L6: audit tables raise on DELETE (contract documented)', () => {
  test('admin_audit_log guard trigger blocks DELETE with an evidence message', () => {
    expect(MIGRATION_624).toMatch(/append-only; DELETE is not permitted/i);
  });
});

describe('L3: privacy export verification fails closed', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../routes/privacy.js'),
    'utf8'
  );

  test('no hardcoded fallback secret remains', () => {
    expect(routeSource).not.toContain('export-verification-secret');
    expect(routeSource).toContain('getExportVerificationSecret');
  });
});

describe('H7: dead compliance report endpoint is gone', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../controllers/monitoringController.js'),
    'utf8'
  );
  const routesSource = fs.readFileSync(
    path.join(__dirname, '../routes/monitoring.js'),
    'utf8'
  );

  test('getComplianceReport is removed from the controller', () => {
    expect(controllerSource).not.toContain('exports.getComplianceReport');
  });

  test('/compliance-report route is removed', () => {
    expect(routesSource).not.toMatch(/router\.(get|post)\(\s*['"]\/compliance-report['"]/);
  });

  test('getAuditTrail reads the real admin_audit_log', () => {
    expect(controllerSource).toMatch(/FROM admin_audit_log/);
  });
});

describe('M18: swallowed refund-audit failure is loud', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../controllers/superAdminController.js'),
    'utf8'
  );

  test('issueManualRefund logs loudly instead of catch (e) {}', () => {
    expect(source).toMatch(/manual_refund_issued audit write failed AFTER refund issued/);
    // the exact old swallowed pattern next to the success response is gone
    expect(source).not.toContain(
      "catch (e) {}\n    res.json({ message: `Refund issued successfully.`"
    );
  });
});

describe('H6: scheduledDeletionJob fails closed on RESTRICT violations', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../jobs/scheduledDeletionJob.js'),
    'utf8'
  );

  test('23503 during hard delete is logged as retained-for-audit-evidence', () => {
    expect(source).toMatch(/retained for audit evidence \(archive-then-delete required\)/);
    expect(source).toMatch(/err\.code === '23503'|err && err\.code/);
  });
});
