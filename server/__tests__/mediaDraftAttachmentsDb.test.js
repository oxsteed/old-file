'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { Pool } = jest.requireActual('pg');
const pool = require('../db');
const attachments = require('../services/mediaDraftAttachments');
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true' && !url) throw new Error('Disposable Media database required');
const describeDb = url ? describe : describe.skip;

describeDb('Media attachment transactions in PostgreSQL', () => {
  const schema = `media_draft_test_${randomUUID().replaceAll('-', '')}`;
  const user = randomUUID();
  const actor = randomUUID();
  let db;
  let setup;
  let post;
  beforeAll(async () => {
    if (!/\/credit_statement_test(?:\?|$)/.test(url)) throw new Error('Use only credit_statement_test');
    setup = new Pool({ connectionString: url });
    await setup.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 5 });
    await db.query(`CREATE TABLE users (id UUID PRIMARY KEY, is_verified boolean DEFAULT true,
      deleted_at timestamptz, is_active boolean DEFAULT true, is_banned boolean DEFAULT false)`);
    // Actual migration DDL and constraints, isolated from all shared fixtures.
    for (const number of [709, 732, 735, 736, 742]) {
      const dir = path.resolve(__dirname, '../migrations');
      const file = fs.readdirSync(dir).find((name) => name.startsWith(`${number}_`));
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    await db.query('INSERT INTO users (id) VALUES ($1)', [user]);
    await db.query(`INSERT INTO media_actors (id,actor_type,owner_user_id,handle,display_name)
      VALUES ($1,'helper',$2,'synthetic-helper','Synthetic helper')`, [actor, user]);
    pool.connect.mockImplementation(() => db.connect());
    pool.query.mockImplementation((...args) => db.query(...args));
  });
  beforeEach(async () => {
    post = randomUUID();
    await db.query(`INSERT INTO media_posts (id,actor_id,body,visibility,processing_status)
      VALUES ($1,$2,'Synthetic draft','unlisted','draft')`, [post, actor]);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (setup) { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await setup.end(); }
  });
  const image = () => ({ postId: post, userId: user, asset: { asset_type: 'image', provider: 'upload',
    storage_key: 'private/synthetic.jpg', content_sha256: 'a'.repeat(64) } });

  test('simultaneous lost-response retries commit one attachment', async () => {
    const results = await Promise.all([attachments.attach(image()), attachments.attach(image())]);
    expect(results.map((r) => r.asset.id)[0]).toBe(results[1].asset.id);
    expect(results.filter((r) => r.existing)).toHaveLength(1);
    expect((await db.query('SELECT * FROM media_post_assets WHERE post_id=$1', [post])).rows).toHaveLength(1);
  });

  test('failed video replacement removes jobs and restores publishable state', async () => {
    const video = await attachments.attach({ ...image(), asset: { ...image().asset, asset_type: 'video',
      processing_status: 'quarantine', csam_status: 'pending', content_sha256: 'b'.repeat(64) } });
    await db.query("UPDATE media_post_assets SET processing_status='failed',csam_status='cloudflare_deferred' WHERE id=$1", [video.asset.id]);
    await attachments.refreshPostState(db, post);
    const result = await attachments.attach({ ...image(), replace: true });
    expect(result.removedKeys).toEqual(['private/synthetic.jpg']);
    expect((await db.query('SELECT * FROM media_processing_jobs WHERE post_id=$1', [post])).rows).toHaveLength(0);
    expect((await db.query('SELECT processing_status,csam_status,visibility FROM media_posts WHERE id=$1', [post])).rows[0])
      .toEqual({ processing_status: 'ready', csam_status: 'passed', visibility: 'unlisted' });
  });

  test('publication wins its lock and prevents a late attachment from mutating a public post', async () => {
    const publishing = await db.connect();
    try {
      await publishing.query('BEGIN');
      await publishing.query('SELECT id FROM media_posts WHERE id=$1 FOR UPDATE', [post]);
      const late = attachments.attach(image());
      // Attach waits on the real PostgreSQL lock and observes committed state.
      await publishing.query("UPDATE media_posts SET visibility='public' WHERE id=$1", [post]);
      await publishing.query('COMMIT');
      await expect(late).rejects.toMatchObject({ code: 'media_draft_required' });
      expect((await db.query('SELECT * FROM media_post_assets WHERE post_id=$1', [post])).rows).toHaveLength(0);
    } finally { await publishing.query('ROLLBACK'); publishing.release(); }
  });

  test('flagged assets remain sticky even when post summary is stale', async () => {
    const old = await attachments.attach(image());
    await db.query("UPDATE media_post_assets SET csam_status='flagged' WHERE id=$1", [old.asset.id]);
    await expect(attachments.attach({ ...image(), replace: true })).rejects.toMatchObject({ code: 'media_draft_blocked' });
    expect((await db.query('SELECT csam_status FROM media_post_assets WHERE post_id=$1', [post])).rows[0].csam_status).toBe('flagged');
  });

  test('migration replay preserves the durable upload identity', async () => {
    const stored = await attachments.attach(image());
    const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/742_oxsteed_media_attachment_retries.sql'), 'utf8');
    await db.query(migration); await db.query(migration);
    const replay = await attachments.attach(image());
    expect(replay.asset.id).toBe(stored.asset.id);
    expect(replay.existing).toBe(true);
  });
});
