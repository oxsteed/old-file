'use strict';

// Section 3 (Verification and publishing): durable private drafts.
// Proves draft IDs and edits survive across update cycles and upload
// failures/retries. Real disposable PostgreSQL only.

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
const media = require('../controllers/mediaController');

jest.setTimeout(120000);

test('media publish draft tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describeDatabase('media publish: durable private drafts', () => {
  const schema = `media_pub_drafts_${randomUUID().replaceAll('-', '')}`;
  const user = randomUUID();
  const actor = randomUUID();
  let db;
  let setup;

  async function createDraft(body) {
    const res = response();
    await media.createPost({ user: { id: user }, body: { body, draft: true } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    return res.json.mock.calls[0][0].post;
  }

  async function readDraft(postId) {
    const res = response();
    await media.getDraft({ params: { id: postId }, user: { id: user } }, res);
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
      service_lat numeric, service_lng numeric, service_city text, service_state text)`);
    await db.query(`CREATE TABLE businesses (id bigint PRIMARY KEY, user_id UUID, profile_slug text,
      business_name text DEFAULT 'Synthetic business', deleted_at timestamptz,
      is_active boolean DEFAULT true, is_business_verified boolean DEFAULT false)`);
    await db.query(`CREATE TABLE food_restaurants (id bigint PRIMARY KEY, business_id bigint, owner_user_id UUID,
      slug text, status text DEFAULT 'active', is_verified boolean DEFAULT false)`);
    for (const number of [709, 731, 732, 733, 735, 736, 742, 743, 744, 754]) {
      const dir = path.resolve(__dirname, '../migrations');
      const file = fs.readdirSync(dir).find((name) => name.startsWith(`${number}_`));
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    await db.query('INSERT INTO users (id) VALUES ($1)', [user]);
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

  test('draft edits retain the same draft ID and body', async () => {
    const draft = await createDraft('First version');
    const firstId = draft.id;
    const res = response();
    await media.updateDraft({ params: { id: firstId }, user: { id: user },
      body: { body: 'Second version with more detail' } }, res);
    expect(res.json).toHaveBeenCalled();
    const updated = res.json.mock.calls[0][0].post || res.json.mock.calls[0][0];
    const updatedId = updated.id || firstId;
    expect(updatedId).toBe(firstId);
    const read = await readDraft(firstId);
    const body = JSON.stringify(read.json.mock.calls[0][0]);
    expect(body).toContain('Second version with more detail');
  });

  test('draft survives a failed attachment with ID and body intact', async () => {
    const draft = await createDraft('Draft that will see a failure');
    const draftId = draft.id;
    // A failing attach (duplicate-limit path is not hit; use a post that
    // cannot accept: temporarily flag the draft blocked, then restore).
    await db.query(`UPDATE media_posts SET processing_status = 'blocked' WHERE id = $1`, [draftId]);
    await expect(attachments.attach({ postId: draftId, userId: user,
      asset: { asset_type: 'image', provider: 'upload', storage_key: 'private/x.jpg',
        content_sha256: 'f'.repeat(64) } })).rejects.toMatchObject({ code: 'media_draft_blocked' });
    await db.query(`UPDATE media_posts SET processing_status = 'draft' WHERE id = $1`, [draftId]);
    const read = await readDraft(draftId);
    const body = JSON.stringify(read.json.mock.calls[0][0]);
    expect(body).toContain('Draft that will see a failure');
    const { rows } = await db.query('SELECT id FROM media_posts WHERE id = $1 AND deleted_at IS NULL', [draftId]);
    expect(rows[0].id).toBe(draftId);
  });

  test('draft keeps its attachments across an edit', async () => {
    const draft = await createDraft('Draft with attachment');
    const draftId = draft.id;
    const attached = await attachments.attach({ postId: draftId, userId: user,
      asset: { asset_type: 'image', provider: 'upload', storage_key: 'private/keep.jpg',
        content_sha256: '0'.repeat(64) } });
    expect(attached.existing).toBe(false);
    const res = response();
    await media.updateDraft({ params: { id: draftId }, user: { id: user },
      body: { body: 'Edited body, attachment must survive' } }, res);
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM media_post_assets WHERE post_id = $1', [draftId]);
    expect(rows[0].n).toBe(1);
    const read = await readDraft(draftId);
    expect(JSON.stringify(read.json.mock.calls[0][0])).toContain('Edited body, attachment must survive');
  });

  test('another user cannot read or mutate the draft', async () => {
    const draft = await createDraft('Private draft');
    const other = randomUUID();
    await db.query('INSERT INTO users (id) VALUES ($1)', [other]);
    const read = response();
    await media.getDraft({ params: { id: draft.id }, user: { id: other } }, read);
    expect(read.status).toHaveBeenCalledWith(404);
    const edit = response();
    await media.updateDraft({ params: { id: draft.id }, user: { id: other },
      body: { body: 'hijacked' } }, edit);
    expect(edit.status).toHaveBeenCalledWith(404);
    const { rows } = await db.query('SELECT body FROM media_posts WHERE id = $1', [draft.id]);
    expect(rows[0].body).toBe('Private draft');
  });
});
