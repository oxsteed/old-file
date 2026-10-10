'use strict';

// Exercise the real visibility SQL against CI's disposable database.
// Uses an isolated schema with real UUID types and actual media migrations,
// following the pattern from mediaDraftAttachmentsDb.test.js.
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const { Pool } = jest.requireActual('pg');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const media = require('../controllers/mediaController');
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true' && !url) {
  throw new Error('Media SQL verification requires the disposable test database in CI');
}
const describeDb = url ? describe : describe.skip;

describeDb('Media block boundaries in PostgreSQL', () => {
  const schema = `media_vis_${randomUUID().replaceAll('-', '')}`;
  // UUID fixtures for the five test users
  const viewer = randomUUID();
  const outbound = randomUUID();
  const inbound = randomUUID();
  const allowed = randomUUID();
  const banned = randomUUID();
  const userIds = { viewer, outbound, inbound, allowed, banned };
  // Actor IDs match user IDs (one actor per user, except viewer)
  // Helper profile IDs
  const helperIds = {};
  let db;
  let setup;

  beforeAll(async () => {
    if (!/\/credit_statement_test(?:\?|$)/.test(url)) throw new Error('Use only the disposable credit_statement_test database');
    setup = new Pool({ connectionString: url });
    await setup.query('CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public');
    await setup.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 5 });

    // Entity tables with real production types (UUID, bigint).
    // These are hand-built because they're not media tables; the backfill
    // below keeps them in sync with production migrations.
    await db.query(`CREATE TABLE users (id UUID PRIMARY KEY, city text, state text,
      deleted_at timestamptz, is_active boolean DEFAULT true, is_banned boolean DEFAULT false,
      is_verified boolean DEFAULT true)`);
    await db.query(`CREATE TABLE helper_profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID, profile_slug text, service_lat numeric, service_lng numeric,
      service_city text, service_state text, is_listed boolean DEFAULT true,
      is_hidden_by_admin boolean DEFAULT false)`);
    await db.query(`CREATE TABLE businesses (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id UUID, deleted_at timestamptz, is_active boolean DEFAULT true,
      is_business_verified boolean DEFAULT true, service_lat numeric, service_lng numeric,
      service_city text, service_state text, address_city text, address_state text,
      business_name text, profile_slug text, is_listed boolean DEFAULT true,
      is_hidden_by_admin boolean DEFAULT false)`);
    await db.query(`CREATE TABLE food_restaurants (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      owner_user_id UUID, business_id bigint, status text DEFAULT 'active',
      is_verified boolean DEFAULT true, latitude numeric, longitude numeric,
      address_city text, address_state text, display_name text, slug text,
      discovery_status text DEFAULT 'visible', is_hidden_by_admin boolean DEFAULT false,
      created_at timestamptz DEFAULT now())`);
    await db.query(`CREATE TABLE user_blocks (blocker_id UUID, blocked_id UUID)`);
    await db.query(`CREATE TABLE food_menu_items (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      restaurant_id bigint, is_available boolean DEFAULT true)`);
    await db.query(`CREATE TABLE jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID, status text, location_approx_lat numeric, location_approx_lng numeric,
      location_city text, location_state text)`);
    await db.query(`CREATE TABLE tool_rentals (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id UUID, is_available boolean DEFAULT true, location_city text, location_state text)`);
    await db.query(`CREATE TABLE direct_catalog_services (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      is_active boolean DEFAULT true, is_published boolean DEFAULT true)`);
    await db.query(`CREATE TABLE pooled_orders (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      organizer_user_id UUID, organizer_business_id bigint, status text)`);

    // Backfill entity tables with any production columns they lack.
    const { backfillAllTables } = require('./mediaTestSchema');
    await backfillAllTables(db, [
      'users', 'helper_profiles', 'businesses', 'food_restaurants', 'user_blocks',
      'food_menu_items', 'jobs', 'tool_rentals', 'direct_catalog_services', 'pooled_orders',
    ], schema);

    // Apply actual media migrations for the media tables (no hand-building).
    // Note: 753_oxsteed_media_community_last_seen (not 753_media_public_video_without_csam).
    const migrationFiles = [
      '709_oxsteed_media.sql',
      '731_',
      '732_',
      '735_',
      '736_',
      '742_',
      '743_',
      '744_',
      '753_oxsteed_media_community_last_seen.sql',
      '754_',
      '757_',
    ];
    for (const prefix of migrationFiles) {
      const dir = path.resolve(__dirname, '../migrations');
      const file = fs.readdirSync(dir).find((name) => name.startsWith(prefix));
      if (!file) throw new Error(`Migration ${prefix} not found`);
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }

    // Fixtures: five users, four with helper profiles and media actors.
    await db.query(
      `INSERT INTO users (id) VALUES ($1), ($2), ($3), ($4), ($5)`,
      [viewer, outbound, inbound, allowed, banned]
    );
    await db.query(`UPDATE users SET is_banned = true WHERE id = $1`, [banned]);
    for (const [name, id] of [['outbound', outbound], ['inbound', inbound], ['allowed', allowed], ['banned', banned]]) {
      const helperId = randomUUID();
      helperIds[name] = helperId;
      await db.query(
        `INSERT INTO helper_profiles (id, user_id, profile_slug) VALUES ($1, $2, $3)`,
        [helperId, id, `local-${name}`]
      );
      await db.query(
        `INSERT INTO media_actors (id, owner_user_id, handle, display_name, actor_type, verified_kind)
         VALUES ($1, $2, $3, $4, 'helper', 'identity')`,
        [id, id, `local-${name}`, `Local ${name}`]
      );
      await db.query(
        `INSERT INTO media_posts (id, actor_id, body) VALUES ($1, $2, 'Local update')`,
        [id, id]
      );
    }
    // Community fixtures
    const townId = randomUUID();
    await db.query(
      `INSERT INTO media_communities (id, slug, title, geo_scope, category)
       VALUES ($1, 'local-town', 'Local town', 'Springfield', 'food')`,
      [townId]
    );
    await db.query(
      `INSERT INTO media_community_members (community_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [townId, viewer, banned]
    );
    await db.query(`UPDATE media_posts SET community_id = $1`, [townId]);
    await db.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2), ($3, $1)`,
      [viewer, outbound, inbound]
    );

    pool.connect.mockImplementation(() => db.connect());
    pool.query.mockImplementation((...args) => db.query(...args));
  });

  afterAll(async () => {
    if (db) await db.end();
    if (setup) { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await setup.end(); }
  });

  function res() { return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }

  test('search excludes both block directions even when the handle matches', async () => {
    const response = res();
    await media.searchMedia({ query: { q: 'local' }, user: { id: viewer } }, response);
    expect(response.status).not.toHaveBeenCalled();
    const data = response.json.mock.calls[0][0];
    expect(data.actors.map((a) => a.id)).toEqual([allowed]);
    expect(data.posts.map((p) => p.id)).toEqual([allowed]);
  });

  test.each([['outbound'], ['inbound'], ['banned']])('direct actor and post URLs hide %s', async (name) => {
    const id = userIds[name];
    const actorRes = res();
    await media.getActor({ params: { handle: `local-${name}` }, user: { id: viewer } }, actorRes);
    expect(actorRes.status).toHaveBeenCalledWith(404);
    const postRes = res();
    await media.getPost({ params: { id }, user: { id: viewer } }, postRes);
    expect(postRes.status).toHaveBeenCalledWith(404);
  });

  test.each(['toggleLike', 'toggleBookmark', 'toggleRepost', 'recordView', 'flagPost'])
    ('blocked %s stops before an action write', async (method) => {
      const response = res();
      await media[method]({
        params: { id: outbound },
        user: { id: viewer },
        query: {},
        body: { reason: 'spam' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'media-test' },
      }, response);
      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({ error: 'Post not found' });
    });

  test('allowed actor resolves and hydrated action state survives reload', async () => {
    await db.query(`INSERT INTO media_likes (post_id, user_id) VALUES ($1, $2)`, [allowed, viewer]);
    await db.query(`INSERT INTO media_bookmarks (post_id, user_id) VALUES ($1, $2)`, [allowed, viewer]);
    const response = res();
    await media.getActor({ params: { handle: 'local-allowed' }, user: { id: viewer } }, response);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].posts[0]).toMatchObject({ id: allowed, owner_user_id: allowed, liked: true, bookmarked: true });
  });

  test('an unverified member reply stays public without granting root publication visibility', async () => {
    const member = randomUUID();
    const memberReply = randomUUID();
    const memberRoot = randomUUID();
    await db.query(
      `INSERT INTO media_actors (id, owner_user_id, handle, display_name, actor_type, verified_kind)
       VALUES ($1, $2, 'member-viewer', 'Member', 'user', 'none')`,
      [member, viewer]
    );
    await db.query(`UPDATE users SET is_verified = false WHERE id = $1`, [viewer]);
    await db.query(
      `INSERT INTO media_posts (id, actor_id, body, parent_id) VALUES ($1, $2, 'A useful reply', $3), ($4, $2, 'An ineligible root', NULL)`,
      [memberReply, member, allowed, memberRoot]
    );
    try {
      const replies = res();
      await media.getReplies({ params: { id: allowed }, query: {} }, replies);
      expect(replies.status).not.toHaveBeenCalled();
      expect(replies.json.mock.calls[0][0].replies).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: memberReply, verified_kind: 'none' }),
      ]));
      const detail = res();
      await media.getPost({ params: { id: memberReply } }, detail);
      expect(detail.status).not.toHaveBeenCalled();
      const root = res();
      await media.getPost({ params: { id: memberRoot } }, root);
      expect(root.status).toHaveBeenCalledWith(404);
      await db.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [allowed, viewer]);
      const blocked = res();
      await media.getReplies({ params: { id: allowed }, query: {}, user: { id: allowed } }, blocked);
      expect(blocked.json.mock.calls[0][0].replies.some(item => item.id === memberReply)).toBe(false);
    } finally {
      await db.query(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [allowed, viewer]);
      await db.query(`DELETE FROM media_posts WHERE actor_id = $1`, [member]);
      await db.query(`DELETE FROM media_actors WHERE id = $1`, [member]);
      await db.query(`UPDATE users SET is_verified = true WHERE id = $1`, [viewer]);
    }
  });

  test('linked cards preserve a snapshot while hiding blocked entity owners', async () => {
    const linkId = randomUUID();
    await db.query(
      `INSERT INTO media_post_links (id, post_id, link_type, target_id, name_snapshot, sort_order)
       VALUES ($1, $2, 'helper', $3, 'Blocked helper', 0)`,
      [linkId, allowed, helperIds['outbound']]
    );
    try {
      const response = res();
      await media.getPost({ params: { id: allowed }, user: { id: viewer } }, response);
      expect(response.status).not.toHaveBeenCalled();
      expect(response.json.mock.calls[0][0].post.links).toEqual([
        expect.objectContaining({
          name: 'Blocked helper',
          available: false,
          canonical_url: null,
        }),
      ]);
    } finally {
      await db.query(`DELETE FROM media_post_links WHERE id = $1`, [linkId]);
    }
  });

  test('blocked linked targets do not boost the ranked feed', async () => {
    const linkId = randomUUID();
    await db.query(
      `INSERT INTO media_post_links (id, post_id, link_type, target_id, name_snapshot, sort_order)
       VALUES ($1, $2, 'helper', $3, 'Blocked helper', 0)`,
      [linkId, allowed, helperIds['outbound']]
    );
    try {
      const response = res();
      await media.getFeed({ query: { limit: '10', location_mode: 'all' }, user: { id: viewer } }, response);
      expect(response.status).not.toHaveBeenCalled();
      const found = response.json.mock.calls[0][0].posts.find((post) => post.id === allowed);
      expect(found).toMatchObject({ link_count: '0' });
      expect(found.links).toEqual([expect.objectContaining({ available: false, canonical_url: null })]);
    } finally {
      await db.query(`DELETE FROM media_post_links WHERE id = $1`, [linkId]);
    }
  });

  test('saved posts exclude both blocked directions and removed posts after reload', async () => {
    await db.query('TRUNCATE media_bookmarks');
    await db.query(
      `INSERT INTO media_bookmarks (post_id, user_id) VALUES ($1, $2), ($3, $2), ($4, $2)`,
      [outbound, viewer, inbound, allowed]
    );
    await db.query(`UPDATE media_posts SET deleted_at = NOW() WHERE id = $1`, [allowed]);
    try {
      const response = res();
      await media.getBookmarks({ user: { id: viewer } }, response);
      expect(response.status).not.toHaveBeenCalled();
      expect(response.json.mock.calls[0][0].posts).toEqual([]);
    } finally {
      await db.query(`UPDATE media_posts SET deleted_at = NULL WHERE id = $1`, [allowed]);
      await db.query('TRUNCATE media_bookmarks');
    }
  });

  test('guests can browse active authors but cannot see banned authors', async () => {
    const response = res();
    await media.searchMedia({ query: { q: 'local' } }, response);
    expect(response.status).not.toHaveBeenCalled();
    const ids = response.json.mock.calls[0][0].actors.map((a) => a.id).sort();
    expect(ids).toEqual([allowed, inbound, outbound].sort());
  });

  test('Space membership, counts and detail feed use the same visibility rules', async () => {
    const list = res();
    await media.getCommunities({ user: { id: viewer } }, list);
    expect(list.status).not.toHaveBeenCalled();
    expect(list.json.mock.calls[0][0].communities[0]).toMatchObject({ joined: true, post_count: 1, member_count: 1 });
    const detail = res();
    await media.getCommunity({ params: { slug: 'local-town' }, user: { id: viewer } }, detail);
    expect(detail.status).not.toHaveBeenCalled();
    expect(detail.json.mock.calls[0][0].community).toMatchObject({ joined: true, member_count: 1 });
    expect(detail.json.mock.calls[0][0].posts.map((p) => p.id)).toEqual([allowed]);
  });

  test('public SQL admits interim videos only in Cloudflare mode and hides flagged or unprocessed assets', async () => {
    const previousMode = process.env.MEDIA_CSAM_MODE;
    try {
      process.env.MEDIA_CSAM_MODE = 'cloudflare';
      await db.query(`UPDATE media_posts SET csam_status = 'cloudflare_deferred' WHERE id = $1`, [allowed]);
      const assetId = randomUUID();
      await db.query(
        `INSERT INTO media_post_assets (id, post_id, sort_order, asset_type, processing_status, csam_status, renditions)
         VALUES ($1, $2, 0, 'video', 'ready', 'cloudflare_deferred', $3)`,
        [assetId, allowed, JSON.stringify([{ storage_key: 'ready.mp4' }])]
      );
      const read = async () => {
        const result = res();
        await media.getPost({ params: { id: allowed }, user: { id: viewer } }, result);
        return result;
      };
      expect((await read()).status).not.toHaveBeenCalled();
      process.env.MEDIA_CSAM_MODE = 'vendor';
      expect((await read()).status).toHaveBeenCalledWith(404);
      process.env.MEDIA_CSAM_MODE = 'cloudflare';
      for (const status of ['flagged', 'pending', 'unavailable']) {
        await db.query('UPDATE media_post_assets SET csam_status = $1 WHERE id = $2', [status, assetId]);
        expect((await read()).status).toHaveBeenCalledWith(404);
      }
      await db.query(`UPDATE media_post_assets SET csam_status = 'cloudflare_deferred', processing_status = 'quarantine' WHERE id = $1`, [assetId]);
      expect((await read()).status).toHaveBeenCalledWith(404);
      await db.query(`UPDATE media_post_assets SET processing_status = 'ready', renditions = '[]' WHERE id = $1`, [assetId]);
      expect((await read()).status).toHaveBeenCalledWith(404);
      await db.query(`UPDATE media_post_assets SET renditions = $1 WHERE id = $2`, [JSON.stringify([{ storage_key: 'ready.mp4' }]), assetId]);
      await db.query(`UPDATE users SET is_verified = false WHERE id = $1`, [allowed]);
      expect((await read()).status).toHaveBeenCalledWith(404);
    } finally {
      if (previousMode === undefined) delete process.env.MEDIA_CSAM_MODE;
      else process.env.MEDIA_CSAM_MODE = previousMode;
    }
  });
});
