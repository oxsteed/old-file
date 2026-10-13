'use strict';

// Review P3-891 / P3-892 against a real migrated database.
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('WEBHOOK_RECOVERY_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const { logAdminAction } = require('../services/auditService');
const recovery = require('../services/webhookReceiptRecoveryService');
const webhook = require('../controllers/webhookController');

describe('parseDiditEventCreated', () => {
  test.each([
    [{ created_at: 1700000000 }, 1700000000],
    [{ created_at: 1700000000123 }, 1700000000],
    [{ timestamp: '2026-10-12T12:00:00Z' }, Math.floor(Date.parse('2026-10-12T12:00:00Z') / 1000)],
    [{}, null],
  ])('%j', (body, expected) => {
    expect(webhook._parseDiditEventCreated(body)).toBe(expected);
  });
});

describeDatabase('webhook recovery (real database)', () => {
  afterAll(async () => { await pool.end?.(); });

  test('an older Didit verdict delivered late is skipped (P3-892)', async () => {
    const sessionId = `sess_${crypto.randomUUID()}`;
    const begin = webhook._beginDiditWebhookEvent;
    const newer = await begin({ event_id: `evt_new_${sessionId}`, session_id: sessionId, created_at: 2000 });
    expect(newer.shouldProcess).toBe(true);
    const stale = await begin({ event_id: `evt_old_${sessionId}`, session_id: sessionId, created_at: 1000 });
    expect(stale).toMatchObject({ shouldProcess: false, stale: true });
    const fresh = await begin({ event_id: `evt_newer_${sessionId}`, session_id: sessionId, created_at: 3000 });
    expect(fresh.shouldProcess).toBe(true);
    const { rows: [wm] } = await pool.query(
      `SELECT event_created FROM webhook_event_watermarks WHERE provider='didit' AND object_id = $1`, [sessionId]);
    expect(Number(wm.event_created)).toBe(3000);
  });

  test('failed Stripe receipts are listed, replayed from Stripe, and resolved (P3-891)', async () => {
    const eventId = `evt_${crypto.randomUUID().replace(/-/g, '')}`;
    const { rows: [receipt] } = await pool.query(
      `INSERT INTO webhook_event_receipts (provider, event_id, event_type, status, last_error, account_id)
       VALUES ('stripe', $1, 'test.unhandled', 'failed', 'boom', NULL) RETURNING id`, [eventId]);
    const listed = await recovery.listFailedReceipts({ provider: 'stripe', limit: 500 });
    expect(listed.map((r) => r.id)).toContain(receipt.id);

    const stripe = { events: { retrieve: jest.fn().mockResolvedValue({
      id: eventId, type: 'test.unhandled', created: 1, data: { object: { id: 'x', object: 'thing' } },
    }) } };
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET ||= 'whsec_test';
    const out = await recovery.replayStripeReceipt(receipt.id, { adminId: crypto.randomUUID(), stripe });
    expect(stripe.events.retrieve).toHaveBeenCalledWith(eventId, undefined);
    expect(out.error ?? null).toBeNull();
    expect(out).toMatchObject({ ok: true, code: 'replayed' });
    const { rows: [after] } = await pool.query('SELECT status FROM webhook_event_receipts WHERE id = $1', [receipt.id]);
    expect(after.status).toBe('processed');
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'webhook_receipt_replay' }));

    const again = await recovery.replayStripeReceipt(receipt.id, { adminId: crypto.randomUUID(), stripe });
    expect(again.code).toBe('already_processed');

    const { rows: [didit] } = await pool.query(
      `INSERT INTO webhook_event_receipts (provider, event_id, event_type, status, last_error)
       VALUES ('didit', $1, 'status.updated', 'failed', 'x') RETURNING id`, [`d_${eventId}`]);
    // Connect receipts are re-fetched from the connected account; an event
    // type the Connect contract does not accept is reported, not processed.
    const connectId = `evt_${crypto.randomUUID().replace(/-/g, '')}`;
    const { rows: [connect] } = await pool.query(
      `INSERT INTO webhook_event_receipts (provider, event_id, event_type, status, account_id)
       VALUES ('stripe', $1, 'test.unhandled', 'failed', 'acct_123') RETURNING id`, [connectId]);
    const connectStripe = { events: { retrieve: jest.fn().mockResolvedValue({ id: connectId, type: 'test.unhandled', created: 1, data: { object: {} } }) } };
    const connectOut = await recovery.replayStripeReceipt(connect.id, { adminId: crypto.randomUUID(), stripe: connectStripe });
    expect(connectStripe.events.retrieve).toHaveBeenCalledWith(connectId, { stripeAccount: 'acct_123' });
    expect(connectOut).toMatchObject({ ok: false, code: 'replay_failed' });

    expect((await recovery.replayStripeReceipt(didit.id, {})).code).toBe('replay_unsupported_provider');
    expect((await recovery.resolveReceipt(didit.id, { adminId: crypto.randomUUID(), note: ' ' })).code).toBe('note_required');
    const resolved = await recovery.resolveReceipt(didit.id, { adminId: crypto.randomUUID(), note: 'Re-ran KYC manually' });
    expect(resolved.ok).toBe(true);
  });
});
