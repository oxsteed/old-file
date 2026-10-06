'use strict';

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

beforeEach(() => resetMocks());

test('skills lookup selects only columns defined by its migration', () => {
  const routeSource = read('routes/admin.js');
  const skillsMigration = read('migrations/037_skills_and_licenses_lookup.sql');
  const skillsSelect = routeSource.match(/router\.get\('\/skills-lookup',[\s\S]*?`SELECT([\s\S]*?)FROM skills_lookup/);

  expect(skillsMigration).toMatch(/CREATE TABLE IF NOT EXISTS skills_lookup/);
  expect(skillsMigration).not.toMatch(/created_at/);
  expect(skillsSelect?.[1]).toContain('id, name, category, is_active');
  expect(skillsSelect?.[1]).not.toContain('created_at');
});

test('business launch status migration supports the admin archive action', () => {
  const statusMigration = read('migrations/700_business_launch_archived_status.sql');

  expect(statusMigration).toContain('DROP CONSTRAINT IF EXISTS consulting_requests_status_check');
  expect(statusMigration).toMatch(/CHECK \(status IN \([\s\S]*'archived'/);
});

test('business launch list qualifies columns shared by joined tables', async () => {
  const { getBusinessLaunchRequests } = require('../controllers/businessLaunchController');
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '0' }] })
    .mockResolvedValueOnce({ rows: [] });

  const res = { json: jest.fn() };
  await getBusinessLaunchRequests({ query: { search: 'founder', status: 'pending' } }, res);

  const dataQuery = String(mockQuery.mock.calls[1][0]);
  expect(dataQuery).toContain('cr.status = $1');
  expect(dataQuery).toContain('cr.first_name ILIKE $2');
  expect(dataQuery).toContain('cr.last_name ILIKE $2');
  expect(dataQuery).toContain('cr.email ILIKE $2');
  expect(dataQuery).toContain('cr.created_at, cr.updated_at');
});
