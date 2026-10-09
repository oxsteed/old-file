'use strict';

// Section 2 (Core interactions) matrix against real PostgreSQL.
//
// Covers: replies, quotes, reposts, likes, bookmarks, shares, views across
// feed/search/actor/detail/replies/quotes/saved views; two-way blocking in
// every view; owner vs viewer state; daily post quota including the
// concurrent race; report validation, hourly cap, and duplicates;
// owner edit/delete atomicity and counter updates; state after reload.
//
// Real migrated PostgreSQL only (disposable database). New test file only;
// no production code is modified here.

jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('MEDIA_INTERACTIONS_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const media = require('../controllers/mediaController');

jest.setTimeout(180000);

test('media interaction matrix requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('media core interactions matrix', () => {
  const userIds = [];
  const actorIds = [];
  const postIds = [];
  let alice;
  let bob;
  let carol;
  let dave;

  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnThis();
    res.json = jest.fn().mockReturnThis();
    return res;
  }

  function mockReq({ userId = null, body = {}, params = {}, query = {} }) {
    return {
      user: userId ? { id: userId } : undefined,
      body,
      params,
      query,
    };
  }

  async function call(fn, req) {
    const res = mockRes();
    await fn(req, res);
    const status = res.status.mock.calls.length > 0 ? res.status.mock.calls[0][0] : 200;
    const payload = res.json.mock.calls.length > 0 ? res.json.mock.calls[0][0] : null;
    return { status, payload };
  }

  async function createUser(tag, { verified = true } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, is_verified, is_active)
       VALUES ($1, $2, 'synthetic-unusable', $3, 'Matrix', $4, TRUE)`,
      [id, `media-matrix-${tag}-${id}@example.invalid`, tag, verified]
    );
    if (verified) {
      await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [id]);
    }
    userIds.push(id);
    return id;
  }

  let posterSeq = 0;

  // Fresh verified poster per call: the daily post quota is per actor, so
  // tests that create posts must not share an actor.
  async function poster() {
    posterSeq += 1;
    return createUser(`poster${posterSeq}`);
  }

  async function createPostAs(userId, body, extra = {}) {
    const { status, payload } = await call(
      media.createPost,
      mockReq({ userId, body: { body, ...extra } })
    );
    if (status !== 201) {
      throw new Error(`createPost failed with ${status}: ${JSON.stringify(payload)}`);
    }
    postIds.push(payload.post.id);
    return payload.post;
  }

  async function tableCount(table, postId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE post_id = $1`,
      [postId]
    );
    return rows[0].count;
  }

  beforeAll(async () => {
    const { rows: applied } = await pool.query(
      "SELECT 1 FROM _migrations WHERE filename = '709_oxsteed_media.sql' AND status = 'applied'"
    );
    if (applied.length !== 1) {
      throw new Error('Apply all repository migrations before running the media interaction matrix');
    }
    alice = await createUser('alice');
    bob = await createUser('bob');
    carol = await createUser('carol');
    dave = await createUser('dave', { verified: false });
  });

  afterAll(async () => {
    const statements = [
      ['DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]],
      ['DELETE FROM media_post_flags WHERE user_id = ANY($1::uuid[])', [userIds]],
      ['DELETE FROM user_blocks WHERE blocker_id = ANY($1::uuid[]) OR blocked_id = ANY($1::uuid[])', [userIds]],
      ['DELETE FROM media_actors WHERE owner_user_id = ANY($1::uuid[])', [userIds]],
      ['DELETE FROM helper_profiles WHERE user_id = ANY($1::uuid[])', [userIds]],
      ['DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]],
    ];
    for (const [sql, params] of statements) {
      try {
        await pool.query(sql, params);
      } catch {
        // Disposable database; best-effort cleanup.
      }
    }
    await pool.end();
  });

  test('verified users create root posts; unverified users get 403', async () => {
    const author = await poster();
    const post = await createPostAs(author, 'Matrix root post alpha');
    expect(post.body).toBe('Matrix root post alpha');
    expect(post.visibility).toBe('public');

    const { status, payload } = await call(
      media.createPost,
      mockReq({ userId: dave, body: { body: 'Dave tries a root post' } })
    );
    expect(status).toBe(403);
    expect(payload.code).toBe('media_not_verified_poster');
  });

  test('replies and quotes link to their targets and bump counters', async () => {
    const author = await poster();
    const replier = await poster();
    const root = await createPostAs(author, 'Matrix root post beta');
    const reply = await createPostAs(replier, 'Matrix reply beta', { parent_id: root.id });
    expect(reply.parent_id).toBe(root.id);

    const quote = await createPostAs(replier, 'Matrix quote beta', { quoted_post_id: root.id });
    expect(quote.quoted_post_id).toBe(root.id);

    const { payload } = await call(media.getPost, mockReq({ params: { id: root.id } }));
    expect(payload.post.reply_count).toBe(1);
    expect(payload.post.quote_count).toBe(1);
  });

  test('unverified users can reply in threads', async () => {
    const author = await poster();
    const root = await createPostAs(author, 'Matrix root post gamma');
    const { status, payload } = await call(
      media.createPost,
      mockReq({ userId: dave, body: { body: 'Dave replies', parent_id: root.id } })
    );
    expect(status).toBe(201);
    expect(payload.post.parent_id).toBe(root.id);
  });

  test('like toggle flips state and keeps the counter exact', async () => {
    const author = await poster();
    const liker = await poster();
    const root = await createPostAs(author, 'Matrix like target');
    let r = await call(media.toggleLike, mockReq({ userId: liker, params: { id: root.id } }));
    expect(r.status).toBe(200);
    expect(r.payload.liked).toBe(true);
    expect(r.payload.like_count).toBe(1);

    r = await call(media.toggleLike, mockReq({ userId: liker, params: { id: root.id } }));
    expect(r.payload.liked).toBe(false);
    expect(r.payload.like_count).toBe(0);
    expect(await tableCount('media_likes', root.id)).toBe(0);
  });

  test('bookmark toggle feeds the saved view', async () => {
    const author = await poster();
    const saver = await poster();
    const root = await createPostAs(author, 'Matrix bookmark target');
    let r = await call(media.toggleBookmark, mockReq({ userId: saver, params: { id: root.id } }));
    expect(r.payload.bookmarked).toBe(true);

    const saved = await call(media.getBookmarks, mockReq({ userId: saver }));
    expect(saved.payload.posts.map((p) => p.id)).toContain(root.id);

    r = await call(media.toggleBookmark, mockReq({ userId: saver, params: { id: root.id } }));
    expect(r.payload.bookmarked).toBe(false);
    const savedAfter = await call(media.getBookmarks, mockReq({ userId: saver }));
    expect(savedAfter.payload.posts.map((p) => p.id)).not.toContain(root.id);
  });

  test('repost toggle bumps repost_count and counters match row counts', async () => {
    const author = await poster();
    const fan = await poster();
    const root = await createPostAs(author, 'Matrix repost target');
    await call(media.toggleLike, mockReq({ userId: fan, params: { id: root.id } }));
    await call(media.toggleBookmark, mockReq({ userId: fan, params: { id: root.id } }));
    const r = await call(media.toggleRepost, mockReq({ userId: fan, params: { id: root.id } }));
    expect(r.payload.reposted).toBe(true);

    const { payload } = await call(media.getPost, mockReq({ params: { id: root.id } }));
    expect(payload.post.like_count).toBe(await tableCount('media_likes', root.id));
    expect(payload.post.bookmark_count).toBe(await tableCount('media_bookmarks', root.id));
    expect(payload.post.repost_count).toBe(await tableCount('media_reposts', root.id));
    expect(payload.post.like_count).toBe(1);
    expect(payload.post.repost_count).toBe(1);
  });

  test('shares and views record once per viewer', async () => {
    const author = await poster();
    const sharer = await poster();
    const root = await createPostAs(author, 'Matrix share target');
    // Signed-in viewers hash to `user:<id>`, so a repeat call is a no-op.
    let r = await call(media.recordShare, mockReq({ userId: sharer, params: { id: root.id } }));
    expect(r.payload.shared).toBe(true);
    expect(r.payload.share_count).toBe(1);
    r = await call(media.recordShare, mockReq({ userId: sharer, params: { id: root.id } }));
    expect(r.payload.shared).toBe(false);
    expect(r.payload.share_count).toBe(1);

    const v1 = await call(media.recordView, mockReq({ userId: sharer, params: { id: root.id } }));
    expect(v1.payload.recorded).toBe(true);
    const v2 = await call(media.recordView, mockReq({ userId: sharer, params: { id: root.id } }));
    expect(v2.payload.recorded).toBe(false);
    expect(await tableCount('media_shares', root.id)).toBe(1);
    expect(await tableCount('media_post_views', root.id)).toBe(1);
  });

  test('views matrix: feed, search, actor, detail, replies, quotes', async () => {
    const author = await poster();
    const engager = await poster();
    const unique = `zebracake-${crypto.randomUUID().slice(0, 8)}`;
    const root = await createPostAs(author, `Matrix views ${unique}`);
    await createPostAs(engager, 'Matrix views reply', { parent_id: root.id });
    await createPostAs(engager, 'Matrix views quote', { quoted_post_id: root.id });

    const feed = await call(media.getFeed, mockReq({ query: { tab: 'home', limit: '50' } }));
    expect(feed.payload.posts.map((p) => p.id)).toContain(root.id);

    const feedAuth = await call(
      media.getFeed,
      mockReq({ userId: engager, query: { tab: 'home', limit: '50' } })
    );
    expect(feedAuth.payload.posts.map((p) => p.id)).toContain(root.id);

    const search = await call(media.searchMedia, mockReq({ query: { q: unique } }));
    expect(search.payload.posts.map((p) => p.id)).toContain(root.id);

    const { rows: [actorRow] } = await pool.query(
      'SELECT handle FROM media_actors WHERE owner_user_id = $1 AND actor_type = $2 LIMIT 1',
      [author, 'helper']
    );
    const actor = await call(media.getActor, mockReq({ params: { handle: actorRow.handle } }));
    expect(actor.status).not.toBe(404);
    expect(actor.payload.actor.handle).toBe(actorRow.handle);

    const detail = await call(media.getPost, mockReq({ userId: engager, params: { id: root.id } }));
    expect(detail.payload.post.id).toBe(root.id);
    expect(detail.payload.post.owner_user_id).toBe(author);

    const replies = await call(media.getReplies, mockReq({ params: { id: root.id } }));
    expect(replies.payload.replies.length).toBe(1);
    expect(replies.payload.replies[0].parent_id).toBe(root.id);

    const quotes = await call(media.getQuotes, mockReq({ params: { id: root.id } }));
    expect(quotes.payload.quotes.length).toBe(1);
    expect(quotes.payload.quotes[0].quoted_post_id).toBe(root.id);
  });

  test('viewer state: liked, bookmarked, reposted reflect the signed-in viewer', async () => {
    const author = await poster();
    const fan = await poster();
    const root = await createPostAs(author, 'Matrix viewer state');
    await call(media.toggleLike, mockReq({ userId: fan, params: { id: root.id } }));
    await call(media.toggleBookmark, mockReq({ userId: fan, params: { id: root.id } }));
    await call(media.toggleRepost, mockReq({ userId: fan, params: { id: root.id } }));

    const asFan = await call(media.getPost, mockReq({ userId: fan, params: { id: root.id } }));
    expect(asFan.payload.post.liked).toBe(true);
    expect(asFan.payload.post.bookmarked).toBe(true);
    expect(asFan.payload.post.reposted).toBe(true);

    const asAuthor = await call(media.getPost, mockReq({ userId: author, params: { id: root.id } }));
    expect(asAuthor.payload.post.liked).toBe(false);
    expect(asAuthor.payload.post.bookmarked).toBe(false);
    expect(asAuthor.payload.post.reposted).toBe(false);
  });

  test('two-way blocking hides content in every view', async () => {
    const unique = `blockcake-${crypto.randomUUID().slice(0, 8)}`;
    const root = await createPostAs(alice, `Matrix block ${unique}`);
    await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [carol, alice]);

    const { rows: [actorRow] } = await pool.query(
      'SELECT handle FROM media_actors WHERE owner_user_id = $1 AND actor_type = $2 LIMIT 1',
      [alice, 'helper']
    );

    const feed = await call(
      media.getFeed,
      mockReq({ userId: carol, query: { tab: 'home', limit: '50' } })
    );
    expect(feed.payload.posts.map((p) => p.id)).not.toContain(root.id);

    const detail = await call(media.getPost, mockReq({ userId: carol, params: { id: root.id } }));
    expect(detail.status).toBe(404);

    const actor = await call(
      media.getActor,
      mockReq({ userId: carol, params: { handle: actorRow.handle } })
    );
    expect(actor.status).toBe(404);

    const search = await call(
      media.searchMedia,
      mockReq({ userId: carol, query: { q: unique } })
    );
    expect(search.payload.posts.map((p) => p.id)).not.toContain(root.id);

    const replies = await call(media.getReplies, mockReq({ userId: carol, params: { id: root.id } }));
    expect(replies.status).toBe(404);

    // The blocker still sees their own content; the blocked party is hidden
    // from the blocker, not the reverse.
    const asAlice = await call(media.getPost, mockReq({ userId: alice, params: { id: root.id } }));
    expect(asAlice.status).toBe(200);
  });

  test('reciprocal blocks hide both directions', async () => {
    const carolPost = await createPostAs(carol, 'Matrix reciprocal block post');
    await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [alice, carol]);

    const asAlice = await call(media.getPost, mockReq({ userId: alice, params: { id: carolPost.id } }));
    expect(asAlice.status).toBe(404);

    const feed = await call(
      media.getFeed,
      mockReq({ userId: alice, query: { tab: 'home', limit: '50' } })
    );
    expect(feed.payload.posts.map((p) => p.id)).not.toContain(carolPost.id);
  });

  test('blocked link targets render inert cards', async () => {
    // Alice posts with a helper link to Bob; the link resolves while unblocked.
    const { rows: [helper] } = await pool.query(
      'SELECT user_id FROM helper_profiles WHERE user_id = $1',
      [bob]
    );
    const linked = await createPostAs(alice, 'Matrix link post', {
      links: [{ link_type: 'helper', target_id: helper.user_id }],
    });
    const asAlice = await call(media.getPost, mockReq({ userId: alice, params: { id: linked.id } }));
    expect(asAlice.payload.post.links[0].available).toBe(true);
    expect(asAlice.payload.post.links[0].canonical_url).toBeTruthy();

    // After Alice blocks Bob, the same card is inert: no target, no URL.
    await pool.query(
      'INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [alice, bob]
    );
    const blocked = await call(media.getPost, mockReq({ userId: alice, params: { id: linked.id } }));
    expect(blocked.payload.post.links[0].available).toBe(false);
    expect(blocked.payload.post.links[0].canonical_url).toBeNull();
  });

  test('only the owner can edit; edits set edited_at', async () => {
    const root = await createPostAs(alice, 'Matrix edit target');
    const denied = await call(
      media.updatePost,
      mockReq({ userId: bob, params: { id: root.id }, body: { body: 'Bob hijacks' } })
    );
    expect(denied.status).toBe(404);

    const ok = await call(
      media.updatePost,
      mockReq({ userId: alice, params: { id: root.id }, body: { body: 'Alice edits' } })
    );
    expect(ok.status).toBe(200);
    expect(ok.payload.post.body).toBe('Alice edits');
    expect(ok.payload.post.edited_at).toBeTruthy();

    const { rows } = await pool.query('SELECT body FROM media_posts WHERE id = $1', [root.id]);
    expect(rows[0].body).toBe('Alice edits');
  });

  test('only the owner can delete; deletion is atomic with counter updates', async () => {
    const owner = await poster();
    const replier = await poster();
    const intruder = await poster();
    const root = await createPostAs(owner, 'Matrix delete parent');
    const reply = await createPostAs(replier, 'Matrix delete reply', { parent_id: root.id });
    const quote = await createPostAs(replier, 'Matrix delete quote', { quoted_post_id: root.id });

    const denied = await call(media.deletePost, mockReq({ userId: intruder, params: { id: reply.id } }));
    expect(denied.status).toBe(404);

    const ok = await call(media.deletePost, mockReq({ userId: replier, params: { id: reply.id } }));
    expect(ok.status).toBe(200);
    expect(ok.payload.deleted).toBe(true);

    const { rows } = await pool.query(
      'SELECT deleted_at, visibility, reply_count FROM media_posts WHERE id = $1',
      [root.id]
    );
    expect(rows[0].reply_count).toBe(0);

    const gone = await call(media.getPost, mockReq({ params: { id: reply.id } }));
    expect(gone.status).toBe(404);

    // Quote deletion decrements the quoted post counter atomically.
    await call(media.deletePost, mockReq({ userId: replier, params: { id: quote.id } }));
    const { rows: [after] } = await pool.query('SELECT quote_count FROM media_posts WHERE id = $1', [root.id]);
    expect(after.quote_count).toBe(0);
  });

  test('daily post quota returns 429 past the limit', async () => {
    const erin = await createUser('erin');
    for (let i = 0; i < 10; i++) {
      const { status } = await call(
        media.createPost,
        mockReq({ userId: erin, body: { body: `Matrix quota post ${i}` } })
      );
      expect(status).toBe(201);
    }
    const { status, payload } = await call(
      media.createPost,
      mockReq({ userId: erin, body: { body: 'Matrix quota post over' } })
    );
    expect(status).toBe(429);
    expect(payload.code).toBe('media_daily_post_limit');
  });

  test('quota race: concurrent posts past the limit yield exactly ten', async () => {
    const frank = await createUser('frank');
    const attempts = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        call(media.createPost, mockReq({ userId: frank, body: { body: `Matrix race ${i}` } }))
      )
    );
    const created = attempts.filter((a) => a.status === 201).length;
    const limited = attempts.filter((a) => a.status === 429).length;
    expect(created).toBe(10);
    expect(limited).toBe(5);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM media_posts p
        JOIN media_actors a ON a.id = p.actor_id
       WHERE a.owner_user_id = $1 AND p.created_at > NOW() - INTERVAL '1 day'`,
      [frank]
    );
    expect(rows[0].count).toBe(10);
  });

  test('report validation rejects bad reasons and long notes', async () => {
    const author = await poster();
    const reporter = await poster();
    const root = await createPostAs(author, 'Matrix report target');
    const badReason = await call(
      media.flagPost,
      mockReq({ userId: reporter, params: { id: root.id }, body: { reason: 'rude' } })
    );
    expect(badReason.status).toBe(400);
    expect(badReason.payload.code).toBe('media_report_reason_invalid');

    const longNote = await call(
      media.flagPost,
      mockReq({ userId: reporter, params: { id: root.id }, body: { reason: 'spam', note: 'x'.repeat(1001) } })
    );
    expect(longNote.status).toBe(400);
    expect(longNote.payload.code).toBe('media_report_note_too_long');
  });

  test('valid report inserts; duplicates get 409', async () => {
    const author = await poster();
    const reporter = await poster();
    const root = await createPostAs(author, 'Matrix duplicate report target');
    const first = await call(
      media.flagPost,
      mockReq({ userId: reporter, params: { id: root.id }, body: { reason: 'spam', note: 'Looks automated' } })
    );
    expect(first.status).toBe(201);

    const dup = await call(
      media.flagPost,
      mockReq({ userId: reporter, params: { id: root.id }, body: { reason: 'spam' } })
    );
    expect(dup.status).toBe(409);
    expect(dup.payload.code).toBe('media_report_exists');
  });

  test('report race: concurrent duplicates yield one insert', async () => {
    const author = await poster();
    const reporter = await poster();
    const root = await createPostAs(author, 'Matrix report race target');
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(media.flagPost, mockReq({ userId: reporter, params: { id: root.id }, body: { reason: 'spam' } }))
      )
    );
    expect(attempts.filter((a) => a.status === 201).length).toBe(1);
    expect(attempts.filter((a) => a.status === 409).length).toBe(4);
  });

  test('hourly report cap returns 429 at thirty-one', async () => {
    const grace = await createUser('grace');
    // Seed 31 reportable posts directly; the daily post quota is not the
    // subject of this test.
    const { rows: [actor] } = await pool.query(
      `INSERT INTO media_actors (actor_type, owner_user_id, handle, display_name, verified_kind)
       VALUES ('helper', $1, $2, 'Grace Matrix', 'identity') RETURNING id`,
      [grace, `grace-matrix-${grace.slice(0, 8)}`]
    );
    const targetIds = [];
    for (let i = 0; i < 31; i++) {
      const { rows: [post] } = await pool.query(
        `INSERT INTO media_posts (actor_id, body, visibility, processing_status)
         VALUES ($1, $2, 'public', 'ready') RETURNING id`,
        [actor.id, `Matrix report cap post ${i}`]
      );
      targetIds.push(post.id);
      postIds.push(post.id);
    }
    actorIds.push(actor.id);

    for (let i = 0; i < 30; i++) {
      const { status } = await call(
        media.flagPost,
        mockReq({ userId: grace, params: { id: targetIds[i] }, body: { reason: 'spam' } })
      );
      expect(status).toBe(201);
    }
    const capped = await call(
      media.flagPost,
      mockReq({ userId: grace, params: { id: targetIds[30] }, body: { reason: 'spam' } })
    );
    expect(capped.status).toBe(429);
    expect(capped.payload.code).toBe('media_report_limit_reached');
  });

  test('state is correct after reload: counts and viewer flags', async () => {
    const author = await poster();
    const replier = await poster();
    const likerA = await poster();
    const likerB = await poster();
    const root = await createPostAs(author, 'Matrix reload target');
    await createPostAs(replier, 'Matrix reload reply', { parent_id: root.id });
    await call(media.toggleLike, mockReq({ userId: likerA, params: { id: root.id } }));
    await call(media.toggleLike, mockReq({ userId: likerB, params: { id: root.id } }));
    await call(media.recordView, mockReq({ userId: dave, params: { id: root.id } }));

    // Fresh read as the post owner.
    const asOwner = await call(media.getPost, mockReq({ userId: author, params: { id: root.id } }));
    expect(asOwner.payload.post.like_count).toBe(2);
    expect(asOwner.payload.post.reply_count).toBe(1);
    expect(asOwner.payload.post.view_count).toBe(1);
    expect(asOwner.payload.post.liked).toBe(false);
    expect(asOwner.payload.post.owner_user_id).toBe(author);

    // Fresh read as an interacting viewer.
    const asViewer = await call(media.getPost, mockReq({ userId: likerA, params: { id: root.id } }));
    expect(asViewer.payload.post.liked).toBe(true);
    expect(asViewer.payload.post.like_count).toBe(2);

    const replies = await call(media.getReplies, mockReq({ userId: author, params: { id: root.id } }));
    expect(replies.payload.replies.length).toBe(1);
  });
});
