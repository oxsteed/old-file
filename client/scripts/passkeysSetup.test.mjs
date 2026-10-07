import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];

const passkeyKeys = [
  'twoFactor.passkeysTitle',
  'twoFactor.registerPasskey',
  'twoFactor.passkeyRegisterTitle',
  'twoFactor.passkeyUnsupportedInline',
  'twoFactor.passkeysPageTitle',
  'settings.security.passkeys',
  'settings.security.managePasskeys',
];

test('passkey setup UI avoids browser prompts and gates passkeys outside TOTP enabled step', () => {
  const twoFactor = read('src/pages/Settings/TwoFactorSetup.jsx');
  const section = read('src/pages/Settings/PasskeysSection.jsx');
  assert.doesNotMatch(twoFactor, /window\.prompt/);
  assert.doesNotMatch(section, /window\.prompt/);
  assert.doesNotMatch(section, /window\.confirm/);
  assert.match(twoFactor, /<PasskeysSection/);
  const enabledBlockStart = twoFactor.indexOf("{step === 'enabled'");
  const passkeysIndex = twoFactor.indexOf('<PasskeysSection');
  assert.ok(enabledBlockStart >= 0 && passkeysIndex > enabledBlockStart, 'PasskeysSection must render outside the enabled-only branch');
  const enabledBranchEnd = twoFactor.indexOf("{step === 'backupCodes'", enabledBlockStart);
  assert.ok(passkeysIndex > enabledBranchEnd, 'PasskeysSection must not be nested inside step === enabled');
  assert.match(twoFactor, /PasskeysSection[\s\S]*className="mt-6/);
});

test('settings exposes a dedicated passkeys route and security entry', () => {
  const app = read('src/App.jsx');
  const settings = read('src/pages/SettingsPage.jsx');
  assert.match(app, /path="\/settings\/passkeys"/);
  assert.match(app, /PasskeysSetup/);
  assert.match(settings, /\/settings\/passkeys/);
  assert.match(settings, /settings\.security\.passkeys/);
});

test('passkey strings exist in every supported locale catalog', () => {
  for (const lang of languages) {
    const catalog = JSON.parse(read(`src/locales/${lang}.json`));
    for (const key of passkeyKeys) {
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

test('passkeys section shows inline unsupported-browser guidance', () => {
  const section = read('src/pages/Settings/PasskeysSection.jsx');
  assert.match(section, /PublicKeyCredential/);
  assert.match(section, /passkeyUnsupportedInline/);
  assert.match(section, /role="status"/);
});
