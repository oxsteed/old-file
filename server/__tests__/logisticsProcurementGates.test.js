'use strict';

/**
 * Logistics procurement gates (auth-audit finding 21).
 *
 * Lane pricing, trade rules, supplier onboarding/approval, and purchase
 * orders move real money; the hard-coded admin-role check let every admin
 * approve spend. Regular admins now need the 'logistics.procurement'
 * grant (super-admins bypass), and money-releasing PO transitions need a
 * fresh TOTP step-up.
 */

const { resetMocks } = require('./setup');

jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return { ...actual, hasGlobalGrant: jest.fn() };
});
jest.mock('../middleware/requireFreshAuth', () => ({
  requireFreshAuth: jest.fn((purpose) => (req, _res, next) => {
    req._freshAuthPurpose = purpose;
    next();
  }),
}));

const { hasGlobalGrant } = require('../middleware/adminAuth');
const router = require('../routes/logisticsAdmin');
const { requireLogisticsProcurement, requirePoMoneyStepUp } = router._procurementGates;

function run(mw, req) {
  return new Promise((resolve) => {
    const res = {};
    mw(req, res, (err) => resolve({ err, req }));
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 21: requireLogisticsProcurement', () => {
  test('super_admin bypasses the grant', async () => {
    hasGlobalGrant.mockResolvedValue(false);
    const { err } = await run(requireLogisticsProcurement, { user: { id: 's1', role: 'super_admin' } });
    expect(err).toBeUndefined();
  });

  test('regular admin with the grant passes', async () => {
    hasGlobalGrant.mockResolvedValue(true);
    const { err } = await run(requireLogisticsProcurement, { user: { id: 'a1', role: 'admin' } });
    expect(err).toBeUndefined();
    expect(hasGlobalGrant).toHaveBeenCalledWith('a1', 'logistics.procurement');
  });

  test('regular admin without the grant is 403 (fail closed)', async () => {
    hasGlobalGrant.mockResolvedValue(false);
    const { err } = await run(requireLogisticsProcurement, { user: { id: 'a2', role: 'admin' } });
    expect(err).toMatchObject({ status: 403, code: 'logistics_procurement_forbidden' });
  });

  test('unauthenticated callers are 403', async () => {
    hasGlobalGrant.mockResolvedValue(false);
    const { err } = await run(requireLogisticsProcurement, {});
    expect(err).toMatchObject({ status: 403 });
  });
});

describe('finding 21: requirePoMoneyStepUp', () => {
  test.each(['approved', 'placed_with_supplier', 'APPROVED'])(
    'money-releasing target %s demands fresh auth',
    async (status) => {
      const { err, req } = await run(requirePoMoneyStepUp, { body: { status } });
      expect(err).toBeUndefined();
      expect(req._freshAuthPurpose).toBe('logistics_po_approve');
    }
  );

  test.each(['draft', 'cancelled', 'received', ''])(
    'non-releasing target %s keeps the session gate only',
    async (status) => {
      const { err, req } = await run(requirePoMoneyStepUp, { body: { status } });
      expect(err).toBeUndefined();
      expect(req._freshAuthPurpose).toBeUndefined();
    }
  );
});
