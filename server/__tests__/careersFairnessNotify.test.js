'use strict';

// Notifications audit item 24: fairness block alerts went to the wrong
// admin set (never-expiring grants excluded), block review notified
// nobody, and quarterly reports notified nobody.
// Reproduction: the grant query requires expires_at > NOW(), there is no
// career_ranking_reviewed type, and runQuarterlyReports never notifies.

jest.mock('../services/careers/notify', () => ({
  notifyUser: jest.fn().mockResolvedValue({ inserted: true }),
}));

const { notifyUser } = require('../services/careers/notify');
const fairness = require('../services/careers/fairness');
const { tNotif } = require('../utils/i18n');

function fakeDb() {
  const queries = [];
  const db = {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push(String(sql));
      if (sql.includes('FROM career_applications')) return { rows: [] };
      if (sql.includes('INSERT INTO career_fairness_reports')) return { rows: [{ id: 7 }] };
      if (sql.includes('FROM users u')) return { rows: [{ id: 'admin-1' }, { id: 'admin-2' }] };
      return { rows: [] };
    }),
  };
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('notifyAdmins includes never-expiring grants in the admin set', async () => {
  const db = fakeDb();
  await fairness.notifyAdmins(db, { scope: 'platform:platform', ratio: '0.50' }, 'career_ranking_block:9');
  const grantSql = db.queries.find((sql) => sql.includes('admin_permission_grants'));
  expect(grantSql).toBeDefined();
  expect(grantSql).toContain('(g.expires_at IS NULL OR g.expires_at > NOW())');
});

test('notifyAdmins still sends career_ranking_disabled for a block by default', async () => {
  const db = fakeDb();
  await fairness.notifyAdmins(db, { scope: 'platform:platform', ratio: '0.50' }, 'career_ranking_block:9');
  expect(notifyUser).toHaveBeenCalledTimes(2);
  expect(notifyUser).toHaveBeenCalledWith(db, expect.objectContaining({
    userId: 'admin-1',
    type: 'career_ranking_disabled',
    actionUrl: '/admin/careers/fairness',
  }));
  expect(notifyUser.mock.calls[0][1].deliveryKey).toBe('career_ranking_block:9:admin-1');
});

test('notifyAdmins can send the review notice to the same set', async () => {
  const db = fakeDb();
  await fairness.notifyAdmins(db, {
    type: 'career_ranking_reviewed',
    params: { scope: 'business:12', ratio: '0.50' },
    deliveryKey: 'career_ranking_reviewed:4',
  });
  expect(notifyUser).toHaveBeenCalledTimes(2);
  expect(notifyUser).toHaveBeenCalledWith(db, expect.objectContaining({
    userId: 'admin-2',
    type: 'career_ranking_reviewed',
  }));
  expect(notifyUser.mock.calls[1][1].deliveryKey).toBe('career_ranking_reviewed:4:admin-2');
});

test('notifyBlockReviewed notifies the admin set about the reviewed block', async () => {
  const db = fakeDb();
  expect(typeof fairness.notifyBlockReviewed).toBe('function');
  await fairness.notifyBlockReviewed(db, {
    id: 4, scope_type: 'business', scope_ref: '12', impact_ratio: 0.5,
  });
  expect(notifyUser).toHaveBeenCalledWith(db, expect.objectContaining({
    type: 'career_ranking_reviewed',
  }));
  expect(notifyUser.mock.calls[0][1].params).toMatchObject({ scope: 'business:12' });
});

test('runQuarterlyReports sends a fairness digest to the admin set', async () => {
  const db = fakeDb();
  const result = await fairness.runQuarterlyReports({
    db, periodStart: '2026-07-01', periodEnd: '2026-09-30',
  });
  expect(result.reports).toBe(1);
  expect(notifyUser).toHaveBeenCalledWith(db, expect.objectContaining({
    type: 'career_fairness_quarterly_digest',
  }));
  expect(notifyUser.mock.calls[0][1].params).toMatchObject({ reports: 1 });
  expect(notifyUser.mock.calls[0][1].deliveryKey).toContain('career_fairness_quarterly:2026-07-01:2026-09-30');
});

test('the new fairness notice types have copy in every language', () => {
  for (const type of ['career_ranking_reviewed', 'career_fairness_quarterly_digest']) {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const text = tNotif(type, lang, { scope: 'business:12', ratio: '0.50', count: 3, period: '2026-07-01 to 2026-09-30' });
      expect(text.title).toBeTruthy();
      expect(text.body).toBeTruthy();
    }
  }
});
