'use strict';

/**
 * Domain 6 finding 12: `requireCorporatePermission` was mounted on zero
 * routes. Investigation (2026-11-13) found no intended mount point:
 * no route, controller, or client surface gates a business action on a
 * corporate permission code. The corporate layer is an org-chart /
 * self-administration overlay: its routes are gated by `requireAdmin` +
 * `requirePermission('manage_admin_accounts')`, and its enforcement
 * lives in-controller in corporateRolesController.js (seniority caps,
 * C-suite guard, cannot-grant-what-you-do-not-hold). The middleware
 * was therefore deleted instead of wired to a hypothetical route; the
 * resolver service (corporateRolesService) is untouched.
 *
 * This test pins the deletion so the dead middleware is not silently
 * re-added without a real mount point.
 */
describe('Domain 6 finding 12: unmounted corporate-permission middleware removed', () => {
  test('the middleware module no longer exists', () => {
    expect(() => require.resolve('../middleware/requireCorporatePermission')).toThrow();
  });

  test('the corporate permission resolver service is untouched', () => {
    const svc = require('../services/corporateRolesService');
    expect(typeof svc.getEffectiveCorporatePermissions).toBe('function');
    expect(typeof svc.hasAny).toBe('function');
    expect(typeof svc.hasAll).toBe('function');
  });
});
