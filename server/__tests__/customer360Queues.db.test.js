'use strict';

// Customer 360 upgrade 10 on PostgreSQL: team queues, SLA tracking, feed
// sync, topic visibility and saved views.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const queues = require('../services/customer360Queues');

jest.setTimeout(120000);

test('filters are allowlisted', () => {
  expect(queues.normalizeFilters({})).toEqual({ queues: [], statuses: ['open', 'claimed'], assignee: 'any', breachedOnly: false, sort: 'due' });
  expect(queues.normalizeFilters({ queues: 'general,anomalies', statuses: ['open'], assignee: 'me', breachedOnly: 'true', sort: 'created' }))
    .toEqual({ queues: ['general', 'anomalies'], statuses: ['open'], assignee: 'me', breachedOnly: true, sort: 'created' });
  for (const bad of [{ statuses: ['resolved'] }, { assignee: 'x' }, { sort: 'name' }, { queues: ["x'; drop"] }]) {
    expect(() => queues.normalizeFilters(bad)).toThrow(expect.objectContaining({ code: 'invalid_filters' }));
  }
  expect(queues.topicsFor({ anomalyKinds: ['refund_spike'], links: false })).toEqual(['refund_spike', 'general']);
});

test('queues DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 queues', () => {
  let pool;
  let admin;
  let admin2;
  const ALL = ['refund_spike', 'payout_failures', 'new_country_login', 'link_review', 'general'];
  const audit = (action, d = {}) => require('../services/auditService').logAdminAction({
    adminId: admin, action, targetType: 'customer360_queue', targetId: d.targetId || null, after: d.after, client: d.client, throwOnError: true });
  async function user(role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', 'Quin', 'Queue', $3)`,
      [id, `c360-q-${id}@example.invalid`, role]);
    return id;
  }
  beforeAll(async () => {
    pool = require('../db');
    admin = await user('admin');
    admin2 = await user('admin');
  });
  afterAll(async () => { await pool.end?.(); });

  test('manual items: add, claim, conflict, release, resolve with SLA stats', async () => {
    const c = await user();
    const item = await queues.enqueue({ queueKey: 'general', customerId: c, reason: 'Call back about card', adminId: admin, audit });
    expect(item).toMatchObject({ status: 'open', queue_key: 'general', breached: false, revision: 1 });
    expect(item.minutes_left).toBeGreaterThan(1430);
    await expect(queues.enqueue({ queueKey: 'general', customerId: c, reason: 'again', adminId: admin, audit })).rejects.toMatchObject({ code: 'already_queued' });
    await expect(queues.enqueue({ queueKey: 'anomalies', customerId: c, reason: 'x', adminId: admin, audit })).rejects.toMatchObject({ code: 'feed_queue' });
    const claimed = await queues.act({ itemId: item.id, action: 'claim', revision: 1, adminId: admin, topics: ALL, audit });
    expect(claimed).toMatchObject({ status: 'claimed', assigned_to: admin, revision: 2 });
    await expect(queues.act({ itemId: item.id, action: 'claim', revision: 1, adminId: admin2, topics: ALL, audit })).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(queues.act({ itemId: item.id, action: 'claim', revision: 2, adminId: admin2, topics: ALL, audit })).rejects.toMatchObject({ code: 'already_claimed' });
    await expect(queues.act({ itemId: item.id, action: 'release', revision: 2, adminId: admin2, topics: ALL, audit })).rejects.toMatchObject({ code: 'not_assignee' });
    const released = await queues.act({ itemId: item.id, action: 'release', revision: 2, adminId: admin, topics: ALL, audit });
    expect(released).toMatchObject({ status: 'open', assigned_to: null });
    await expect(queues.act({ itemId: item.id, action: 'resolve', revision: 3, adminId: admin, topics: ALL, audit })).rejects.toMatchObject({ code: 'resolution_required' });
    const resolved = await queues.act({ itemId: item.id, action: 'resolve', revision: 3, resolution: 'handled', note: 'Done', adminId: admin, topics: ALL, audit });
    expect(resolved).toMatchObject({ status: 'resolved', resolution: 'handled' });
    const general = (await queues.queues(ALL)).find((q) => q.queue_key === 'general');
    expect(general.resolved_30d).toBeGreaterThanOrEqual(1);
    expect(general.sla_met_pct_30d).not.toBeNull();
    // Re-adding after resolution is allowed.
    await queues.enqueue({ queueKey: 'general', customerId: c, reason: 'New issue', adminId: admin, audit });
  });

  test('feeds follow their sources, breaches are stamped and topics hide items', async () => {
    const c = await user();
    const { rows: [a] } = await pool.query(
      `INSERT INTO customer_anomalies (customer_id, kind, first_detected_at) VALUES ($1, 'refund_spike', NOW() - interval '5 hours') RETURNING id::text`, [c]);
    await queues.syncFeeds();
    await queues.syncFeeds();
    const mine = await queues.customerItems(c, ALL);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ queue_key: 'anomalies', source_ref: a.id, breached: true });
    expect(await queues.customerItems(c, ['general'])).toEqual([]);
    await expect(queues.getItem(mine[0].id, ['general'])).rejects.toMatchObject({ code: 'queue_item_not_found' });
    await queues.markBreaches();
    const { rows: [stamped] } = await pool.query(`SELECT sla_breached_at IS NOT NULL AS b FROM customer360_queue_items WHERE id = $1`, [mine[0].id]);
    expect(stamped.b).toBe(true);
    const board = await queues.items({ filters: { queues: ['anomalies'], breachedOnly: true }, topics: ALL, adminId: admin });
    expect(board.items.some((i) => i.id === mine[0].id)).toBe(true);
    const hidden = await queues.items({ filters: { queues: ['anomalies'] }, topics: ['general'], adminId: admin });
    expect(hidden.items.some((i) => i.id === mine[0].id)).toBe(false);
    await pool.query(`UPDATE customer_anomalies SET status = 'resolved' WHERE id = $1`, [a.id]);
    await queues.syncFeeds();
    expect((await queues.customerItems(c, ALL))[0]).toMatchObject({ status: 'resolved', resolution: 'source_closed' });
  });

  test('board pagination is stable and assignee filters work', async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await user();
      ids.push((await queues.enqueue({ queueKey: 'general', customerId: c, reason: `r${i}`, adminId: admin, audit })).id);
    }
    await queues.act({ itemId: ids[0], action: 'claim', revision: 1, adminId: admin2, topics: ALL, audit });
    const me = await queues.items({ filters: { queues: ['general'], assignee: 'me' }, topics: ALL, adminId: admin2 });
    expect(me.items.map((i) => i.id)).toEqual([ids[0]]);
    const un = await queues.items({ filters: { queues: ['general'], assignee: 'unassigned' }, topics: ALL, adminId: admin2 });
    expect(un.items.map((i) => i.id)).toEqual(expect.arrayContaining([ids[1], ids[2]]));
    await expect(queues.items({ filters: {}, topics: ALL, adminId: admin, cursor: 'bad' })).rejects.toMatchObject({ code: 'invalid_cursor' });
  });

  test('queue config and saved views: owner-only edits, team views shared', async () => {
    const key = `q_${crypto.randomBytes(4).toString('hex')}`;
    const q = await queues.createQueue({ body: { queueKey: key, name: 'Escalations', slaMinutes: 60 }, adminId: admin, audit });
    await expect(queues.createQueue({ body: { queueKey: key, name: 'x', slaMinutes: 60 }, adminId: admin, audit })).rejects.toMatchObject({ code: 'queue_exists' });
    await expect(queues.updateQueue({ queueId: q.id, body: { slaMinutes: 1, revision: 1 }, audit })).rejects.toMatchObject({ code: 'invalid_sla' });
    const u = await queues.updateQueue({ queueId: q.id, body: { slaMinutes: 120, revision: 1 }, audit });
    expect(u).toMatchObject({ sla_minutes: 120, revision: 2 });
    const v = await queues.saveView({ adminId: admin, body: { name: 'My breaches', scope: 'team', filters: { breachedOnly: true, assignee: 'me' } }, audit });
    expect(v.filters).toMatchObject({ breachedOnly: true, assignee: 'me' });
    await expect(queues.saveView({ adminId: admin, body: { name: 'my BREACHES', filters: {} }, audit })).rejects.toMatchObject({ code: 'view_name_taken' });
    const seen = await queues.views(admin2);
    expect(seen.find((x) => x.id === v.id)).toMatchObject({ mine: false, scope: 'team' });
    await expect(queues.saveView({ adminId: admin2, viewId: v.id, body: { name: 'Hijack', filters: {}, revision: 1 }, audit })).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(queues.deleteView({ adminId: admin2, viewId: v.id, audit })).rejects.toMatchObject({ code: 'view_not_found' });
    const p = await queues.saveView({ adminId: admin, viewId: v.id, body: { name: 'My breaches', scope: 'private', filters: { breachedOnly: true }, revision: 1 }, audit });
    expect(p.revision).toBe(2);
    expect((await queues.views(admin2)).find((x) => x.id === v.id)).toBeUndefined();
    await queues.deleteView({ adminId: admin, viewId: v.id, audit });
  });
});
