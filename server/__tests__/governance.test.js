'use strict';

/**
 * M5 — Market Governance workspace.
 *
 * Failing reproduction: there is no governed registry for marketplace
 * policies or executed contracts. Policy text and vendor agreements live
 * outside any versioned, audited store, so nobody can answer "which policy
 * version was in force on date X" or "which contracts are expiring".
 *
 * The contract we need:
 *   1. policy_rules: code (unique slug) + title + category + body, with a
 *      version that bumps on every edit and a draft/active/retired
 *      lifecycle. Duplicate codes fail with 409.
 *   2. contracts: counterparty + type + title + signed/expiry dates +
 *      status lifecycle. expires_at before signed_at fails with 400.
 *   3. Every mutation writes an admin audit row.
 *   4. E13 service gains listInvestigationAccessGrants({requesterId?,
 *      status?}) bounded at 100 rows for the governance UI.
 */

const { mockQuery, resetMocks } = require('./setup');

const governanceCtrl = require('../controllers/governanceController');
const {
  listInvestigationAccessGrants,
} = require('../services/investigationAccessService');

beforeEach(() => {
  resetMocks();
});

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq(overrides = {}) {
  return { user: { id: 'super-admin-1' }, params: {}, query: {}, body: {}, ...overrides };
}

function policyRow(overrides = {}) {
  return {
    id: 1,
    code: 'fraud-zero-tolerance',
    title: 'Zero tolerance for fraud',
    category: 'trust-safety',
    body: 'Fraud on the marketplace is not tolerated.',
    version: 1,
    status: 'draft',
    effective_from: null,
    created_by: 'super-admin-1',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function contractRow(overrides = {}) {
  return {
    id: 7,
    counterparty: 'Acme Background Checks LLC',
    contract_type: 'vendor',
    title: 'Background check services agreement',
    signed_at: '2026-01-15',
    expires_at: '2027-01-15',
    status: 'active',
    storage_ref: 's3://contracts/acme-2026.pdf',
    notes: null,
    created_by: 'super-admin-1',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('governance policies', () => {
  test('createPolicy returns 201 and audit-logs the creation', async () => {
    const row = policyRow();
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO policy_rules')) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 }; // audit insert
    });

    const res = mockRes();
    await governanceCtrl.createPolicy(mockReq({
      body: {
        code: 'fraud-zero-tolerance',
        title: 'Zero tolerance for fraud',
        category: 'trust-safety',
        body: 'Fraud on the marketplace is not tolerated.',
      },
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ policy: row });
    // Audit row written (second INSERT goes to admin_audit_log).
    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('admin_audit_log'));
    expect(auditCall).toBeDefined();
    expect(auditCall[1][1]).toBe('policy_rule_created');
  });

  test('createPolicy rejects a duplicate code with 409', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO policy_rules')) {
        const err = new Error('duplicate key value violates unique constraint "policy_rules_code_key"');
        err.code = '23505';
        throw err;
      }
      return { rows: [], rowCount: 0 };
    });

    const res = mockRes();
    await governanceCtrl.createPolicy(mockReq({
      body: {
        code: 'fraud-zero-tolerance',
        title: 'Duplicate',
        category: 'trust-safety',
        body: 'Some body text.',
      },
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'policy_code_duplicate' });
  });

  test('createPolicy rejects a non-slug code with 400', async () => {
    const res = mockRes();
    await governanceCtrl.createPolicy(mockReq({
      body: { code: 'Not A Slug!', title: 'T', category: 'c', body: 'body text here' },
    }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createPolicy rejects missing required fields with 400', async () => {
    const res = mockRes();
    await governanceCtrl.createPolicy(mockReq({
      body: { code: 'valid-slug', title: '', category: 'c', body: 'x' },
    }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('updatePolicy bumps the version and returns 200', async () => {
    const row = policyRow({ version: 2 });
    let sawVersionBump = false;
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('UPDATE policy_rules')) {
        sawVersionBump = sql.includes('version = version + 1');
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = mockRes();
    await governanceCtrl.updatePolicy(mockReq({
      params: { id: '1' },
      body: { title: 'Updated title', status: 'active' },
    }), res, jest.fn());

    expect(sawVersionBump).toBe(true);
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ policy: row });
  });

  test('updatePolicy rejects an invalid status with 400', async () => {
    const res = mockRes();
    await governanceCtrl.updatePolicy(mockReq({
      params: { id: '1' },
      body: { status: 'archived' },
    }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('updatePolicy on an unknown id returns 404', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = mockRes();
    await governanceCtrl.updatePolicy(mockReq({
      params: { id: '999' },
      body: { title: 'New title' },
    }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('retirePolicy moves the policy to retired', async () => {
    const row = policyRow({ status: 'retired', version: 2 });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('UPDATE policy_rules')) {
        expect(sql).toMatch(/'retired'/);
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = mockRes();
    await governanceCtrl.retirePolicy(mockReq({ params: { id: '1' } }), res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ policy: row });
  });

  test('listPolicies returns the registry', async () => {
    const rows = [policyRow(), policyRow({ id: 2, code: 'other-policy' })];
    mockQuery.mockResolvedValue({ rows, rowCount: 2 });
    const res = mockRes();
    await governanceCtrl.listPolicies(mockReq(), res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ policies: rows });
  });
});

describe('governance contracts', () => {
  test('createContract returns 201 and audit-logs the creation', async () => {
    const row = contractRow();
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO contracts')) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = mockRes();
    await governanceCtrl.createContract(mockReq({
      body: {
        counterparty: 'Acme Background Checks LLC',
        contract_type: 'vendor',
        title: 'Background check services agreement',
        signed_at: '2026-01-15',
        expires_at: '2027-01-15',
      },
    }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ contract: row });
    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('admin_audit_log'));
    expect(auditCall).toBeDefined();
    expect(auditCall[1][1]).toBe('contract_created');
  });

  test('createContract with expires_at before signed_at fails with 400', async () => {
    const res = mockRes();
    await governanceCtrl.createContract(mockReq({
      body: {
        counterparty: 'Acme LLC',
        contract_type: 'vendor',
        title: 'Bad dates',
        signed_at: '2026-06-01',
        expires_at: '2026-01-01',
      },
    }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('updateContract with expires_at before signed_at fails with 400', async () => {
    const res = mockRes();
    await governanceCtrl.updateContract(mockReq({
      params: { id: '7' },
      body: { signed_at: '2026-06-01', expires_at: '2026-01-01' },
    }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('terminateContract moves the contract to terminated', async () => {
    const row = contractRow({ status: 'terminated' });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('UPDATE contracts')) {
        expect(sql).toMatch(/'terminated'/);
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = mockRes();
    await governanceCtrl.terminateContract(mockReq({
      params: { id: '7' },
      body: { reason: 'Vendor failed SLA three quarters in a row.' },
    }), res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ contract: row });
  });

  test('terminateContract on an unknown id returns 404', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = mockRes();
    await governanceCtrl.terminateContract(mockReq({ params: { id: '999' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('listContracts returns the registry', async () => {
    const rows = [contractRow()];
    mockQuery.mockResolvedValue({ rows, rowCount: 1 });
    const res = mockRes();
    await governanceCtrl.listContracts(mockReq(), res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ contracts: rows });
  });
});

describe('E13 grant listing (service)', () => {
  test('listInvestigationAccessGrants returns rows bounded at 100', async () => {
    const rows = [{ id: 1, status: 'active' }];
    let seenLimit = false;
    mockQuery.mockImplementation(async (sql, params) => {
      seenLimit = /LIMIT 100/.test(sql);
      expect(params).toEqual([]);
      return { rows, rowCount: 1 };
    });

    const result = await listInvestigationAccessGrants({});
    expect(result).toEqual(rows);
    expect(seenLimit).toBe(true);
  });

  test('listInvestigationAccessGrants applies requester and status filters', async () => {
    let captured = null;
    mockQuery.mockImplementation(async (sql, params) => {
      captured = { sql, params };
      return { rows: [], rowCount: 0 };
    });

    await listInvestigationAccessGrants({ requesterId: 'admin-1', status: 'pending' });
    expect(captured.params).toEqual(['admin-1', 'pending']);
    expect(captured.sql).toMatch(/requester_admin_id = \$1/);
    expect(captured.sql).toMatch(/status = \$2/);
  });
});
