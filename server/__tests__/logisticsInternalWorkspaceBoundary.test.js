'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/logisticsAuditService', () => ({
  logLogisticsAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../middleware/requireLogisticsAccess', () => ({
  resolveLogisticsRole: jest.fn().mockResolvedValue('compliance_reviewer'),
  countryOnFile: jest.fn(),
}));

const {
  requireAnyInternalLogisticsWorkspace,
} = require('../middleware/requireInternalLogisticsWorkspace');
const complianceController = require('../controllers/logisticsComplianceController');
const { logLogisticsAction } = require('../services/logisticsAuditService');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function run(middleware, req) {
  const res = response();
  return new Promise((resolve) => {
    const finish = (error) => resolve({ error, req, res });
    res.json.mockImplementation(() => { finish(); return res; });
    middleware(req, res, finish);
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('internal workspace read boundary', () => {
  test('operations staff can use a shared read-only operations/compliance surface', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      user_id: 'ops-1', operations_enabled: true, compliance_enabled: false,
      admin_portal_enabled: false, is_active: true,
    }] });

    const result = await run(
      requireAnyInternalLogisticsWorkspace('operations', 'compliance'),
      { user: {
        id: 'ops-1', role: 'employee', logistics_role: 'logistics_coordinator',
        internal_access_route: 'operations',
      } }
    );

    expect(result.error).toBeUndefined();
    expect(result.req.internalWorkspace).toBe('operations');
    expect(result.req.internalAccessRecord.operations_enabled).toBe(true);
  });

  test('operations staff cannot use the compliance approval workspace', async () => {
    const result = await run(
      requireAnyInternalLogisticsWorkspace('compliance'),
      { user: {
        id: 'ops-1', role: 'employee', logistics_role: 'logistics_coordinator',
        internal_access_route: 'operations',
      } }
    );

    expect(result.error).toBeUndefined();
    expect(result.res.status).toHaveBeenCalledWith(403);
    expect(result.res.json).toHaveBeenCalledWith({ error: 'Internal workspace access required.' });
  });
});

describe('restricted purchase-order compliance audit', () => {
  const req = {
    user: { id: 'reviewer-1' },
    params: { id: '41' },
    body: { decision: 'approve', notes: 'Documents verified.' },
    ip: '203.0.113.10',
  };

  test('records before/after states and the approving staff identity', async () => {
    const before = {
      id: 41, status: 'awaiting_deposit', lane_id: 9,
      risk_tier: 'restricted', approved_by: null,
    };
    const after = {
      ...before, status: 'approved', approved_by: 'reviewer-1',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [after] });
    const res = response();

    await complianceController.approveRestrictedPO(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, data: after });
    expect(logLogisticsAction).toHaveBeenCalledWith('purchase_order', 41, 'compliance_approve', expect.objectContaining({
      actorUserId: 'reviewer-1',
      beforeState: before,
      afterState: after,
      ipAddress: '203.0.113.10',
    }));
  });

  test('does not let compliance staff approve an unrestricted order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 41, risk_tier: 'low' }] });
    const next = jest.fn();

    await complianceController.approveRestrictedPO(req, response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 409,
      code: 'compliance_approval_not_required',
    }));
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(logLogisticsAction).not.toHaveBeenCalled();
  });
});

