'use strict';

// Unit tests for the pure careers logic (no database): catalog, opening
// validation, pay-transparency scanning, offers, Jobs for you, AI-ranking
// inputs and order, fairness ratios, scope helpers and templates.
// Route, permission and flow coverage lives in careers.db.test.js.

const { slugify, STAGE_TRANSITIONS, getCareerCatalog, LOCALES } = require('../services/careerCatalog');
const { parseOpening } = require('../services/careers/validation');
const { scanText, checkOpening, jurisdictionOf } = require('../services/careers/compliance');
const { parseOffer } = require('../services/careers/offers');
const { jobsForYou, rankOrder, hourlyEquivalent, isNycOpening, addBusinessDays } = require('../services/careers/matching');
const { buildRankInput, MODEL_FACT_TYPES } = require('../services/careers/ranking');
const { impactRatios, IMPACT_THRESHOLD, MIN_GROUP } = require('../services/careers/fairness');
const { locationsInScope, canHireRole } = require('../services/careers/access');
const templates = require('../utils/careerNotificationTemplates');
const { previousMonth, previousQuarter } = require('../jobs/careersJobs');

const opening = (over = {}) => ({
  title: 'Line cook', department: 'restaurant', path_stage: 'part_time', employment_type: 'part_time', workplace_type: 'onsite',
  country_code: 'US', region: 'FL', city: 'Miami', timezone: 'America/New_York', currency_code: 'USD',
  compensation_min: 15, compensation_max: 19, compensation_period: 'hourly', work_authorization: 'local_authorized',
  description: 'Grill and prep.', ...over,
});

describe('catalog', () => {
  test('hire only by candidate acceptance: no stage moves straight to hired or offer', () => {
    for (const next of Object.values(STAGE_TRANSITIONS)) {
      expect(next).not.toContain('hired');
      expect(next).not.toContain('offer');
    }
    expect(STAGE_TRANSITIONS.hired).toEqual([]);
  });
  test('slugify is locale-safe', () => {
    expect(slugify('Chef de Partie — Port-au-Prince')).toBe('chef-de-partie-port-au-prince');
  });
  test('catalog lists all 20 locales', () => {
    expect(LOCALES).toHaveLength(20);
    expect(getCareerCatalog()).toEqual(expect.objectContaining({ workplaceTypes: expect.arrayContaining(['remote', 'hybrid', 'onsite']) }));
  });
});

describe('opening validation (Q12 pay everywhere)', () => {
  test('pay range required', () => {
    const { errors } = parseOpening(opening({ compensation_min: null, compensation_max: null }), { employerType: 'business' });
    expect(errors.fields).toEqual(expect.objectContaining({ compensation_min: expect.any(String), compensation_max: expect.any(String) }));
  });
  test('max must be at least min', () => {
    const { errors } = parseOpening(opening({ compensation_min: 20, compensation_max: 10 }), { employerType: 'business' });
    expect(errors.fields.compensation_max).toBeTruthy();
  });
  test('a complete opening validates', () => {
    const { errors, value } = parseOpening(opening(), { employerType: 'business' });
    expect(errors.fields).toEqual({});
    expect(value.country_code).toBe('US');
  });
});

describe('pay transparency and discriminatory wording', () => {
  test.each([
    ['What is your current salary?', 'salary_history'],
    ['US citizens only', 'citizens_only'],
    ['Women only please', 'gender_only'],
    ['Applicants under 30', 'age_limit'],
  ])('blocks "%s"', (text, code) => {
    expect(scanText(text).blocking.map((b) => b.code)).toContain(code);
  });
  test('warns on coded wording without blocking', () => {
    const r = scanText('Looking for a young, energetic waitress');
    expect(r.blocking).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['age_coded', 'gendered_title']));
  });
  test('state names normalize to jurisdiction codes', () => {
    expect(jurisdictionOf({ country_code: 'US', region: 'Colorado' })).toBe('US-CO');
    expect(jurisdictionOf({ country_code: 'DE' })).toBe('DE');
  });
  test('checkOpening flags a missing range', () => {
    const r = checkOpening({ ...opening(), compensation_min: null, compensation_max: null });
    expect(r.blocking.length).toBeGreaterThan(0);
  });
});

describe('offers', () => {
  const app = {
    stage: 'interview', employer_type: 'business', opening_period: 'hourly', opening_location_ids: [7],
    compensation_min: 15, compensation_max: 19, opening_team_role: 'employee', opening_title: 'Line cook',
  };
  const start = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  test('pay below the posted range is refused', () => {
    expect(() => parseOffer({ pay: 10, start_date: start }, app)).toThrow();
  });
  test('above range needs a reason and is marked', () => {
    expect(() => parseOffer({ pay: 25, start_date: start }, app)).toThrow();
    const v = parseOffer({ pay: 25, start_date: start, outside_posted_range_reason: 'Senior' }, app);
    expect(v.aboveRange).toBe(true);
    expect(v.locationId).toBe(7);
  });
  test('pay in another period is compared on an hourly basis', () => {
    const v = parseOffer({ pay: 34000, pay_period: 'yearly', start_date: start }, app);
    expect(v.aboveRange).toBe(false);
    expect(hourlyEquivalent(34000, 'yearly')).toBeGreaterThan(15);
  });
  test('background check is a condition only when the opening lists it and checks are on', () => {
    expect(parseOffer({ pay: 16, start_date: start }, { ...app, background_check_required: true }, { settings: { background_checks_enabled: false } }).conditions).not.toContain('background_check');
    const v = parseOffer({ pay: 16, start_date: start }, { ...app, background_check_required: true }, { settings: { background_checks_enabled: true } });
    expect(v.conditions).toContain('background_check');
    expect(v.isConditional).toBe(true);
  });
  test('expiry is capped at 30 days', () => {
    expect(() => parseOffer({ pay: 16, start_date: start, expires_in_days: 45 }, app)).toThrow();
  });
});

describe('Jobs for you', () => {
  test('excludes roles needing authorization the worker lacks', () => {
    expect(jobsForYou(opening(), {}, { workerAuthorized: false }).excluded).toBe(true);
  });
  test('scores with reasons and never reads ratings or boosts', () => {
    const r = jobsForYou({ ...opening(), is_promoted: true, rating: 5 }, { desired_roles: ['restaurant'], travel_radius_km: 20, languages: ['en'] }, { distanceKm: 2 });
    expect(r.excluded).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(['role_match', 'within_radius']));
    const same = jobsForYou({ ...opening(), is_promoted: false, rating: 1 }, { desired_roles: ['restaurant'], travel_radius_km: 20, languages: ['en'] }, { distanceKm: 2 });
    expect(same.score).toBe(r.score);
  });
});

describe('AI ranking inputs and order (Q6, R10)', () => {
  test('the model never sees names, photos, contact, postal codes, ratings or EEO', () => {
    const input = buildRankInput(
      { required_credentials: ['food_handler'], required_languages: ['es:fluent'] },
      {
        first_name: 'Ana', last_name: 'Diaz', applicant_email: 'a@example.com', phone: '555', city: 'Miami', photo_url: 'x',
        eeo: { sex: 'female' }, postal_code: '33101', languages: ['es:fluent'],
        profile_snapshot: {
          facts: [
            { fact_type: 'rating', value: { average: 4.9 } },
            { fact_type: 'rehire_eligible', value: { eligible: true } },
            { fact_type: 'certificate', value: { code: 'food_handler', expires_on: '2027-01-01', holder_name: 'Ana Diaz' } },
          ],
          added_by_you: { headline: 'Hi I am Ana' },
          skill_codes: ['grill'],
        },
      }
    );
    const json = JSON.stringify(input);
    for (const banned of ['Ana', 'Diaz', 'a@example.com', '555', 'Miami', 'photo', 'female', '33101', 'rating', 'rehire', '4.9', 'holder_name']) {
      expect(json).not.toContain(banned);
    }
    expect(input.applicant.facts).toEqual([expect.objectContaining({ type: 'certificate', value: { code: 'food_handler', expires_on: '2027-01-01' } })]);
    expect(MODEL_FACT_TYPES).not.toContain('rating');
  });
  test('order depends on requirements met then applied date only', () => {
    const apps = [
      { id: 1, created_at: '2026-10-01', is_promoted: true, rating: 5 },
      { id: 2, created_at: '2026-10-02' },
      { id: 3, created_at: '2026-09-30' },
    ];
    const a = new Map([
      [1, [{ required: true, status: 'partly_met' }]],
      [2, [{ required: true, status: 'met' }]],
      [3, [{ required: true, status: 'partly_met' }]],
    ]);
    expect(rankOrder(apps, a).map((r) => r.application_id)).toEqual([2, 3, 1]);
  });
  test('NYC openings are recognized for the LL144 notice period', () => {
    expect(isNycOpening({ country_code: 'US', city: 'Brooklyn' })).toBe(true);
    expect(isNycOpening({ country_code: 'US', city: 'Miami' })).toBe(false);
    const d = addBusinessDays(new Date('2026-10-23T12:00:00Z'), 10);
    expect(d.getUTCDate()).toBe(6);
  });
});

describe('fairness (four-fifths rule)', () => {
  const rows = (group, n, selected) => Array.from({ length: n }, (_, i) => ({ group, selected: i < selected }));
  test('flags a ratio under 0.8', () => {
    const r = impactRatios([...rows('a', 20, 10), ...rows('b', 20, 4)]);
    expect(r.minRatio).toBeCloseTo(0.4);
    expect(r.minRatio).toBeLessThan(IMPACT_THRESHOLD);
  });
  test('small groups and declines are not scored', () => {
    const r = impactRatios([...rows('a', 20, 10), ...rows('b', MIN_GROUP - 1, 0), ...rows('decline', 30, 0)]);
    expect(r.suppressed).toContain('b');
    expect(r.minRatio).toBeNull();
  });
});

describe('hiring scope helpers (Q17, C-01, C-03)', () => {
  test('store managers stay inside their stores; business-wide needs business or brand scope', () => {
    const store = { kind: 'business', isOwner: false, role: 'manager', scope: { mode: 'stores', locationIds: [1, 2] } };
    expect(locationsInScope(store, [1])).toBe(true);
    expect(locationsInScope(store, [3])).toBe(false);
    expect(locationsInScope(store, [])).toBe(false);
    expect(locationsInScope({ ...store, scope: { mode: 'brand' } }, [])).toBe(true);
  });
  test('rank guard', () => {
    expect(canHireRole({ role: 'manager' }, 'employee')).toBe(true);
    expect(canHireRole({ role: 'manager' }, 'manager')).toBe(false);
    expect(canHireRole({ isOwner: true, role: 'owner' }, 'manager')).toBe(true);
  });
});

describe('notification templates', () => {
  test('every careers template has en, es, fr, ht and ar copy', () => {
    const all = templates.careerNotifications;
    const entries = Object.entries(all).filter(([k, v]) => k.startsWith('career_') && v && v.title);
    expect(entries.length).toBeGreaterThan(20);
    for (const [, t] of entries) {
      for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
        expect(t.title[lang]).toBeTruthy();
        expect(t.body[lang]).toBeTruthy();
      }
    }
  });
});

describe('job periods', () => {
  test('previous month and quarter', () => {
    expect(previousMonth(new Date('2026-11-01T04:00:00Z'))).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-11-01' });
    expect(previousQuarter(new Date('2026-10-01T04:00:00Z'))).toEqual({ periodStart: '2026-07-01', periodEnd: '2026-10-01' });
  });
});
