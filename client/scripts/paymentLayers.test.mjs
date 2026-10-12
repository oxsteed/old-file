import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as money from '../src/shared/money.js';
import * as countries from '../src/shared/countries.js';

const LANGS = ['en', 'es', 'fr', 'ht', 'ar'];
const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../${rel}`, import.meta.url)));

function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
}

test('minor units follow each currency exponent', () => {
  assert.equal(money.currencyExponent('USD'), 2);
  assert.equal(money.currencyExponent('JPY'), 0);
  assert.equal(money.currencyExponent('KWD'), 3);
  assert.equal(money.toMinor('12.34', 'USD'), 1234);
  assert.equal(money.toMinor('1500', 'JPY'), 1500);
  assert.equal(money.toMinor('1.234', 'KWD'), 1234);
  assert.equal(money.fromMinor(1234, 'KWD'), '1.234');
  assert.equal(money.bpsOf(10000, 100, 'up'), 100);
});

test('country helpers normalise names and codes', () => {
  assert.equal(countries.normalizeCountryCode('ca'), 'CA');
  assert.equal(countries.normalizeCountryCode('Haiti'), 'HT');
  assert.equal(countries.defaultCurrencyFor('KE'), 'KES');
  assert.equal(countries.isValidTimeZone('America/Port-au-Prince'), true);
  assert.equal(countries.isValidTimeZone('Mars/Base'), false);
});

test('server CommonJS copies of the shared modules are in sync', () => {
  const script = fileURLToPath(new URL('../../server/scripts/generate-shared-cjs.cjs', import.meta.url));
  execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' });
});

test('paymentRail strings exist with the same keys and placeholders in every locale and catalog', () => {
  const en = read('src/locales/en.json').paymentRail;
  assert.ok(en, 'paymentRail namespace');
  const enLeaves = new Map(leaves(en));
  for (const lang of LANGS) {
    for (const file of [`src/locales/${lang}.json`, `src/i18n/locales/${lang}/common.json`]) {
      const ns = read(file).paymentRail;
      assert.ok(ns, file);
      const got = new Map(leaves(ns));
      assert.deepEqual([...got.keys()].sort(), [...enLeaves.keys()].sort(), file);
      for (const [key, value] of enLeaves) {
        assert.ok(String(got.get(key)).trim(), `${file} ${key} empty`);
        for (const v of String(value).match(/\{\{\w+\}\}/g) || []) assert.ok(String(got.get(key)).includes(v), `${file} ${key} keeps ${v}`);
      }
    }
  }
});

test('Arabic paymentRail strings are written in Arabic script (RTL)', () => {
  const ar = read('src/locales/ar.json').paymentRail;
  assert.match(ar.panelTitle, /[\u0600-\u06FF]/);
  assert.match(ar.offlineAck, /[\u0600-\u06FF]/);
});

test('every server rail reason code used by the UI has a translation', () => {
  const en = read('src/locales/en.json').paymentRail.reasons;
  const policy = fs.readFileSync(new URL('../../server/services/paymentRailPolicy.js', import.meta.url), 'utf8');
  const reasons = new Set([...policy.matchAll(/Reason = '([a-z_]+)'/g)].map((m) => m[1]));
  for (const code of ['country_not_supported', 'country_tax_review_pending', 'country_not_enabled']) reasons.add(code);
  for (const code of reasons) assert.ok(en[code], `missing reason ${code}`);
});
