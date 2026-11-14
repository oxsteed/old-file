// Mobile/PWA M20: the support FAB has two competing bottom offsets (Tailwind
// bottom-20 = 80px vs PwaExperience.css 5.5rem = 88px; the CSS
// attribute-selector rule wins on specificity, so the Tailwind class is dead
// weight) and the launcher vanishes entirely while the offline banner shows.
// One source of truth (the CSS value) and a visible-but-disabled launcher
// while offline.
//
// Run: node --test scripts/supportFabOffset.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');

test('the FAB bottom has one source of truth: the CSS 5.5rem rule', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  // The main FAB (AISupportWidget) carries no bottom utilities: the CSS
  // .fixed[data-pwa-support-launcher] rule owns the offset. The fallback
  // FAB keeps its own bottom-[4.75rem] because it renders outside the
  // launcher-clearance flow; it never had a competing Tailwind bottom.
  const mainFab = widget.split('support-contact-fab')[0];
  assert.doesNotMatch(mainFab, /bottom-20/, 'dead bottom-20 on main FAB');
  assert.doesNotMatch(mainFab, /sm:bottom-6/, 'dead sm:bottom-6 on main FAB');
  const css = await src('src/styles/PwaExperience.css');
  assert.match(css, /\.fixed\[data-pwa-support-launcher\]\s*\{[^}]*--pwa-support-bottom:\s*5\.5rem/);
});

test('the launcher stays visible while offline, in a disabled state', async () => {
  const css = await src('src/styles/PwaExperience.css');
  assert.doesNotMatch(
    css,
    /\.pwa-connection-present \[data-pwa-support-launcher\][^{]*\{[^}]*display:\s*none/,
    'launcher still display:none while offline',
  );
  assert.match(
    css,
    /\.pwa-connection-present \[data-pwa-support-launcher\]\s*\{[^}]*opacity:[^}]*pointer-events:\s*none/,
    'offline launcher is visible but disabled',
  );
});

test('the launcher still hides while the keyboard is open (typing room)', async () => {
  const css = await src('src/styles/PwaExperience.css');
  assert.match(
    css,
    /\.pwa-keyboard-open \[data-pwa-support-launcher\]\s*\{[^}]*display:\s*none/,
  );
});
