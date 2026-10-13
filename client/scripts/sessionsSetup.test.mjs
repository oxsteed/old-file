import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];

// Review P3-14-F03: the sessions page must exist, be routed, be linked from
// the settings security tab, and carry full 5-locale strings.
const sessionKeys = [
  'sessions.pageTitle',
  'sessions.pageSubtitle',
  'sessions.loading',
  'sessions.loadFailed',
  'sessions.retry',
  'sessions.empty',
  'sessions.emptyDesc',
  'sessions.thisDevice',
  'sessions.lastActive',
  'sessions.unknownDevice',
  'sessions.revoke',
  'sessions.revokeTitle',
  'sessions.revokeConfirm',
  'sessions.cancel',
  'sessions.confirmRevoke',
  'sessions.revoked',
  'sessions.revokeFailed',
  'sessions.revokeCurrentBlocked',
  'sessions.logoutEverywhere',
  'sessions.logoutEverywhereTitle',
  'sessions.logoutEverywhereConfirm',
  'sessions.confirmLogoutEverywhere',
  'sessions.loggedOutEverywhere',
  'sessions.logoutEverywhereFailed',
  'sessions.working',
  'settings.security.sessions',
  'settings.security.sessionsDesc',
  'settings.security.manageSessions',
];

test('settings exposes a dedicated sessions route and security entry', () => {
  const app = read('src/App.jsx');
  const settings = read('src/pages/SettingsPage.jsx');
  assert.match(app, /path="\/settings\/sessions"/);
  assert.match(app, /SessionsSetup/);
  assert.match(settings, /\/settings\/sessions/);
  assert.match(settings, /settings\.security\.manageSessions/);
});

test('sessions page wires list, revoke-one, and log-out-everywhere to the API', () => {
  const page = read('src/pages/Settings/SessionsSetup.jsx');
  const api = read('src/api/userSessions.js');
  assert.match(api, /\/users\/me\/sessions/);
  assert.match(page, /listSessions/);
  assert.match(page, /revokeSession/);
  // The current session is never offered a revoke control.
  assert.match(page, /!session\.is_current/);
  // No native dialogs; inline confirm modals like the passkeys page.
  assert.doesNotMatch(page, /window\.prompt/);
  assert.doesNotMatch(page, /window\.confirm/);
});

test('session strings exist in every supported locale catalog', () => {
  for (const lang of languages) {
    const catalog = JSON.parse(read(`src/locales/${lang}.json`));
    for (const key of sessionKeys) {
      const parts = key.split('.');
      let node = catalog;
      for (const part of parts) {
        assert.ok(node && Object.prototype.hasOwnProperty.call(node, part), `${lang}: missing ${key}`);
        node = node[part];
      }
      assert.equal(typeof node, 'string', `${lang}: ${key} must be a string`);
      assert.ok(node.trim().length > 0, `${lang}: ${key} must not be empty`);
    }
  }
});
