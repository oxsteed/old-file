// Domain 7 #25: the C360 / B360 audit tabs fetch limit 100 with no pager
// and no truncation label, so 100 rows read as a complete trail. Add a
// "showing first 100" note whenever a full page of 100 arrives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(clientRoot, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

test('Customer360 notes the 100-row cap on both audit sections', () => {
  const src = read('src/admin/pages/Customer360.jsx');
  assert.match(src, /\{activity\.length === 100 && \(/);
  assert.match(src, /\{adminAudit\.length === 100 && \(/);
  assert.equal((src.match(/audit\.firstHundred/g) || []).length, 2,
    'both Customer360 audit sections must render the first-hundred note');
});

test('Business360 notes the 100-row cap on its audit section', () => {
  const src = read('src/admin/pages/Business360.jsx');
  assert.match(src, /\{adminAudit\.length === 100 && \(/);
  assert.match(src, /audit\.firstHundred/);
});

test('the first-hundred note key exists in all five locales for both pages', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = readJson(`src/locales/${lang}.json`);
    for (const ns of ['adminCustomer360', 'adminBusiness360']) {
      const value = catalog[ns]?.audit?.firstHundred;
      assert.ok(typeof value === 'string' && value.length > 0,
        `${lang} ${ns}: missing audit.firstHundred`);
      assert.match(value, /100/, `${lang} ${ns}: note must name the 100-row cap`);
    }
  }
});

test('the audit fetch stays capped at 100 (note, not paging, per the brief)', () => {
  const c360 = read('src/admin/pages/Customer360.jsx');
  const b360 = read('src/admin/pages/Business360.jsx');
  assert.match(c360, /admin\/audit-log', \{ signal, params: \{ target_type: 'user', target_id: userId, limit: 100 \} \}/);
  assert.match(b360, /admin\/audit-log', \{ signal, params: \{ target_type: 'business', target_id: businessId, limit: 100 \} \}/);
});
