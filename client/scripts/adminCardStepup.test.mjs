// Auth audit item 16 UI follow-up — admin card issuance step-up contract.
//
// Run: node --test scripts/adminCardStepup.test.mjs
//
// The contract:
//   1. Both admin card issuance flows (virtual + physical) and the admin
//      replacement retry collect a fresh TOTP step-up challenge with action
//      type 'credit_card_issue' BEFORE posting (the server gate 403s without
//      a valid challenge id + code).
//   2. A 403 step-up failure from the guarded post re-prompts once with a
//      fresh challenge instead of failing silently; cancel abandons the
//      action with no post and no side effects.
//   3. Fulfillment advance and revoke are NOT stepped up server-side and
//      must stay unprompted.
//   4. Every new user-visible string exists in all five credit locales with
//      key parity, and is referenced via t('cards.stepup.*') with no
//      defaultValue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = path.join(root, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

const cards = read(path.join(clientSrc, 'admin', 'pages', 'super', 'OxsteedCreditCards.jsx'));

const CHALLENGE_ENDPOINT = '/admin/super/oxsteed-credit/stepup-challenges';
const ACTION_TYPE = 'credit_card_issue';
const ISSUE_VIRTUAL = '/admin/super/oxsteed-credit/cards/issue-virtual';
const ISSUE_PHYSICAL = '/admin/super/oxsteed-credit/cards/issue-physical';
const REPLACEMENT_RETRY = '/replacement/retry';

function functionBody(src, fnName) {
  const start = src.indexOf(fnName);
  assert.notEqual(start, -1, `${fnName} not found`);
  return src.slice(start);
}

test('issue flows prompt step-up before posting', () => {
  const body = functionBody(cards, 'submitIssue');
  const promptIdx = body.indexOf('runSteppedUp');
  assert.notEqual(promptIdx, -1, 'issue submit must run through the step-up helper');
  assert.ok(body.includes(ISSUE_VIRTUAL), 'virtual issue endpoint must be used by the issue submit');
  assert.ok(body.includes(ISSUE_PHYSICAL), 'physical issue endpoint must be used by the issue submit');
  const postIdx = body.indexOf('adminApi.post(endpoint', promptIdx);
  assert.notEqual(postIdx, -1, 'issue post must follow the step-up prompt');
  assert.ok(body.includes('...stepup'), 'issue payload must spread the step-up challenge id + code');
});

test('issue flow issues a challenge with the card action type', () => {
  assert.ok(cards.includes(`STEPUP_ACTION_TYPE = '${ACTION_TYPE}'`),
    'card step-up must use the credit_card_issue action type');
  assert.ok(cards.includes(CHALLENGE_ENDPOINT),
    'card step-up must issue through the admin step-up challenge endpoint');
  const prompt = functionBody(cards, 'promptCardStepUp');
  assert.ok(prompt.includes('actionType: STEPUP_ACTION_TYPE'),
    'challenge issuance must carry the card action type');
});

test('issue flow abandons on cancel without side effects', () => {
  const body = functionBody(cards, 'submitIssue');
  assert.ok(body.includes('if (!response) return;'),
    'cancelled step-up must return before clearing idempotency, resetting the form, or reloading');
});

test('replacement retry prompts step-up before posting', () => {
  const body = functionBody(cards, "card.replacementStatus === 'failed'");
  const promptIdx = body.indexOf('runSteppedUp');
  assert.notEqual(promptIdx, -1, 'replacement retry must run through the step-up helper');
  const postIdx = body.indexOf(REPLACEMENT_RETRY, promptIdx);
  assert.notEqual(postIdx, -1, 'replacement retry post must follow the step-up prompt');
  assert.ok(body.includes('...stepup'), 'replacement retry payload must spread the step-up challenge id + code');
  assert.ok(body.includes('if (!result) return;'),
    'cancelled step-up must return before reloading');
});

test('step-up 403 re-prompts once with a fresh challenge', () => {
  assert.ok(cards.includes("startsWith('credit_stepup_')"),
    'step-up failure detection must key on the credit_stepup_* error codes');
  assert.ok(cards.includes('err?.response?.status === 403'),
    'step-up failure detection must require the 403 status');
  const body = functionBody(cards, 'runSteppedUp');
  const failureIdx = body.indexOf('isStepUpFailure');
  assert.notEqual(failureIdx, -1, 'stepped-up runner must check for step-up failures');
  const repromptIdx = body.indexOf('promptCardStepUp()', failureIdx);
  assert.notEqual(repromptIdx, -1, 'a step-up 403 must re-prompt with a fresh challenge');
});

test('cancel abandons the stepped-up action', () => {
  const body = functionBody(cards, 'runSteppedUp');
  assert.ok(body.includes('if (!first) return null'),
    'a cancelled first prompt must abandon without posting');
  assert.ok(body.includes('if (!second) return null'),
    'a cancelled re-prompt must abandon without retrying');
});

test('fulfillment advance and revoke stay unprompted', () => {
  const advanceStart = cards.indexOf('const advanceFulfillment');
  const revokeStart = cards.indexOf('const revoke');
  assert.ok(advanceStart !== -1 && revokeStart !== -1 && advanceStart < revokeStart,
    'fulfillment and revoke handlers must exist in order');
  const advanceBody = cards.slice(advanceStart, revokeStart);
  assert.ok(!advanceBody.includes('runSteppedUp') && !advanceBody.includes('promptCardStepUp'),
    'fulfillment advance must not prompt (no server step-up on that route)');
  const sectionStart = cards.indexOf('return <section');
  const revokeBody = cards.slice(revokeStart, sectionStart);
  assert.ok(!revokeBody.includes('runSteppedUp') && !revokeBody.includes('promptCardStepUp'),
    'revoke must not prompt (no server step-up on that route)');
});

test('card step-up strings exist in all five credit locales with key parity', () => {
  const keys = ['title', 'body', 'codeLabel', 'cancel', 'verify', 'issueFailed', 'codeRequired'];
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(read(path.join(clientSrc, 'i18n', 'locales', lang, 'credit.json')));
    const stepup = catalog.cards?.stepup ?? {};
    for (const key of keys) {
      assert.equal(typeof stepup[key], 'string', `${lang} cards.stepup.${key} missing`);
    }
  }
});

test('new step-up strings are referenced without defaultValue fallback', () => {
  for (const key of ['title', 'body', 'codeLabel', 'cancel', 'verify', 'issueFailed', 'codeRequired']) {
    const ref = `cards.stepup.${key}`;
    assert.ok(cards.includes(`'${ref}'`), `${ref} must be referenced in source`);
    assert.ok(!cards.includes(`${ref}', { defaultValue`), `${ref} must not use a defaultValue fallback`);
  }
});
