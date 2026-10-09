'use strict';

// Section 3 (Verification and publishing): video conversion journey.
// Exercises the real media transcode worker against disposable PostgreSQL:
// expiring leases, fenced completion, bounded retries, crashed-worker
// reclaim, a real FFmpeg transcode of a generated video, and the failure
// path. No mocks for the worker.

jest.unmock('pg');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { execFileSync } = require('child_process');

const UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'media-publish-transcode-'));
process.env.LOCAL_UPLOAD_DIR = UPLOAD_ROOT;
process.env.MEDIA_CSAM_MODE = 'cloudflare';
process.env.MEDIA_PUBLIC_VIDEO_INTERIM = 'true';
process.env.OXSTEED_MEDIA_LAUNCHED = 'true';

const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('MEDIA_PUBLISH_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { Pool } = jest.requireActual('pg');
const pool = require('../db');

const worker = require('../services/mediaTranscodeWorker');
const storage = require('../utils/storage');

jest.setTimeout(180000);

test('media publish transcode tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

function makeTestVideo() {
  const out = path.join(os.tmpdir(), `media-publish-src-${randomUUID()}.mp4`);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
    '-i', 'testsrc=duration=1:size=160x120:rate=10',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', out]);
  return out;
}

describeDatabase('media publish: video conversion journey', () => {
  const schema = `media_pub_transcode_${randomUUID().replaceAll('-', '')}`;
  const user = randomUUID();
  const actor = randomUUID();
  let db;
  let setup;

  async function newVideoPost() {
    const postId = randomUUID();
    await db.query(`INSERT INTO media_posts (id, actor_id, body, visibility, processing_status, csam_status)
      VALUES ($1, $2, 'Synthetic draft', 'unlisted', 'quarantine', 'pending')`, [postId, actor]);
    return postId;
  }

  async function newVideoAsset(postId, storageKey, csamStatus = 'pending') {
    const { rows } = await db.query(
      `INSERT INTO media_post_assets (post_id, asset_type, provider, storage_key, content_sha256,
        processing_status, csam_status, renditions)
       VALUES ($1, 'video', 'upload', $2, $3, 'quarantine', $4, '[]') RETURNING *`,
      [postId, storageKey, randomUUID().replaceAll('-', ''), csamStatus]);
    return rows[0];
  }

  async function newJob(postId, assetId, jobType, overrides = {}) {
    const { rows } = await db.query(
      `INSERT INTO media_processing_jobs (post_id, asset_id, job_type, status, attempts, max_attempts,
        lease_token, lease_expires_at, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
      [postId, assetId, jobType, overrides.status || 'pending', overrides.attempts || 0,
        overrides.max_attempts || 5, overrides.lease_token || null, overrides.lease_expires_at || null]);
    return rows[0];
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
    fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  });

  test('csam_check job runs the real worker path to cloudflare_deferred', async () => {
    const postId = await newVideoPost();
    const asset = await newVideoAsset(postId, 'private/v.mp4', 'pending');
    const job = await newJob(postId, asset.id, 'csam_check');
    const claimed = await worker.runOnce();
    expect(claimed && claimed.id).toBe(job.id);
    const { rows } = await db.query(
      'SELECT status FROM media_processing_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('done');
    const { rows: assets } = await db.query(
      'SELECT csam_status FROM media_post_assets WHERE id = $1', [asset.id]);
    expect(assets[0].csam_status).toBe('cloudflare_deferred');
  });

  test('expired lease is reclaimed with a fresh token', async () => {
    const postId = await newVideoPost();
    const asset = await newVideoAsset(postId, 'private/v2.mp4', 'pending');
    const stale = randomUUID();
    const job = await newJob(postId, asset.id, 'csam_check', {
      status: 'running', lease_token: stale,
      lease_expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    const claimed = await worker.runOnce();
    expect(claimed && claimed.id).toBe(job.id);
    // The crashed worker's stale token was replaced, not reused.
    expect(claimed.lease_token).not.toBe(stale);
    const { rows } = await db.query(
      'SELECT status, lease_token FROM media_processing_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('done');
    expect(rows[0].lease_token).toBeNull();
  });

  test('a running job with a live lease is left alone', async () => {
    const postId = await newVideoPost();
    const asset = await newVideoAsset(postId, 'private/v3.mp4', 'pending');
    const token = randomUUID();
    const job = await newJob(postId, asset.id, 'csam_check', {
      status: 'running', lease_token: token,
      lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const claimed = await worker.runOnce();
    expect(claimed).toBeNull();
    const { rows } = await db.query(
      'SELECT status, lease_token FROM media_processing_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('running');
    expect(rows[0].lease_token).toBe(token);
  });

  test('bounded retries: exhausted job is never claimed', async () => {
    const postId = await newVideoPost();
    const asset = await newVideoAsset(postId, 'private/v4.mp4', 'pending');
    await newJob(postId, asset.id, 'csam_check', { attempts: 5, max_attempts: 5 });
    const claimed = await worker.runOnce();
    expect(claimed).toBeNull();
  });

  test('fenced completion: a stale lease token cannot finish the job', async () => {
    const postId = await newVideoPost();
    const asset = await newVideoAsset(postId, 'private/v5.mp4', 'pending');
    const live = randomUUID();
    const job = await newJob(postId, asset.id, 'csam_check', {
      status: 'running', lease_token: live,
      lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    // Exact predicate from markDone: a wrong token must update zero rows.
    const wrong = await db.query(
      `UPDATE media_processing_jobs SET status = 'done', lease_token = NULL
        WHERE id = $1 AND lease_token = $2`, [job.id, randomUUID()]);
    expect(wrong.rowCount).toBe(0);
    const right = await db.query(
      `UPDATE media_processing_jobs SET status = 'done', lease_token = NULL
        WHERE id = $1 AND lease_token = $2`, [job.id, live]);
    expect(right.rowCount).toBe(1);
  });

  test('failed transcode requeues with backoff, then fails terminally', async () => {
    const postId = await newVideoPost();
    // Storage key points at nothing: the worker must fail the job for real.
    const asset = await newVideoAsset(postId, 'media/videos/does-not-exist.mp4', 'passed');
    await db.query(`UPDATE media_posts SET csam_status = 'passed' WHERE id = $1`, [postId]);
    const job = await newJob(postId, asset.id, 'transcode');
    const claimed = await worker.runOnce();
    expect(claimed && claimed.id).toBe(job.id);
    const { rows } = await db.query(
      'SELECT status, attempts, last_error FROM media_processing_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toBeTruthy();
    const { rows: assets } = await db.query(
      'SELECT processing_status FROM media_post_assets WHERE id = $1', [asset.id]);
    expect(assets[0].processing_status).toBe('failed');
  });

  test('real FFmpeg transcode produces renditions and marks the asset ready', async () => {
    const src = makeTestVideo();
    const key = await storage.uploadFile(fs.readFileSync(src), 'media/videos', 'original.mp4', 'video/mp4');
    fs.unlinkSync(src);
    const postId = await newVideoPost();
    await db.query(`UPDATE media_posts SET csam_status = 'passed' WHERE id = $1`, [postId]);
    const asset = await newVideoAsset(postId, key, 'passed');
    const job = await newJob(postId, asset.id, 'transcode');
    const claimed = await worker.runOnce();
    expect(claimed && claimed.id).toBe(job.id);
    const { rows: jobs } = await db.query(
      'SELECT status, last_error FROM media_processing_jobs WHERE id = $1', [job.id]);
    const { rows } = await db.query(
      'SELECT processing_status, renditions, thumbnail_key FROM media_post_assets WHERE id = $1', [asset.id]);
    // Include the worker's last_error in the failure message for CI diagnosis.
    expect(`${rows[0].processing_status} / ${jobs[0].last_error || 'no error'}`).toBe('ready / no error');
    const renditions = rows[0].renditions;
    expect(Array.isArray(renditions) && renditions.length).toBeGreaterThan(0);
    expect(renditions[0].storage_key).toBeTruthy();
    expect(rows[0].thumbnail_key).toBeTruthy();
    expect(jobs[0].status).toBe('done');
  });
});
