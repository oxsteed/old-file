'use strict';

// Section 4 (Discovery and integrations): actual API matrix against a real
// migrated disposable PostgreSQL. Covers Spaces, nearby ranking, location
// handling, the versioned feed cursor, follows, live-count broadcast,
// integrations (business posts, actor profiles, linked cards), and the
// restaurant-copy CSAM revocation path.
//
// Real migrated PostgreSQL only (disposable credit_statement_test database).
// Controllers are mounted on their real route paths with a test auth stub;
// the discovery behavior under test lives in the controllers, not in auth.

jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('MEDIA_DISCOVERY_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const mediaCtrl = require('../controllers/mediaController');
const feedContext = require('../services/mediaFeedContext');
const socketService = require('../services/socketService');

jest.setTimeout(120000);

test('media discovery DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

// Test auth: reads the fixture user id from a header. The real auth
// middleware is not under test here; every behavior below lives in the
// media controllers.
function testAuth(req, res, next) {
  const userId = req.headers['x-test-user-id'];
  if (userId) req.user = { id: userId, role: 'customer' };
  next();
}
function requireTestAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(testAuth);
  app.get('/media/feed', mediaCtrl.getFeed);
  app.get('/media/search', mediaCtrl.searchMedia);
  app.get('/media/communities', mediaCtrl.getCommunities);
  app.get('/media/communities/:slug', mediaCtrl.getCommunity);
  app.post('/media/communities/:id/join', requireTestAuth, mediaCtrl.joinCommunity);
  app.delete('/media/communities/:id/join', requireTestAuth, mediaCtrl.leaveCommunity);
  app.get('/media/business/:businessId/posts', mediaCtrl.getBusinessPosts);
  app.get('/media/posts/:id', mediaCtrl.getPost);
  app.get('/media/actors/:handle', mediaCtrl.getActor);
  app.post('/media/actors/:actorId/follow', requireTestAuth, mediaCtrl.toggleFollow);
  app.post('/media/posts/:id/like', requireTestAuth, mediaCtrl.toggleLike);
  return app;
}

describeDatabase('media discovery and integrations', () => {
  let app;
  const tag = crypto.randomBytes(4).toString('hex');
  const users = {};   // name -> id
  const actors = {};  // name -> { id, handle }
  const posts = {};   // name -> id
  let communityId;
  let communitySlug;

  async function createUser(name, opts = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role,
                          is_active, is_banned, is_verified, city, state)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, 'customer',
               $5, $6, $7, $8, $9)`,
      [id, `disc-${tag}-${name}@example.invalid`, `Disc${name}`, `User${tag}`,
       opts.active !== false, !!opts.banned, !!opts.verified,
       opts.city || null, opts.state || null]
    );
    users[name] = id;
    return id;
  }

  async function makeHelper(name, { city = null, state = null } = {}) {
    const userId = users[name];
    await pool.query(
      `INSERT INTO helper_profiles (user_id, service_city, service_state)
       VALUES ($1, $2, $3)`,
      [userId, city, state]
    );
    const handle = `disc-${tag}-${name}`;
    const { rows } = await pool.query(
      `INSERT INTO media_actors (actor_type, owner_user_id, handle, display_name, verified_kind)
       VALUES ('helper', $1, $2, $3, 'identity') RETURNING id`,
      [userId, handle, `Disc ${name}`]
    );
    actors[name] = { id: rows[0].id, handle };
    return actors[name];
  }

  async function makePost(name, actorName, { body = 'hello', communityId: commId = null, visibility = 'public' } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO media_posts (actor_id, body, visibility, processing_status, csam_status, community_id)
       VALUES ($1, $2, $3, 'ready', 'passed', $4) RETURNING id`,
      [actors[actorName].id, `${body} ${tag} ${name}`, visibility, commId]
    );
    posts[name] = rows[0].id;
    return posts[name];
  }

  beforeAll(async () => {
    app = buildApp();
    // Two verified helpers (one with a service city), one unverified plain user.
    await createUser('alice', { verified: true, city: 'Springfield', state: 'IL' });
    await createUser('bob', { verified: true });
    await createUser('carol', { verified: true });
    await createUser('dave'); // plain member, no helper profile
    await makeHelper('alice', { city: 'Springfield', state: 'IL' });
    await makeHelper('bob', { city: 'Shelbyville', state: 'IL' });
    await makeHelper('carol');

    const { rows: comm } = await pool.query(
      `INSERT INTO media_communities (slug, title, geo_scope, category)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [`disc-${tag}-springfield`, `Springfield ${tag}`, 'springfield,il', 'city']
    );
    communityId = comm[0].id;
    communitySlug = `disc-${tag}-springfield`;

    // Root posts for feed/search/actor coverage.
    await makePost('p1', 'alice', { body: 'springfield plumbing tips' });
    await makePost('p2', 'bob', { body: 'shelbyville electrical work' });
    await makePost('p3', 'carol', { body: 'general handyman advice' });
    await makePost('p4', 'alice', { body: 'community post', communityId });
    // A removed-visibility post must never surface.
    await makePost('pRemoved', 'alice', { body: 'removed post', visibility: 'removed' });
  });

  afterAll(async () => {
    // Best-effort cleanup; fixtures use random ids so re-runs do not collide.
    await pool.query(`DELETE FROM media_posts WHERE body LIKE '%' || $1 || '%'`, [tag]).catch(() => {});
    await pool.query(`DELETE FROM media_actors WHERE handle LIKE 'disc-' || $1 || '-%'`, [tag]).catch(() => {});
    await pool.query(`DELETE FROM media_communities WHERE slug LIKE 'disc-' || $1 || '-%'`, [tag]).catch(() => {});
    await pool.query(`DELETE FROM helper_profiles WHERE user_id = ANY($1::uuid[])`, [Object.values(users)]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE email LIKE 'disc-' || $1 || '-%'`, [tag]).catch(() => {});
    await pool.end().catch(() => {});
  });

  const as = (name) => ({ 'x-test-user-id': users[name] });

  // ── 1. City/category Spaces ────────────────────────────────────────────
  describe('spaces', () => {
    test('communities list reports post/member counts and join state', async () => {
      const res = await request(app).get('/media/communities').set(as('alice')).expect(200);
      const found = res.body.communities.find((c) => c.id === communityId);
      expect(found).toBeTruthy();
      expect(found.post_count).toBe(1);
      expect(found.member_count).toBe(0);
      expect(found.joined).toBe(false);
    });

    test('join/leave round-trips member counts', async () => {
      let res = await request(app).post(`/media/communities/${communityId}/join`).set(as('alice')).expect(200);
      expect(res.body.joined).toBe(true);
      expect(res.body.member_count).toBe(1);
      res = await request(app).post(`/media/communities/${communityId}/join`).set(as('bob')).expect(200);
      expect(res.body.member_count).toBe(2);
      res = await request(app).delete(`/media/communities/${communityId}/join`).set(as('alice')).expect(200);
      expect(res.body.joined).toBe(false);
      expect(res.body.member_count).toBe(1);
      // Restore for other tests.
      await request(app).post(`/media/communities/${communityId}/join`).set(as('alice')).expect(200);
    });

    test('member_count excludes banned members', async () => {
      await pool.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [users.bob]);
      try {
        const res = await request(app).get('/media/communities').set(as('alice')).expect(200);
        const found = res.body.communities.find((c) => c.id === communityId);
        expect(found.member_count).toBe(1); // only alice counts
      } finally {
        await pool.query('UPDATE users SET is_banned = FALSE WHERE id = $1', [users.bob]);
      }
    });

    test('community detail returns its public posts', async () => {
      const res = await request(app).get(`/media/communities/${communitySlug}`).set(as('alice')).expect(200);
      expect(res.body.community.id).toBe(communityId);
      expect(res.body.posts.length).toBe(1);
    });
  });

  // ── 2. Nearby ranking ──────────────────────────────────────────────────
  describe('nearby ranking', () => {
    test('feed with city/state returns posts; city without state is rejected', async () => {
      const res = await request(app)
        .get('/media/feed?city=springfield&state=il&limit=10')
        .set(as('alice'))
        .expect(200);
      expect(Array.isArray(res.body.posts)).toBe(true);
      expect(res.body.posts.length).toBeGreaterThan(0);
      await request(app).get('/media/feed?city=springfield&limit=10').set(as('alice')).expect(400);
    });

    test('location_mode=all rejects city params', async () => {
      await request(app).get('/media/feed?location_mode=all&city=springfield&state=il').set(as('alice')).expect(400);
      await request(app).get('/media/feed?location_mode=all').set(as('alice')).expect(200);
    });

    test('removed-entity posts lose discoverability', async () => {
      // Ban carol: her post must disappear from the feed and search.
      await pool.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [users.carol]);
      try {
        const feed = await request(app).get('/media/feed?limit=50').set(as('alice')).expect(200);
        const bodies = feed.body.posts.map((p) => p.body).join(' ');
        expect(bodies).not.toContain('general handyman advice');
        const search = await request(app).get(`/media/search?q=handyman%20${tag}`).set(as('alice')).expect(200);
        expect(search.body.posts.length).toBe(0);
      } finally {
        await pool.query('UPDATE users SET is_banned = FALSE WHERE id = $1', [users.carol]);
      }
    });

    test('reciprocally blocked authors are hidden from feed and search', async () => {
      await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [users.alice, users.bob]);
      try {
        const feed = await request(app).get('/media/feed?limit=50').set(as('alice')).expect(200);
        const bodies = feed.body.posts.map((p) => p.body).join(' ');
        expect(bodies).not.toContain('shelbyville electrical work');
        const search = await request(app).get(`/media/search?q=shelbyville%20${tag}`).set(as('alice')).expect(200);
        expect(search.body.posts.length).toBe(0);
      } finally {
        await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [users.alice, users.bob]);
      }
    });
  });

  // ── 3. Guest/device location handling ──────────────────────────────────
  describe('location resolution', () => {
    test('guest city/state choice resolves; device coords are rounded', async () => {
      const loc = await feedContext.resolveLocation(
        { city: 'Springfield', state: 'IL', latitude: '39.7817213', longitude: '-89.6501481' }, null, pool);
      expect(loc.city).toBe('springfield');
      expect(loc.state).toBe('il');
      expect(loc.latitude).toBe(39.782);
      expect(loc.longitude).toBe(-89.65);
    });

    test('invalid combos are rejected', async () => {
      await expect(feedContext.resolveLocation({ city: 'x' }, null, pool)).rejects.toThrow();
      await expect(feedContext.resolveLocation({ latitude: '1.0' }, null, pool)).rejects.toThrow();
      await expect(feedContext.resolveLocation({ city: 'x', state: 'y', location_mode: 'all' }, null, pool)).rejects.toThrow();
      await expect(feedContext.resolveLocation({ latitude: 'not-a-number', longitude: '1' }, null, pool)).rejects.toThrow();
    });

    test('signed-in viewer falls back to profile location', async () => {
      const loc = await feedContext.resolveLocation({}, users.alice, pool);
      expect(loc.city).toBe('springfield');
      expect(loc.state).toBe('il');
    });

    test('guest with no location gets the empty context', async () => {
      const loc = await feedContext.resolveLocation({}, null, pool);
      expect(loc).toEqual({ city: '', state: '', latitude: null, longitude: null });
    });
  });

  // ── 4. Versioned feed cursor ───────────────────────────────────────────
  describe('feed cursor', () => {
    test('paginating with the cursor yields no duplicate ids', async () => {
      const page1 = await request(app).get('/media/feed?limit=2').set(as('alice')).expect(200);
      expect(page1.body.posts.length).toBe(2);
      expect(page1.body.next_cursor).toBeTruthy();
      const seen = new Set(page1.body.posts.map((p) => p.id));
      const page2 = await request(app).get(`/media/feed?limit=2&cursor=${page1.body.next_cursor}`).set(as('alice')).expect(200);
      for (const post of page2.body.posts) {
        expect(seen.has(post.id)).toBe(false);
        seen.add(post.id);
      }
    });

    test('tampered and cross-context cursors are rejected', async () => {
      const page1 = await request(app).get('/media/feed?limit=2').set(as('alice')).expect(200);
      const cursor = page1.body.next_cursor;
      // Tampered payload.
      await request(app).get('/media/feed?limit=2&cursor=not-a-cursor').set(as('alice')).expect(400);
      // Cursor minted for a different tab context must not apply here.
      const following = await request(app)
        .get(`/media/feed?tab=following&limit=2&cursor=${cursor}`)
        .set(as('alice'))
        .expect(400);
      expect(following.body.code || following.body.error).toBeTruthy();
    });
  });

  // ── 5. Stale/deleted content stays out of read surfaces ────────────────
  describe('stale content', () => {
    test('deleted posts disappear from search, actor page, and detail', async () => {
      await pool.query('UPDATE media_posts SET deleted_at = NOW() WHERE id = $1', [posts.p3]);
      try {
        const search = await request(app).get(`/media/search?q=handyman%20${tag}`).set(as('alice')).expect(200);
        expect(search.body.posts.find((p) => p.id === posts.p3)).toBeUndefined();
        const actor = await request(app).get(`/media/actors/${actors.carol.handle}`).set(as('alice')).expect(200);
        expect(actor.body.posts.find((p) => p.id === posts.p3)).toBeUndefined();
        // Detail of a deleted post returns 404, never the live post.
        await request(app).get(`/media/posts/${posts.p3}`).set(as('alice')).expect(404);
      } finally {
        await pool.query('UPDATE media_posts SET deleted_at = NULL WHERE id = $1', [posts.p3]);
      }
    });
  });

  // ── 6. Follows and Following ──────────────────────────────────────────
  describe('follows', () => {
    test('follow round-trip updates actor state and the following feed', async () => {
      let res = await request(app).post(`/media/actors/${actors.bob.id}/follow`).set(as('alice')).expect(200);
      expect(res.body.following).toBe(true);
      res = await request(app).get(`/media/actors/${actors.bob.handle}`).set(as('alice')).expect(200);
      expect(res.body.actor.following).toBe(true);
      expect(res.body.actor.follower_count).toBe(1);
      const feed = await request(app).get('/media/feed?tab=following&limit=50').set(as('alice')).expect(200);
      const bodies = feed.body.posts.map((p) => p.body).join(' ');
      expect(bodies).toContain('shelbyville electrical work');
      res = await request(app).post(`/media/actors/${actors.bob.id}/follow`).set(as('alice')).expect(200);
      expect(res.body.following).toBe(false);
    });

    test('cannot follow yourself or a blocked actor', async () => {
      await request(app).post(`/media/actors/${actors.alice.id}/follow`).set(as('alice')).expect(400);
      await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [users.alice, users.carol]);
      try {
        await request(app).post(`/media/actors/${actors.carol.id}/follow`).set(as('alice')).expect(404);
      } finally {
        await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [users.alice, users.carol]);
      }
    });

    test('following feed requires sign-in', async () => {
      await request(app).get('/media/feed?tab=following').expect(401);
    });
  });

  // ── 7. Live authoritative counts ─────────────────────────────────────
  describe('live counts', () => {
    test('liking a post broadcasts the committed counter', async () => {
      // The test harness mocks socketService; attach the media broadcast fn.
      socketService.broadcastToMediaPost = jest.fn();
      try {
        await request(app).post(`/media/posts/${posts.p1}/like`).set(as('dave')).expect(200);
        expect(socketService.broadcastToMediaPost).toHaveBeenCalled();
        const call = socketService.broadcastToMediaPost.mock.calls
          .find(([postId]) => String(postId) === String(posts.p1));
        expect(call).toBeTruthy();
        expect(call[1]).toBe('media:post:counts');
        expect(Number(call[2].like_count)).toBe(1);
        // Committed counter matches the broadcast value.
        const { rows } = await pool.query('SELECT like_count FROM media_posts WHERE id = $1', [posts.p1]);
        expect(Number(rows[0].like_count)).toBe(1);
      } finally {
        delete socketService.broadcastToMediaPost;
        await request(app).post(`/media/posts/${posts.p1}/like`).set(as('dave')).catch(() => {});
      }
    });
  });

  // ── 8. Integrations ──────────────────────────────────────────────────
  describe('integrations', () => {
    let businessId;
    let businessActorId;

    beforeAll(async () => {
      const { rows: biz } = await pool.query(
        `INSERT INTO businesses (user_id, business_name, is_active, is_business_verified)
         VALUES ($1, $2, TRUE, TRUE) RETURNING id`,
        [users.carol, `Disc Biz ${tag}`]
      );
      businessId = biz[0].id;
      const handle = `disc-${tag}-carolbiz`;
      const { rows: actor } = await pool.query(
        `INSERT INTO media_actors (actor_type, owner_user_id, business_id, handle, display_name, verified_kind)
         VALUES ('business', $1, $2, $3, $4, 'business') RETURNING id`,
        [users.carol, businessId, handle, `Disc Biz ${tag}`]
      );
      businessActorId = actor[0].id;
      await pool.query(
        `INSERT INTO media_posts (actor_id, body, visibility, processing_status, csam_status)
         VALUES ($1, $2, 'public', 'ready', 'passed')`,
        [businessActorId, `business announcement ${tag}`]
      );
      // A linked job card on alice's post.
      await pool.query(
        `INSERT INTO media_post_links (post_id, link_type, target_id, name_snapshot)
         VALUES ($1, 'job', $2, 'Fix sink')`,
        [posts.p1, `job-${tag}`]
      );
    });

    test('business posts endpoint returns the business actor posts', async () => {
      const res = await request(app).get(`/media/business/${businessId}/posts`).set(as('alice')).expect(200);
      expect(res.body.posts.length).toBe(1);
      expect(res.body.posts[0].body).toContain('business announcement');
    });

    test('actor profile returns follower counts and public posts', async () => {
      const res = await request(app).get(`/media/actors/${actors.alice.handle}`).set(as('dave')).expect(200);
      expect(res.body.actor.handle).toBe(actors.alice.handle);
      expect(typeof res.body.actor.follower_count).toBe('number');
      expect(res.body.posts.length).toBeGreaterThan(0);
    });

    test('post detail hydrates linked cards', async () => {
      const res = await request(app).get(`/media/posts/${posts.p1}`).set(as('alice')).expect(200);
      const post = res.body.post || res.body;
      const links = post.links || [];
      expect(links.some((l) => l.link_type === 'job')).toBe(true);
    });
  });

  // ── 9. Restaurant copy CSAM revocation ───────────────────────────────
  describe('restaurant copy csam revocation', () => {
    test('flagging source media revokes every federated copy', async () => {
      const { recordFlagged } = require('../services/csamCheckService');
      // Build the chain: business -> restaurant -> restaurant_media.
      const { rows: biz } = await pool.query(
        `INSERT INTO businesses (user_id, business_name, is_active) VALUES ($1, $2, TRUE) RETURNING id`,
        [users.bob, `Disc Rest Biz ${tag}`]
      );
      const { rows: rest } = await pool.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [biz[0].id, users.bob, `Disc Diner ${tag}`]
      );
      // One source row produces one federated post (unique index), so use two
      // sources to prove every copy is revoked.
      const mediaIds = [];
      for (const n of [1, 2]) {
        const { rows: media } = await pool.query(
          `INSERT INTO restaurant_media (restaurant_id, user_id, video_url, provider, external_video_id)
           VALUES ($1, $2, $3, 'youtube', $4) RETURNING id`,
          [rest[0].id, users.bob, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', `vid-${tag}-${n}`]
        );
        mediaIds.push(media[0].id);
      }
      const copyIds = [];
      for (const [i, mediaId] of mediaIds.entries()) {
        const { rows: copy } = await pool.query(
          `INSERT INTO media_posts (actor_id, body, visibility, processing_status, csam_status, source_restaurant_media_id)
           VALUES ($1, $2, 'public', 'ready', 'passed', $3) RETURNING id`,
          [actors.bob.id, `federated copy ${i + 1} ${tag}`, mediaId]
        );
        copyIds.push(copy[0].id);
      }
      // An unrelated post must survive.
      const { rows: other } = await pool.query(
        `INSERT INTO media_posts (actor_id, body, visibility, processing_status, csam_status)
         VALUES ($1, $2, 'public', 'ready', 'passed') RETURNING id`,
        [actors.bob.id, `unrelated post ${tag}`]
      );

      await recordFlagged(mediaIds[0], 'passed');

      const { rows: [source] } = await pool.query(
        `SELECT csam_status FROM restaurant_media WHERE id = $1`,
        [mediaIds[0]]
      );
      expect(source.csam_status).toBe('flagged');

      const { rows: after } = await pool.query(
        `SELECT id, visibility FROM media_posts WHERE id = ANY($1::uuid[])`,
        [[...copyIds, other[0].id]]
      );
      const byId = Object.fromEntries(after.map((r) => [r.id, r.visibility]));
      expect(byId[copyIds[0]]).toBe('removed');
      expect(byId[copyIds[1]]).toBe('public');
      expect(byId[other[0].id]).toBe('public');
    });
  });
});
