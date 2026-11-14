// Mobile/PWA M8: "mobile" is defined four different ways (SupportWidget
// fullscreen at <640px, FAB/sticky-bar colour and visibility at lg: = 1024px,
// Navbar hamburger at 1360px, PWA launcher offset at 640px). One shared
// breakpoint token (1024px) must drive the FAB colour, the sticky Book bar
// and the chat fullscreen logic; the Navbar 1360px rule stays as a documented
// nav-density exception, not device identity.
//
// Run: node --test scripts/mobileBreakpoint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MOBILE_BREAKPOINT_PX, isMobileWidth } from '../src/utils/mobileBreakpoint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');

test('the shared mobile breakpoint is 1024px (the Tailwind lg: breakpoint)', () => {
  assert.equal(MOBILE_BREAKPOINT_PX, 1024);
  // Tablets and narrow desktop windows are mobile: an 820px iPad portrait
  // gets the mobile chat and the green FAB, not the desktop popup.
  assert.equal(isMobileWidth(820), true);
  assert.equal(isMobileWidth(1023), true);
  assert.equal(isMobileWidth(1024), false);
  assert.equal(isMobileWidth(1280), false);
  // The old fullscreen threshold (640px) no longer splits tablets off.
  assert.equal(isMobileWidth(640), true);
});

test('SupportWidget fullscreen chat and both FABs consume the shared hook', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  assert.match(widget, /import \{ useIsMobile \} from '\.\.\/hooks\/useIsMobile'/);
  assert.match(widget, /const isMobile = useIsMobile\(\)/);
  // No private width check left: the old <640 fullscreen rule is gone.
  assert.doesNotMatch(widget, /innerWidth < 640/);
  assert.doesNotMatch(widget, /innerWidth/);
  // FAB colour is hook-driven, not a Tailwind lg: flip: green below 1024px,
  // dark above (Emile's green-on-mobile-only rule).
  assert.doesNotMatch(widget, /lg:bg-gray-900/);
  assert.doesNotMatch(widget, /lg:bg-gray-950/);
  assert.doesNotMatch(widget, /lg:hover:bg-gray-950/);
  assert.match(widget, /isMobile \? 'bg-green-600 hover:bg-green-700/);
});

test('the sticky Book bars consume the shared hook instead of lg:hidden', async () => {
  for (const rel of [
    'src/pages/BusinessProfilePage.jsx',
    'src/pages/HelperBusinessProfilePage.tsx',
  ]) {
    const page = await src(rel);
    assert.match(page, /import \{ useIsMobile \} from '\.\.\/hooks\/useIsMobile'/, rel);
    assert.match(page, /const isMobile = useIsMobile\(\)/, rel);
    assert.match(page, /\{isMobile && \(/, rel);
    assert.doesNotMatch(page, /lg:hidden fixed bottom-0 inset-x-0/, rel);
  }
});

test('the PWA launcher offset flips at the shared 1024px breakpoint', async () => {
  const css = await src('src/styles/PwaExperience.css');
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.doesNotMatch(css, /@media \(min-width: 640px\)/);
  assert.match(css, /shared mobile breakpoint|MOBILE_BREAKPOINT_PX/);
});

test('the Navbar 1360px hamburger rule is a documented nav-density exception', async () => {
  const css = await src('src/components/Navbar.css');
  assert.match(css, /@media \(max-width: 1360px\)/);
  assert.match(css, /nav-density breakpoint, not device identity/);
});
