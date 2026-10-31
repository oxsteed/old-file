'use strict';

/**
 * Audit item 15: corporate roles cache invalidation across instances.
 *
 * invalidateCache publishes on the same Redis channel as permissionsService
 * ('oxsteed:permissions:invalidate'), and this process's subscriber evicts
 * its own corporate cache on incoming messages. Redis is replaced by a test
 * double (no live Redis in unit tests); the real publish/subscribe code
 * path in corporateRolesService is what runs.
 */

const mockPublish = jest.fn().mockResolvedValue('OK');
const mockMessageHandlers = {};
const mockSubscriber = {
  on: jest.fn((event, handler) => { mockMessageHandlers[event] = handler; }),
  subscribe: jest.fn().mockResolvedValue('OK'),
};
const mockDuplicate = jest.fn(() => mockSubscriber);
const mockRedis = { publish: mockPublish, duplicate: mockDuplicate };

jest.mock('../utils/redis', () => mockRedis);

let mockQuery;
jest.mock('../db', () => ({ query: (...args) => mockQuery(...args) }));

function installQueryMock() {
  mockQuery = jest.fn(async (sql) => {
    if (sql.includes('FROM corporate_assignments')) {
      return { rows: [{ id: 1, department_id: 10 }] };
    }
    if (sql.includes('corporate_department_permissions')) {
      return { rows: [{ code: 'finance.view', allow: true }] };
    }
    if (sql.includes('corporate_assignment_permission_overrides')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function loadService() {
  installQueryMock();
  // Fresh module registry so the bus singletons reset per test.
  jest.resetModules();
  return require('../services/corporateRolesService');
}

function fireBusMessage(payload) {
  const handler = mockMessageHandlers.message;
  expect(handler).toBeDefined();
  handler('oxsteed:permissions:invalidate', JSON.stringify(payload));
}

describe('corporate roles invalidation bus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('invalidateCache publishes the user id on the shared channel and evicts locally', async () => {
    const svc = loadService();
    const first = await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    expect(first.permissions.has('finance.view')).toBe(true);
    const callsAfterSeed = mockQuery.mock.calls.length;
    expect(callsAfterSeed).toBeGreaterThan(0);

    svc.invalidateCache('user-1');
    expect(mockPublish).toHaveBeenCalledWith(
      'oxsteed:permissions:invalidate',
      JSON.stringify({ userId: 'user-1' })
    );

    // Cache miss after eviction: the next read queries the database again.
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    expect(mockQuery.mock.calls.length).toBeGreaterThan(callsAfterSeed);
  });

  test('an incoming bus message for a user evicts that user locally', async () => {
    const svc = loadService();
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    // Initialize the bus (lazy, on first invalidate) without evicting user-1.
    svc.invalidateCache('other-user');
    const callsAfterSeed = mockQuery.mock.calls.length;

    fireBusMessage({ userId: 'user-1' });

    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    expect(mockQuery.mock.calls.length).toBeGreaterThan(callsAfterSeed);
  });

  test('clear-all publishes and honors the corporateClearAll message', async () => {
    const svc = loadService();
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    const callsAfterSeed = mockQuery.mock.calls.length;

    svc.invalidateCache();
    expect(mockPublish).toHaveBeenCalledWith(
      'oxsteed:permissions:invalidate',
      JSON.stringify({ corporateClearAll: true })
    );

    fireBusMessage({ corporateClearAll: true });
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    expect(mockQuery.mock.calls.length).toBeGreaterThan(callsAfterSeed);
  });

  test('a malformed bus message never crashes the subscriber and leaves the cache intact', async () => {
    const svc = loadService();
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    // Initialize the bus (lazy, on first invalidate) without evicting user-1.
    svc.invalidateCache('other-user');
    const callsAfterSeed = mockQuery.mock.calls.length;

    const handler = mockMessageHandlers.message;
    expect(() => handler('oxsteed:permissions:invalidate', 'not-json{')).not.toThrow();

    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    expect(mockQuery.mock.calls.length).toBe(callsAfterSeed);
  });

  test('without Redis, invalidateCache still evicts locally and never throws', async () => {
    jest.resetModules();
    jest.doMock('../utils/redis', () => null);
    installQueryMock();
    const svc = require('../services/corporateRolesService');
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    const callsAfterSeed = mockQuery.mock.calls.length;
    expect(() => svc.invalidateCache('user-1')).not.toThrow();
    await svc.getEffectiveCorporatePermissions({ userId: 'user-1', role: 'employee' });
    expect(mockQuery.mock.calls.length).toBeGreaterThan(callsAfterSeed);
  });
});
