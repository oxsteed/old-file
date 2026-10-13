import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildJobPatch, canEditJob, bidNeedingReconfirm, classifyEditError, fieldErrorKeys, formFromJob, inputToCents,
  postJobFieldErrors, JOB_EDIT_ERROR_CODES, SCHEMA_LIMITS,
} from '../src/utils/jobEditModel.js';
import { jobDetailView } from '../src/utils/jobDetailModel.js';
import { revisionFieldKeys, revisionValue, REVISION_SOURCES } from '../src/utils/jobRevisionFormat.js';

const job = {
  id: 'j1', client_id: '1', status: 'published', version: 4, revision: 1, bid_count: 2,
  title: 'Translated title', original_title: 'Replace the broken fence panel', description: 'd'.repeat(80),
  budget_type: 'fixed', budget_min_cents: 20000, budget_max_cents: 20000, budget_min: '200.00',
  urgency: 'this_week', site_access: 'easy', recurrence: 'none', location_city: 'Austin', location_country: 'US',
  location_address: '1 Main St', notes: 'Gate code 1234', private_notes: null, scheduled_start_at: null,
};

test('form uses original (untranslated) text and cents-accurate money', () => {
  const form = formFromJob(job);
  assert.equal(form.title, 'Replace the broken fence panel');
  assert.equal(form.budget_min, '200');
  assert.equal(formFromJob({ ...job, budget_min_cents: 12345 }).budget_min, '123.45');
  assert.equal(inputToCents('1,234.5'), 123450);
  assert.ok(Number.isNaN(inputToCents('12.345')));
  assert.equal(inputToCents(''), null);
});

test('only changed fields are sent; unchanged form produces an empty patch', () => {
  assert.deepEqual(buildJobPatch(job, formFromJob(job)).patch, {});
  const changed = buildJobPatch(job, { ...formFromJob(job), notes: '', budget_min: '150' });
  assert.deepEqual(changed.patch, { budget_min_cents: 15000, budget_max_cents: 15000, notes: null });
  assert.equal(changed.material, true);
  assert.equal(buildJobPatch(job, { ...formFromJob(job), notes: 'Dog is friendly' }).material, false);
});

test('schedule: date-only anchors at 09:00 UTC; time makes it a datetime', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const dateOnly = buildJobPatch(job, { ...formFromJob(job), scheduled_date: '2026-11-02' }, { now });
  assert.equal(dateOnly.patch.scheduled_start_at, '2026-11-02T09:00:00.000Z');
  assert.equal(dateOnly.patch.scheduled_precision, 'date');
  const past = buildJobPatch(job, { ...formFromJob(job), scheduled_date: '2020-01-01', scheduled_time: '10:00' }, { now });
  assert.equal(past.errors.scheduled_start_at, 'in_past');
});

test('client validation mirrors the server and maps to form fields', () => {
  const bad = buildJobPatch(job, { ...formFromJob(job), title: 'short', budget_type: 'range', budget_min: '500', budget_max: '100' });
  assert.deepEqual(bad.errors, { title: 'too_short', budget_max_cents: 'budget_order' });
  assert.deepEqual(fieldErrorKeys(bad.errors), { title: 'jobEdit.errors.too_short', budget_max: 'jobEdit.errors.budget_order' });
  assert.equal(fieldErrorKeys({ x: 'weird' }).x, 'jobEdit.errors.invalid');
});

test('after hiring, locked fields are never sent', () => {
  const hired = { ...job, status: 'accepted' };
  const result = buildJobPatch(hired, { ...formFromJob(hired), budget_min: '1', description: 'z'.repeat(70), notes: 'New note' });
  assert.deepEqual(Object.keys(result.patch), ['notes']);
});

test('edit failures are classified for recovery', () => {
  const err = (status, data) => ({ response: { status, data } });
  assert.equal(classifyEditError(err(412, {})).kind, 'conflict');
  assert.equal(classifyEditError(err(409, { code: 'version_conflict' })).kind, 'conflict');
  assert.equal(classifyEditError(err(409, { code: 'job_not_editable' })).kind, 'notEditable');
  assert.equal(classifyEditError(err(429, { code: 'material_edit_limit' })).kind, 'materialLimit');
  assert.equal(classifyEditError(err(429, {})).kind, 'rateLimited');
  assert.deepEqual(classifyEditError(err(422, { fields: { budget_min_cents: 'budget_negative' } })),
    { kind: 'fields', fields: { budget_min: 'jobEdit.errors.budget_negative' } });
  assert.equal(classifyEditError(new Error('network')).kind, 'unknown');
});

test('edit permission and reconfirm detection', () => {
  assert.equal(canEditJob(job, { id: '1' }), true);
  assert.equal(canEditJob({ ...job, status: 'accepted' }, { id: '1' }), false);
  assert.equal(canEditJob({ ...job, can_edit: true, status: 'accepted' }, { id: '9', role: 'admin' }), true);
  assert.equal(canEditJob(job, { id: '2' }), false);
  const bids = [{ id: 'b', helper_id: '2', status: 'pending', needs_reconfirm: true }];
  assert.equal(bidNeedingReconfirm(bids, { id: '2' }, job).id, 'b');
  assert.equal(bidNeedingReconfirm([{ ...bids[0], needs_reconfirm: false, job_revision: 1 }], { id: '2' }, { ...job, revision: 2 }).id, 'b');
  assert.equal(bidNeedingReconfirm([{ ...bids[0], needs_reconfirm: false, job_revision: 2 }], { id: '2' }, { ...job, revision: 2 }), null);
});

test('helpers can bid on every open status', () => {
  for (const status of ['published', 'matched', 'negotiating']) {
    const view = jobDetailView({ job: { ...job, status, client_id: '1' }, user: { id: 2, role: 'helper' }, bidsStatus: 'success', canApplyToJobs: true });
    assert.equal(view.canSubmitBid, true, status);
    assert.equal(view.action, 'bid', status);
  }
});

test('post-job errors are localized from server codes', () => {
  const t = (key) => `t:${key}`;
  const errors = postJobFieldErrors({ title: 'too_short', location: 'required', budget_min_cents: 'budget_negative' }, t);
  assert.equal(errors.title, 't:jobEdit.errors.too_short');
  assert.equal(errors.locationCity, 't:jobEdit.errors.required');
  assert.match(errors.submit, /jobEdit\.errors\.budget_negative/);
  assert.equal(SCHEMA_LIMITS.titleMin, 10);
});

test('revision display helpers', () => {
  assert.deepEqual(revisionFieldKeys({ location_lat: 1, location_lng: 2, budget_min_cents: 1 }), ['address', 'budgetMin']);
  assert.equal(revisionValue('budget_min_cents', 12345), '123.45');
  assert.equal(revisionValue('title', null), '—');
});

const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const flatten = (value, prefix = '') => (typeof value === 'string' ? [[prefix, value]]
  : Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)));

test('jobEdit copy exists in both catalogs for every language, identical, with matching placeholders', async () => {
  const english = JSON.parse(await readFile(new URL('../src/i18n/locales/en/common.json', import.meta.url))).jobEdit;
  const englishKeys = flatten(english).map(([k]) => k).sort();
  for (const code of JOB_EDIT_ERROR_CODES) assert.ok(english.errors[code], code);
  for (const source of REVISION_SOURCES) assert.ok(english.sources[source], source);
  for (const language of LANGUAGES) {
    const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url))).jobEdit;
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url))).jobEdit;
    assert.deepEqual(legacy, common, language);
    const entries = flatten(common);
    assert.deepEqual(entries.map(([k]) => k).sort(), englishKeys, language);
    for (const [key, value] of entries) {
      assert.ok(value.trim(), `${language} ${key}`);
      const names = (s) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
      assert.deepEqual(names(value), names(flatten(english).find(([k]) => k === key)[1]), `${language} ${key}`);
    }
  }
  const ar = JSON.parse(await readFile(new URL('../src/i18n/locales/ar/common.json', import.meta.url))).jobEdit;
  assert.match(ar.pageTitle, /[\u0600-\u06FF]/);
  assert.equal(ar.changeArrow, '←');
});

test('jobDetail namespace size is unchanged', async () => {
  for (const language of LANGUAGES) {
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url)));
    assert.equal(Object.keys(common.jobDetail).length, 44);
  }
});
