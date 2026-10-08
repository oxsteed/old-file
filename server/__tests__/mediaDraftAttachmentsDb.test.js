'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { Pool } = jest.requireActual('pg');
const pool = require('../db');
const attachments = require('../services/mediaDraftAttachments');
const { verifiedActorSql } = require('../services/mediaPublisherPolicy');
const media = require('../controllers/mediaController');
const admin = require('../controllers/mediaAdminController');
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
      city text DEFAULT 'Springfield', state text DEFAULT 'OH',
      deleted_at timestamptz, is_active boolean DEFAULT true, is_banned boolean DEFAULT false)`);
    await db.query(`CREATE TABLE helper_profiles (id serial PRIMARY KEY,user_id UUID,profile_slug text,service_lat numeric,service_lng numeric,service_city text,service_state text);
      CREATE TABLE businesses (id bigint PRIMARY KEY, user_id UUID, profile_slug text,
        business_name text DEFAULT 'Synthetic business', service_lat numeric,service_lng numeric,service_city text,service_state text,address_city text,address_state text,
        deleted_at timestamptz, is_active boolean DEFAULT true, is_business_verified boolean DEFAULT false);
      CREATE TABLE food_restaurants (id bigint PRIMARY KEY, business_id bigint, owner_user_id UUID, slug text,
        latitude double precision,longitude double precision,address_city text,address_state text,
        status text DEFAULT 'active', is_verified boolean DEFAULT false)`);
    // Actual migration DDL and constraints, isolated from all shared fixtures.
    for (const number of [709, 731, 732, 735, 736, 742]) {
      const dir = path.resolve(__dirname, '../migrations');
      const file = fs.readdirSync(dir).find((name) => name.startsWith(`${number}_`));
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    await db.query('INSERT INTO users (id) VALUES ($1)', [user]);
    await db.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user]);
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

  test.each(['business', 'restaurant'])('another verified %s cannot authorize this unverified represented entity', async type => {
    const representedActor = randomUUID();
    const unverifiedId = type === 'business' ? 101 : 201;
    if (type === 'business') {
      await db.query(`INSERT INTO businesses (id,user_id,profile_slug,is_business_verified)
        VALUES (101,$1,'unverified-business',false),(102,$1,'verified-business',true)`, [user]);
    } else {
      await db.query(`INSERT INTO food_restaurants (id,business_id,owner_user_id,slug,is_verified)
        VALUES (201,101,$1,'unverified-restaurant',false),(202,102,$1,'verified-restaurant',true)`, [user]);
    }
    await db.query(`INSERT INTO media_actors (id,actor_type,owner_user_id,handle,display_name,business_id,restaurant_id)
      VALUES ($1,$2,$3,$4,'Unverified represented entity',$5,$6)`,
    [representedActor, type, user, `unverified-${type}`, type === 'business' ? unverifiedId : 101,
      type === 'restaurant' ? unverifiedId : null]);
    await db.query('UPDATE media_posts SET actor_id=$2,processing_status=\'ready\' WHERE id=$1', [post, representedActor]);
    const status = await db.query(`SELECT (${verifiedActorSql('a')}) AS verified FROM media_actors a WHERE id=$1`, [representedActor]);
    expect(status.rows[0].verified).toBe(false);
    const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
    const publication = res();
    await media.publishPost({ params: { id: post }, user: { id: user } }, publication);
    expect(publication.status).toHaveBeenCalledWith(403);
    const approval = res();
    await admin.approvePost({ params: { id: post }, user: { id: user }, body: { reason: 'Synthetic review' } }, approval);
    expect(approval.status).toHaveBeenCalledWith(409);
    const table = type === 'business' ? 'businesses' : 'food_restaurants';
    const flag = type === 'business' ? 'is_business_verified' : 'is_verified';
    await db.query(`UPDATE ${table} SET ${flag}=true WHERE id=$1`, [unverifiedId]);
    const verified = await db.query(`SELECT (${verifiedActorSql('a')}) AS verified FROM media_actors a WHERE id=$1`, [representedActor]);
    expect(verified.rows[0].verified).toBe(true);
  });

  test('legacy migration binds only the entity named by its handle and safely repeats', async () => {
    const legacy = randomUUID();
    await db.query(`INSERT INTO media_actors (id,actor_type,owner_user_id,handle,display_name)
      VALUES ($1,'business',$2,'business-102','Legacy business')`, [legacy, user]);
    const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/743_oxsteed_media_actor_entities.sql'), 'utf8');
    await db.query(migration); await db.query(migration);
    expect((await db.query('SELECT business_id FROM media_actors WHERE id=$1', [legacy])).rows[0].business_id).toBe('102');
  });

  test('real ranked pagination preserves link ordering and microsecond timestamp precision', async () => {
    await db.query("UPDATE media_posts SET visibility='unlisted'");
    const ids = Array.from({ length: 8 }, () => randomUUID());
    for (let index = 0; index < ids.length; index += 1) {
      await db.query(`INSERT INTO media_posts (id,actor_id,body,visibility,created_at)
        VALUES ($1,$2,'Synthetic ranked post','public',TIMESTAMPTZ '2026-10-08 12:00:00.123000+00' + $3 * INTERVAL '1 microsecond')`,
      [ids[index], actor, index]);
    }
    // The oldest linked post must outrank all newer unlinked posts.
    await db.query(`INSERT INTO media_post_links (post_id,link_type,target_id,name_snapshot)
      VALUES ($1,'business','102','Synthetic business')`, [ids[0]]);
    const seen = [];
    let before;
    for (let page = 0; page < 6; page += 1) {
      const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await media.getFeed({ query: { limit: '2', tab: 'mine', before }, user: { id: user } }, response);
      expect(response.status).not.toHaveBeenCalled();
      const payload = response.json.mock.calls[0][0];
      seen.push(...payload.posts.map(item => item.id));
      if (!payload.has_more) break;
      before = payload.next_before;
    }
    expect(seen[0]).toBe(ids[0]);
    expect(seen).toHaveLength(ids.length);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  test('real locality ranks entity coordinates, city/state fallback and valid links without losing pages', async () => {
    await db.query("UPDATE media_posts SET visibility='unlisted'");
    await db.query(`UPDATE helper_profiles SET service_city='Boston',service_state='MA',service_lat=NULL,service_lng=NULL WHERE user_id=$1`, [user]);
    await db.query(`UPDATE businesses SET service_lat=39.924,service_lng=-83.811,service_city='Springfield',service_state='OH' WHERE id=102`);
    await db.query(`UPDATE food_restaurants SET latitude=42.360,longitude=-71.059,address_city='Boston',address_state='MA' WHERE id=202`);
    const ids = Array.from({ length: 4 }, () => randomUUID());
    for (let index = 0; index < ids.length; index += 1) {
      await db.query(`INSERT INTO media_posts(id,actor_id,body,visibility,created_at)
        VALUES($1,$2,'Synthetic nearby discovery','public',TIMESTAMPTZ '2026-10-08 12:00:00+00'+$3*INTERVAL '1 microsecond')`, [ids[index], actor, index]);
    }
    await db.query(`INSERT INTO media_post_links(post_id,link_type,target_id,name_snapshot)
      VALUES($1,'business','102','Nearby business'),($2,'restaurant','202','Far restaurant'),
        ($2,'business','missing','Removed business'),($3,'business','missing','Removed business')`, [ids[0], ids[1], ids[2]]);
    const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
    const query = { latitude: '39.924', longitude: '-83.811', location_mode: 'custom', limit: '1' };
    const seen = []; let before;
    for (let page = 0; page < 5; page += 1) {
      const res = response(); await media.getFeed({ query: { ...query, before } }, res);
      expect(res.status).not.toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0]; seen.push(...payload.posts.map(item => item.id));
      if (!page) {
        expect(payload.posts[0]).toMatchObject({ id: ids[0], locality_boost: 3, link_count: '1' });
        // A cursor cannot be reused after switching location.
        const changed = response();
        await media.getFeed({ query: { ...query, latitude: '42.360', before: payload.next_before } }, changed);
        expect(changed.status).toHaveBeenCalledWith(400);
      }
      if (!payload.has_more) break;
      before = payload.next_before;
    }
    expect(new Set(seen)).toEqual(new Set(ids)); expect(seen).toHaveLength(4);
    await db.query('UPDATE businesses SET service_lat=NULL,service_lng=NULL WHERE id=102');
    const cityRes = response();
    await media.getFeed({ query: { city: 'Springfield', state: 'OH', limit: '10' } }, cityRes);
    expect(cityRes.status).not.toHaveBeenCalled();
    expect(cityRes.json.mock.calls[0][0].posts[0]).toMatchObject({ id: ids[0], locality_boost: 2 });
    await db.query('UPDATE businesses SET is_active=false WHERE id=102');
    const removed = response(); await media.getFeed({ query: { city: 'Springfield', state: 'OH' } }, removed);
    expect(removed.status).not.toHaveBeenCalled();
    expect(removed.json.mock.calls[0][0].posts.find(item => item.id === ids[0]))
      .toMatchObject({ locality_boost: 0, link_count: '0', links: [expect.objectContaining({ available: false })] });
  });
});
