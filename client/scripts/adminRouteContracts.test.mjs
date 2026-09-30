import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_ROUTE_MANIFEST } from '../src/admin/adminRouteManifest.js';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('admin support deep links use the registered inbox route', () => {
  const app = read('src/admin/AdminApp.jsx');
  const dashboard = read('src/admin/pages/super/Dashboard.jsx');
  const userDetail = read('src/admin/pages/super/UserDetail.jsx');

  assert.match(app, /path=\{adminRoute\('support'\)\.relative\}\s+element=\{<SupportTickets \/>\}/);
  assert.doesNotMatch(app, /path="support\/tickets"/);
  assert.match(dashboard, /to: '\/admin\/support'/);
  assert.doesNotMatch(dashboard, /to: '\/admin\/support\/tickets'/);
  assert.match(userDetail, /\/admin\/support\?ticket=/);
  assert.doesNotMatch(userDetail, /\/admin\/support\/tickets\/\$\{/);
});

test('users dashboard filters honor URL query state', () => {
  const users = read('src/admin/pages/UsersList.jsx');
  assert.match(users, /useSearchParams/);
  for (const key of ['search', 'role', 'status', 'plan', 'location', 'page', 'limit', 'sort', 'order']) {
    assert.match(users, new RegExp(`searchParams\\.get\\('${key}'\\)`));
  }
  assert.match(users, /setSearchParams\(next, \{ replace: true \}\)/);
  assert.match(users, /PAGE_SIZES\.includes\(limit\)/);
  assert.match(users, /SORT_KEYS\.has/);
});

test('navigation does not advertise grant-protected pages without a grant', () => {
  const layout = read('src/admin/layouts/AdminLayout.jsx');
  assert.match(layout, /routePath\('messages'\).*adminNav\.messages/);
  assert.match(layout, /grant: adminRoute\('messages'\)\.grant/);
  assert.match(layout, /routePath\('payments'\).*adminNav\.payments/);
  assert.match(layout, /grant: adminRoute\('payments'\)\.grant/);
  assert.match(layout, /\(!item\.grant \|\| isSuper \|\| myScopes\.includes\(item\.grant\)\)/);
  assert.match(layout, /isSuper \|\| \(item\.grant && myScopes\.includes\(item\.grant\)\)/);
});

test('grant-protected admin pages fail closed on direct navigation too', () => {
  const app = read('src/admin/AdminApp.jsx');
  assert.match(
    app,
    /path=\{adminRoute\('messages'\)\.relative\}\s+element=\{\s*<GrantGuard grant=\{adminRoute\('messages'\)\.grant\}><AdminMessages \/><\/GrantGuard>/s,
  );
  assert.match(
    app,
    /path=\{adminRoute\('payments'\)\.relative\}\s+element=\{\s*<GrantGuard grant=\{adminRoute\('payments'\)\.grant\}><PaymentsList \/><\/GrantGuard>/s,
  );
});

test('client grant contracts remain aligned with server authorization middleware', () => {
  const routes = read('../server/routes/admin.js');
  const contracts = [
    ['/messages/conversations', 'message_users'],
    ['/payments', 'view_financials'],
    ['/financials', 'view_financials'],
    ['/payouts', 'view_financials'],
    ['/super/money', 'view_financials'],
    ['/super/revenue', 'view_financials'],
    ['/settings', 'manage_settings'],
    ['/audit-log', 'view_audit_log'],
    ['/super/audit-log/user-actions', 'view_audit_log'],
    ['/super/admin-accounts', 'manage_admin_accounts'],
  ];

  for (const [route, grant] of contracts) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `router\\.(?:get|post|put|patch|delete)\\(\\s*['"]${escapedRoute}(?:['"]|/)` +
      `[\\s\\S]{0,220}?requirePermission\\(['"]${grant}['"]\\)`,
    );
    assert.match(routes, pattern, `${route} must enforce ${grant} on the server`);
  }
});

test('every static admin navigation destination resolves to a registered route', () => {
  const app = read('src/admin/AdminApp.jsx');
  const routePaths = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, path]) => path));
  for (const [, key] of app.matchAll(/<Route\s+path=\{adminRoute\('([^']+)'\)\.relative\}/g)) {
    routePaths.add(ADMIN_ROUTE_MANIFEST[key].relative);
  }
  for (const [, key] of app.matchAll(/<Route\s+path=\{adminRoute\('([^']+)'\)\.path\}/g)) {
    routePaths.add(ADMIN_ROUTE_MANIFEST[key].relative);
  }
  const navPaths = Object.values(ADMIN_ROUTE_MANIFEST).map(({ path }) => path);
  const externalPaths = new Set(['/direct/admin', '/admin']);

  const matchesRoute = (path) => {
    if (externalPaths.has(path)) return true;
    if (!path.startsWith('/admin/')) return false;
    const relative = path.slice('/admin/'.length);
    return [...routePaths].some((route) => {
      if (route === '*' || route.startsWith('/')) return false;
      const pattern = `^${route
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:[^/]+/g, '[^/]+')}$`;
      return new RegExp(pattern).test(relative);
    });
  };

  for (const path of navPaths) {
    assert.equal(matchesRoute(path), true, `Admin navigation path is not registered: ${path}`);
  }
});

test('admin route manifest has unique paths and AdminApp has no unregistered static paths', () => {
  const app = read('src/admin/AdminApp.jsx');
  const definitions = Object.entries(ADMIN_ROUTE_MANIFEST);
  const paths = definitions.map(([, definition]) => definition.path);
  assert.equal(new Set(paths).size, paths.length, 'admin route paths must be unique');

  const staticPaths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, route]) => route);
  assert.deepEqual(staticPaths, ['*'], 'all concrete AdminApp routes must use the manifest');
});

test('operations overview links resolve to real product or admin routes', () => {
  const operations = read('../server/controllers/adminOperationsController.js');
  const adminApp = read('src/admin/AdminApp.jsx');
  const productApp = read('src/App.jsx');
  const adminRoutes = new Set([...adminApp.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, route]) => route));
  const productRoutes = new Set([...productApp.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, route]) => route));
  const linkedRoutes = [...operations.matchAll(/route:\s*['"]([^'"]+)['"]/g)].map(([, route]) => route);

  const matches = (route, registered, prefix) => {
    if (!route.startsWith(prefix)) return false;
    const relative = route.slice(prefix.length);
    return [...registered].some((candidate) => {
      if (candidate === '*' || candidate.startsWith('/')) return false;
      const pattern = `^${candidate
        .replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
        .replace(/:[^/]+/g, '[^/]+')}$`;
      return new RegExp(pattern).test(relative);
    });
  };

  for (const route of linkedRoutes) {
    const registered = route.startsWith('/admin/')
      ? matches(route, adminRoutes, '/admin/')
      : matches(route, productRoutes, '/');
    assert.equal(registered, true, `Operations link is not registered: ${route}`);
  }
});

test('privileged job and user actions are hidden until their grants resolve', () => {
  const jobs = read('src/admin/pages/JobsList.jsx');
  const detail = read('src/admin/pages/JobDetail.jsx');
  const users = read('src/admin/pages/UsersList.jsx');

  assert.match(jobs, /useHasGrant\('export_data'\)/);
  assert.match(jobs, /useHasGrant\('delete_jobs'\)/);
  assert.match(detail, /useHasGrant\('issue_refunds'\)/);
  assert.match(detail, /useHasGrant\('delete_jobs'\)/);
  assert.match(users, /useHasGrant\('message_users'\)/);
  assert.match(users, /useHasGrant\('export_data'\)/);
});

test('operations command center has a registered route and read-only API contract', () => {
  const app = read('src/admin/AdminApp.jsx');
  const layout = read('src/admin/layouts/AdminLayout.jsx');
  const page = read('src/admin/pages/OperationsOverview.jsx');

  assert.match(app, /path=\{adminRoute\('operations'\)\.relative\}\s+element=\{<OperationsOverview \/>\}/);
  assert.match(layout, /to: routePath\('operations'\)/);
  assert.match(page, /\/admin\/operations\/overview/);
  assert.match(page, /read-only|Read-only/i);
  assert.match(page, /permissionRequired/);
  assert.match(page, /section\.route\.startsWith\('\/admin\/'\)/);
  assert.match(page, /30_000/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /clearTimeout/);
  assert.match(page, /<section className=/);
  assert.doesNotMatch(page, /to=\{['"]\/admin\/settings['"]\}/);
  assert.doesNotMatch(page, /manage_credit/);
  assert.match(layout, /aria-expanded=\{sidebarOpen\}/);
  assert.match(layout, /inert=\{!sidebarOpen \? '' : undefined\}/);
});

test('settings routes expose transactional rollback contracts', () => {
  const routes = read('../server/routes/admin.js');
  const controller = read('../server/controllers/superAdminController.js');
  assert.match(routes, /settings\/:key\/rollback.*rollbackSetting/);
  assert.match(routes, /feature-flags\/:key\/rollback.*rollbackFeatureFlag/);
  assert.match(controller, /platform_setting_rollback/);
  assert.match(controller, /feature_flag_rollback/);
});

test('sensitive admin exports are rate-limited and non-cacheable', () => {
  const routes = read('../server/routes/admin.js');
  const controller = read('../server/controllers/superAdminController.js');
  assert.match(routes, /router\.get\('\/export\/:type'\s*,\s*requireAdmin\s*,\s*requirePermission\('export_data'\)\s*,\s*strictLimiter\s*,\s*superCtrl\.exportData\)/);
  assert.match(controller, /res\.set\('Cache-Control', 'private, no-store'\)/);
  assert.match(controller, /res\.set\('X-Content-Type-Options', 'nosniff'\)/);
});

test('every manifest route except documented external surfaces is registered in AdminApp', () => {
  const app = read('src/admin/AdminApp.jsx');
  const referenced = new Set([...app.matchAll(/adminRoute\('([^']+)'\)/g)].map(([, key]) => key));
  // directOps (/direct/admin) is a separate product surface with its own
  // audience, intentionally not mounted inside the admin router.
  const intentionallyExternal = new Set(['directOps']);
  const unregistered = Object.keys(ADMIN_ROUTE_MANIFEST).filter(
    (key) => !intentionallyExternal.has(key) && !referenced.has(key),
  );
  assert.deepEqual(unregistered, [], 'manifest routes missing from AdminApp');
  for (const key of intentionallyExternal) {
    assert.equal(ADMIN_ROUTE_MANIFEST[key].audience, 'direct', `${key} must stay a direct-audience route`);
  }
});
