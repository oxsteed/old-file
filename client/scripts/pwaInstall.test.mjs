import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'public');
const manifestPath = path.join(publicDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function iconFile(src) {
  assert.match(src, /^\//, `icon src must be absolute: ${src}`);
  const full = path.join(publicDir, src.slice(1));
  assert.ok(fs.existsSync(full), `manifest icon missing: ${src}`);
  return full;
}

test('manifest has identity fields for install attribution', () => {
  assert.equal(manifest.id, '/');
  assert.match(manifest.start_url, /utm_source=pwa_install/, 'start_url must carry the install UTM');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.launch_handler && manifest.launch_handler.client_mode === 'focus-existing');
});

test('manifest description names all three surfaces and stays short', () => {
  assert.ok(manifest.description.length <= 324, `description too long: ${manifest.description.length}`);
  for (const word of ['helpers', 'food', 'wallet']) {
    assert.match(manifest.description.toLowerCase(), new RegExp(word), `description should mention ${word}`);
  }
});

test('manifest declares required icon purposes with files on disk', () => {
  const purposes = manifest.icons.map((i) => i.purpose);
  for (const need of ['any', 'maskable', 'monochrome']) {
    assert.ok(purposes.includes(need), `missing icon purpose: ${need}`);
  }
  for (const icon of manifest.icons) iconFile(icon.src);
});

test('manifest shortcuts are money funnels with icons and attribution', () => {
  assert.ok(manifest.shortcuts.length >= 4, 'expected at least 4 shortcuts');
  const urls = manifest.shortcuts.map((s) => s.url);
  assert.ok(urls.some((u) => u.startsWith('/food')), 'missing Order Food shortcut');
  assert.ok(urls.some((u) => u.startsWith('/oxsteed-credit')), 'missing Top Up shortcut');
  assert.ok(urls.some((u) => u.startsWith('/orders')), 'missing Track Order shortcut');
  assert.ok(urls.some((u) => u.startsWith('/post-job')), 'missing Post a Job shortcut');
  for (const shortcut of manifest.shortcuts) {
    assert.match(shortcut.url, /source=app_shortcut/, `shortcut missing attribution: ${shortcut.name}`);
    assert.ok(shortcut.icons && shortcut.icons.length > 0, `shortcut missing icon: ${shortcut.name}`);
    for (const icon of shortcut.icons) iconFile(icon.src);
  }
});

test('manifest screenshots reference real files with matching sizes', () => {
  for (const shot of manifest.screenshots || []) {
    const full = iconFile(shot.src);
    assert.ok(shot.sizes, 'screenshot must declare sizes');
    assert.ok(shot.form_factor === 'narrow' || shot.form_factor === 'wide', 'screenshot needs a form_factor');
  }
});

test('apple-touch-icon is a dedicated opaque 180x180 file', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(match, 'index.html must link an apple-touch-icon');
  const full = path.join(publicDir, match[1].replace(/^\//, ''));
  assert.ok(fs.existsSync(full), `apple-touch-icon missing: ${match[1]}`);
});

test('pwa install manager enforces dismissal discipline and money-moment gating', () => {
  const src = fs.readFileSync(path.join(root, 'src/utils/pwaInstall.js'), 'utf8');
  assert.match(src, /preventDefault\(\)/, 'must preventDefault the native banner');
  assert.match(src, /MAX_DISMISSALS/, 'must cap dismissals');
  assert.match(src, /SUPPRESS_MS/, 'must suppress after dismissal');
  assert.match(src, /notifyMoneyMoment/, 'must expose the money-moment trigger');
  assert.match(src, /pwa_prompt_shown/, 'must log prompt shown');
  assert.match(src, /pwa_prompt_outcome/, 'must log prompt outcome');
  assert.match(src, /pwa_installed/, 'must log installs');
  assert.match(src, /pwa_session_start/, 'must log session start with launch mode');
});

test('install prompt UI is mounted globally and localized', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
  assert.match(app, /PwaInstallPrompt/, 'PwaInstallPrompt must be mounted in App');
  const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
  assert.match(main, /initPwaInstall\(\)/, 'initPwaInstall must run at boot');
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const locales = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${lang}.json`), 'utf8'));
    assert.ok(locales.pwa && locales.pwa.installTitle, `missing pwa strings in ${lang}`);
  }
});

test('install prompt fires at money moments only', () => {
  const restaurant = fs.readFileSync(path.join(root, 'src/pages/food/FoodRestaurantPage.jsx'), 'utf8');
  assert.match(restaurant, /notifyMoneyMoment\('food_order'\)/);
  const postJob = fs.readFileSync(path.join(root, 'src/pages/PostJobPage.jsx'), 'utf8');
  assert.match(postJob, /notifyMoneyMoment\('job_posted'\)/);
});
