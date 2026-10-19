import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_INSTALL_DISMISS_KEY,
  detectDisplayStandalone,
  readInstallPromptDismissed,
  shouldShowInstallPrompt,
  writeInstallPromptDismissed,
} from './displayInstall.js';

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
  };
}

test('matchMedia display-mode standalone wins', () => {
  assert.equal(
    detectDisplayStandalone({
      matchMedia: () => ({ matches: true }),
      standalone: false,
    }),
    true,
  );
});

test('iOS navigator.standalone is detected', () => {
  assert.equal(
    detectDisplayStandalone({ matchMedia: undefined, standalone: true }),
    true,
  );
});

test('regular browser tab is not standalone', () => {
  assert.equal(
    detectDisplayStandalone({
      matchMedia: () => ({ matches: false }),
      standalone: false,
    }),
    false,
  );
  assert.equal(detectDisplayStandalone({}), false);
});

test('throwing matchMedia falls back to navigator.standalone', () => {
  const throwing = () => {
    throw new Error('nope');
  };
  assert.equal(
    detectDisplayStandalone({ matchMedia: throwing, standalone: true }),
    true,
  );
  assert.equal(
    detectDisplayStandalone({ matchMedia: throwing, standalone: false }),
    false,
  );
});

test('prompt shows once: skipped when installed or dismissed', () => {
  assert.equal(
    shouldShowInstallPrompt({ dismissed: false, standalone: false }),
    true,
  );
  assert.equal(
    shouldShowInstallPrompt({ dismissed: true, standalone: false }),
    false,
  );
  assert.equal(
    shouldShowInstallPrompt({ dismissed: false, standalone: true }),
    false,
  );
  assert.equal(
    shouldShowInstallPrompt({ dismissed: true, standalone: true }),
    false,
  );
});

test('dismissal round-trips through storage under a stable key', () => {
  assert.equal(
    DISPLAY_INSTALL_DISMISS_KEY,
    'oxsteed:display:install-prompt-dismissed:v1',
  );
  const storage = fakeStorage();
  assert.equal(readInstallPromptDismissed(storage), false);
  writeInstallPromptDismissed(storage);
  assert.equal(readInstallPromptDismissed(storage), true);
});

test('missing storage never throws', () => {
  assert.equal(readInstallPromptDismissed(null), false);
  writeInstallPromptDismissed(null);
});
