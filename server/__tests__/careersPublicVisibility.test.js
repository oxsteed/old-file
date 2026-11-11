'use strict';

const { listPublic, getPublic } = require('../services/careers/openings');
const employers = require('../services/careers/marketplace/employers');
const seeker = require('../services/careers/marketplace/seeker');

function dbWith(rows = []) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return { rows };
    }),
  };
}

test('public career listing joins owner and applies the live business gate', async () => {
  const db = dbWith([]);
  await listPublic(db, {});
  const sql = db.calls[0].sql;
  expect(sql).toMatch(/LEFT JOIN users u ON u\.id = b\.user_id/);
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/COALESCE\(b\.is_hidden_by_admin, FALSE\) = FALSE/);
  expect(sql).toMatch(/COALESCE\(b\.setup_status, 'active'\) = 'active'/);
  expect(sql).toMatch(/u\.email_verified = TRUE/);
  expect(sql).toMatch(/u\.onboarding_completed = TRUE/);
});

test('public career detail applies the same live business gate', async () => {
  const db = dbWith([]);
  await getPublic(db, { id: '42' });
  const sql = db.calls[0].sql;
  expect(sql).toMatch(/LEFT JOIN users u ON u\.id = b\.user_id/);
  expect(sql).toMatch(/b\.is_active = TRUE/);
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/u\.is_active = TRUE/);
  expect(sql).toMatch(/u\.onboarding_completed = TRUE/);
});

test('career employer and impression queries provide the owner alias used by the public gate', async () => {
  const db = dbWith([{ total: 0 }]);
  await employers.directory(db, { q: 'Acme' });
  expect(db.calls[0].sql).toMatch(/LEFT JOIN users u ON u\.id = b\.user_id/);
  expect(db.calls[0].sql).toMatch(/u\.email_verified = TRUE/);

  db.calls.length = 0;
  await seeker.trackImpressions(db, [42], 'viewer-hash');
  expect(db.calls[0].sql).toMatch(/LEFT JOIN users u ON u\.id = b\.user_id/);
  expect(db.calls[0].sql).toMatch(/u\.onboarding_completed = TRUE/);
});
