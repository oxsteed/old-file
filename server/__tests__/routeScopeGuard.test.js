'use strict';

/**
 * Route scope guard (scope report Area 4).
 *
 * Enumerates every Express router under server/routes and requires each route
 * whose path carries a tenant id (:businessId, :restaurantId, ...) to run a
 * shared scope gate (requireBusinessAccess, requireRestaurantAccess,
 * requireSupportBusinessAccess, a platform-admin gate, or a domain gate marked
 * with markGate) or an explicit, registered scopeExempt(reason).
 *
 * A new endpoint that forgets scoping fails here. The pending list may only
 * shrink; resource-scoped exemptions are limited to a reviewed list.
 */

require('./setup');
const path = require('path');
const { collectRoutes, tenantRoutes, classify } = require('../scripts/scope/routeInventory');
const { EXEMPT_REASONS } = require('../middleware/scopeGates');
const pending = new Set(require('../scripts/scope/pendingRoutes.json').pending);
const resourceScoped = new Set(require('../scripts/scope/resourceScopedRoutes.json').routes);

const { routes, errors } = collectRoutes();
const tenant = tenantRoutes(routes);
const key = (r) => `${r.file} ${r.methods.join(',')} ${r.path}`;
const AUTH = new Set(['authenticate', 'requireAdmin', 'requireSuperAdmin']);

describe('route scope guard', () => {
  test('every route module with tenant paths loads for inspection', () => {
    // A module the shared jest setup mocks out may fail to load; that is only
    // acceptable when its source declares no tenant-id path at all.
    const fs = require('fs');
    const tenantSource = /:(businessId|restaurantId|bizId|business_id|restaurant_id)\b/;
    const blocking = errors.filter((e) => tenantSource.test(fs.readFileSync(path.join(__dirname, '..', e.file), 'utf8')));
    expect(blocking).toEqual([]);
    expect(tenant.length).toBeGreaterThan(500);
  });

  test('every tenant route is gated, exempt for a registered reason, or still pending', () => {
    const ungated = tenant.filter((r) => classify(r) === 'ungated').map(key);
    const unexpected = ungated.filter((k) => !pending.has(k));
    expect(unexpected).toEqual([]);
  });

  test('the pending list only shrinks (no stale entries)', () => {
    const ungated = new Set(tenant.filter((r) => classify(r) === 'ungated').map(key));
    const stale = [...pending].filter((k) => !ungated.has(k));
    expect(stale).toEqual([]);
  });

  test('exemptions use registered reasons; resource-scoped only where reviewed', () => {
    const problems = [];
    for (const r of tenant) {
      for (const g of r.gates.filter((x) => x.kind === 'exempt')) {
        if (!EXEMPT_REASONS[g.detail]) problems.push(`${key(r)} unknown reason ${g.detail}`);
        if (g.detail === 'resource-scoped' && !resourceScoped.has(key(r))) problems.push(`${key(r)} not in resourceScopedRoutes.json`);
      }
    }
    const used = new Set(tenant.filter((r) => r.gates.some((g) => g.detail === 'resource-scoped')).map(key));
    for (const k of resourceScoped) if (!used.has(k)) problems.push(`stale resource-scoped entry ${k}`);
    expect(problems).toEqual([]);
  });

  test('user-session gates run after authentication', () => {
    const problems = [];
    for (const r of tenant) {
      const idx = r.middleware.findIndex((fn) => fn.scopeGate && ['business', 'restaurant', 'support-business'].includes(fn.scopeGate.kind));
      if (idx < 0) continue;
      const before = r.middleware.slice(0, idx).map((fn) => fn.name);
      if (!before.some((n) => AUTH.has(n))) problems.push(key(r));
    }
    expect(problems).toEqual([]);
  });

  test('the gate runs before the final handler, never after it', () => {
    const problems = tenant.filter((r) => r.handler && r.handler.scopeGate && r.handler.scopeGate.kind !== 'exempt').map(key);
    expect(problems).toEqual([]);
  });
});

describe('scope gate markers', () => {
  const { scopeExempt, requireRestaurantAccess, requireSupportBusinessAccess } = require('../middleware/scopeGates');
  const requireBusinessAccess = require('../middleware/requireBusinessAccess');

  test('unknown exemption reasons are rejected at load time', () => {
    expect(() => scopeExempt('because')).toThrow(/unknown reason/);
  });

  test('gates carry their kind', () => {
    expect(requireBusinessAccess.manager().scopeGate).toEqual({ kind: 'business', detail: 'manager' });
    expect(requireRestaurantAccess().scopeGate.kind).toBe('restaurant');
    expect(requireSupportBusinessAccess('manage').scopeGate.kind).toBe('support-business');
    expect(() => requireSupportBusinessAccess('everything')).toThrow();
  });

  test('inventory paths are relative to server/', () => {
    expect(path.isAbsolute(tenant[0].file)).toBe(false);
  });
});
