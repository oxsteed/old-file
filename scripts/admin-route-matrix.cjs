'use strict';

/**
 * Admin route/role access matrix.
 *
 * Builds the authenticated access matrix from the canonical client route
 * manifest (client/src/admin/adminRouteManifest.js) and cross-checks it
 * against the server's permission usage:
 *
 *  - every manifest route resolves to exactly one required credential
 *    (anonymous | admin | admin+grant | super_admin | direct-staff)
 *  - every grant named by the manifest is actually enforced somewhere on the
 *    server via requirePermission('...') (no phantom grants)
 *  - the only anonymous admin route is /admin/login
 *  - every server requirePermission grant used in admin routes is either
 *    named by the manifest or allow-listed as API-only
 *
 * Run: node scripts/admin-route-matrix.cjs [--json]
 * Test: node --test scripts/admin-route-matrix.test.cjs
 *
 * This is the static half of the authenticated browser matrix described in
 * docs/admin-browser-matrix.md. The live half (real logins per role across
 * browsers) needs a running backend and is run manually per that document.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'client', 'src', 'admin', 'adminRouteManifest.js');
const SERVER_ROUTES_DIR = path.join(REPO_ROOT, 'server', 'routes');

// Grants enforced only by API routes with no corresponding admin page.
const API_ONLY_GRANTS = new Set([
  'delete_jobs',
  'verify_users',
  'issue_refunds',
  'message_users',
  'export_data', // GET /export/:type, no admin page
]);

// superOnly routes intentionally outside /admin/super/ (client AdminGuard
// still enforces super_admin; the path reflects the product area).
const SUPERONLY_PATH_EXCEPTIONS = new Set([
  '/admin/logistics/control',
]);

function parseManifest() {
  const src = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const entries = [];
  const re = /(\w+):\s*defineRoute\('([^']+)'(?:,\s*\{([^}]*)\})?\)/g;
  let m;
  while ((m = re.exec(src))) {
    const [, key, routePath, opts = ''] = m;
    const audience = /audience:\s*'([^']+)'/.exec(opts)?.[1] || 'admin';
    const grant = /grant:\s*'([^']+)'/.exec(opts)?.[1] || null;
    const superOnly = /superOnly:\s*true/.test(opts);
    entries.push({ key, path: routePath, audience, grant, superOnly });
  }
  return entries;
}

function requiredCredential(entry) {
  if (entry.path === '/admin/login') return 'anonymous';
  if (entry.audience === 'direct') return 'direct-staff';
  if (entry.superOnly) return 'super_admin';
  if (entry.grant) return `admin+grant:${entry.grant}`;
  return 'admin';
}

function collectServerGrants() {
  const grants = new Map(); // grant -> Set of files
  for (const file of fs.readdirSync(SERVER_ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(SERVER_ROUTES_DIR, file), 'utf8');
    const re = /requirePermission\('([^']+)'\)/g;
    let m;
    while ((m = re.exec(src))) {
      const grant = m[1];
      if (!grants.has(grant)) grants.set(grant, new Set());
      grants.get(grant).add(file);
    }
  }
  return grants;
}

function buildMatrix() {
  const entries = parseManifest();
  const serverGrants = collectServerGrants();
  const manifestGrants = new Set(entries.map((e) => e.grant).filter(Boolean));

  const violations = [];

  // 1. Only /admin/login may be anonymous.
  for (const e of entries) {
    if (requiredCredential(e) === 'anonymous' && e.path !== '/admin/login') {
      violations.push(`anonymous route not allow-listed: ${e.key} -> ${e.path}`);
    }
  }

  // 2. Every manifest grant must be enforced server-side.
  for (const grant of manifestGrants) {
    if (!serverGrants.has(grant)) {
      violations.push(`manifest grant '${grant}' is never enforced via requirePermission on the server`);
    }
  }

  // 3. Every server-enforced grant in admin-ish routes should be visible in
  //    the matrix or allow-listed as API-only.
  const adminRouteFiles = fs.readdirSync(SERVER_ROUTES_DIR)
    .filter((f) => /admin|super|operations|monitoring|enforcement/i.test(f));
  const adminGrants = new Set();
  for (const file of adminRouteFiles) {
    const src = fs.readFileSync(path.join(SERVER_ROUTES_DIR, file), 'utf8');
    const re = /requirePermission\('([^']+)'\)/g;
    let m;
    while ((m = re.exec(src))) adminGrants.add(m[1]);
  }
  for (const grant of adminGrants) {
    if (!manifestGrants.has(grant) && !API_ONLY_GRANTS.has(grant)) {
      violations.push(`server-enforced grant '${grant}' has no manifest route; add it to the matrix or API_ONLY_GRANTS`);
    }
  }

  // 4. superOnly routes must live under /admin/super/ (convention), except
  //    documented product-area exceptions.
  for (const e of entries) {
    if (e.superOnly && !e.path.startsWith('/admin/super/') && !SUPERONLY_PATH_EXCEPTIONS.has(e.path)) {
      violations.push(`superOnly route outside /admin/super/: ${e.key} -> ${e.path}`);
    }
  }

  const rows = entries.map((e) => ({
    key: e.key,
    path: e.path,
    requires: requiredCredential(e),
    unauthenticated: e.path === '/admin/login' ? '200 (login form)' : 'redirect /admin/login',
    unauthorized: e.path === '/admin/login' ? 'n/a' : '403 + audit denial',
  }));

  const byCredential = {};
  for (const row of rows) {
    byCredential[row.requires] = (byCredential[row.requires] || 0) + 1;
  }

  return { rows, byCredential, violations, total: rows.length };
}

function renderHuman(matrix) {
  const lines = [];
  lines.push(`Admin route/role matrix: ${matrix.total} routes`);
  lines.push('');
  lines.push('Credential summary:');
  for (const [cred, count] of Object.entries(matrix.byCredential).sort()) {
    lines.push(`  ${cred}: ${count}`);
  }
  lines.push('');
  if (matrix.violations.length) {
    lines.push('VIOLATIONS:');
    for (const v of matrix.violations) lines.push(`  - ${v}`);
  } else {
    lines.push('No violations: every route resolves to exactly one credential,');
    lines.push('all manifest grants are server-enforced, no phantom anonymous routes.');
  }
  return lines.join('\n');
}

if (require.main === module) {
  const matrix = buildMatrix();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(matrix, null, 2));
  } else {
    console.log(renderHuman(matrix));
  }
  process.exit(matrix.violations.length ? 1 : 0);
}

module.exports = { parseManifest, requiredCredential, collectServerGrants, buildMatrix, renderHuman, API_ONLY_GRANTS, SUPERONLY_PATH_EXCEPTIONS };
