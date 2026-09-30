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

test('manifest parses to 115 routes with unique paths', () => {
  const entries = parseManifest();
  assert.equal(entries.length, 115);
  const paths = entries.map((e) => e.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate manifest paths');
});

test('requiredCredential resolves exactly one credential per route', () => {
  const entries = parseManifest();
  const creds = entries.map(requiredCredential);
  assert.ok(creds.every(Boolean));
  assert.equal(creds.filter((c) => c === 'anonymous').length, 1);
  const login = entries.find((e) => e.path === '/admin/login');
  assert.equal(requiredCredential(login), 'anonymous');
  const direct = entries.find((e) => e.key === 'directOps');
  assert.equal(requiredCredential(direct), 'direct-staff');
  const superRoute = entries.find((e) => e.key === 'superDashboard');
  assert.equal(requiredCredential(superRoute), 'super_admin');
  const grantRoute = entries.find((e) => e.key === 'money');
  assert.equal(requiredCredential(grantRoute), 'admin+grant:view_financials');
  const plain = entries.find((e) => e.key === 'dashboard');
  assert.equal(requiredCredential(plain), 'admin');
});

test('server grants include every manifest grant', () => {
  const serverGrants = collectServerGrants();
  for (const grant of ['view_financials', 'manage_settings', 'manage_admin_accounts', 'view_audit_log', 'message_users']) {
    assert.ok(serverGrants.has(grant), `server never enforces ${grant}`);
    assert.ok(serverGrants.get(grant).size > 0);
  }
});

test('buildMatrix reports no violations on the current tree', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.total, 115);
  assert.deepEqual(matrix.violations, []);
  assert.equal(matrix.byCredential['admin'], 78);
  assert.equal(matrix.byCredential['super_admin'], 20);
  assert.equal(matrix.byCredential['anonymous'], 1);
  assert.equal(matrix.byCredential['direct-staff'], 1);
});

test('renderHuman summarizes credentials and violations', () => {
  const matrix = buildMatrix();
  const text = renderHuman(matrix);
  assert.ok(text.includes('115 routes'));
  assert.ok(text.includes('No violations'));
  const bad = { ...matrix, violations: ['boom'] };
  assert.ok(renderHuman(bad).includes('VIOLATIONS'));
});
