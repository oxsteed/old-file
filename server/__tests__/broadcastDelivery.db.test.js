'use strict';

// Decision 1: real business broadcast delivery against the real schema
// (LIKE public.* INCLUDING ALL in a disposable schema). Covers audience
// expansion, idempotent per-recipient delivery rows, preference and
// unsubscribe enforcement, fenced leases, retries, in-app read / push open /
// email open+click tracking, one-click unsubscribe, and reporting.
const crypto = require('crypto');
const schema = `broadcast_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const svc = require('../services/broadcastDeliveryService');
const { runBroadcastDeliveryTick } = require('../jobs/broadcastDelivery');

const TABLES = ['users', 'businesses', 'business_clients', 'customer_business_profile', 'notification_preferences',
  'notifications', 'business_broadcasts', 'business_broadcast_recipients', 'business_broadcast_deliveries',
  'business_broadcast_suppressions', 'business_audit_log'];

(url ? describe : describe.skip)('business broadcast delivery', () => {
  const owner = crypto.randomUUID();
  const ana = crypto.randomUUID();    // platform user, all channels allowed, French
  const ben = crypto.randomUUID();    // platform user, opted out of push + marketing email
  const cleo = crypto.randomUUID();   // platform user, blocked by the business
  let businessId;
  const emails = [];
  const push = [];
  const deps = (over = {}) => ({
    db,
    sendEmail: async (msg) => { emails.push(msg); return over.emailResult || { success: true, id: `re_${emails.length}` }; },
    webPush: { sendToUser: async (userId, payload) => { push.push({ userId, payload }); return over.webPush || { sent: 1, failed: 0 }; } },
    mobilePush: { sendToUser: async () => ({ sent: 0, failed: 0, skipped: 0 }) },
  });
  const user = (id, lang = 'en') => db.query(`INSERT INTO users(id, email, password_hash, first_name, last_name, role, preferred_language)
    VALUES($1, $2, 'x', 'T', 'U', 'customer', $3)`, [id, `${id}@example.test`, lang]);
  const client = (fields) => db.query(`INSERT INTO business_clients(business_id, customer_id, display_name, email, status, tags)
    VALUES($1, $2, 'Client', $3, $4, $5) RETURNING id`, [businessId, fields.customer || null, fields.email || null,
    fields.status || 'active', fields.tags || []]);
  const broadcast = async (channel, over = {}) => (await db.query(`INSERT INTO business_broadcasts
      (business_id, subject, body, message, channel, audience, status, scheduled_at)
    VALUES($1, 'Spring sale', $2, $2, $3, $4, $5, $6) RETURNING id`, [businessId,
    over.message || 'Hello!\n\nSee https://example.com/sale?a=1&b=2 today.', channel, over.audience || 'all',
    over.status || 'draft', over.scheduledAt || null])).rows[0].id;
  const queue = async (id) => {
    const c = await db.connect();
    try { await c.query('BEGIN'); const r = await svc.queueBroadcast(c, { businessId, broadcastId: id, userId: owner }); await c.query('COMMIT'); return r; }
    finally { c.release(); }
  };
  const deliveries = async (id) => (await db.query(`SELECT d.*, r.user_id, r.email, r.tracking_token
    FROM business_broadcast_deliveries d JOIN business_broadcast_recipients r ON r.id = d.recipient_id
    WHERE d.broadcast_id = $1 ORDER BY r.client_id, d.channel`, [id])).rows;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await db.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
    await user(owner); await user(ana, 'fr'); await user(ben); await user(cleo);
    ({ rows: [{ id: businessId }] } = await db.query(
      `INSERT INTO businesses(user_id, business_name) VALUES($1, 'Café Ayiti') RETURNING id`, [owner]));
    await db.query(`INSERT INTO notification_preferences(user_id, push_notifications, marketing_emails) VALUES($1, FALSE, FALSE)`, [ben]);
    await client({ customer: ana, tags: ['vip'] });
    await client({ customer: ben });
    await client({ customer: cleo });
    await client({ email: ' Walkin@Example.TEST ' });           // CRM-only contact: email only
    await client({ email: 'archived@example.test', status: 'archived' });
    await db.query(`INSERT INTO customer_business_profile(business_id, customer_id, is_blocked) VALUES($1, $2, TRUE)`, [businessId, cleo]);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  test('queue expands the audience once into per-recipient, per-channel rows', async () => {
    const id = await broadcast('all');
    const out = await queue(id);
    expect(out.queued).toBe(true);
    expect(out.broadcast).toMatchObject({ status: 'sending', recipient_count: 3, delivery_tracked: true,
      channels: ['in_app', 'push', 'email'], tracked_links: ['https://example.com/sale?a=1&b=2'] });
    const rows = await deliveries(id);
    expect(rows).toHaveLength(9);
    const walkIn = rows.filter(r => r.user_id === null);
    expect(walkIn.map(r => [r.channel, r.status, r.skip_reason])).toEqual([
      ['email', 'pending', null], ['in_app', 'skipped', 'no_platform_account'], ['push', 'skipped', 'no_platform_account']]);
    expect(walkIn[0].email).toBe('walkin@example.test');
    // Replaying the expansion is a no-op; a sent broadcast cannot be re-queued.
    await db.query(`UPDATE business_broadcasts SET status='draft' WHERE id=$1`, [id]);
    await queue(id);
    expect(await deliveries(id)).toHaveLength(9);
    await db.query(`UPDATE business_broadcasts SET status='sending' WHERE id=$1`, [id]);
    expect(await queue(id)).toMatchObject({ conflict: true });
  });

  test('worker delivers per channel, honors preferences, records tracking and reports', async () => {
    const id = (await db.query(`SELECT id FROM business_broadcasts ORDER BY id LIMIT 1`)).rows[0].id;
    emails.length = 0; push.length = 0;
    const result = await runBroadcastDeliveryTick(deps());
    expect(result.finished).toContain(id);
    const rows = await deliveries(id);
    const by = (u, ch) => rows.find(r => r.user_id === u && r.channel === ch);
    expect(by(ana, 'in_app')).toMatchObject({ status: 'sent' });
    expect(by(ana, 'push')).toMatchObject({ status: 'sent', devices_sent: 1 });
    expect(by(ana, 'email')).toMatchObject({ status: 'sent', provider_message_id: expect.stringMatching(/^re_/) });
    expect(by(ben, 'push')).toMatchObject({ status: 'skipped', skip_reason: 'push_opted_out' });
    expect(by(ben, 'email')).toMatchObject({ status: 'skipped', skip_reason: 'email_opted_out' });
    expect(by(ben, 'in_app')).toMatchObject({ status: 'sent' });
    expect(rows.some(r => r.user_id === cleo)).toBe(false);
    expect(emails).toHaveLength(2);
    const anaMail = emails.find(m => m.to === `${ana}@example.test`);
    expect(anaMail.idempotencyKey).toBe(`business-broadcast:${by(ana, 'email').id}`);
    expect(anaMail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(anaMail.html).toContain('lang="fr" dir="ltr"');
    expect(anaMail.html).toContain('Se désabonner de Café Ayiti');
    expect(anaMail.html).toContain(`/api/broadcast-tracking/c/${by(ana, 'email').tracking_token}/0`);
    expect(anaMail.html).not.toContain('<script');
    expect(push[0].payload.data.track_url).toContain(`/p/${by(ana, 'push').tracking_token}`);
    const { rows: [note] } = await db.query(`SELECT * FROM notifications WHERE id = $1`, [by(ana, 'in_app').notification_id]);
    expect(note).toMatchObject({ type: 'business_broadcast', is_promotional: true, title: 'Spring sale' });

    // Tracking: in-app read, push open, email open + whitelisted click only.
    await db.query(`UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1`, [note.id]);
    expect(await svc.recordOpen(db, by(ana, 'push').tracking_token, 'push')).toBe(true);
    expect(await svc.recordOpen(db, by(ana, 'email').tracking_token, 'email')).toBe(true);
    expect(await svc.recordClick(db, by(ana, 'email').tracking_token, 0)).toBe('https://example.com/sale?a=1&b=2');
    expect(await svc.recordClick(db, by(ana, 'email').tracking_token, 1)).toBeNull();
    expect(await svc.recordClick(db, 'f'.repeat(64), 0)).toBeNull();
    expect(await svc.recordOpen(db, 'not-a-token', 'email')).toBe(false);

    const stats = (await svc.getBroadcastStats(db, [id]))[String(id)];
    expect(stats.channels.email).toMatchObject({ total: 3, sent: 2, skipped: 1, opened: 1, clicked: 1, openRatePct: 50, clickRatePct: 50,
      skipReasons: { email_opted_out: 1 } });
    expect(stats.channels.in_app).toMatchObject({ sent: 2, opened: 1, openRatePct: 50 });
    expect(stats.channels.push).toMatchObject({ sent: 1, opened: 1, skipReasons: { push_opted_out: 1, no_platform_account: 1 } });
    const report = await svc.getBroadcastReport(db, businessId, 30);
    expect(report.channels.email).toMatchObject({ broadcasts: 1, sent: 2, opened: 1, clicked: 1 });
    const { rows: [b] } = await db.query(`SELECT status, completed_at FROM business_broadcasts WHERE id=$1`, [id]);
    expect(b.status).toBe('sent');
  });

  test('one-click unsubscribe suppresses later broadcasts for that business', async () => {
    const first = (await deliveries((await db.query(`SELECT id FROM business_broadcasts ORDER BY id LIMIT 1`)).rows[0].id))
      .find(r => r.user_id === ana && r.channel === 'email');
    expect(await svc.unsubscribe(db, first.tracking_token, 'one_click')).toMatchObject({ user_id: ana });
    expect(await svc.unsubscribe(db, first.tracking_token, 'one_click')).toMatchObject({ user_id: ana }); // idempotent
    const id = await broadcast('email', { audience: 'vip' });
    await queue(id);
    emails.length = 0;
    await runBroadcastDeliveryTick(deps());
    const rows = await deliveries(id);
    expect(rows).toEqual([expect.objectContaining({ user_id: ana, status: 'skipped', skip_reason: 'unsubscribed' })]);
    expect(emails).toHaveLength(0);
    expect((await svc.getBroadcastStats(db, [first.broadcast_id]))[String(first.broadcast_id)].unsubscribes).toBe(1);
  });

  test('retries with backoff, gives up after MAX_ATTEMPTS, and a stale lease cannot record', async () => {
    await db.query(`DELETE FROM business_broadcast_suppressions`);
    const id = await broadcast('email', { audience: 'vip' });
    await queue(id);
    await runBroadcastDeliveryTick(deps({ emailResult: { success: false, code: 'email_not_configured' } }));
    let [row] = await deliveries(id);
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'email_not_configured' });
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30000);

    // Stale lease: claim, let another worker re-claim after expiry, then the
    // first worker's late result is refused.
    await db.query(`UPDATE business_broadcast_deliveries SET next_attempt_at = NOW() WHERE broadcast_id=$1`, [id]);
    const [stale] = await svc.claimDeliveries(db, { limit: 10 });
    await db.query(`UPDATE business_broadcast_deliveries SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [stale.id]);
    const [fresh] = await svc.claimDeliveries(db, { limit: 10 });
    expect(fresh.id).toBe(stale.id);
    expect(fresh.lease_token).not.toBe(stale.lease_token);
    expect(await svc.deliverOne(db, stale, deps())).toBe(false);
    expect(await svc.deliverOne(db, fresh, deps({ emailResult: { success: false, error: 'boom' } }))).toBe(true);

    await db.query(`UPDATE business_broadcast_deliveries SET attempts = $2 - 1, next_attempt_at = NOW() WHERE broadcast_id=$1`, [id, svc.MAX_ATTEMPTS]);
    await runBroadcastDeliveryTick(deps({ emailResult: { success: false, error: 'still down' } }));
    [row] = await deliveries(id);
    expect(row).toMatchObject({ status: 'failed', attempts: svc.MAX_ATTEMPTS, last_error: 'still down' });
    const { rows: [b] } = await db.query(`SELECT status FROM business_broadcasts WHERE id=$1`, [id]);
    expect(b.status).toBe('sent');
  });

  test('future schedules wait; due schedules are promoted by the worker', async () => {
    const id = await broadcast('in_app', { status: 'scheduled', scheduledAt: new Date(Date.now() + 3600e3) });
    expect(await queue(id)).toMatchObject({ scheduled: true });
    expect(await deliveries(id)).toHaveLength(0);
    await db.query(`UPDATE business_broadcasts SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [id]);
    const result = await runBroadcastDeliveryTick(deps());
    expect(result.promoted).toContain(id);
    expect((await deliveries(id)).filter(r => r.status === 'sent')).toHaveLength(2);
  });

  test('sms and unknown channels are refused rather than silently marked sent', async () => {
    const id = await broadcast('sms');
    await expect(queue(id)).rejects.toMatchObject({ code: 'broadcast_channel_unsupported' });
  });
});
