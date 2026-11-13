// Nov 10 #12 (STILL LIVE): AdminLegalDocumentsPage, AdminLegalDocumentEditorPage
// and AdminLegalApprovalPage are orphaned: nothing imports them, no admin route
// mounts them, no nav entry links them. They are deleted (with their CSS).
// The /api/admin/legal/documents endpoints stay: they live in
// server/routes/legalDocuments.js, which also serves the live acceptances and
// audit-log pages, and server tests cover them. The adminLegal.* locale keys
// stay too: the live legal pages share that namespace.
//
// Run: node --test scripts/orphanedAdminLegalPages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(clientRoot, '..');
const ORPHANS = [
  'src/pages/admin/AdminLegalDocumentsPage.jsx',
  'src/pages/admin/AdminLegalDocumentsPage.css',
  'src/pages/admin/AdminLegalDocumentEditorPage.jsx',
  'src/pages/admin/AdminLegalDocumentEditorPage.css',
  'src/pages/admin/AdminLegalApprovalPage.jsx',
  'src/pages/admin/AdminLegalApprovalPage.css',
];

test('the orphaned AdminLegal pages and their stylesheets are gone', () => {
  for (const rel of ORPHANS) {
    assert.equal(fs.existsSync(path.join(clientRoot, rel)), false, `${rel} still exists`);
  }
});

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('nothing references the deleted pages or their routes', () => {
  const needles = [
    'AdminLegalDocumentsPage',
    'AdminLegalDocumentEditorPage',
    'AdminLegalApprovalPage',
    '/admin/legal/documents',
  ];
  for (const file of walk(path.join(clientRoot, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const needle of needles) {
      assert.doesNotMatch(src, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${path.relative(repoRoot, file)} still references ${needle}`);
    }
  }
});

test('the live legal pages and the documents API are untouched', () => {
  for (const rel of [
    'src/admin/pages/AdminLegalAcceptancesPage.jsx',
    'src/admin/pages/AdminLegalAuditLogPage.jsx',
  ]) {
    assert.equal(fs.existsSync(path.join(clientRoot, rel)), true, `${rel} must stay`);
  }
  const router = fs.readFileSync(path.join(repoRoot, 'server/routes/legalDocuments.js'), 'utf8');
  for (const route of ["router.get('/documents'", "router.post('/documents'", "router.get('/documents/:id'"]) {
    assert.ok(router.includes(route), `server router lost ${route}`);
  }
});
