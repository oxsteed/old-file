import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminChallengeHandler } from '../src/api/adminChallenge.mjs';
const challenge = { response: { status: 403, data: { code: 'admin_2fa_required' } } };
test('setup challenge navigates once for concurrent failures', () => {
  const calls = [];
  const handle = createAdminChallengeHandler({ pathname: '/admin/dashboard', replace: p => calls.push(p) });
  handle(challenge);
  handle(challenge);
  assert.deepEqual(calls, ['/admin/2fa-setup']);
});
test('setup page never reloads itself', () => {
  createAdminChallengeHandler({ pathname: '/admin/2fa-setup', replace: () => assert.fail('reload') })(challenge);
});
test('permission denials and expired tokens are not login redirects', () => {
  const handle = createAdminChallengeHandler({ pathname: '/admin/dashboard', replace: () => assert.fail('redirect') });
  handle({ response: { status: 403, data: { error: 'Permission required' } } });
  handle({ response: { status: 401 } });
  handle({});
});
