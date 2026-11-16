'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/access/accessService', () => ({ can: jest.fn() }));
jest.mock('../services/access/flags', () => ({ projectionEnabled: jest.fn() }));

const pool = require('../db');
const progressiveAccess = require('../services/access/accessService');
const { projectionEnabled } = require('../services/access/flags');
const { resolveLogisticsRole } = require('../middleware/requireLogisticsAccess');

describe('progressive logistics role derivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    projectionEnabled.mockReturnValue(false);
    progressiveAccess.can.mockResolvedValue({ allowed: false });
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('approved self logistics grant promotes an ordinary customer to organizer', async () => {
    projectionEnabled.mockReturnValue(true);
    progressiveAccess.can.mockResolvedValue({ allowed: true });

    await expect(resolveLogisticsRole({ id: 'customer-1', role: 'customer', default_mode: 'customer' }))
      .resolves.toBe('organizer');
    expect(progressiveAccess.can).toHaveBeenCalledWith('customer-1', 'logistics.ship', { type: 'self' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('pending or revoked logistics access falls back to the ordinary buyer role', async () => {
    projectionEnabled.mockReturnValue(true);

    await expect(resolveLogisticsRole({ id: 'customer-2', role: 'customer', default_mode: 'customer' }))
      .resolves.toBe('individual_buyer');
    expect(progressiveAccess.can).toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM businesses'), ['customer-2']);
  });

  test('stored business buyer role remains authoritative over a personal logistics grant', async () => {
    projectionEnabled.mockReturnValue(true);
    progressiveAccess.can.mockResolvedValue({ allowed: true });

    await expect(resolveLogisticsRole({ id: 'business-buyer-1', role: 'customer', logistics_role: 'business_buyer' }))
      .resolves.toBe('business_buyer');
    expect(progressiveAccess.can).not.toHaveBeenCalled();
  });
});
