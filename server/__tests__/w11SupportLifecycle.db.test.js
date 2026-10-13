'use strict';

const crypto = require('crypto');
const schema = `w11_support_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('W11 fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(null) }));
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { transitionTicket } = require('../services/supportTicketLifecycleService');
const { logAdminAction } = require('../services/auditService');
const ids = { owner: crypto.randomUUID(), other: crypto.randomUUID(), admin: crypto.randomUUID() };
const tickets = [];
const owner = { id: ids.owner, role: 'customer' };
const admin = { id: ids.admin, role: 'admin' };
const describeDb = url ? describe : describe.skip;

describeDb('W11 real PostgreSQL ticket transitions and audit rollback', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (
      id UUID PRIMARY KEY, email TEXT, password_hash TEXT, first_name TEXT,
      last_name TEXT, role TEXT, preferred_language TEXT)`);
    // Execute the production table and integrity migrations in a disposable
    // namespace, without touching unrelated financial fixtures in public.
    for (const filename of ['046_support_tickets.sql', '600_support_ticket_terminal_integrity.sql',
      '792_w11_support_ticket_events.sql', '792_w11_support_ticket_events.sql']) {
      await db.query(fs.readFileSync(path.join(__dirname, '../migrations', filename), 'utf8'));
    }
    for (const [role, id] of Object.entries(ids)) await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', 'W11', 'Fixture', $3, 'ar')`,
      [id, `${id}@example.invalid`, role === 'admin' ? 'admin' : 'customer'],
    );
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });
  beforeEach(() => logAdminAction.mockReset().mockResolvedValue(null));
  async function ticket(status) {
    const { rows: [row] } = await db.query(
      `INSERT INTO support_tickets (user_id, name, email, status, resolved_at, closed_at)
       VALUES ($1, 'W11 Fixture', 'synthetic@example.invalid', $2::text,
         CASE WHEN $2::text IN ('resolved', 'closed') THEN now() END,
         CASE WHEN $2::text = 'closed' THEN now() END) RETURNING *`, [ids.owner, status],
    );
    tickets.push(row.id);
    return row;
  }
  async function state(id) {
    return (await db.query('SELECT * FROM support_tickets WHERE id=$1', [id])).rows[0];
  }
  async function events(id) {
    return (await db.query('SELECT * FROM support_ticket_events WHERE ticket_id=$1 ORDER BY created_at,id', [id])).rows;
  }

  test.each(['resolved', 'closed'])('owner can reopen %s with retained history and one event', async status => {
    const row = await ticket(status);
    const changed = await transitionTicket({ ticketId: row.id, actor: owner, status: 'open', ownerOnly: true });
    expect(changed.ticket).toMatchObject({ id: row.id, status: 'open', preferred_language: 'ar' });
    expect(await state(row.id)).toMatchObject({ status: 'open', resolved_at: null, closed_at: null, subject: row.subject });
    expect(await events(row.id)).toEqual([expect.objectContaining({ actor_id: ids.owner, event_type: 'reopened', before_status: status, after_status: 'open' })]);
  });
  test('another account cannot reopen or write an event', async () => {
    const row = await ticket('closed');
    await expect(transitionTicket({ ticketId: row.id, actor: { id: ids.other, role: 'customer' }, status: 'open', ownerOnly: true })).rejects.toMatchObject({ code: 'ticket_not_found', statusCode: 404 });
    expect((await state(row.id)).status).toBe('closed');
    expect(await events(row.id)).toEqual([]);
  });
  test('concurrent owner reopens have one winner and one audit event', async () => {
    const row = await ticket('resolved');
    const result = await Promise.allSettled([1, 2].map(() => transitionTicket({ ticketId: row.id, actor: owner, status: 'open', ownerOnly: true })));
    expect(result.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(result.find(x => x.status === 'rejected').reason.code).toBe('ticket_not_reopenable');
    expect(await events(row.id)).toHaveLength(1);
  });
  test('terminal status cannot jump directly to in_progress', async () => {
    const row = await ticket('closed');
    await expect(transitionTicket({ ticketId: row.id, actor: admin, status: 'in_progress' })).rejects.toMatchObject({ code: 'invalid_status_transition', statusCode: 409 });
    expect((await state(row.id)).status).toBe('closed');
    expect(await events(row.id)).toEqual([]);
  });
  test('administrator reopen uses transactional admin audit', async () => {
    const row = await ticket('closed');
    await transitionTicket({ ticketId: row.id, actor: admin, status: 'open' });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ client: expect.any(Object), adminId: ids.admin, action: 'support_ticket_reopened', throwOnError: true }));
    expect(await events(row.id)).toHaveLength(1);
  });
  test('audit failure rolls back status and event together', async () => {
    const row = await ticket('in_progress');
    logAdminAction.mockRejectedValueOnce(new Error('synthetic audit outage'));
    await expect(transitionTicket({ ticketId: row.id, actor: admin, status: 'resolved' })).rejects.toThrow('synthetic audit outage');
    expect((await state(row.id)).status).toBe('in_progress');
    expect(await events(row.id)).toEqual([]);
  });
  test('same-status admin replay does not duplicate events or audit', async () => {
    const row = await ticket('open');
    expect(await transitionTicket({ ticketId: row.id, actor: admin, status: 'open' })).toMatchObject({ replayed: true });
    expect(logAdminAction).not.toHaveBeenCalled();
    expect(await events(row.id)).toEqual([]);
  });
  test('a customer cannot use the admin status path', async () => {
    const row = await ticket('open');
    await expect(transitionTicket({ ticketId: row.id, actor: owner, status: 'resolved' })).rejects.toMatchObject({ code: 'admin_required', statusCode: 403 });
    expect((await state(row.id)).status).toBe('open');
  });
  test('a guest cannot reopen a ticket by knowing its ID', async () => {
    const row = await ticket('closed');
    await expect(transitionTicket({ ticketId: row.id, actor: null, status: 'open', ownerOnly: true })).rejects.toMatchObject({ statusCode: 401 });
    expect((await state(row.id)).status).toBe('closed');
    expect(await events(row.id)).toEqual([]);
  });
});
