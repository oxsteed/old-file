import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('progressive access deletes the navbar mode switcher; Applications stays reachable from Settings', async () => {
  await assert.rejects(source('components/ModeSwitcher.jsx'), /ENOENT/);
  const navbar = await source('components/Navbar.jsx');
  assert.doesNotMatch(navbar, /ModeSwitcher/);
  const settings = await source('pages/SettingsPage.jsx');
  assert.match(settings, /to="\/settings\/applications"/);
});

test('mode switcher keys and constants are deleted', async () => {
  const launchScope = await source('utils/launchScope.js');
  assert.doesNotMatch(launchScope, /LAUNCH_SWITCHER_MODES/);
  const joinPage = await source('pages/JoinPage.jsx');
  assert.doesNotMatch(joinPage, /MODE_CATALOG/);
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(
      await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'),
    );
    assert.equal(catalog.modes, undefined, `${language} modes key`);
    assert.equal(catalog.modeSwitcher, undefined, `${language} modeSwitcher key`);
  }
});

test('settings account no longer offers self-selected mode switching', async () => {
  const code = await source('pages/SettingsPage.jsx');
  assert.doesNotMatch(code, /handleSwitchMode/);
  assert.doesNotMatch(code, /LAUNCH_SELF_SELECTABLE_MODES/);
  assert.doesNotMatch(code, /switchRole/);
  assert.match(code, /progressiveAccess\.heldTitle/);
  assert.match(code, /to="\/settings\/applications"/);
});

test('approved customer-role helpers receive capability-aware client actions', async () => {
  const context = await source('context/AuthContext.jsx');
  const model = await source('utils/jobDetailModel.js');
  assert.match(context, /useAccessProjection/);
  assert.match(context, /helper\.offer_services/);
  assert.match(context, /hasHelperAccess/);
  assert.match(model, /hasHelperAccess/);
  for (const file of [
    'components/messaging/MessagingWorkspace.jsx',
    'pages/CalendarPage.jsx',
    'pages/InvoicesPage.jsx',
    'pages/ProductMarketplacePage.jsx',
    'pages/SettingsPage.jsx',
  ]) {
    assert.match(await source(file), /hasHelperAccess/, file);
  }
});
