'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseManifest,
  requiredCredential,
  collectServerGrants,
  buildMatrix,
  renderHuman,
} = require('./admin-route-matrix.cjs');

async function canonicalEntries() {
  const { ADMIN_ROUTE_MANIFEST } = await import('../client/src/admin/adminRouteManifest.js');
  return Object.entries(ADMIN_ROUTE_MANIFEST).map(([key, { path, audience, grant, superOnly }]) => ({
    key, path, audience, grant, superOnly,
  }));
}

test('manifest parser covers every canonical route with unique paths', async () => {
  const entries = parseManifest();
  assert.ok(entries.length > 0, 'manifest must not be empty');
  assert.deepEqual(entries, await canonicalEntries(), 'parser must preserve every route and access field');
  const paths = entries.map((e) => e.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate manifest paths');
});

test('requiredCredential resolves exactly one credential per route', () => {
  const entries = parseManifest();
  const creds = entries.map(requiredCredential);
  assert.ok(creds.every(Boolean));
  assert.equal(creds.filter((c) => c === 'anonymous').length, 1);
  // Pin security-sensitive mappings independently of aggregate route counts.
  const contracts = {
    login: 'anonymous',
    directOps: 'direct-staff',
    dashboard: 'admin',
    quoteRequests: 'admin',
    superDashboard: 'super_admin',
    logisticsControl: 'super_admin',
    feeConfig: 'super_admin',
    oxsteedCredit: 'super_admin',
    payments: 'admin+grant:view_financials',
    money: 'admin+grant:view_financials',
    revenue: 'admin+grant:view_financials',
    financials: 'admin+grant:view_financials',
    payouts: 'admin+grant:view_financials',
    reconciliationExceptions: 'admin+grant:view_financials',
    incidents: 'admin+grant:manage_operations',
    messages: 'admin+grant:message_users',
    settings: 'admin+grant:manage_settings',
    adminAccounts: 'admin+grant:manage_admin_accounts',
    permissions: 'admin+grant:manage_admin_accounts',
    auditLog: 'admin+grant:view_audit_log',
    userActionLog: 'admin+grant:view_audit_log',
  };
  for (const [key, credential] of Object.entries(contracts)) {
    const entry = entries.find((e) => e.key === key);
    assert.ok(entry, `missing route contract: ${key}`);
    assert.equal(requiredCredential(entry), credential, `wrong credential for ${key}`);
  }
});

test('credential precedence cannot downgrade super-only routes to grant access', () => {
  const entry = { path: '/admin/super/example', audience: 'admin', grant: 'view_financials', superOnly: true };
  assert.equal(requiredCredential(entry), 'super_admin');
  assert.equal(requiredCredential({ ...entry, audience: 'direct' }), 'direct-staff');
  assert.equal(requiredCredential({ ...entry, path: '/admin/login' }), 'anonymous');
});

test('server grants include every manifest grant', () => {
  const serverGrants = collectServerGrants();
  const grants = new Set(parseManifest().map((entry) => entry.grant).filter(Boolean));
  assert.ok(grants.size > 0, 'manifest must retain permission-protected routes');
  for (const grant of grants) {
    assert.ok(serverGrants.has(grant), `server never enforces ${grant}`);
    assert.ok(serverGrants.get(grant).size > 0);
  }
});

test('buildMatrix reports no violations and derives credential counts from the manifest', async () => {
  const entries = await canonicalEntries();
  const matrix = buildMatrix();
  assert.equal(matrix.total, entries.length);
  assert.equal(matrix.rows.length, entries.length);
  assert.deepEqual(matrix.violations, []);
  // Classify the canonical fields independently of requiredCredential, so a
  // regression in that function cannot silently update the expected counts.
  const adminEntries = entries.filter((entry) => entry.path !== '/admin/login' && entry.audience === 'admin');
  const expectedCounts = {
    anonymous: entries.filter((entry) => entry.path === '/admin/login').length,
    'direct-staff': entries.filter((entry) => entry.path !== '/admin/login' && entry.audience === 'direct').length,
    admin: adminEntries.filter((entry) => !entry.superOnly && !entry.grant).length,
    super_admin: adminEntries.filter((entry) => entry.superOnly).length,
  };
  for (const entry of adminEntries.filter((entry) => !entry.superOnly && entry.grant)) {
    const credential = `admin+grant:${entry.grant}`;
    expectedCounts[credential] = (expectedCounts[credential] || 0) + 1;
  }
  assert.deepEqual(matrix.byCredential, expectedCounts);
  assert.equal(Object.values(matrix.byCredential).reduce((sum, count) => sum + count, 0), entries.length);
  assert.deepEqual(matrix.rows.filter((row) => row.requires === 'anonymous').map((row) => row.path), ['/admin/login']);
});

test('renderHuman summarizes credentials and violations', () => {
  const matrix = buildMatrix();
  const text = renderHuman(matrix);
  assert.ok(text.includes(`${matrix.total} routes`));
  for (const [credential, count] of Object.entries(matrix.byCredential)) {
    assert.ok(text.includes(`  ${credential}: ${count}\n`), `missing credential summary: ${credential}`);
  }
  assert.ok(text.includes('No violations'));
  const bad = { ...matrix, violations: ['boom'] };
  assert.ok(renderHuman(bad).includes('VIOLATIONS'));
});
