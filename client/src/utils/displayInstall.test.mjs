import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_INSTALL_DESTINATION_KEY,
  DISPLAY_INSTALL_DISMISS_KEY,
  detectDisplayStandalone,
  isValidDisplayRoutePath,
  readInstallPromptDismissed,
  readDisplayInstallDestination,
  resolveDisplayInstallRedirect,
  parseDisplayRoutePath,
  saveDisplayInstallDestination,
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

test('destination key is stable and versioned', () => {
  assert.equal(DISPLAY_INSTALL_DESTINATION_KEY, 'oxsteed:display:install-destination:v1');
});

test('only real display routes are valid destination paths', () => {
  assert.equal(isValidDisplayRoutePath('/restaurants/kitchen/42'), true);
  assert.equal(isValidDisplayRoutePath('/restaurants/queue/7'), true);
  assert.equal(isValidDisplayRoutePath('/food/kiosk/123'), true);
  assert.equal(isValidDisplayRoutePath('/food/kitchen/9'), true);
  assert.equal(isValidDisplayRoutePath('/'), false);
  assert.equal(isValidDisplayRoutePath('/restaurants'), false);
  assert.equal(isValidDisplayRoutePath('/restaurants/kitchen'), false);
  assert.equal(isValidDisplayRoutePath('/restaurants/kitchen/abc'), false);
  assert.equal(isValidDisplayRoutePath('/restaurants/pos/42'), false);
  assert.equal(isValidDisplayRoutePath('/login'), false);
  assert.equal(isValidDisplayRoutePath('/restaurants/kitchen/42/pair'), false);
  assert.equal(isValidDisplayRoutePath('//restaurants/kitchen/42'), false);
  assert.equal(isValidDisplayRoutePath(null), false);
  assert.equal(isValidDisplayRoutePath(undefined), false);
  assert.equal(isValidDisplayRoutePath(42), false);
});

test('destination round-trips through storage for valid display routes', () => {
  const storage = fakeStorage();
  assert.equal(readDisplayInstallDestination(storage), null);
  assert.equal(
    saveDisplayInstallDestination(
      { path: '/restaurants/kitchen/42', restaurantId: '42', displayType: 'kitchen' },
      storage,
    ),
    true,
  );
  assert.deepEqual(readDisplayInstallDestination(storage), {
    path: '/restaurants/kitchen/42',
    restaurantId: '42',
    displayType: 'kitchen',
  });
});

test('saving a non-display route is refused and leaves storage untouched', () => {
  const storage = fakeStorage();
  assert.equal(saveDisplayInstallDestination({ path: '/login' }, storage), false);
  assert.equal(saveDisplayInstallDestination({ path: '/restaurants/kitchen' }, storage), false);
  assert.equal(saveDisplayInstallDestination({}, storage), false);
  assert.equal(readDisplayInstallDestination(storage), null);
});

test('a stored non-display destination is never read back', () => {
  const storage = fakeStorage({
    [DISPLAY_INSTALL_DESTINATION_KEY]: JSON.stringify({ path: '/dashboard' }),
  });
  assert.equal(readDisplayInstallDestination(storage), null);
  const corrupt = fakeStorage({ [DISPLAY_INSTALL_DESTINATION_KEY]: 'not-json' });
  assert.equal(readDisplayInstallDestination(corrupt), null);
  assert.equal(readDisplayInstallDestination(null), null);
});

test('display route parsing extracts type and restaurant id', () => {
  assert.deepEqual(parseDisplayRoutePath('/restaurants/kitchen/42'), {
    path: '/restaurants/kitchen/42',
    displayType: 'kitchen',
    restaurantId: '42',
  });
  assert.deepEqual(parseDisplayRoutePath('/food/queue/7'), {
    path: '/food/queue/7',
    displayType: 'queue',
    restaurantId: '7',
  });
  assert.equal(parseDisplayRoutePath('/restaurants/kitchen/42/pair'), null);
  assert.equal(parseDisplayRoutePath('/login'), null);
  assert.equal(parseDisplayRoutePath(null), null);
});

test('restore decision only fires for standalone at a bare start_url', () => {
  const withDestination = (pathname, standalone) =>
    resolveDisplayInstallRedirect({
      standalone,
      pathname,
      storage: fakeStorage({
        [DISPLAY_INSTALL_DESTINATION_KEY]: JSON.stringify({
          path: '/restaurants/kitchen/42',
          restaurantId: '42',
          displayType: 'kitchen',
        }),
      }),
    });

  // Happy path: installed app launched at the manifest start_url.
  assert.equal(withDestination('/', true), '/restaurants/kitchen/42');
  assert.equal(withDestination('/restaurants', true), '/restaurants/kitchen/42');

  // Regular browser tab never redirects.
  assert.equal(withDestination('/', false), null);

  // Anywhere else (already on a real page) never redirects.
  assert.equal(withDestination('/restaurants/kitchen/42', true), null);
  assert.equal(withDestination('/login', true), null);
  assert.equal(withDestination('/', undefined), null);

  // No (or invalid) saved destination: nothing to restore.
  assert.equal(
    resolveDisplayInstallRedirect({ standalone: true, pathname: '/', storage: fakeStorage() }),
    null,
  );
  assert.equal(
    resolveDisplayInstallRedirect({
      standalone: true,
      pathname: '/',
      storage: fakeStorage({
        [DISPLAY_INSTALL_DESTINATION_KEY]: JSON.stringify({ path: '/dashboard' }),
      }),
    }),
    null,
  );
});
