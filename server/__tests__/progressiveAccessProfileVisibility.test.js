'use strict';

const helpers = require('../controllers/helpersController');

afterEach(() => { delete process.env.ACCESS_PROJECTION_ENABLED; delete process.env.ACCESS_PILOT_USER_IDS; });

test('legacy helper discovery predicate remains role-compatible when projection is off', () => {
  expect(helpers.publicHelperRolePredicate('u')).toBe('u.role = ANY($1::user_role[])');
  expect(helpers.publicHelperStandingPredicate('u')).toBe("u.role IN ('helper', 'helper_pro', 'broker')");
});

test('projection-enabled discovery accepts an effective helper capability without changing legacy roles', () => {
  process.env.ACCESS_PROJECTION_ENABLED = 'true';
  const role = helpers.publicHelperRolePredicate('u');
  const standing = helpers.publicHelperStandingPredicate('u');
  for (const predicate of [role, standing]) {
    expect(predicate).toMatch(/access_grants/);
    expect(predicate).toMatch(/helper\.offer_services/);
    expect(predicate).toMatch(/status = 'active'/);
    expect(predicate).toMatch(/expires_at IS NULL OR ag\.expires_at > NOW/);
  }
});

test('public profile and dynamic availability surfaces share the capability standing gate', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../controllers/helpersController.js'), 'utf8');
  expect((source.match(/publicHelperStandingPredicate\('u'\)/g) || []).length).toBeGreaterThanOrEqual(6);
  const slots = require('node:fs').readFileSync(require('node:path').join(__dirname, '../controllers/helperAvailabilityController.js'), 'utf8');
  expect(slots).toMatch(/access_grants/);
  expect(slots).toMatch(/helper\.offer_services/);
});
