'use strict';

// Money flows W2: scheduled-report recipients were never validated
// against restaurant membership. Anyone holding
// analytics.view_financial could add any user ID or any email
// address to a schedule, and the 06:05 job would deliver revenue
// and labor summaries to them. There was also no cap on recipient
// count, so one schedule could fan out to an unbounded list.
//
// Repro-first: before the fix, validateScheduleRecipients does not
// exist (outsiders are accepted) and validateScheduleInput accepts
// an over-cap list. After the fix, user recipients must be active
// members of the restaurant's business (or the business owner),
// email recipients must belong to such a member, and a schedule
// holds at most MAX_RECIPIENTS_PER_SCHEDULE (50) recipients.
//
// DB: disposable credit_statement_test only, migrated first:
//   DATABASE_URL=<redacted> npm run migrate
//   STATEMENT_TEST_DATABASE_URL=<redacted>
//     npx jest __tests__/moneyFlowsW2Recipients.db.test.js

jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const scheduledReports = require('../services/restaurantScheduledReports');

ddescribe('Money flows W2: scheduled-report recipients are members', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const revokedId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  let businessId;

  const emailFor = (tag) => `w2-${tag}-${suffix}@example.com`;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20), ($21, $22, $23, $24, $25)',
      [ownerId, emailFor('owner'), 'test-hash', 'W2', 'Owner',
       memberId, emailFor('member'), 'test-hash', 'W2', 'Member',
       pendingId, emailFor('pending'), 'test-hash', 'W2', 'Pending',
       revokedId, emailFor('revoked'), 'test-hash', 'W2', 'Revoked',
       outsiderId, emailFor('outsider'), 'test-hash', 'W2', 'Outsider'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `W2 Recipients ${suffix}`],
    ));
    businessId = Number(businessId);
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active'),
              ($1, $2, $5, 'representative', $6, 'pending'),
              ($1, $2, $7, 'representative', $8, 'revoked')`,
      [businessId, ownerId,
       memberId, emailFor('member'),
       pendingId, emailFor('pending'),
       revokedId, emailFor('revoked')],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)', [ownerId, memberId, pendingId, revokedId, outsiderId]).catch(() => {});
    await pool.end();
  });

  test('the recipient cap is 50 and validateScheduleInput enforces it', () => {
    expect(scheduledReports.MAX_RECIPIENTS_PER_SCHEDULE).toBe(50);
    const fifty = Array.from({ length: 50 }, (_, i) => ({ user_id: `user-${i}` }));
    expect(() => scheduledReports.validateScheduleInput({
      reportType: 'labor', deliveryChannel: 'in_app', recipients: fifty,
    })).not.toThrow();
    const fiftyOne = [...fifty, { user_id: 'user-50' }];
    expect(() => scheduledReports.validateScheduleInput({
      reportType: 'labor', deliveryChannel: 'in_app', recipients: fiftyOne,
    })).toThrow(/at most 50 recipients/);
  });

  test('an active member and the business owner are accepted', async () => {
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [
        { user_id: memberId },
        { user_id: ownerId },
        { email: emailFor('member') },
        { email: emailFor('owner') },
      ],
    })).resolves.toBeUndefined();
  });

  test('an outsider user ID is rejected', async () => {
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ user_id: outsiderId }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });

  test('an outsider email is rejected', async () => {
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ email: emailFor('outsider') }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });

  test('a pending invitee and a revoked member are rejected, user and email alike', async () => {
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ user_id: pendingId }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ email: emailFor('pending') }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ user_id: revokedId }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ email: emailFor('revoked') }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });

  test('one outsider rejects the whole list, fail-closed', async () => {
    await expect(scheduledReports.validateScheduleRecipients(pool, {
      businessId,
      recipients: [{ user_id: memberId }, { user_id: outsiderId }],
    })).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });
});
