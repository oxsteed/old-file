// Audit item 1 UI follow-up — super-admin password-set step-up contract.
//
// Run: node --test scripts/adminPasswordStepup.test.mjs
//
// The contract:
//   1. Both admin password-reset flows collect a TOTP step-up with purpose
//      'super_admin_password_set' BEFORE posting to the password endpoint
//      (the server gate 401s without a fresh event).
//   2. A 401 fresh_auth_required from the password post re-prompts for
//      step-up instead of failing silently.
//   3. Every new user-visible string exists in all five locales with key
//      parity, and is referenced via t('ns.key') with no defaultValue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = path.join(root, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

const userDetail = read(path.join(clientSrc, 'admin', 'pages', 'super', 'UserDetail.jsx'));
const usersList = read(path.join(clientSrc, 'admin', 'pages', 'UsersList.jsx'));

const PASSWORD_POST = '/password`';
const STEPUP_VERIFY = '/admin/super/stepup/verify';
const PURPOSE = 'super_admin_password_set';
const FRESH_AUTH = 'fresh_auth_required';

function functionBody(src, fnName) {
  const start = src.indexOf(fnName);
  assert.notEqual(start, -1, `${fnName} not found`);
  return src.slice(start);
}

test('UserDetail password reset prompts step-up before posting', () => {
  const body = functionBody(userDetail, 'submitSuperAdminPassword');
  const promptIdx = body.indexOf(`promptStepUpCode('${PURPOSE}')`);
  assert.notEqual(promptIdx, -1, 'password submit must prompt step-up with the password purpose');
  const postIdx = body.indexOf(PASSWORD_POST, promptIdx);
  assert.notEqual(postIdx, -1, 'password post must follow the step-up prompt');
  assert.ok(body.indexOf(STEPUP_VERIFY) !== -1 || userDetail.includes(STEPUP_VERIFY),
    'step-up verify endpoint must be called');
});

test('UserDetail password reset re-prompts on 401 fresh_auth_required', () => {
  const body = functionBody(userDetail, 'submitSuperAdminPassword');
  assert.ok(body.includes(FRESH_AUTH), 'password submit must check for fresh_auth_required');
  const first401 = body.indexOf(FRESH_AUTH);
  const reprompt = body.indexOf(`promptStepUpCode('${PURPOSE}')`, first401);
  assert.notEqual(reprompt, -1, 'a 401 fresh_auth_required must re-prompt for step-up');
});

test('UserDetail step-up verify records the password purpose', () => {
  assert.ok(userDetail.includes(`purpose: stepUpPurpose`),
    'step-up verify must send the prompted purpose, not a hardcoded one');
  assert.ok(userDetail.includes(`stepUpPurpose === '${PURPOSE}'`),
    'password copy and failure copy must key off the password purpose');
});

test('UsersList reset modal prompts step-up before posting', () => {
  const body = functionBody(usersList, 'ResetPasswordModal');
  const promptIdx = body.indexOf('promptStepUpCode()');
  assert.notEqual(promptIdx, -1, 'reset modal must prompt for step-up');
  const postIdx = body.indexOf(PASSWORD_POST, promptIdx);
  assert.notEqual(postIdx, -1, 'password post must follow the step-up prompt');
  assert.ok(body.includes(STEPUP_VERIFY), 'reset modal must verify via the step-up endpoint');
  assert.ok(body.includes(`purpose: '${PURPOSE}'`), 'reset modal must verify with the password purpose');
});

test('UsersList reset modal re-prompts on 401 fresh_auth_required', () => {
  const body = functionBody(usersList, 'ResetPasswordModal');
  assert.ok(body.includes(FRESH_AUTH), 'reset modal must check for fresh_auth_required');
  const first401 = body.indexOf(FRESH_AUTH);
  const reprompt = body.indexOf('promptStepUpCode()', first401);
  assert.notEqual(reprompt, -1, 'a 401 fresh_auth_required must re-prompt for step-up');
});

test('password step-up strings exist in all five locales with key parity', () => {
  const userDetailKeys = [
    'password.stepupTitle', 'password.stepupBody', 'password.stepupCode',
    'password.stepupVerify', 'password.stepupFailed', 'password.stepupCancel',
  ];
  const usersListKeys = [
    'resetStepupTitle', 'resetStepupBody', 'resetStepupCode',
    'resetStepupVerify', 'resetStepupFailed', 'resetStepupCancel',
  ];
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(read(path.join(root, 'src', 'locales', `${lang}.json`)));
    const detail = catalog.adminUserDetail ?? {};
    const list = catalog.adminUsers?.list ?? {};
    for (const key of userDetailKeys) {
      assert.equal(typeof detail[key], 'string', `${lang} adminUserDetail.${key} missing`);
    }
    for (const key of usersListKeys) {
      assert.equal(typeof list[key], 'string', `${lang} adminUsers.list.${key} missing`);
    }
  }
});

test('new step-up strings are referenced without defaultValue fallback', () => {
  for (const [src, key] of [
    [userDetail, 'adminUserDetail.password.stepupTitle'],
    [userDetail, 'adminUserDetail.password.stepupBody'],
    [userDetail, 'adminUserDetail.password.stepupCode'],
    [userDetail, 'adminUserDetail.password.stepupVerify'],
    [userDetail, 'adminUserDetail.password.stepupFailed'],
    [userDetail, 'adminUserDetail.password.stepupCancel'],
    [usersList, 'adminUsers.list.resetStepupTitle'],
    [usersList, 'adminUsers.list.resetStepupBody'],
    [usersList, 'adminUsers.list.resetStepupCode'],
    [usersList, 'adminUsers.list.resetStepupVerify'],
    [usersList, 'adminUsers.list.resetStepupFailed'],
    [usersList, 'adminUsers.list.resetStepupCancel'],
  ]) {
    assert.ok(src.includes(`'${key}'`), `${key} must be referenced in source`);
    assert.ok(!src.includes(`${key}', { defaultValue`), `${key} must not use a defaultValue fallback`);
  }
});
