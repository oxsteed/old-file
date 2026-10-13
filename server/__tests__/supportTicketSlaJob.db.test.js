'use strict';

/**
 * __tests__/supportTicketSlaJob.db.test.js
 *
 * DB-backed tests for the support ticket SLA sweeper (review P1-17-F05):
 *  - open, unclaimed, past-due tickets are escalated exactly once
 *  - priority bumps one level (urgent stays urgent)
 *  - claimed or not-yet-due tickets are left alone
 */

const crypto = require('crypto');
const schema = `sla_job_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('SLA job fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/socketService', () => ({ broadcastToAdmins: jest.fn() }));
const db = require('../db');
const { sweepSupportTicketSla, bumpPriority } = require('../jobs/supportTicketSlaJob');
const { broadcastToAdmins } = require('../services/socketService');

const describeDb = url ? describe : describe.skip;

describeDb('support ticket SLA sweeper', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.support_tickets (
      id SERIAL PRIMARY KEY,
      ticket_number TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to UUID,
      sla_due_at TIMESTAMPTZ,
      escalated_at TIMESTAMPTZ,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  });

  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });
  beforeEach(async () => {
    await db.query('DELETE FROM support_tickets');
    broadcastToAdmins.mockClear();
  });

  async function ticket(overrides = {}) {
    const { rows: [t] } = await db.query(
      `INSERT INTO support_tickets (ticket_number, priority, status, assigned_to, sla_due_at, escalated_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        overrides.ticket_number || `T-${crypto.randomBytes(4).toString('hex')}`,
        overrides.priority || 'normal',
        overrides.status || 'open',
        overrides.assigned_to || null,
        overrides.sla_due_at === undefined ? new Date(Date.now() - 3600000).toISOString() : overrides.sla_due_at,
        overrides.escalated_at || null,
      ]
    );
    return t;
  }

  async function state(id) {
    return (await db.query('SELECT * FROM support_tickets WHERE id = $1', [id])).rows[0];
  }

  test('escalates a past-due open unclaimed ticket once, bumping priority', async () => {
    const t = await ticket({ priority: 'normal' });
    const result = await sweepSupportTicketSla(db);
    expect(result.escalated).toBe(1);
    const after = await state(t.id);
    expect(after.priority).toBe('high');
    expect(after.escalated_at).not.toBeNull();
    expect(after.metadata.sla_escalated_at).toBeTruthy();
    expect(after.metadata.sla_breached_priority).toBe('normal');
    expect(broadcastToAdmins).toHaveBeenCalledTimes(1);

    // Second sweep must not re-escalate.
    broadcastToAdmins.mockClear();
    const again = await sweepSupportTicketSla(db);
    expect(again.escalated).toBe(0);
    expect(broadcastToAdmins).not.toHaveBeenCalled();
  });

  test('urgent stays urgent (top of the ladder)', async () => {
    const t = await ticket({ priority: 'urgent' });
    await sweepSupportTicketSla(db);
    const after = await state(t.id);
    expect(after.priority).toBe('urgent');
    expect(after.escalated_at).not.toBeNull();
  });

  test('leaves claimed, not-due, and closed tickets alone', async () => {
    const claimed = await ticket({ assigned_to: crypto.randomUUID() });
    const future = await ticket({ sla_due_at: new Date(Date.now() + 3600000).toISOString() });
    const closed = await ticket({ status: 'closed' });
    const result = await sweepSupportTicketSla(db);
    expect(result.escalated).toBe(0);
    for (const id of [claimed.id, future.id, closed.id]) {
      expect((await state(id)).escalated_at).toBeNull();
    }
    expect(broadcastToAdmins).not.toHaveBeenCalled();
  });

  test('bumpPriority ladder', () => {
    expect(bumpPriority('low')).toBe('normal');
    expect(bumpPriority('normal')).toBe('high');
    expect(bumpPriority('high')).toBe('urgent');
    expect(bumpPriority('urgent')).toBe('urgent');
    expect(bumpPriority('bogus')).toBe('urgent');
  });
});
