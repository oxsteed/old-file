'use strict';

/**
 * PR #804 Track B (G-2 / G-32): a second signup intent no longer silently
 * overwrites the first. Intents are keyed by (user_id, intent), every
 * unconsumed intent stays resumable, consumption stamps consumed_at, and
 * re-expressing a consumed intent reopens it. Skips unless
 * STATEMENT_TEST_DATABASE_URL is the disposable Track B database.
 */

jest.unmock('pg');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_pr804_b$/.test(url.pathname);
  } catch { return false; }
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;
if (CAN_RUN_DB) process.env.DATABASE_URL = RAW_URL;

jest.setTimeout(60000);

ddescribe('signup intents are keyed by (user_id, intent) (real database)', () => {
  let pool;
  let signupIntent;
  let accessService;

  beforeAll(() => {
    pool = require('../db');
    signupIntent = require('../services/access/signupIntent');
    accessService = require('../services/access/accessService');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, `t${id}@example.invalid`, role],
    );
    return { id, role };
  }

  async function intentRows(userId) {
    const { rows } = await pool.query(
      'SELECT intent, capability, consumed_at FROM access_signup_intents WHERE user_id = $1 ORDER BY intent',
      [userId],
    );
    return rows;
  }

  test('two intents are stored as two rows and both stay resumable', async () => {
    const user = await makeUser();
    await signupIntent.finalize(user.id, { signup_intent: 'franchise', signup_return_to: null });
    await signupIntent.finalize(user.id, { signup_intent: 'join_workforce', signup_return_to: null });

    const rows = await intentRows(user.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.intent).sort()).toEqual(['franchise', 'join_workforce']);
    expect(rows.every((r) => r.consumed_at === null)).toBe(true);

    const pending = await signupIntent.pendingIntents(user.id);
    expect(pending.map((r) => r.intent).sort()).toEqual(['franchise', 'join_workforce']);
    const franchise = pending.find((r) => r.intent === 'franchise');
    expect(franchise.statusPath).toBe('/franchise/apply');
    expect(franchise.kind).toBe('domain_enrollment');
    const workforce = pending.find((r) => r.intent === 'join_workforce');
    expect(workforce.statusPath).toBe('/learn');
  });

  test('consuming one intent leaves the other resumable', async () => {
    const user = await makeUser();
    await signupIntent.finalize(user.id, { signup_intent: 'franchise', signup_return_to: null });
    await signupIntent.finalize(user.id, { signup_intent: 'join_partner', signup_return_to: null });

    expect(await signupIntent.consumeIntent(user.id, 'franchise')).toBe(true);
    const pending = await signupIntent.pendingIntents(user.id);
    expect(pending.map((r) => r.intent)).toEqual(['join_partner']);

    const rows = await intentRows(user.id);
    expect(rows.find((r) => r.intent === 'franchise').consumed_at).not.toBeNull();
    expect(rows.find((r) => r.intent === 'join_partner').consumed_at).toBeNull();
  });

  test('re-expressing a consumed intent reopens it', async () => {
    const user = await makeUser();
    await signupIntent.finalize(user.id, { signup_intent: 'franchise', signup_return_to: null });
    await signupIntent.consumeIntent(user.id, 'franchise');
    expect(await signupIntent.pendingIntents(user.id)).toHaveLength(0);

    await signupIntent.finalize(user.id, { signup_intent: 'franchise', signup_return_to: null });
    const pending = await signupIntent.pendingIntents(user.id);
    expect(pending.map((r) => r.intent)).toEqual(['franchise']);
    const rows = await intentRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].consumed_at).toBeNull();
  });

  test('a staff intent opens a visible provisioning request', async () => {
    const user = await makeUser();
    await signupIntent.finalize(user.id, { signup_intent: 'request_reviewer', signup_return_to: null });
    const { rows } = await pool.query(
      `SELECT kind, status FROM signup_provisioning_requests WHERE user_id = $1`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'staff_reviewer', status: 'pending' });
  });

  test('G-2/G-3: every null-capability handoff intent lands on its owning page', async () => {
    const user = await makeUser();
    // [intent, statusPath, admission kind, provisioning kind or null]
    const handoffs = [
      ['join_business_team', '/vortex', 'organization_invitation', null],
      ['join_restaurant_team', '/vortex', 'organization_invitation', null],
      ['franchise', '/franchise/apply', 'domain_enrollment', null],
      ['join_credit', '/credit/apply', 'domain_enrollment', null],
      ['join_partner', '/affiliate', 'domain_enrollment', null],
      ['join_workforce', '/learn', 'domain_enrollment', null],
      ['request_reviewer', '/settings/applications', 'staff_provisioning', 'staff_reviewer'],
      ['request_support', '/settings/applications', 'staff_provisioning', 'staff_support'],
      ['request_operations', '/settings/applications', 'staff_provisioning', 'staff_operations'],
      ['request_device', '/settings/applications', 'nonhuman_provisioning', 'service_account'],
    ];
    for (const [intent, statusPath, kind, provisioningKind] of handoffs) {
      const finalized = await signupIntent.finalize(user.id, { signup_intent: intent, signup_return_to: null });
      expect(finalized.nextStep.type).toBe('none');
      expect(finalized.nextStep.statusPath).toBe(statusPath);
      expect(finalized.nextStep.kind).toBe(kind);
    }
    const pending = await signupIntent.pendingIntents(user.id);
    expect(pending.map((r) => r.intent).sort()).toEqual(handoffs.map(([intent]) => intent).sort());
    for (const [intent, statusPath] of handoffs) {
      expect(pending.find((r) => r.intent === intent).statusPath).toBe(statusPath);
    }
    // Staff/device intents also open a visible, decidable provisioning row.
    const { rows } = await pool.query(
      `SELECT kind, status FROM signup_provisioning_requests WHERE user_id = $1 ORDER BY kind`,
      [user.id],
    );
    expect(rows).toEqual([
      { kind: 'service_account', status: 'pending' },
      { kind: 'staff_operations', status: 'pending' },
      { kind: 'staff_reviewer', status: 'pending' },
      { kind: 'staff_support', status: 'pending' },
    ]);
  });

  test('submitting the draft application consumes the capability intent', async () => {
    const user = await makeUser();
    const finalized = await signupIntent.finalize(user.id, { signup_intent: 'offer_services', signup_return_to: null });
    expect(finalized.nextStep.requestId).toBeTruthy();

    const submitted = await accessService.applicantTransition(
      user.id,
      finalized.nextStep.requestId,
      'submit',
      { expectedVersion: 1, answers: { serviceCategories: ['plumbing'], serviceArea: { country: 'US', city: 'Columbus' } } },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.request.status).toBe('submitted');

    const rows = await intentRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].intent).toBe('offer_services');
    expect(rows[0].consumed_at).not.toBeNull();
    expect(await signupIntent.pendingIntents(user.id)).toHaveLength(0);
  });
});
