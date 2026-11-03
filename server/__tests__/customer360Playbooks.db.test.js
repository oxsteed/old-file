'use strict';

// Customer 360 upgrade 9 on PostgreSQL: playbooks execute only safe steps,
// are idempotent and single-open, and never execute money hand-offs.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const mockOtp = jest.fn();
jest.mock('../utils/email', () => ({ ...jest.requireActual('../utils/email'), sendOTPEmail: (...a) => mockOtp(...a) }));
const playbooks = require('../services/customer360Playbooks');

jest.setTimeout(120000);

test('definitions: money steps are hand-offs only and no safe action moves money', () => {
  const defs = playbooks.definitions();
  expect(defs.map((d) => d.key)).toEqual(['verification_help', 'notification_retry', 'payment_issue']);
  const all = defs.flatMap((d) => d.steps);
  expect(all.filter((s) => s.kind === 'money_handoff').map((s) => s.key)).toEqual(['refund_or_credit']);
  expect(all.filter((s) => s.kind === 'safe_action').map((s) => s.key))
    .toEqual(['resend_verification', 'retry_message_notifications', 'retry_support_emails']);
});

test('playbooks DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 playbooks', () => {
  let pool;
  let admin;
  const audits = [];
  const audit = (action, d) => { audits.push(action); return require('../services/auditService').logAdminAction({
    adminId: admin, action, targetType: 'user', targetId: null, after: d.after, client: d.client, throwOnError: true }); };
  async function user(role = 'customer', verified = false) {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, preferred_language)
      VALUES ($1, $2, 'x', 'Pia', 'Book', $3, $4, 'fr')`, [id, `c360-pb-${id}@example.invalid`, role, verified]);
    return id;
  }
  beforeAll(async () => {
    pool = require('../db');
    admin = await user('admin', true);
    mockOtp.mockResolvedValue({ success: true });
  });
  afterAll(async () => { await pool.end?.(); });
  const run = (customerId, key, extra = {}) => playbooks.start({
    customerId, key, adminId: admin, clientRequestId: crypto.randomUUID(), confirm: true, can: async () => true, audit, ...extra });

  test('verification help resends once, is idempotent, single-open and cooled down', async () => {
    const c = await user();
    await expect(run(c, 'verification_help', { confirm: false })).rejects.toMatchObject({ code: 'confirmation_required' });
    const id = crypto.randomUUID();
    const first = await run(c, 'verification_help', { clientRequestId: id });
    expect(first.run.steps.map((s) => [s.key, s.status])).toEqual([
      ['check_unverified', 'done'], ['resend_verification', 'done'], ['confirm_with_customer', 'pending']]);
    expect(mockOtp).toHaveBeenCalledTimes(1);
    expect(mockOtp.mock.calls[0][2]).toBe('fr');
    const { rows: [u] } = await pool.query('SELECT otp_code, otp_last_sent_at FROM users WHERE id = $1', [c]);
    expect(u.otp_code).toMatch(/^[0-9a-f]{64}$/);
    // Same request id replays, no second email.
    const again = await run(c, 'verification_help', { clientRequestId: id });
    expect(again.replayed).toBe(true);
    expect(mockOtp).toHaveBeenCalledTimes(1);
    await expect(run(c, 'verification_help')).rejects.toMatchObject({ code: 'playbook_already_open' });
    const done = await playbooks.completeStep({ customerId: c, runId: first.run.id, stepKey: 'confirm_with_customer', adminId: admin, note: 'Called', audit });
    expect(done.status).toBe('completed');
    // A second run within the cooldown does not send again.
    const second = await run(c, 'verification_help');
    expect(second.run.steps[1]).toMatchObject({ status: 'skipped', result: { reason: 'cooldown' } });
    expect(mockOtp).toHaveBeenCalledTimes(1);
    expect(audits).toEqual(expect.arrayContaining(['customer360_playbook_started', 'customer360_playbook_resend_verification', 'customer360_playbook_step_done']));
  });

  test('a verified customer stops at the check and nothing is sent', async () => {
    const c = await user('customer', true);
    const r = await run(c, 'verification_help');
    expect(r.run.status).toBe('completed');
    expect(r.run.steps.map((s) => s.status)).toEqual(['done', 'skipped', 'skipped']);
    expect(mockOtp).toHaveBeenCalledTimes(1);
  });

  test('notification retry requeues only this customer\'s failed rows and needs the operations grant', async () => {
    const c = await user();
    const other = await user();
    const { rows: [conv] } = await pool.query(`INSERT INTO conversations (customer_id, helper_id, status) VALUES ($1, $2, 'active') RETURNING id`, [admin, c]);
    const { rows: [m] } = await pool.query(`INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, 'hi') RETURNING id`, [conv.id, admin]);
    await pool.query(`INSERT INTO message_notification_outbox (message_id, conversation_id, recipient_id, payload, status, attempts)
      VALUES ($1, $2, $3, '{}', 'failed', 5), ($1, $2, $4, '{}', 'failed', 5)`, [m.id, conv.id, c, other]);
    const { rows: [email] } = await pool.query('SELECT email FROM users WHERE id = $1', [c]);
    await pool.query(`INSERT INTO support_email_outbox (kind, recipient, subject, payload, idempotency_key, status, attempts)
      VALUES ('reply', $1, 's', '{}', $2, 'failed', 4)`, [email.email.toUpperCase(), `pb-${c}`]);
    const denied = await run(c, 'notification_retry', { can: async () => false });
    expect(denied.run.steps.map((s) => s.status)).toEqual(['done', 'skipped', 'skipped', 'pending']);
    expect(denied.run.steps[1].result.reason).toBe('no_access');
    await playbooks.cancel({ customerId: c, runId: denied.run.id, adminId: admin, audit });
    const r = await run(c, 'notification_retry');
    expect(r.run.steps[0].result).toEqual({ messageNotifications: 1, supportEmails: 1 });
    expect(r.run.steps[1]).toMatchObject({ status: 'done', result: { requeued: 1 } });
    expect(r.run.steps[2]).toMatchObject({ status: 'done', result: { requeued: 1 } });
    const { rows } = await pool.query(`SELECT recipient_id, status FROM message_notification_outbox WHERE message_id = $1 ORDER BY status`, [m.id]);
    expect(rows.find((x) => x.recipient_id === other).status).toBe('failed');
    expect(rows.find((x) => x.recipient_id === c).status).toBe('pending');
  });

  test('money hand-off is never executed and needs a note', async () => {
    const c = await user();
    const r = await run(c, 'payment_issue');
    expect(r.run.steps.map((s) => s.status)).toEqual(['done', 'pending', 'pending']);
    await expect(playbooks.completeStep({ customerId: c, runId: r.run.id, stepKey: 'refund_or_credit', adminId: admin, audit }))
      .rejects.toMatchObject({ code: 'handoff_note_required' });
    await expect(playbooks.completeStep({ customerId: c, runId: r.run.id, stepKey: 'review_payments', adminId: admin, audit }))
      .rejects.toMatchObject({ code: 'step_not_manual' });
    const h = await playbooks.completeStep({ customerId: c, runId: r.run.id, stepKey: 'refund_or_credit', adminId: admin, note: 'Refund request #12 in approvals', audit });
    expect(h.steps[2].status).toBe('handed_off');
    await expect(pool.query(`UPDATE customer_playbook_run_steps SET status = 'done' WHERE run_id = $1 AND step_key = 'refund_or_credit'`, [r.run.id]))
      .rejects.toMatchObject({ code: '23514' });
    const other = await user();
    await expect(playbooks.getRun(other, r.run.id)).rejects.toMatchObject({ code: 'playbook_run_not_found' });
  });
});
