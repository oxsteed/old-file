import test from 'node:test';
import assert from 'node:assert/strict';
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
