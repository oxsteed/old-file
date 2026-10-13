// The axios instance (src/api/axios.js) already carries the /api base URL.
// Hand-writing "/api/..." on calls through it produces /api/api/... -> 404
// (review: the double-prefix bug class). This guard fails on any new case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const srcRoot = new URL('../src/', import.meta.url).pathname;
const CALL = /\b(?:api|axiosInstance)\.(?:get|post|put|patch|delete)\(\s*[`'"]\/api\//g;
// Remaining known offenders, removed as each review wave lands. Must only shrink.
const KNOWN = new Set([
  'pages/food/FoodMerchantPage.jsx',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('no axios call hand-writes the /api prefix', () => {
  const offenders = [];
  for (const file of walk(srcRoot)) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    if (KNOWN.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (CALL.test(text)) offenders.push(rel);
    CALL.lastIndex = 0;
  }
  assert.deepEqual(offenders, []);
});

test('work agreement pages call the API without a double prefix', () => {
  for (const page of ['pages/WorkAgreementPage.jsx', 'pages/NewWorkAgreementPage.jsx']) {
    const text = fs.readFileSync(path.join(srcRoot, page), 'utf8');
    assert.doesNotMatch(text, /api\.(get|post)\(\s*[`'"]\/api\//, page);
  }
});

test('new agreement page sends content and navigates with the returned id', () => {
  const text = fs.readFileSync(path.join(srcRoot, 'pages/NewWorkAgreementPage.jsx'), 'utf8');
  assert.match(text, /content:\s*\{/);
  assert.match(text, /data\?\.id \|\| data\?\.agreement\?\.id/);
});
