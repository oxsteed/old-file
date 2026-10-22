'use strict';

// Section 3 (Verification and publishing): safety predicates.
// Proves that quarantine/malware verdicts block publication, that verdicts
// are sticky, that quarantined assets are not servable on public posts, and
// that admin approval cannot bypass identity, malware, CSAM, processing, or
// publication gates. Real disposable PostgreSQL only; no mocks for the
// safety predicates.

jest.unmock('pg');

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.MEDIA_CSAM_MODE = 'cloudflare';

const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('MEDIA_PUBLISH_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { Pool } = jest.requireActual('pg');
const pool = require('../db');

const attachments = require('../services/mediaDraftAttachments');
const mediaSafety = require('../services/mediaSafetyPolicy');
const media = require('../controllers/mediaController');
const admin = require('../controllers/mediaAdminController');

jest.setTimeout(120000);

test('media publish safety tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describeDatabase('media publish: safety predicates', () => {
  const schema = `media_pub_safety_${randomUUID().replaceAll('-', '')}`;
  const user = randomUUID();
  const actor = randomUUID();
  const adminId = randomUUID();
  let db;
  let setup;

  async function newDraft() {
    const id = randomUUID();
    await db.query(`INSERT INTO media_posts (id, actor_id, body, visibility, processing_status)
      VALUES ($1, $2, 'Synthetic draft', 'unlisted', 'draft')`, [id, actor]);
    return id;
  }

  async function addImage(postId, overrides = {}) {
    const { rows } = await db.query(
      `INSERT INTO media_post_assets (post_id, asset_type, provider, storage_key, content_sha256,
        processing_status, csam_status)
       VALUES ($1, 'image', 'upload', $2, $3, $4, $5) RETURNING *`,
      [postId, overrides.storage_key || `private/${randomUUID()}.jpg`, overrides.sha || randomUUID().replaceAll('-', ''),
        overrides.processing_status || 'ready', overrides.csam_status || 'passed']);
    return rows[0];
  }

  async function publishAs(postId, userId) {
    const res = response();
    await media.publishPost({ params: { id: postId }, user: { id: userId } }, res);
    return res;
  }

  async function approveAs(postId) {
    const res = response();
    await admin.approvePost({ params: { id: postId }, user: { id: adminId }, body: { reason: 'synthetic review' } }, res);
    return res;
  }

  beforeAll(async () => {
    if (!/\/credit_statement_test(?:\?|$)/.test(database)) throw new Error('Use only credit_statement_test');
    setup = new Pool({ connectionString: database });
    await setup.query('CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public');
    await setup.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: database, options: `-c search_path=${schema},public`, max: 5 });
    await db.query(`CREATE TABLE users (id UUID PRIMARY KEY, is_verified boolean DEFAULT true,
      city text DEFAULT 'Springfield', state text DEFAULT 'OH',
      deleted_at timestamptz, is_active boolean DEFAULT true, is_banned boolean DEFAULT false)`);
    await db.query(`CREATE TABLE user_blocks (id SERIAL PRIMARY KEY,
      blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_blocks UNIQUE (blocker_id, blocked_id),
      CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id))`);
    await db.query(`CREATE TABLE helper_profiles (id serial PRIMARY KEY, user_id UUID, profile_slug text,
      service_lat numeric, service_lng numeric, service_city text, service_state text,
      is_listed boolean DEFAULT true, is_hidden_by_admin boolean DEFAULT false)`);
    await db.query(`CREATE TABLE businesses (id bigint PRIMARY KEY, user_id UUID, profile_slug text,
      business_name text DEFAULT 'Synthetic business', deleted_at timestamptz,
      is_active boolean DEFAULT true, is_business_verified boolean DEFAULT false,
      is_listed boolean DEFAULT true, is_hidden_by_admin boolean DEFAULT false)`);
    await db.query(`CREATE TABLE food_restaurants (id bigint PRIMARY KEY, business_id bigint, owner_user_id UUID,
      slug text, status text DEFAULT 'active', is_verified boolean DEFAULT false,
      discovery_status text DEFAULT 'visible', is_hidden_by_admin boolean DEFAULT false)`);
    await db.query(`CREATE TABLE admin_audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID, action VARCHAR(80) NOT NULL, target_type VARCHAR(40), target_id TEXT,
      target_key TEXT, description TEXT, ip_address INET, user_agent TEXT,
      before_state JSONB, after_state JSONB, created_at TIMESTAMPTZ DEFAULT now())`);
    // Backfill any production columns the hand-built tables lack, so the
    // test schema stays in sync with migrations automatically.
    const { backfillAllTables } = require('./mediaTestSchema');
    await backfillAllTables(db, [
      'users', 'user_blocks', 'helper_profiles', 'businesses', 'food_restaurants',
      'admin_audit_log',
    ], schema);
    for (const number of [709, 731, 732, 733, 735, 736, 742, 743, 744, 754, 757, 758]) {
      const dir = path.resolve(__dirname, '../migrations');
      const file = fs.readdirSync(dir).find((name) => name.startsWith(`${number}_`));
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    await db.query('INSERT INTO users (id) VALUES ($1), ($2)', [user, adminId]);
    await db.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user]);
    await db.query(`INSERT INTO media_actors (id, actor_type, owner_user_id, handle, display_name)
      VALUES ($1, 'helper', $2, 'synthetic-helper', 'Synthetic helper')`, [actor, user]);
    pool.connect.mockImplementation(() => db.connect());
    pool.query.mockImplementation((...args) => db.query(...args));
  });

  afterAll(async () => {
    if (db) await db.end();
    if (setup) { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await setup.end(); }
  });

  test('quarantined asset blocks publication', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'quarantine', csam_status: 'pending' });
    await attachments.refreshPostState(db, postId);
    const res = await publishAs(postId, user);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('media_safety_pending');
    const { rows } = await db.query('SELECT visibility FROM media_posts WHERE id = $1', [postId]);
    expect(rows[0].visibility).toBe('unlisted');
  });

  test('flagged CSAM asset blocks publication and is sticky on the post', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'blocked', csam_status: 'flagged' });
    await attachments.refreshPostState(db, postId);
    const { rows } = await db.query('SELECT csam_status, processing_status FROM media_posts WHERE id = $1', [postId]);
    expect(rows[0].csam_status).toBe('flagged');
    expect(rows[0].processing_status).toBe('blocked');
    const res = await publishAs(postId, user);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('unsafe verdict cannot be cleared by re-running the post state refresh', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'blocked', csam_status: 'flagged' });
    await attachments.refreshPostState(db, postId);
    // A second refresh must not wash the flagged verdict back to passed.
    await attachments.refreshPostState(db, postId);
    const { rows } = await db.query('SELECT csam_status FROM media_posts WHERE id = $1', [postId]);
    expect(rows[0].csam_status).toBe('flagged');
  });

  test('admin approval cannot bypass an unverified publisher', async () => {
    const postId = await newDraft();
    await addImage(postId);
    await attachments.refreshPostState(db, postId);
    await db.query('UPDATE users SET is_verified = FALSE WHERE id = $1', [user]);
    try {
      const res = await approveAs(postId);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('media_not_verified_poster');
    } finally {
      await db.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [user]);
    }
  });

  test('admin approval cannot bypass unfinished processing', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'quarantine', csam_status: 'pending' });
    await attachments.refreshPostState(db, postId);
    const res = await approveAs(postId);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('media_safety_pending');
  });

  test('admin approval cannot bypass a flagged CSAM verdict', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'blocked', csam_status: 'flagged' });
    await attachments.refreshPostState(db, postId);
    const res = await approveAs(postId);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('media_safety_pending');
  });

  test('admin approval cannot bypass an unready asset', async () => {
    const postId = await newDraft();
    // Asset looks ready at the post level but has no real processing completion.
    await addImage(postId, { processing_status: 'ready', csam_status: 'pending' });
    await db.query(`UPDATE media_posts SET processing_status = 'ready', csam_status = 'passed',
      visibility = 'unlisted' WHERE id = $1`, [postId]);
    const res = await approveAs(postId);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('media_safety_pending');
  });

  test('admin approval cannot bypass video identity: video post, unverified user', async () => {
    const postId = await newDraft();
    const { rows } = await db.query(
      `INSERT INTO media_post_assets (post_id, asset_type, provider, storage_key, content_sha256,
        processing_status, csam_status, renditions)
       VALUES ($1, 'video', 'upload', 'private/v.mp4', $2, 'ready', 'passed', '[]') RETURNING id`,
      [postId, randomUUID().replaceAll('-', '')]);
    expect(rows[0].id).toBeTruthy();
    await db.query(`UPDATE media_posts SET processing_status = 'ready', csam_status = 'passed' WHERE id = $1`, [postId]);
    await db.query('UPDATE users SET is_verified = FALSE WHERE id = $1', [user]);
    try {
      const res = await approveAs(postId);
      expect(res.status).toHaveBeenCalledWith(409);
    } finally {
      await db.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [user]);
    }
  });

  test('admin approval succeeds when every gate passes (positive control)', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'ready', csam_status: 'passed' });
    await attachments.refreshPostState(db, postId);
    const res = await approveAs(postId);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, approved: true }));
    const { rows } = await db.query(
      'SELECT visibility, admin_override_by FROM media_posts WHERE id = $1', [postId]);
    expect(rows[0].visibility).toBe('public');
    expect(rows[0].admin_override_by).toBe(adminId);
  });

  test('quarantined assets are not servable: public post with an unready asset is invisible', async () => {
    const postId = await newDraft();
    await addImage(postId, { processing_status: 'quarantine', csam_status: 'pending' });
    // Force the post public via SQL to simulate the read path against an
    // inconsistent row: the public query must still refuse to serve it.
    await db.query(`UPDATE media_posts SET visibility = 'public' WHERE id = $1`, [postId]);
    const res = response();
    await media.getPost({ params: { id: postId }, user: { id: user } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
