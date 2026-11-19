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

test('WP-104 cutover 1.2: mode-router machinery, register redirects and the JoinPage mode state are gone', async () => {
  // modeRouter.js is deleted outright: its catalog served only the deleted
  // ModeSwitcher, and no other module imports it.
  await assert.rejects(source('utils/modeRouter.js'), /ENOENT/);
  const app = await source('App.jsx');
  assert.doesNotMatch(app, /path="\/register\/customer"/);
  assert.doesNotMatch(app, /path="\/register\/helper"/);
  // The /register/:mode entry survives (1.7 deep-link index): stale links
  // resolve through LegacyRegisterRedirect, never 404.
  assert.match(app, /path="\/register\/:mode"/);
  const join = await source('pages/JoinPage.jsx');
  // The ?mode= preset survives, but only as an intent preselect: it maps a
  // legacy mode to its signup intent and never mints a mode.
  assert.match(join, /intentForLegacyMode/);
  assert.match(join, /signupIntent: presetIntent/);
  assert.doesNotMatch(join, /defaultMode/);
  assert.doesNotMatch(join, /postSignupRouteForMode/);
  assert.match(join, /signupIntent: form\.signupIntent/);
  assert.match(join, /name="signupIntent"/);
  const navbar = await source('components/Navbar.jsx');
  assert.doesNotMatch(navbar, /routeForMode/);
  await assert.rejects(source('components/ModeSwitcher.jsx'), /ENOENT/);
  const validation = await source('utils/signupValidation.js');
  assert.doesNotMatch(validation, /defaultMode/);
  assert.match(validation, /form\.signupIntent/);
});
