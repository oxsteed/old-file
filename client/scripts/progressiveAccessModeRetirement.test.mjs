import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('progressive access replaces the navbar mode switcher with Applications navigation', async () => {
  const code = await source('components/ModeSwitcher.jsx');
  assert.match(code, /useAccessProjection/);
  assert.match(code, /accessProjection\?\.flags\?\.accessProjection/);
  assert.match(code, /to="\/settings\/applications"/);
  assert.doesNotMatch(code, /aria-hidden="true".*progressiveAccess\.pageTitle/);
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
});
