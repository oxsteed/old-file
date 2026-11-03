'use strict';

// Customer 360 upgrade 8 on PostgreSQL: merged, grant-filtered inbox and
// the explicit, audited, idempotent email/SMS send through existing channels.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const mockSms = jest.fn();
jest.mock('../services/smsNotificationService', () => ({ sendSMSIfOptedIn: (...a) => mockSms(...a) }));
const templates = require('../services/customer360InboxTemplates');
const inbox = require('../services/customer360Inbox');

jest.setTimeout(120000);

test('every template renders in all five languages without placeholders left', () => {
  for (const key of templates.KEYS) {
    for (const lang of templates.LANGUAGES) {
      const t = templates.render(key, lang, { firstName: 'Mika' });
      expect(t.language).toBe(lang);
      expect(t.body).toContain('Mika');
      expect(`${t.subject}${t.body}`).not.toMatch(/\{\{/);
    }
  }
  expect(templates.render('general', 'de').language).toBe('en');
  expect(templates.render('nope', 'en')).toBeNull();
  expect(inbox.maskEmail('anne@example.com')).toBe('a***@example.com');
  expect(inbox.maskPhone('+50937001234')).toBe('********1234');
});

test('inbox DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 unified inbox', () => {
  let pool;
  let customer;
  let admin;
  async function user(role = 'customer', extra = '') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, phone_number, phone_verified, preferred_language)
       VALUES ($1, $2, 'x', 'Mika', 'Inbox', $3, true, '+50937001234', true, 'ht')`, [id, `c360-inbox-${id}${extra}@example.invalid`, role]);
    return id;
  }
  const audit = (action) => (client, row) => require('../services/auditService').logAdminAction({
    adminId: admin, action, targetType: 'user', targetId: row.customer_id, after: { id: row.id }, client, throwOnError: true,
  });
  beforeAll(async () => {
    pool = require('../db');
    customer = await user();
    admin = await user('admin');
    const { rows: [t] } = await pool.query(
      `INSERT INTO support_tickets (user_id, name, email, subject, status) VALUES ($1, 'Mika', 'mika@example.invalid', 'Card help', 'open') RETURNING id`, [customer]);
    await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_id, sender_name, content, is_internal, is_from_admin, created_at) VALUES
       ($1, $2, 'Mika', 'My card failed', false, false, NOW() - interval '3 hours'),
       ($1, $3, 'Agent', 'internal: check processor', true, true, NOW() - interval '2 hours')`, [t.id, customer, admin]);
    const { rows: [c] } = await pool.query(`INSERT INTO conversations (customer_id, helper_id, job_id, status) VALUES ($1, $2, NULL, 'active') RETURNING id`, [admin, customer]);
    await pool.query(`INSERT INTO messages (conversation_id, sender_id, content, created_at) VALUES ($1, $2, 'Hello from OxSteed', NOW() - interval '1 hour')`, [c.id, admin]);
  });
  afterAll(async () => { await pool.end?.(); });

  test('timeline merges channels and respects grants', async () => {
    const all = await inbox.list(customer, { support: true, internal: true, messages: true });
    expect(all.items.map((i) => i.channel)).toEqual(['message', 'support', 'support']);
    expect(all.items[0]).toMatchObject({ outbound: true, body: 'Hello from OxSteed' });
    const noInternal = await inbox.list(customer, { support: true, internal: false, messages: false });
    expect(noInternal.items.map((i) => i.body)).toEqual(['My card failed']);
    expect((await inbox.list(customer, {})).items).toEqual([]);
    expect((await inbox.openTickets(customer))[0].subject).toBe('Card help');
    const u = await inbox.recipient(customer);
    expect(inbox.preferredLanguage(u)).toBe('ht');
    expect(inbox.channels(u).email).toMatchObject({ available: true, verified: true });
    await expect(inbox.list(customer, { support: true }, { before: 'nope' })).rejects.toMatchObject({ code: 'invalid_cursor' });
  });

  test('email send is explicit, audited, idempotent and goes through the Resend outbox', async () => {
    const t = templates.render('general', 'ht', { firstName: 'Mika' });
    const base = { customerId: customer, adminId: admin, channel: 'email', templateKey: 'general', language: 'ht', subject: t.subject, body: t.body };
    const key = crypto.randomUUID();
    await expect(inbox.send({ ...base, clientMessageId: key, confirm: false, audit: audit('x') })).rejects.toMatchObject({ code: 'confirmation_required' });
    await expect(inbox.send({ ...base, clientMessageId: 'abc', confirm: true, audit: audit('x') })).rejects.toMatchObject({ code: 'invalid_client_message_id' });
    await expect(inbox.send({ ...base, language: 'de', clientMessageId: key, confirm: true, audit: audit('x') })).rejects.toMatchObject({ code: 'invalid_language' });
    // An audit failure rolls the record back.
    await expect(inbox.send({ ...base, clientMessageId: key, confirm: true, audit: async () => { throw new Error('audit down'); } })).rejects.toThrow('audit down');
    expect((await pool.query('SELECT 1 FROM customer_outbound_messages WHERE client_message_id = $1', [key])).rows).toHaveLength(0);

    const sent = await inbox.send({ ...base, clientMessageId: key, confirm: true, audit: audit('customer360_inbox_email_send') });
    expect(sent.replayed).toBe(false);
    expect(sent.message).toMatchObject({ channel: 'email', status: 'queued', recipient_masked: expect.stringMatching(/^c\*\*\*@/) });
    const { rows: [ob] } = await pool.query(`SELECT kind, recipient, payload FROM support_email_outbox WHERE idempotency_key = $1`, [`customer360:${sent.message.id}`]);
    expect(ob.kind).toBe('customer360');
    expect(ob.payload.html).toContain('lang="ht"');
    const again = await inbox.send({ ...base, clientMessageId: key, confirm: true, audit: audit('customer360_inbox_email_send') });
    expect(again).toMatchObject({ replayed: true, message: { id: sent.message.id } });
    const other = await user();
    await expect(inbox.send({ ...base, customerId: other, clientMessageId: key, confirm: true, audit: audit('x') })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const { rows: audits } = await pool.query(`SELECT action FROM admin_audit_log WHERE target_id = $1 AND action LIKE 'customer360_inbox_%'`, [customer]);
    expect(audits.map((a) => a.action)).toEqual(['customer360_inbox_email_send']);
    const { rows: ev } = await pool.query(`SELECT event_type FROM customer_events WHERE customer_id = $1 AND event_type LIKE 'inbox.%'`, [customer]);
    expect(ev.map((e) => e.event_type)).toEqual(['inbox.email_sent']);
    const timeline = await inbox.list(customer, { messages: true });
    expect(timeline.items[0]).toMatchObject({ channel: 'email', status: 'queued' });
  });

  test('SMS stays off unless enabled and then uses the opt-in sender with a redacted record', async () => {
    const base = { customerId: customer, adminId: admin, channel: 'sms', language: 'en', body: 'Your request was updated.', confirm: true, audit: audit('customer360_inbox_sms_send') };
    delete process.env.CUSTOMER360_INBOX_SMS_ENABLED;
    await expect(inbox.send({ ...base, clientMessageId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'sms_disabled' });
    process.env.CUSTOMER360_INBOX_SMS_ENABLED = 'true';
    try {
      mockSms.mockResolvedValueOnce(false);
      const r = await inbox.send({ ...base, clientMessageId: crypto.randomUUID() });
      expect(mockSms).toHaveBeenCalledWith(customer, 'Your request was updated.', 'support_replies');
      expect(r.message).toMatchObject({ status: 'not_sent', status_reason: 'opted_out_or_rate_limited', body: null, body_preview: 'Your request was upd…' });
      await expect(inbox.send({ ...base, body: 'x'.repeat(481), clientMessageId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'invalid_body' });
    } finally {
      delete process.env.CUSTOMER360_INBOX_SMS_ENABLED;
    }
  });

  test('deleted customers and staff cannot be messaged', async () => {
    const gone = await user();
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [gone]);
    await expect(inbox.send({ customerId: gone, adminId: admin, channel: 'email', language: 'en', subject: 's', body: 'b', clientMessageId: crypto.randomUUID(), confirm: true, audit: audit('x') }))
      .rejects.toMatchObject({ code: 'customer_not_messageable' });
    await expect(inbox.recipient(admin)).rejects.toMatchObject({ code: 'customer_not_messageable' });
  });
});
