import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navbarSource = () => readFile(
  new URL('../src/components/Navbar.jsx', import.meta.url),
  'utf8',
);
const navbarCss = () => readFile(
  new URL('../src/components/Navbar.css', import.meta.url),
  'utf8',
);

// Palette item 6 (D-726): an obvious labeled search entry in the mobile menu.
test('mobile menu opens with a labeled search button that opens the palette', async () => {
  const source = await navbarSource();
  assert.match(source, /className="ox-nav-mobile-search"/);
  assert.match(source, /data-track="ui\.0b9e115b87\.7"/);
  assert.match(source, /t\('commandPalette\.search'\)/);
  assert.match(source, /onClick=\{\(\) => \{ setMobileOpen\(false\); openCommandPalette\(\); \}\}/);
  // The button sits inside the expanded mobile menu, before the
  // preferences block, so signed-in and guest users both see it.
  const menuIndex = source.indexOf('className="ox-nav-mobile-menu"');
  const buttonIndex = source.indexOf('ox-nav-mobile-search');
  const prefsIndex = source.indexOf('ox-nav-mobile-preferences');
  assert.ok(menuIndex > -1 && buttonIndex > menuIndex, 'button is inside the mobile menu');
  assert.ok(buttonIndex < prefsIndex, 'button precedes the preferences block');
});

test('mobile search button is full-width with a 44px target', async () => {
  const css = await navbarCss();
  assert.match(css, /\.ox-nav-mobile-search \{[^}]*width: 100%/s);
  assert.match(css, /\.ox-nav-mobile-search \{[^}]*min-height: 44px/s);
});

test('locale parity: commandPalette.search exists in all five locales', async () => {
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await readFile(
      new URL(`../src/locales/${locale}.json`, import.meta.url),
      'utf8',
    ));
    const value = catalog?.commandPalette?.search;
    assert.equal(typeof value, 'string', `${locale}: missing commandPalette.search`);
    assert.ok(value.trim().length > 0, `${locale}: empty commandPalette.search`);
  }
});

test('growth registries carry the new mobile search element key', async () => {
  for (const file of [
    '../src/growth/elementKeys.json',
    '../../server/growth/events/elementKeys.json',
  ]) {
    const registry = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
    assert.ok(registry.includes('ui.0b9e115b87.7'), `${file}: missing ui.0b9e115b87.7`);
  }
});
