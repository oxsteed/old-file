'use strict';

// Staff review S-17 (announcements + log book) and S-19 (notification
// type + params) against the real migrated schema. Runs only against an
// explicitly opted-in disposable st_t4 database:
//   ST_T4_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/st_t4
//
// Fixtures are stamped with a unique suffix; comms rows are cleaned up,
// while user/business/restaurant rows stay in the disposable database
// (food_restaurants deletes are blocked schema-wide by the wallet
// ledger's append-only rewrite rule, as other tracks have documented).
function stT4OptIn() {
  const value = process.env.ST_T4_TEST_DATABASE_URL || '';
  if (!value) return '';
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!loopback || url.pathname !== '/st_t4') {
    throw new Error('ST_T4_TEST_DATABASE_URL must be a loopback st_t4 database');
  }
  return value;
}

const url = stT4OptIn();
if (url) process.env.DATABASE_URL = url;
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const teamComms = require('../controllers/restaurantTeamCommsController');
const appFlow = require('../controllers/restaurantAppFlowController');
const training = require('../controllers/restaurantTrainingController');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function mockNext() {
  const next = (err) => { if (err) next.error = err; };
  next.error = null;
  return next;
}

async function call(handler, req) {
  const res = mockRes();
  const next = mockNext();
  await handler(req, res, next);
  return { res, error: next.error };
}

suite('S-17/S-19 restaurant team communication', () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let ownerId;
  let staffId;
  let outsiderId;
  let businessId;
  let restaurantId;
  let announcementId;

  const reqFor = (userId, body = {}, params = {}, query = {}) => ({
    user: { id: userId },
    body,
    params,
    query,
    get: () => undefined,
  });

  async function makeUser(tag) {
    const { rows: [user] } = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, 'x', $2, 'Fixture') RETURNING id`,
      [`st4-${tag}-${stamp}@example.test`, tag]
    );
    return user.id;
  }

  beforeAll(async () => {
    ownerId = await makeUser('Owner');
    staffId = await makeUser('Staff');
    outsiderId = await makeUser('Outsider');
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `ST4 Bistro ${stamp}`]
    );
    businessId = biz.id;
    const { rows: [rest] } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [businessId, ownerId, `ST4 Bistro ${stamp}`]
    );
    restaurantId = rest.id;
    await db.query(
      `INSERT INTO business_members (business_id, member_id, role, status)
       VALUES ($1, $2, 'employee', 'active')`,
      [businessId, staffId]
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM restaurant_announcement_acks WHERE announcement_id IN (SELECT id FROM restaurant_announcements WHERE restaurant_id = $1)', [restaurantId]);
    await db.query('DELETE FROM restaurant_announcements WHERE restaurant_id = $1', [restaurantId]);
    await db.query('DELETE FROM restaurant_logbook_entries WHERE restaurant_id = $1', [restaurantId]);
    await db.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [[ownerId, staffId, outsiderId]]);
    await db.end();
  });

  test('manager posts an announcement; staff sees it unacknowledged', async () => {
    const { res, error } = await call(
      teamComms.createAnnouncement,
      reqFor(ownerId, { title: 'New menu Friday', body: 'Tasting at 4pm' }, { restaurantId: String(restaurantId) })
    );
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    announcementId = res.body.announcement.id;
    expect(res.body.announcement.ack_count).toBe(0);

    const list = await call(
      teamComms.listAnnouncements,
      reqFor(staffId, {}, { restaurantId: String(restaurantId) })
    );
    expect(list.error).toBeNull();
    const mine = list.res.body.announcements.find((a) => a.id === announcementId);
    expect(mine).toBeTruthy();
    expect(mine.acknowledged_by_me).toBe(false);
    expect(mine.ack_count).toBe(0);
  });

  test('announcement fans a type+params notification out to staff (S-19)', async () => {
    const { rows } = await db.query(
      `SELECT type, data FROM notifications WHERE user_id = $1 AND type = 'restaurant_announcement'`,
      [staffId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data.params.announcementTitle).toBe('New menu Friday');
    expect(rows[0].data.params.restaurantName).toBe(`ST4 Bistro ${stamp}`);
    expect(rows[0].data.announcementId).toBe(announcementId);
  });

  test('staff acknowledgement is recorded once and reflected in the list', async () => {
    const params = { restaurantId: String(restaurantId), announcementId: String(announcementId) };
    const first = await call(teamComms.acknowledgeAnnouncement, reqFor(staffId, {}, params));
    expect(first.error).toBeNull();
    expect(first.res.body.ack_count).toBe(1);
    const second = await call(teamComms.acknowledgeAnnouncement, reqFor(staffId, {}, params));
    expect(second.error).toBeNull();
    expect(second.res.body.ack_count).toBe(1);

    const list = await call(
      teamComms.listAnnouncements,
      reqFor(staffId, {}, { restaurantId: String(restaurantId) })
    );
    const mine = list.res.body.announcements.find((a) => a.id === announcementId);
    expect(mine.acknowledged_by_me).toBe(true);
    expect(mine.ack_count).toBe(1);
  });

  test('staff cannot post announcements or write the log book', async () => {
    const post = await call(
      teamComms.createAnnouncement,
      reqFor(staffId, { title: 'Staff takeover' }, { restaurantId: String(restaurantId) })
    );
    expect(post.error).toBeTruthy();
    expect(post.error.status).toBe(403);

    const log = await call(
      teamComms.createLogbookEntry,
      reqFor(staffId, { body: 'Staff note' }, { restaurantId: String(restaurantId) })
    );
    expect(log.error).toBeTruthy();
    expect(log.error.status).toBe(403);
  });

  test('non-members cannot read announcements or the log book', async () => {
    const list = await call(
      teamComms.listAnnouncements,
      reqFor(outsiderId, {}, { restaurantId: String(restaurantId) })
    );
    expect(list.error).toBeTruthy();
    expect(list.error.status).toBe(404);
    const log = await call(
      teamComms.listLogbook,
      reqFor(outsiderId, {}, { restaurantId: String(restaurantId) })
    );
    expect(log.error).toBeTruthy();
    expect(log.error.status).toBe(404);
  });

  test('manager writes a log book entry; staff reads it; bad shift is rejected', async () => {
    const created = await call(
      teamComms.createLogbookEntry,
      reqFor(ownerId, { body: 'Freezer ran warm at close; logged temps.' }, { restaurantId: String(restaurantId) })
    );
    expect(created.error).toBeNull();
    expect(created.res.statusCode).toBe(201);

    const list = await call(
      teamComms.listLogbook,
      reqFor(staffId, {}, { restaurantId: String(restaurantId) })
    );
    expect(list.error).toBeNull();
    expect(list.res.body.entries.some((e) => e.body.startsWith('Freezer ran warm'))).toBe(true);

    const badShift = await call(
      teamComms.createLogbookEntry,
      reqFor(ownerId, { body: 'Note', shiftId: 99999999 }, { restaurantId: String(restaurantId) })
    );
    expect(badShift.error).toBeTruthy();
    expect(badShift.error.status).toBe(404);
  });

  test('assigning a crew task notifies the assignee with type + params', async () => {
    const { res, error } = await call(
      appFlow.createCrewTask,
      reqFor(ownerId, { title: 'Restock napkins', assignedTo: staffId }, { restaurantId: String(restaurantId) })
    );
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    const { rows } = await db.query(
      `SELECT type, data FROM notifications WHERE user_id = $1 AND type = 'crew_task_assigned'`,
      [staffId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data.params.taskTitle).toBe('Restock napkins');
    expect(rows[0].data.taskId).toBe(res.body.task.id);
  });

  test('assigning training notifies the assignee with type + params', async () => {
    const { rows: [module] } = await db.query(
      `INSERT INTO restaurant_training_modules (restaurant_id, title, category, pass_score_pct, created_by)
       VALUES ($1, 'Knife safety', 'safety', 80, $2) RETURNING id`,
      [restaurantId, ownerId]
    );
    const { res, error } = await call(
      training.assignModule,
      reqFor(ownerId, { userId: staffId }, { restaurantId: String(restaurantId), moduleId: String(module.id) })
    );
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    const { rows } = await db.query(
      `SELECT type, data FROM notifications WHERE user_id = $1 AND type = 'training_assigned'`,
      [staffId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data.params.moduleTitle).toBe('Knife safety');
  });

  test('publishing a crew shift notifies staff; cancelling notifies again', async () => {
    const created = await call(
      appFlow.createCrewShift,
      reqFor(ownerId, {
        label: 'Friday dinner',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
      }, { restaurantId: String(restaurantId) })
    );
    expect(created.error).toBeNull();
    expect(created.res.statusCode).toBe(201);
    const shiftId = created.res.body.shift.id;

    const published = await db.query(
      `SELECT data FROM notifications WHERE user_id = $1 AND type = 'crew_shift_published'`,
      [staffId]
    );
    expect(published.rows).toHaveLength(1);
    expect(published.rows[0].data.params.shiftLabel).toBe('Friday dinner');

    const cancelled = await call(
      appFlow.updateCrewShift,
      reqFor(ownerId, { status: 'cancelled' }, { restaurantId: String(restaurantId), shiftId: String(shiftId) })
    );
    expect(cancelled.error).toBeNull();
    const cancelNotifs = await db.query(
      `SELECT data FROM notifications WHERE user_id = $1 AND type = 'crew_shift_cancelled'`,
      [staffId]
    );
    expect(cancelNotifs.rows).toHaveLength(1);
    expect(cancelNotifs.rows[0].data.params.shiftLabel).toBe('Friday dinner');
  });
});
