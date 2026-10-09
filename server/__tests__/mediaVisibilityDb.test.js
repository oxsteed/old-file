'use strict';

// Exercise the real visibility SQL against CI's disposable database. Temporary
// tables shadow production names only for this connection and disappear on exit.
jest.mock('../db', () => ({ query: jest.fn() }));
const { Client } = jest.requireActual('pg');
const pool = require('../db');
const media = require('../controllers/mediaController');
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true' && !url) {
  throw new Error('Media SQL verification requires the disposable test database in CI');
}
const describeDb = url ? describe : describe.skip;

describeDb('Media block boundaries in PostgreSQL', () => {
  let db;
  beforeAll(async () => {
    if (!/\/credit_statement_test(?:\?|$)/.test(url)) throw new Error('Use only the disposable credit_statement_test database');
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query(`
      CREATE TEMP TABLE users (id text PRIMARY KEY, city text, state text, deleted_at timestamptz, is_active boolean DEFAULT true, is_banned boolean DEFAULT false, is_verified boolean DEFAULT true);
      CREATE TEMP TABLE media_actors (id text PRIMARY KEY, owner_user_id text, business_id text, restaurant_id text, handle text, display_name text, avatar_url text, verified_kind text, actor_type text);
      -- Shadow every entity table referenced by the public publisher policy so
      -- this disposable text-id fixture never compares a temporary text user
      -- id with a production UUID column from the surrounding database.
      CREATE TEMP TABLE helper_profiles (id text PRIMARY KEY, user_id text, profile_slug text, service_lat numeric, service_lng numeric, service_city text, service_state text);
      CREATE TEMP TABLE businesses (id text PRIMARY KEY, user_id text, deleted_at timestamptz, is_active boolean DEFAULT true, is_business_verified boolean DEFAULT true, service_lat numeric, service_lng numeric, service_city text, service_state text, address_city text, address_state text, business_name text, profile_slug text);
      CREATE TEMP TABLE food_restaurants (id text PRIMARY KEY, owner_user_id text, status text DEFAULT 'active', is_verified boolean DEFAULT true, latitude numeric, longitude numeric, address_city text, address_state text, display_name text, slug text, business_id text);
      CREATE TEMP TABLE user_blocks (blocker_id text, blocked_id text);
      CREATE TEMP TABLE media_posts (id text PRIMARY KEY, actor_id text, body text, parent_id text, quoted_post_id text, community_id text, deleted_at timestamptz,
        visibility text DEFAULT 'public', processing_status text DEFAULT 'ready', csam_status text DEFAULT 'passed', created_at timestamptz DEFAULT now());
      CREATE TEMP TABLE media_post_links (id text, post_id text, sort_order int);
      CREATE TEMP TABLE media_post_assets (id text, post_id text, sort_order int, asset_type text, processing_status text, csam_status text, renditions jsonb);
      CREATE TEMP TABLE media_likes (post_id text, user_id text);
      CREATE TEMP TABLE media_bookmarks (post_id text, user_id text);
      CREATE TEMP TABLE media_reposts (post_id text, actor_id text);
      CREATE TEMP TABLE media_follows (follower_user_id text, actor_id text, created_at timestamptz DEFAULT now());
      CREATE TEMP TABLE media_communities (id text PRIMARY KEY, slug text, title text, geo_scope text, category text);
      CREATE TEMP TABLE media_community_members (community_id text, user_id text);
      INSERT INTO users (id) VALUES ('viewer'), ('outbound'), ('inbound'), ('allowed'), ('banned');
      UPDATE users SET is_banned = true WHERE id = 'banned';
      INSERT INTO helper_profiles (id, user_id, profile_slug)
        SELECT 'helper-' || id, id, 'local-' || id FROM users WHERE id <> 'viewer';
      INSERT INTO media_actors (id, owner_user_id, handle, display_name, actor_type, verified_kind)
        SELECT id, id, 'local-' || id, 'Local ' || id, 'helper', 'identity' FROM users WHERE id <> 'viewer';
      INSERT INTO media_posts (id, actor_id, body) SELECT id, id, 'Local update' FROM media_actors;
      INSERT INTO media_communities VALUES ('town', 'local-town', 'Local town', 'Springfield', 'food');
      INSERT INTO media_community_members VALUES ('town', 'viewer');
      UPDATE media_posts SET community_id = 'town';
      INSERT INTO user_blocks VALUES ('viewer', 'outbound'), ('inbound', 'viewer');
    `);
    pool.query.mockImplementation((...args) => db.query(...args));
  });
  afterAll(async () => { if (db) await db.end(); });

  function res() { return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }

  test('search excludes both block directions even when the handle matches', async () => {
    const response = res();
    await media.searchMedia({ query: { q: 'local' }, user: { id: 'viewer' } }, response);
    expect(response.status).not.toHaveBeenCalled();
    const data = response.json.mock.calls[0][0];
    expect(data.actors.map((a) => a.id)).toEqual(['allowed']);
    expect(data.posts.map((p) => p.id)).toEqual(['allowed']);
  });

  test.each(['outbound', 'inbound', 'banned'])('direct actor and post URLs hide %s', async (id) => {
    const actorRes = res();
    await media.getActor({ params: { handle: `local-${id}` }, user: { id: 'viewer' } }, actorRes);
    expect(actorRes.status).toHaveBeenCalledWith(404);
    const postRes = res();
    await media.getPost({ params: { id }, user: { id: 'viewer' } }, postRes);
    expect(postRes.status).toHaveBeenCalledWith(404);
  });

  test('allowed actor resolves and hydrated action state survives reload', async () => {
    await db.query("INSERT INTO media_likes VALUES ('allowed', 'viewer'); INSERT INTO media_bookmarks VALUES ('allowed', 'viewer')");
    const response = res();
    await media.getActor({ params: { handle: 'local-allowed' }, user: { id: 'viewer' } }, response);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].posts[0]).toMatchObject({ id: 'allowed', owner_user_id: 'allowed', liked: true, bookmarked: true });
  });

  test('saved posts exclude both blocked directions and removed posts after reload', async () => {
    await db.query('TRUNCATE media_bookmarks');
    await db.query("INSERT INTO media_bookmarks (post_id, user_id) VALUES ('outbound', 'viewer'), ('inbound', 'viewer'), ('allowed', 'viewer')");
    await db.query("UPDATE media_posts SET deleted_at = NOW() WHERE id = 'allowed'");
    try {
      const response = res();
      await media.getBookmarks({ user: { id: 'viewer' } }, response);
      expect(response.status).not.toHaveBeenCalled();
      expect(response.json.mock.calls[0][0].posts).toEqual([]);
    } finally {
      await db.query("UPDATE media_posts SET deleted_at = NULL WHERE id = 'allowed'");
      await db.query('TRUNCATE media_bookmarks');
    }
  });

  test('guests can browse active authors but cannot see banned authors', async () => {
    const response = res();
    await media.searchMedia({ query: { q: 'local' } }, response);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].actors.map((a) => a.id).sort()).toEqual(['allowed', 'inbound', 'outbound']);
  });

  test('Space membership, counts and detail feed use the same visibility rules', async () => {
    const list = res();
    await media.getCommunities({ user: { id: 'viewer' } }, list);
    expect(list.status).not.toHaveBeenCalled();
    expect(list.json.mock.calls[0][0].communities[0]).toMatchObject({ joined: true, post_count: 1 });
    const detail = res();
    await media.getCommunity({ params: { slug: 'local-town' }, user: { id: 'viewer' } }, detail);
    expect(detail.status).not.toHaveBeenCalled();
    expect(detail.json.mock.calls[0][0].posts.map((p) => p.id)).toEqual(['allowed']);
  });

  test('public SQL admits interim videos only in Cloudflare mode and hides flagged or unprocessed assets', async () => {
    const previousMode = process.env.MEDIA_CSAM_MODE;
    try {
      process.env.MEDIA_CSAM_MODE = 'cloudflare';
      await db.query("UPDATE media_posts SET csam_status = 'cloudflare_deferred' WHERE id = 'allowed'");
      await db.query(`INSERT INTO media_post_assets VALUES
        ('video', 'allowed', 0, 'video', 'ready', 'cloudflare_deferred', '[{"storage_key":"ready.mp4"}]')`);
      const read = async () => {
        const result = res();
        await media.getPost({ params: { id: 'allowed' }, user: { id: 'viewer' } }, result);
        return result;
      };
      expect((await read()).status).not.toHaveBeenCalled();
      process.env.MEDIA_CSAM_MODE = 'vendor';
      expect((await read()).status).toHaveBeenCalledWith(404);
      process.env.MEDIA_CSAM_MODE = 'cloudflare';
      for (const status of ['flagged', 'pending', 'unavailable']) {
        await db.query('UPDATE media_post_assets SET csam_status = $1', [status]);
        expect((await read()).status).toHaveBeenCalledWith(404);
      }
      await db.query("UPDATE media_post_assets SET csam_status = 'cloudflare_deferred', processing_status = 'quarantine'");
      expect((await read()).status).toHaveBeenCalledWith(404);
      await db.query("UPDATE media_post_assets SET processing_status = 'ready', renditions = '[]'");
      expect((await read()).status).toHaveBeenCalledWith(404);
      await db.query(`UPDATE media_post_assets SET renditions = '[{"storage_key":"ready.mp4"}]'`);
      await db.query("UPDATE users SET is_verified = false WHERE id = 'allowed'");
      expect((await read()).status).toHaveBeenCalledWith(404);
    } finally {
      if (previousMode === undefined) delete process.env.MEDIA_CSAM_MODE;
      else process.env.MEDIA_CSAM_MODE = previousMode;
    }
  });
});
