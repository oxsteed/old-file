import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPayRange, formatMoney, formToOpeningPayload, openingToForm, validateOpeningForm, EMPTY_OPENING,
  availabilityToForm, formToAvailability, groupByStage, offerBlockers, applicantLabel, NEUTRAL_MOVES,
  rankingNotice, isEorAllowed, fieldErrorsFrom, formatWhen,
} from './careersModel.js';

test('pay range formats in the opening currency', () => {
  assert.equal(formatPayRange({ currency_code: 'USD', compensation_min: 15, compensation_max: 19 }, 'en-US'), '$15–$19');
  assert.equal(formatPayRange({ currency_code: 'EUR', compensation_min: 12, compensation_max: 12 }, 'en-US'), '€12');
  assert.equal(formatMoney(null), '');
  assert.match(formatMoney(10, 'XXX_BAD', 'en'), /XXX_BAD 10.00/);
});

test('opening form requires pay and keeps the range ordered', () => {
  const errs = validateOpeningForm({ ...EMPTY_OPENING, title: 'Cook' });
  assert.equal(errs.compensation_min, 'payRequired');
  assert.equal(errs.compensation_max, 'payRequired');
  assert.equal(validateOpeningForm({ ...EMPTY_OPENING, title: 'Cook', compensation_min: 20, compensation_max: 10 }).compensation_max, 'maxBelowMin');
  assert.deepEqual(validateOpeningForm({ ...EMPTY_OPENING, title: 'Cook', compensation_min: 15, compensation_max: 19 }), {});
  assert.equal(validateOpeningForm({ ...EMPTY_OPENING, title: 'Cook', compensation_min: 1, compensation_max: 2, background_check_required: true }).background_check_reason, 'required');
});

test('form payload: lists split, EOR only on shift/seasonal/temporary, platform drops team fields', () => {
  const p = formToOpeningPayload({ ...EMPTY_OPENING, title: 'Cook', compensation_min: '15', compensation_max: '19', required_languages: 'es, en', employer_model: 'oxsteed_eor', path_stage: 'full_time' });
  assert.deepEqual(p.required_languages, ['es', 'en']);
  assert.equal(p.compensation_min, 15);
  assert.equal(p.employer_model, 'direct');
  assert.equal(p.background_check_package, null);
  const eor = formToOpeningPayload({ ...EMPTY_OPENING, employer_model: 'oxsteed_eor', path_stage: 'seasonal' });
  assert.equal(eor.employer_model, 'oxsteed_eor');
  const platform = formToOpeningPayload({ ...EMPTY_OPENING }, { employerType: 'platform' });
  assert.equal('team_role' in platform, false);
  assert.equal('location_ids' in platform, false);
  assert.equal(isEorAllowed('shift'), true);
  assert.equal(isEorAllowed('full_time'), false);
});

test('opening round-trips through the form', () => {
  const form = openingToForm({ title: 'Cook', required_credentials: ['food_handler'], location_ids: ['3'], applications_close_at: '2026-12-01T00:00:00Z' });
  assert.equal(form.required_credentials, 'food_handler');
  assert.deepEqual(form.location_ids, [3]);
  assert.equal(form.applications_close_at, '2026-12-01');
});

test('availability converts both ways', () => {
  const form = availabilityToForm([{ day: 6, start: '08:00', end: '14:00' }]);
  assert.equal(form.sat.on, true);
  assert.equal(form.mon.on, false);
  assert.deepEqual(formToAvailability(form), [{ day: 6, start: '08:00', end: '14:00' }]);
});

test('pipeline grouping and moves never include hired or offer', () => {
  const g = groupByStage([{ id: 1, stage: 'received' }, { id: 2, stage: 'interview' }, { id: 3, stage: 'received' }]);
  assert.equal(g.received.length, 2);
  assert.equal(g.interview.length, 1);
  for (const moves of Object.values(NEUTRAL_MOVES)) {
    assert.equal(moves.includes('hired'), false);
    assert.equal(moves.includes('offer'), false);
  }
});

test('offer blockers: 18+ and identity before accepting', () => {
  assert.deepEqual(offerBlockers({}, { adultConfirmed: true, identityVerified: true }), []);
  assert.deepEqual(offerBlockers({}, { adultConfirmed: false, identityVerified: false }), ['age', 'identity']);
  assert.deepEqual(offerBlockers({ expires_at: '2000-01-01' }, { adultConfirmed: true, identityVerified: true }), ['expired']);
});

test('applicants show a number until their name is shared', () => {
  const t = (k, o) => `${k}:${o.number}`;
  assert.equal(applicantLabel({ applicant_number: 7 }, t), 'careers.employer.applicantNumber:7');
  assert.equal(applicantLabel({ first_name: 'Ana', last_name: 'Diaz' }, t), 'Ana Diaz');
});

test('ranking notice explains neutral order', () => {
  assert.equal(rankingNotice({ mode: 'ai' }), null);
  assert.equal(rankingNotice({ mode: 'neutral', reason: 'market_not_enabled' }), 'market_not_enabled');
});

test('server field errors are read from the response', () => {
  assert.deepEqual(fieldErrorsFrom({ response: { data: { fields: { title: 'Title is required' } } } }), { title: 'Title is required' });
  assert.deepEqual(fieldErrorsFrom(new Error('x')), {});
});

test('times show their zone', () => {
  assert.match(formatWhen('2026-11-02T15:00:00Z', 'America/New_York', 'en-US'), /EST|GMT-5/);
});

import { localizedOpening, cleanFilters } from './careersModel.js';

test('postings use a stored translation for the UI language', () => {
  const o = { title: 'Cook', description: 'Cook food', content_locale: 'en', translations: { es: { title: 'Cocinero', description: '' } } };
  assert.equal(localizedOpening(o, 'es').title, 'Cocinero');
  assert.equal(localizedOpening(o, 'es').description, 'Cook food');
  assert.equal(localizedOpening(o, 'es').is_translated, true);
  assert.equal(localizedOpening(o, 'en').is_translated, false);
  assert.equal(localizedOpening(o, 'fr').title, 'Cook');
});

test('empty filters are dropped and radius needs a postal code', () => {
  assert.deepEqual(cleanFilters({ q: '', country: 'US', radius_km: 25 }), { country: 'US' });
  assert.deepEqual(cleanFilters({ near: '10001', radius_km: 25 }), { near: '10001', radius_km: 25 });
});

import { applicationPayload, eeoPayload } from './careersModel.js';

test('EEO answers are sent only on US openings and only when answered', () => {
  const form = { authorized_to_work: true, needs_sponsorship: false, eeo: { sex: 'female', veteran: '' } };
  assert.deepEqual(applicationPayload(form, { country_code: 'US' }).eeo, { sex: 'female' });
  assert.equal('eeo' in applicationPayload(form, { country_code: 'FR' }), false);
  assert.equal(eeoPayload({ sex: 'bogus' }), null);
});

test('application payload records the AI notice when ranking is on', () => {
  assert.equal(applicationPayload({}, { ai_ranking_enabled: true }).ai_notice_shown, true);
  assert.equal(applicationPayload({}, { ai_ranking_enabled: false }).ai_notice_shown, false);
});

import { factValueText } from './careersModel.js';

test('facts render as short values', () => {
  assert.equal(factValueText({ fact_type: 'completed_jobs', value: { count: 12 } }), '12');
  assert.equal(factValueText({ fact_type: 'on_time_rate', value: { rate: 0.955 } }), '96%');
  assert.equal(factValueText({ fact_type: 'avg_rating', value: { average: 4.62, count: 30 } }), '4.6 / 5 (30)');
  assert.match(factValueText({ fact_type: 'certificate', value: { title: 'Food handler', expires_on: '2027-01-15' } }, 'en-US'), /^Food handler → Jan 15, 2027$/);
});
