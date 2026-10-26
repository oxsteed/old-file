'use strict';

/**
 * Customer 360 second-wave endpoints.
 *
 * Covers the new customer360Controller surface: watchlist CRUD, note
 * pinning, case ownership, login history, duplicates (entity graph),
 * and related search. Runs against a real PostgreSQL database because
 * these endpoints are SQL-heavy; honors CUSTOMER360_TEST_DATABASE_URL
 * end to end (disposable localhost database only).
 */

const DISPOSABLE_PATTERN = (() => {
  const raw = process.env.CUSTOMER360_TEST_DATABASE_URL
    || process.env.STATEMENT_TEST_DATABASE_URL
    || 'postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test?sslmode=disable';
  let url;
  try { url = new URL(raw); } catch { throw new Error('Requires a disposable localhost test database'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test'
    || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
    throw new Error('Requires a disposable localhost credit_statement_test database; connection overrides are forbidden');
  }
  return raw;
})();

process.env.DATABASE_URL = DISPOSABLE_PATTERN;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const crypto = require('crypto');

// The global test setup mocks 'pg'; these tests need the real driver.
jest.unmock('pg');

const db = require('../db');
const ctrl = require('../controllers/customer360Controller');

function mockRes() {
  const res = {};
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

const adminId = crypto.randomUUID();
const targetId = crypto.randomUUID();
const otherId = crypto.randomUUID();
const adminReq = (params = {}, query = {}, body = {}) => ({
  params, query, body,
  user: { id: adminId, role: 'super_admin' },
});

describe('customer 360 wave-2 endpoints', () => {
  beforeAll(async () => {
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, role)
       VALUES ($1, $2, 'Wave', 'Admin', 'x', 'super_admin'),
              ($3, $4, 'Wave', 'Target', 'x', 'customer'),
              ($5, $6, 'Wave', 'Other', 'x', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [adminId, `wave-admin-${adminId.slice(0, 8)}@example.com`,
       targetId, `wave-target-${targetId.slice(0, 8)}@example.com`,
       otherId, `wave-other-${otherId.slice(0, 8)}@example.com`]
    );
  }, 30000);

  afterAll(async () => {
    const cleanups = [
      [`DELETE FROM admin_user_watchlist WHERE target_user_id = $1`, [targetId]],
      [`DELETE FROM admin_user_case_owner WHERE target_user_id = $1`, [targetId]],
      [`DELETE FROM user_login_history WHERE user_id IN ($1, $2)`, [targetId, otherId]],
      [`DELETE FROM entity_links WHERE subject_id LIKE 'WAVETEST%' OR object_id LIKE 'WAVETEST%'`, []],
      [`DELETE FROM entity_ids WHERE public_id LIKE 'WAVETEST%'`, []],
    ];
    for (const [sql, params] of cleanups) {
      try { await db.query(sql, params); } catch (e) { /* best-effort */ }
    }
    await db.end();
  }, 30000);

  test('watchlist: add, status, remove', async () => {
    let res = mockRes();
    await ctrl.addWatch(adminReq({ userId: targetId }, {}, { triggers: ['dispute'] }), res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body.watching).toBe(true);

    res = mockRes();
    await ctrl.getWatchStatus(adminReq({ userId: targetId }), res);
    expect(res.body.watching).toBe(true);
    expect(res.body.watch.triggers).toContain('dispute');

    res = mockRes();
    await ctrl.removeWatch(adminReq({ userId: targetId }), res);
    expect(res.body.watching).toBe(false);

    res = mockRes();
    await ctrl.getWatchStatus(adminReq({ userId: targetId }), res);
    expect(res.body.watching).toBe(false);
  }, 30000);

  test('watchlist rejects an invalid user id', async () => {
    const res = mockRes();
    await ctrl.addWatch(adminReq({ userId: 'not-a-uuid' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('note pinning toggles is_pinned', async () => {
    const { rows } = await db.query(
      `INSERT INTO admin_user_notes (target_user_id, admin_id, note_text)
       VALUES ($1::UUID, $2::UUID, 'wave2 pin test') RETURNING id`,
      [targetId, adminId]
    );
    const noteId = rows[0].id;

    let res = mockRes();
    await ctrl.toggleNotePin(adminReq({ userId: targetId, noteId: String(noteId) }, {}, { pinned: true }), res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body.note.is_pinned).toBe(true);

    const check = await db.query(`SELECT is_pinned, pinned_by FROM admin_user_notes WHERE id = $1`, [noteId]);
    expect(check.rows[0].is_pinned).toBe(true);

    res = mockRes();
    await ctrl.toggleNotePin(adminReq({ userId: targetId, noteId: String(noteId) }, {}, { pinned: false }), res);
    expect(res.body.note.is_pinned).toBe(false);

    try { await db.query(`DELETE FROM admin_user_notes WHERE id = $1`, [noteId]); } catch (e) { /* ignore */ }
  }, 30000);

  test('case owner: set, get, clear', async () => {
    let res = mockRes();
    await ctrl.setCaseOwner(adminReq({ userId: targetId }, {}, {}), res);
    expect(res.body.ok).toBe(true);

    res = mockRes();
    await ctrl.getCaseOwner(adminReq({ userId: targetId }), res);
    expect(res.body.owner).toBeTruthy();
    expect(res.body.owner.owner_admin_id).toBe(adminId);
    expect(res.body.owner.owner_name).toMatch(/Wave Admin/);

    res = mockRes();
    await ctrl.clearCaseOwner(adminReq({ userId: targetId }), res);
    expect(res.body.ok).toBe(true);

    res = mockRes();
    await ctrl.getCaseOwner(adminReq({ userId: targetId }), res);
    expect(res.body.owner).toBeNull();
  }, 30000);

  test('login history returns rows and shared-IP flags', async () => {
    await db.query(
      `INSERT INTO user_login_history (user_id, success, ip_address, user_agent)
       VALUES ($1::UUID, TRUE, '10.9.8.7', 'WaveAgent/1.0'),
              ($2::UUID, TRUE, '10.9.8.7', 'OtherAgent/2.0')`,
      [targetId, otherId]
    );
    const res = mockRes();
    await ctrl.getLoginHistory(adminReq({ userId: targetId }), res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body.logins.length).toBeGreaterThanOrEqual(1);
    const row = res.body.logins.find((l) => l.ip_address === '10.9.8.7');
    expect(row).toBeTruthy();
    expect(Number(row.other_users_on_ip)).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.total_logins).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.distinct_ips).toBeGreaterThanOrEqual(1);
  }, 30000);

  test('duplicates resolves entity-graph duplicate_of links', async () => {
    const mePublic = 'WAVETEST-person-1';
    const otherPublic = 'WAVETEST-person-2';
    await db.query(
      `INSERT INTO entity_ids (public_id, entity_type, entity_key)
       VALUES ($1, 'person', $2), ($3, 'person', $4)
       ON CONFLICT (public_id) DO NOTHING`,
      [mePublic, targetId, otherPublic, otherId]
    );
    await db.query(
      `INSERT INTO entity_links (subject_id, object_id, relation)
       VALUES ($1, $2, 'duplicate_of')`,
      [mePublic, otherPublic]
    );
    const res = mockRes();
    await ctrl.getDuplicates(adminReq({ userId: targetId }), res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body.duplicates.length).toBe(1);
    expect(res.body.duplicates[0].id).toBe(otherId);
    expect(res.body.duplicates[0].direction).toBe('outgoing');
  }, 30000);

  test('related search finds other users mentioning the query', async () => {
    const marker = `wave2marker-${targetId.slice(0, 8)}`;
    const { rows } = await db.query(
      `INSERT INTO admin_user_notes (target_user_id, admin_id, note_text)
       VALUES ($1::UUID, $2::UUID, $3) RETURNING id`,
      [otherId, adminId, `customer mentioned ${marker} in a call`]
    );
    const noteId = rows[0].id;
    const res = mockRes();
    await ctrl.relatedSearch(adminReq({ userId: targetId }, { q: marker }), res);
    expect(res.json).toHaveBeenCalled();
    const hit = res.body.results.find((r) => r.kind === 'note' && String(r.id) === String(noteId));
    expect(hit).toBeTruthy();
    expect(hit.subject_email).toContain('wave-other-');
    try { await db.query(`DELETE FROM admin_user_notes WHERE id = $1`, [noteId]); } catch (e) { /* ignore */ }
  }, 30000);

  test('notifyWatchers honors ticket and booking triggers', async () => {
    // Watch with all three triggers
    let res = mockRes();
    await ctrl.addWatch(
      adminReq({ userId: targetId }, {}, { triggers: ['dispute', 'ticket', 'booking'] }),
      res
    );
    expect(res.body.watch.triggers).toEqual(
      expect.arrayContaining(['dispute', 'ticket', 'booking'])
    );

    // Mock sendNotification to capture calls
    const sent = [];
    const notifPath = require.resolve('../services/notificationService');
    const orig = require(notifPath);
    require.cache[notifPath].exports = {
      ...orig,
      sendNotification: jest.fn(async (args) => { sent.push(args); }),
    };
    try {
      await ctrl.notifyWatchers({
        targetUserIds: [targetId],
        eventType: 'ticket',
        refId: 'tick-1',
        title: 'Help needed',
      });
      expect(sent.length).toBe(1);
      expect(sent[0].type).toBe('watchlist_ticket');
      expect(sent[0].userId).toBe(adminId);

      sent.length = 0;
      await ctrl.notifyWatchers({
        targetUserIds: [targetId],
        eventType: 'booking',
        refId: 'job-1',
        title: 'Fix sink',
      });
      expect(sent.length).toBe(1);
      expect(sent[0].type).toBe('watchlist_booking');

      // Unknown event type is ignored
      sent.length = 0;
      await ctrl.notifyWatchers({
        targetUserIds: [targetId],
        eventType: 'nope',
        refId: 'x-1',
        title: 'x',
      });
      expect(sent.length).toBe(0);
    } finally {
      require.cache[notifPath].exports = orig;
    }

    res = mockRes();
    await ctrl.removeWatch(adminReq({ userId: targetId }), res);
    expect(res.body.watching).toBe(false);
  }, 30000);

  test('health returns user metrics and platform baselines', async () => {
    const res = mockRes();
    await ctrl.getHealth(adminReq({ userId: targetId }), res);
    expect(res.json).toHaveBeenCalled();
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('platform');
  }, 30000);

  test('linked entities returns an array', async () => {
    const res = mockRes();
    await ctrl.getLinkedEntities(adminReq({ userId: targetId }), res);
    expect(res.json).toHaveBeenCalled();
    expect(Array.isArray(res.body.entities)).toBe(true);
  }, 30000);
});
