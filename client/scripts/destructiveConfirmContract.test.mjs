// E12 — destructive-action confirmation contract (failing reproduction).
//
// Run: node --test scripts/destructiveConfirmContract.test.mjs
//
// The contract:
//   1. Admin destructive actions go through ONE dialog component
//      (admin/components/DestructiveConfirmDialog.jsx) with consistent
//      copy, not ad-hoc window.confirm() calls.
//   2. Its user-visible strings exist in all five locales with key parity.
//   3. The destructive endpoints behind those dialogs record the action in
//      the audit log (logAdminAction / logUserAction).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = path.join(root, 'src');
const serverRoot = path.resolve(root, '..', 'server');

// The generated catalogs are gitignored build output; rebuild them so the
// parity check below reads what the app will actually serve.
execFileSync(process.execPath, [path.join(root, 'scripts', 'splitLocaleCatalogs.mjs')]);

const read = (p) => fs.readFileSync(p, 'utf8');

function adminJsxFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsx')) out.push(full);
    }
  };
  walk(path.join(clientSrc, 'admin'));
  return out;
}

test('one destructive-confirm dialog component exists', () => {
  const dialogPath = path.join(clientSrc, 'admin', 'components', 'DestructiveConfirmDialog.jsx');
  assert.ok(fs.existsSync(dialogPath), 'DestructiveConfirmDialog.jsx is missing');
  const src = read(dialogPath);
  assert.match(src, /requireTypeText|typeToConfirm/, 'dialog must support type-to-confirm');
  assert.match(src, /onConfirm/, 'dialog must expose onConfirm');
});

test('no ad-hoc window.confirm remains in admin UI', () => {
  const self = path.join(clientSrc, 'admin', 'components', 'DestructiveConfirmDialog.jsx');
  const offenders = adminJsxFiles().filter((f) => f !== self && read(f).includes('window.confirm('));
  assert.deepEqual(offenders, [], `ad-hoc window.confirm in: ${offenders.join(', ')}`);
});

test('dialog strings exist in all five locales with key parity', () => {
  const languages = ['en', 'es', 'fr', 'ht', 'ar'];
  const loadMerged = (lang) => {
    const merged = {};
    for (const shard of [0, 1, 2]) {
      Object.assign(
        merged,
        JSON.parse(read(path.join(clientSrc, 'locales', 'generated', `${lang}-${shard}.json`)))
      );
    }
    return merged;
  };
  const catalogs = Object.fromEntries(languages.map((lang) => [lang, loadMerged(lang)]));
  for (const lang of languages) {
    const dc = catalogs[lang].destructiveConfirm;
    assert.ok(dc && typeof dc.title === 'string', `${lang}: missing destructiveConfirm.title`);
  }
  const enKeys = Object.keys(catalogs.en.destructiveConfirm || {});
  for (const lang of languages) {
    if (lang === 'en') continue;
    assert.deepEqual(
      Object.keys(catalogs[lang].destructiveConfirm || {}).sort(),
      enKeys.sort(),
      `${lang}: destructiveConfirm key parity broken`
    );
  }
  // No em dashes in user-visible prose.
  for (const lang of languages) {
    for (const k of enKeys) {
      const value = catalogs[lang].destructiveConfirm[k];
      assert.ok(!String(value).includes('\u2014'), `${lang}.destructiveConfirm.${k}: em dash`);
    }
  }
});

test('destructive endpoints record the action in the audit log', () => {
  const checks = [
    ['controllers/adminPermissionController.js', 'revokeGrant', /logAdminAction/],
    ['controllers/superAdminController.js', 'forceLogout', /logAdminAction/],
    ['controllers/countryPackController.js', 'adminUpdateCountryPack', /logAdminAction/],
  ];
  for (const [file, fnName, auditRe] of checks) {
    const src = read(path.join(serverRoot, file));
    const fnStart = src.indexOf(`exports.${fnName}`) !== -1
      ? src.indexOf(`exports.${fnName}`)
      : src.indexOf(`${fnName} = async`);
    assert.ok(fnStart !== -1, `${file}: ${fnName} not found`);
    const body = src.slice(fnStart, fnStart + 6000);
    assert.match(body, auditRe, `${file}::${fnName} does not audit-log`);
  }
});
