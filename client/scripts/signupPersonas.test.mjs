import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERSONA_NAVIGATION_CATALOG } from '../src/utils/personaNavigation.js';
import { SIGNUP_PERSONAS, SIGNUP_INTENT_VALUES, signupPersonaForIntent } from '../src/utils/signupPersonas.js';

test('signup covers every catalog persona family exactly once', () => {
  assert.equal(SIGNUP_PERSONAS.length, PERSONA_NAVIGATION_CATALOG.length);
  assert.deepEqual(SIGNUP_PERSONAS.map(({ id }) => id), PERSONA_NAVIGATION_CATALOG.map(({ id }) => id));
  assert.equal(new Set(SIGNUP_INTENT_VALUES).size, SIGNUP_INTENT_VALUES.length);
  for (const persona of SIGNUP_PERSONAS) {
    assert.ok(persona.intent, persona.id);
    assert.ok(persona.admission, persona.id);
    assert.ok(persona.copy, persona.id);
    assert.equal(signupPersonaForIntent(persona.intent).id, persona.id);
  }
});

test('staff and nonhuman personas describe provisioning without a human role grant', () => {
  assert.equal(signupPersonaForIntent('request_reviewer').admission, 'staff_provisioning');
  assert.equal(signupPersonaForIntent('request_device').admission, 'nonhuman_provisioning');
});

// G-5: the goal picker on /join renders task language only. The signup
// browser check asserts the picker text never matches /mode|switcher/i, so
// every rendered signupUpgrade string must be free of mode/switcher
// language in all five locales and both catalog structures, and the dead
// switcherNote key must not ship at all.
test('goal-picker copy never uses mode or switcher language', () => {
  const languages = ['en', 'es', 'fr', 'ht', 'ar'];
  const catalogs = languages.flatMap((language) => [
    `../src/locales/${language}.json`,
    `../src/i18n/locales/${language}/common.json`,
  ]);
  const collectStrings = (value, out = []) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((entry) => collectStrings(entry, out));
    return out;
  };
  for (const relative of catalogs) {
    const catalog = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
    assert.ok(catalog.signupUpgrade, `${relative} carries signupUpgrade`);
    assert.equal('switcherNote' in catalog.signupUpgrade, false, `${relative} still ships dead switcherNote`);
    for (const value of collectStrings(catalog.signupUpgrade)) {
      assert.doesNotMatch(value, /mode|switcher/i, `${relative}: ${value}`);
    }
    assert.ok(catalog.signupUpgrade.modeError, `${relative} keeps a modeError string`);
  }
});
