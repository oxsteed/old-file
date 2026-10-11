import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const result = await build({ entryPoints: ['src/utils/signupValidation.js'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} }; new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
const { isSignupPasswordValid, isSignupPhoneValid, normalizeSignupRegion, validateSignup } = module.exports;
const server = require('../../server/utils/signupValidation.js');
test('frontend/backend password category and boundary policies stay identical', () => {
  for (let mask = 0; mask < 8; mask++) {
    const password = 'abcdefgh' + (mask & 1 ? 'A' : '') + (mask & 2 ? '1' : '') + (mask & 4 ? '!' : '');
    const allowed = ((mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0)) >= 2;
    assert.equal(isSignupPasswordValid(password), allowed); assert.equal(server.isSignupPasswordValid(password), allowed);
  }
  for (const n of [0, 7, 8, 128, 129]) {
    const password = ('A1' + 'a'.repeat(129)).slice(0, n);
    assert.equal(isSignupPasswordValid(password), n >= 8 && n <= 128); assert.equal(isSignupPasswordValid(password), server.isSignupPasswordValid(password));
  }
  assert.equal(isSignupPasswordValid(' A1aaaaa '), true);
});
test('formatted US/international phone numbers and digit limits', () => {
  for (const value of ['(937) 555-0100', '+1 (937) 555-0100', '937.555.0100']) assert.equal(isSignupPhoneValid(value, 'US'), true);
  for (const value of ['1234567', '123456789012', 'phone1234567890', '++19375550100']) assert.equal(isSignupPhoneValid(value, 'US'), false);
  for (const value of ['1234567', '+33123456789', '+123456789012345']) assert.equal(isSignupPhoneValid(value, 'FR'), true);
  for (const value of ['123456', '+1234567890123456']) assert.equal(isSignupPhoneValid(value, 'FR'), false);
});
test('country-aware regions, postal rules, independent age and Terms', () => {
  const base = { firstName:'Test',lastName:'Person',email:'synthetic@example.test',phone:'+50937000000',country:'HT',addressLine1:'1 Test Street',city:'Test City',state:'',zipCode:'',password:'Testpass1',defaultMode:'customer',ageConfirmed:true,termsAccepted:true };
  assert.deepEqual(validateSignup(base, ['customer']), {});
  assert.equal(validateSignup({ ...base, ageConfirmed:false }, ['customer']).ageConfirmed, 'ageError');
  assert.equal(validateSignup({ ...base, termsAccepted:false }, ['customer']).termsAccepted, 'termsError');
  assert.equal(validateSignup({ ...base, country:'US',phone:'9375550100' }, ['customer']).state, 'stateError');
  assert.equal(normalizeSignupRegion('US', 'oh'), 'OH'); assert.equal(normalizeSignupRegion('FR', 'Île-de-France'), 'Île-de-France'); assert.equal(normalizeSignupRegion('GB', 'England'), 'England');
});
test('all five locales contain identical new keys in both catalog structures', () => {
  const english = JSON.parse(fs.readFileSync('src/locales/en.json')).signupUpgrade;
  for (const lang of ['en','es','fr','ht','ar']) for (const file of [`src/locales/${lang}.json`, `src/i18n/locales/${lang}/common.json`]) {
    const catalog = JSON.parse(fs.readFileSync(file)).signupUpgrade;
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort(), file);
    assert.ok(Object.values(catalog).every(value => typeof value === 'string' && value.length), file);
  }
});
