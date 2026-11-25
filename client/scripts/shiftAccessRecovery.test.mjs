// 450 access-change recovery UI (D-441): the self view mounts above the
// shift brief and stays visible when the brief 403s; the manager view
// renders null on 403 and reassigns through the real handoff route.
// No jsdom or testing-library exists in this repo, so these checks assert
// the wiring in source (the walletPage.test.mjs pattern); the endpoints
// and the reassign path are proved end to end by
// server/__tests__/gapsShiftRecovery.db.test.js, and build:ci proves the
// JSX compiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panelSource = fs.readFileSync(
  new URL('../src/components/businessHub/g56/ShiftPanel.jsx', import.meta.url), 'utf8');

const NEW_KEYS = ['recoveryTitle', 'recoveryLost', 'recoveryTickets', 'recoveryRecover',
  'recoveryRecovered', 'recoveryManagersNotified', 'recoveryReleasedAt',
  'managerRecoveryTitle', 'managerRecoveryIntro', 'managerRecoveryLostBy',
  'managerRecoveryTeammates', 'managerRecoveryAssignTo', 'managerRecoveryReassign',
  'managerRecoveryNoPermission', 'managerRecoveryReleased'];

// Source of the two new sections only (not the whole panel: TicketSection
// and EndShiftSection still carry the D-440 sibling-gap URLs).
const selfStart = panelSource.indexOf('function AccessRecoverySection');
const managerStart = panelSource.indexOf('function ManagerRecoverySection');
const lateStart = panelSource.indexOf('function LateOrdersSection');
const selfSource = panelSource.slice(selfStart, managerStart);
const managerSource = panelSource.slice(managerStart, lateStart);
const newSource = panelSource.slice(selfStart, lateStart);

test('self section mounts above the shift brief in the normal render', () => {
  const sectionIndex = panelSource.indexOf('<AccessRecoverySection />');
  const titleIndex = panelSource.indexOf("<h3>{b.tr('title')}</h3>");
  const briefIndex = panelSource.indexOf('<ShiftBrief b={b}');
  assert.ok(sectionIndex !== -1, 'ShiftPanel must render <AccessRecoverySection />');
  assert.ok(sectionIndex < titleIndex, 'recovery section must come before the panel title');
  assert.ok(sectionIndex < briefIndex, 'recovery section must come before the shift brief');
});

test('self section still mounts when the brief 403s (early return)', () => {
  const earlyStart = panelSource.indexOf('if (!b.data) {');
  const earlyEnd = panelSource.indexOf('const start = async');
  const early = panelSource.slice(earlyStart, earlyEnd);
  assert.match(early, /<AccessRecoverySection \/>/, 'early return must keep the recovery section');
  assert.ok(early.indexOf('<AccessRecoverySection />') < early.indexOf('g56-error'),
    'recovery section must come before the brief error text');
});

test('manager section mounts in the panel', () => {
  assert.match(panelSource, /<ManagerRecoverySection restaurantId=\{restaurantId\} \/>/);
});

test('self section reads its own access state and recovers through the real legs', () => {
  assert.match(selfSource, /useBizG56\('\/restaurants\/me\/shift-access', 'shift'\)/);
  assert.match(selfSource, /p\.send\('post', '\/restaurants\/me\/shift-access\/recover', \{\}\)/);
  assert.match(selfSource, /lost_access/);
  assert.match(selfSource, /recovered/);
  assert.match(selfSource, /managers_notified/);
  assert.match(selfSource, /recoveryTickets/);
  assert.match(selfSource, /recoveryManagersNotified/);
});

test('self section renders nothing when nothing is lost and nothing recovered', () => {
  assert.match(selfSource, /if \(lost\.length === 0 && recovered\.length === 0\) return null;/);
});

test('manager section renders null on 403 and shows releases when authorized', () => {
  assert.match(managerSource, /useBizG56\(`\/restaurants\/\$\{restaurantId\}\/shift\/access-recovery`, 'shift'\)/);
  assert.match(managerSource, /if \(!p\.data\) return p\.error === 'noAccess' \? null/);
  assert.match(managerSource, /if \(releases\.length === 0\) return null;/);
  assert.match(managerSource, /teammates_on_shift/);
  assert.match(managerSource, /can_reassign/);
});

test('manager reassign posts to the real handoff route with kind owner', () => {
  assert.match(managerSource,
    /p\.send\('post', `\/restaurants\/\$\{restaurantId\}\/shift\/orders\/\$\{orderId\}\/handoff`, \{ kind: 'owner', to_user_id: toUserId \}\)/);
});

test('manager reassign form only appears for unassigned tickets the caller may reassign', () => {
  assert.match(managerSource, /!t\.owner_user_id && p\.data\.can_reassign/);
  assert.match(managerSource, /managerRecoveryNoPermission/);
});

test('the new sections use no wrong /shift/* URLs', () => {
  for (const wrong of ['/shift/verify-pickup/', '/shift/batch-print', '/shift/handoff/',
    '/shift/tickets/', '/shift/end/preview']) {
    assert.ok(!newSource.includes(wrong), `new sections must not call ${wrong}`);
  }
});

test('all 15 bizG56.shift keys exist non-empty in all five locales', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(
      new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8'));
    const shift = catalog.bizG56.shift;
    assert.equal(Object.keys(shift).length, 82, `${lang} must have 82 shift keys`);
    for (const key of NEW_KEYS) {
      assert.equal(typeof shift[key], 'string', `${lang} bizG56.shift.${key} must exist`);
      assert.ok(shift[key].length > 0, `${lang} bizG56.shift.${key} must not be empty`);
    }
  }
});

test('interpolation variables match across locales', () => {
  const vars = (value) => [...value.matchAll(/{{\s*([A-Za-z0-9_]+)\s*}}/g)]
    .map((m) => m[1]).sort().join(',');
  const en = JSON.parse(fs.readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
  for (const lang of ['es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(
      new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of NEW_KEYS) {
      assert.equal(vars(catalog.bizG56.shift[key]), vars(en.bizG56.shift[key]),
        `${lang} bizG56.shift.${key} interpolation must match en`);
    }
  }
});

test('growth ids continue ui.33e821f241.28+ in source and both registries', () => {
  for (const id of ['ui.33e821f241.28', 'ui.33e821f241.29', 'ui.33e821f241.30']) {
    assert.ok(panelSource.includes(`data-track="${id}"`), `ShiftPanel must use ${id}`);
    for (const registry of ['../src/growth/elementKeys.json', '../../server/growth/events/elementKeys.json']) {
      const keys = JSON.parse(fs.readFileSync(new URL(registry, import.meta.url), 'utf8'));
      assert.ok(keys.includes(id), `${registry} must include ${id}`);
    }
  }
});
