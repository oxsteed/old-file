'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `w11_integrity_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(target.hostname)
      || target.pathname !== '/credit_statement_test') throw new Error('Disposable statement DB required');
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../middleware/adminAuth', () => ({ hasGlobalGrant: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
const db = require('../db');
const learn = require('../controllers/learnController');
const { reviewVideoSubmission, reviewVideoFlag } = require('../services/learnVideoIntegrityService');
const { processLearnVideoReviewAlerts } = require('../services/learnVideoReviewAlerts');
const { normalizeSubmittedVideoUrl } = require('../utils/learnVideoIdentity');
const { logAdminAction } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');
const { hasGlobalGrant } = require('../middleware/adminAuth');
const admin = crypto.randomUUID();
const user = crypto.randomUUID();
const request = { user: { id: admin }, headers: {}, ip: '127.0.0.1' };
const describeDb = url ? describe : describe.skip;

describeDb('W11 Learn integrity against real PostgreSQL', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE users(id UUID PRIMARY KEY, email TEXT, role TEXT,
      is_active BOOLEAN, is_banned BOOLEAN, totp_enabled BOOLEAN)`);
    await db.query(`CREATE TABLE learn_guides(id TEXT PRIMARY KEY, title TEXT, status TEXT,
      video_url TEXT, video_provider TEXT)`);
    for (const file of ['630_learn_guide_video_submissions.sql', '631_learn_guide_video_playlists.sql', '793_w11_learn_review_integrity.sql']) {
      await db.query(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
    }
    for (let replay = 0; replay < 2; replay += 1) {
      await db.query(fs.readFileSync(path.join(__dirname, '../migrations/803_w11_learn_video_identity_parity.sql'), 'utf8'));
    }
    await db.query(`INSERT INTO users VALUES($1,'admin@example.invalid','super_admin',TRUE,FALSE,TRUE),
      ($2,'user@example.invalid','customer',TRUE,FALSE,FALSE)`, [admin, user]);
    await db.query("INSERT INTO learn_guides(id,title,status) VALUES('guide','Synthetic guide','published'),('target','Target','published')");
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    logAdminAction.mockResolvedValue(undefined);
    sendNotification.mockResolvedValue({ success: true });
    hasGlobalGrant.mockResolvedValue(true);
    await db.query("UPDATE users SET role='super_admin',is_active=TRUE,is_banned=FALSE,totp_enabled=TRUE WHERE id=$1", [admin]);
    await db.query('TRUNCATE learn_guide_video_submissions,learn_guide_videos,learn_guide_video_moderation_blocks CASCADE');
    await db.query('UPDATE learn_guides SET video_url=NULL');
  });
  async function invoke(handler, params, body = {}, actor = user) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await handler({ params, body, user: { id: actor }, headers: {} }, res, next);
    return { body: res.json.mock.calls[0]?.[0], error: next.mock.calls[0]?.[0], status: res.status.mock.calls[0]?.[0] };
  }
  const submit = (video_url, guide = 'guide') => invoke(learn.submitGuideVideo, { id: guide }, { video_url });
  async function video(url = 'https://youtu.be/abcdef') {
    return (await db.query("INSERT INTO learn_guide_videos(guide_id,video_url,video_provider) VALUES('guide',$1,'youtube') RETURNING id", [url])).rows[0].id;
  }
  async function flag(id) {
    return (await db.query("INSERT INTO learn_guide_video_flags(video_id,user_id,reason) VALUES($1,$2,'spam') RETURNING id", [id, user])).rows[0].id;
  }

  test.each([
    'https://www.youtube.com/watch?t=4&v=abc_def-123',
    'http://YOUTUBE.com/embed/abc_def-123?autoplay=1',
    'https://m.youtube.com/shorts/abc_def-123',
    'https://youtu.be/abc%5Fdef-123?t=4',
    'https://www.youtube.com/watch?v=abc%5Fdef-123',
    'https://player.vimeo.com/video/12345',
    'https://vimeo.com/12345?share=copy',
    'https://youtube.com/watch?%76=abc_def-123',
    'https://youtu.be//abc_def-123',
  ])('SQL and JS agree on historical provider identity: %s', async raw => {
    const normalized = normalizeSubmittedVideoUrl(raw);
    expect(normalized).not.toBeNull();
    expect((await db.query('SELECT learn_video_identity($1) AS identity', [raw])).rows[0].identity).toBe(normalized.identity);
  });

  test.each([
    'https://example.invalid/watch?v=abcdef',
    'https://youtube.com/watch#?v=abcdef',
    'https://youtu.be/abc%20def',
    'https://youtube.com/watch?v=ab',
    'https://youtube.com/watch?next=/embed/abcdef',
    'https://youtube.com/watch&v=abcdef',
    'https://youtube.com/watch?v=abcdef?foo',
    'https://vimeo.com/watch?next=/12345',
  ])('invalid provider links cannot gain a SQL identity: %s', async raw => {
    expect(normalizeSubmittedVideoUrl(raw)).toBeNull();
    expect((await db.query('SELECT learn_video_identity($1) AS identity', [raw])).rows[0].identity).toBeNull();
  });

  test.each(['pending', 'live', 'pinned'].flatMap(source => [
    [source, 'https://youtu.be/abc_def-123?t=4'],
    [source, 'https://youtube.com/watch?%76=abc_def-123'],
    [source, 'https://youtu.be//abc_def-123'],
  ]))('historical %s alias cannot be submitted again: %s', async (source, raw) => {
    if (source === 'pending') await db.query("INSERT INTO learn_guide_video_submissions(guide_id,video_url,status) VALUES('guide',$1,'pending')", [raw]);
    if (source === 'live') await video(raw);
    if (source === 'pinned') await db.query("UPDATE learn_guides SET video_url=$1 WHERE id='guide'", [raw]);
    expect((await submit('https://youtube.com/watch?v=abc_def-123')).error).toMatchObject({ code: 'video_duplicate', statusCode: 409 });
  });

  test('concurrent alias submissions create exactly one pending row and one notice', async () => {
    const results = await Promise.all([submit('https://youtu.be/abcdef'), submit('https://youtube.com/watch?v=abcdef')]);
    expect(results.filter(result => result.status === 201)).toHaveLength(1);
    expect(results.filter(result => result.error?.code === 'video_duplicate')).toHaveLength(1);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM learn_guide_video_submissions')).rows[0].n).toBe(1);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM learn_video_review_notice_jobs')).rows[0].n).toBe(1);
  });

  test('duplicate lookup failure cannot create a pending submission or notice', async () => {
    const connect = db.connect.bind(db);
    const spy = jest.spyOn(db, 'connect').mockImplementationOnce(async () => {
      const client = await connect();
      const query = client.query.bind(client);
      client.query = (sql, ...params) => /SELECT 'moderated' AS source/.test(sql)
        ? Promise.reject(new Error('synthetic identity lookup outage')) : query(sql, ...params);
      const release = client.release.bind(client);
      client.release = (...args) => {
        client.query = query;
        client.release = release;
        release(...args);
      };
      return client;
    });
    try {
      expect((await submit('https://youtu.be/abcdef')).error).toMatchObject({ code: 'video_submit_failed', statusCode: 500 });
      expect((await db.query('SELECT * FROM learn_guide_video_submissions')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM learn_video_review_notice_jobs')).rows).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  test('open flags hide public playlists until every flag is dismissed', async () => {
    const id = await video();
    const otherFlagger = crypto.randomUUID();
    await db.query("INSERT INTO users(id,role) VALUES($1,'customer')", [otherFlagger]);
    const first = await flag(id);
    const second = (await db.query("INSERT INTO learn_guide_video_flags(video_id,user_id,reason) VALUES($1,$2,'broken') RETURNING id", [id, otherFlagger])).rows[0].id;
    // Execute the production playlist query against the isolated tables.
    const source = fs.readFileSync(path.join(__dirname, '../controllers/learnController.js'), 'utf8');
    const sql = source.slice(source.indexOf('const getGuideVideos =')).match(/`(SELECT v\.id[\s\S]+?)`/)[1]
      .replace(/\$\{viewerId \? 'BOOL_OR\(vt\.user_id = \$2\)' : 'FALSE'\}/, 'FALSE');
    const visible = async () => (await db.query(sql, [['guide']])).rows;
    expect(await visible()).toHaveLength(0);
    expect(await reviewVideoFlag(first, admin, 'dismiss', null, request)).toEqual({ ok: true });
    expect(await visible()).toHaveLength(0);
    expect(await reviewVideoFlag(second, admin, 'dismiss', null, request)).toEqual({ ok: true });
    expect(await visible()).toHaveLength(1);
  });

  test('flag deletion persists a tombstone despite cascades and blocks URL aliases', async () => {
    const id = await video();
    const fid = await flag(id);
    expect(await reviewVideoFlag(fid, admin, 'delete', null, request)).toEqual({ ok: true });
    expect((await db.query('SELECT * FROM learn_guide_video_flags')).rows).toHaveLength(0);
    expect((await submit('https://youtube.com/shorts/abcdef')).error).toMatchObject({ code: 'video_moderated' });
    expect((await db.query('SELECT * FROM learn_guide_video_moderation_blocks')).rows).toHaveLength(1);
    // The block is scoped to the guide, not a global publisher ban.
    expect((await submit('https://youtube.com/shorts/abcdef', 'target')).status).toBe(201);
  });

  test('migration replay backfills previously missed blocked aliases without duplicate tombstones', async () => {
    await db.query("INSERT INTO learn_guide_video_submissions(guide_id,video_url,status) VALUES('guide','https://youtube.com/watch?%76=abcdef','blocked')");
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/803_w11_learn_video_identity_parity.sql'), 'utf8');
    await db.query(migration);
    await db.query(migration);
    expect((await db.query('SELECT video_identity FROM learn_guide_video_moderation_blocks')).rows).toEqual([{ video_identity: 'youtube:abcdef' }]);
    expect((await submit('https://youtu.be/abcdef')).error?.code).toBe('video_moderated');
  });

  test('audit failure rolls back both deletion and the tombstone', async () => {
    const id = await video();
    const fid = await flag(id);
    logAdminAction.mockRejectedValueOnce(new Error('synthetic audit outage'));
    await expect(reviewVideoFlag(fid, admin, 'delete', null, request)).rejects.toThrow('synthetic audit outage');
    expect((await db.query('SELECT * FROM learn_guide_videos')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM learn_guide_video_moderation_blocks')).rows).toHaveLength(0);
    expect((await db.query('SELECT status FROM learn_guide_video_flags')).rows[0].status).toBe('open');
  });

  test('concurrent deletion and alias resubmission cannot revive the removed video', async () => {
    const id = await video();
    const fid = await flag(id);
    const [deleted, submitted] = await Promise.all([
      reviewVideoFlag(fid, admin, 'delete', null, request), submit('https://youtube.com/watch?v=abcdef'),
    ]);
    expect(deleted).toEqual({ ok: true });
    expect(['video_duplicate', 'video_moderated']).toContain(submitted.error?.code);
    expect((await submit('https://youtube.com/watch?v=abcdef')).error?.code).toBe('video_moderated');
    expect((await db.query("SELECT * FROM learn_guide_video_submissions WHERE status='pending'")).rows).toHaveLength(0);
  });

  test('concurrent approval and publisher cannot create two live aliases', async () => {
    const { body } = await submit('https://youtu.be/abcdef');
    const id = body.submission.id;
    await db.query("UPDATE learn_guide_video_submissions SET created_at=NOW()-INTERVAL '25 hours' WHERE id=$1", [id]);
    await Promise.all([reviewVideoSubmission(id, 'approve', admin, request), learn.publishDueGuideVideos()]);
    expect((await db.query('SELECT * FROM learn_guide_videos')).rows).toHaveLength(1);
    expect((await db.query('SELECT status FROM learn_guide_video_submissions')).rows[0].status).toBe('live');
  });

  test('new and overdue review notices survive failed delivery and retry idempotently', async () => {
    sendNotification.mockResolvedValueOnce({ success: false });
    const { body } = await submit('https://youtu.be/abcdef');
    const id = body.submission.id;
    expect((await db.query("SELECT attempts,delivered_at FROM learn_video_review_notice_jobs WHERE kind='submitted'")).rows[0])
      .toMatchObject({ attempts: 1, delivered_at: null });
    await db.query('UPDATE learn_video_review_notice_jobs SET next_attempt_at=NOW()');
    await db.query("UPDATE learn_guide_video_submissions SET created_at=NOW()-INTERVAL '25 hours' WHERE id=$1", [id]);
    expect(await processLearnVideoReviewAlerts()).toEqual({ notified: 2, deferred: 0 });
    expect(await processLearnVideoReviewAlerts()).toEqual({ notified: 0, deferred: 0 });
    expect(sendNotification.mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual([
      `learn-video:submitted:${id}:${admin}`, `learn-video:submitted:${id}:${admin}`, `learn-video:overdue:${id}:${admin}`,
    ]);
  });

  test('successful publication preserves the missed review window for the alert worker', async () => {
    const { body } = await submit('https://youtu.be/abcdef');
    await db.query("UPDATE learn_guide_video_submissions SET created_at=NOW()-INTERVAL '25 hours' WHERE id=$1", [body.submission.id]);
    expect(await learn.publishDueGuideVideos()).toMatchObject({ published: 1 });
    expect((await db.query("SELECT delivered_at FROM learn_video_review_notice_jobs WHERE kind='overdue'")).rows[0].delivered_at).toBeNull();
    expect(await processLearnVideoReviewAlerts()).toEqual({ notified: 1, deferred: 0 });
    expect(sendNotification).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'learn_video_review_overdue' }));
  });

  test('lost moderator grant defers the notice without delivering protected admin links', async () => {
    const { body } = await submit('https://youtu.be/abcdef');
    await db.query("UPDATE learn_video_review_notice_jobs SET delivered_at=NULL,next_attempt_at=NOW() WHERE submission_id=$1", [body.submission.id]);
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin]);
    sendNotification.mockClear();
    hasGlobalGrant.mockResolvedValue(false);
    expect(await processLearnVideoReviewAlerts()).toEqual({ notified: 0, deferred: 1 });
    expect(hasGlobalGrant).toHaveBeenCalledWith(admin, 'moderate_content');
    expect(sendNotification).not.toHaveBeenCalled();
    hasGlobalGrant.mockResolvedValue(true);
    await db.query('UPDATE learn_video_review_notice_jobs SET next_attempt_at=NOW()');
    expect(await processLearnVideoReviewAlerts()).toEqual({ notified: 1, deferred: 0 });
  });

  test.each([['is_active', false], ['is_banned', true], ['totp_enabled', false], ['role', 'customer']])(
    'notice delivery rechecks current reviewer eligibility: %s=%s', async (field, value) => {
      const { body } = await submit('https://youtu.be/abcdef');
      await db.query("UPDATE learn_video_review_notice_jobs SET delivered_at=NULL,next_attempt_at=NOW() WHERE submission_id=$1", [body.submission.id]);
      await db.query(`UPDATE users SET ${field}=$1 WHERE id=$2`, [value, admin]);
      sendNotification.mockClear();
      expect(await processLearnVideoReviewAlerts()).toEqual({ notified: 0, deferred: 0 });
      expect(sendNotification).not.toHaveBeenCalled();
    },
  );
});
