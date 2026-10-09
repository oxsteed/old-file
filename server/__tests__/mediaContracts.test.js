'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({
  getSignedDownloadUrl: jest.fn(async (key) => `/signed/${key}`),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
}));

const pool = require('../db');
const media = require('../controllers/mediaController');
const assets = require('../controllers/mediaAssetController');

function resMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

describe('OxSteed Media launch contracts', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.connect = jest.fn();
  });

  test('keeps a draft private when an uploaded video is still awaiting safety processing', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'draft-1', visibility: 'unlisted', processing_status: 'draft', csam_status: 'passed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1', asset_type: 'video', processing_status: 'quarantine', csam_status: 'pending', renditions: {} }] })
      .mockResolvedValueOnce({});
    const res = resMock();

    await media.publishPost({ params: { id: 'draft-1' }, user: { id: 'user-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'media_safety_pending',
      retryable: true,
      processing_status: 'draft',
      csam_status: 'passed',
      assets: [expect.objectContaining({ id: 'asset-1', ready: false })],
    }));
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  test('serves a stable guest share-image URL only for safety-cleared thumbnails', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ thumbnail_key: 'media/photos/thumb.jpg' }] });
    const res = resMock();

    await media.getShareImage({ params: { id: 'post-1' } }, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60, s-maxage=300');
    expect(res.redirect).toHaveBeenCalledWith(302, '/signed/media/photos/thumb.jpg');
    expect(pool.query.mock.calls[0][0]).toContain('safety_asset');
  });

  test('rechecks the current poster verification before publishing an old draft', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'draft-2', visibility: 'unlisted', processing_status: 'draft', csam_status: 'passed', current_actor_verified: false }] })
      .mockResolvedValueOnce({});
    const res = resMock();

    await media.publishPost({ params: { id: 'draft-2' }, user: { id: 'user-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_not_verified_poster' }));
    expect(client.query.mock.calls[1][0]).toMatch(/current_actor_verified/);
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  test('keeps quarantined drafts discoverable for a later retry', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('p.visibility = \'unlisted\'')) {
        return { rows: [{ id: 'draft-3', visibility: 'unlisted', processing_status: 'quarantine', csam_status: 'pending', owner_user_id: 'user-1' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = resMock();

    await media.getDrafts({ user: { id: 'user-1' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ drafts: [expect.objectContaining({ id: 'draft-3', processing_status: 'quarantine' })] }));
    expect(pool.query.mock.calls[0][0]).toMatch(/processing_status IN \('draft', 'quarantine', 'failed', 'blocked', 'ready'\)/);
  });

  test('persists owner edits to a private draft before a retry', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'draft-4', visibility: 'unlisted', processing_status: 'failed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'space-1' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Local Cafe' }] }) // authoritative linked restaurant
      .mockResolvedValueOnce({ rows: [{ id: 'draft-4', body: 'Updated copy', visibility: 'unlisted', processing_status: 'failed' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM media_posts p JOIN media_actors')) {
        return { rows: [{ id: 'draft-4', body: 'Updated copy', visibility: 'unlisted', processing_status: 'failed' }] };
      }
      if (sql.includes('FROM media_post_links')) return { rows: [] };
      if (sql.includes('FROM media_post_assets')) return { rows: [] };
      return { rows: [] };
    });
    const res = resMock();

    await media.updateDraft({
      params: { id: 'draft-4' },
      user: { id: 'user-1' },
      body: {
        body: 'Updated copy',
        community_id: 'space-1',
        links: [{ link_type: 'restaurant', target_id: '7', name_snapshot: 'Local Cafe' }],
      },
    }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ draft: true }));
    expect(client.query.mock.calls.some(([sql]) => sql.includes('a.owner_user_id = $2'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM media_post_links'))).toBe(true);
  });

  test('rejects an unavailable linked target before replacing draft cards', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'draft-invalid-link', visibility: 'unlisted', processing_status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    const res = resMock();

    await media.updateDraft({
      params: { id: 'draft-invalid-link' },
      user: { id: 'user-1' },
      body: { body: 'Keep this draft', links: [{ link_type: 'restaurant', target_id: 'removed-restaurant' }] },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_link_target_unavailable' }));
    expect(client.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM media_post_links'))).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  test('supports Relevant reply ranking without a deployment flag', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await media.getReplies({ params: { id: 'post-1' }, query: { sort: 'relevant' }, user: null }, res);

    expect(res.json).toHaveBeenCalledWith({ replies: [], sort: 'relevant' });
    expect(pool.query.mock.calls[1][0]).toContain('ORDER BY (p.like_count * 3');
  });

  test('returns authoritative action counts for live card reconciliation', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // visiblePost
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 }) // insert like
      .mockResolvedValueOnce({ rows: [{ like_count: 9 }] })
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [] }); // owner lookup
    const likeRes = resMock();
    await media.toggleLike({ params: { id: 'post-1' }, user: { id: 'user-1' } }, likeRes);
    expect(likeRes.json).toHaveBeenCalledWith({ liked: true, like_count: 9 });

    pool.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // visiblePost
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 }) // insert bookmark
      .mockResolvedValueOnce({ rows: [{ bookmark_count: 4 }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const bookmarkRes = resMock();
    await media.toggleBookmark({ params: { id: 'post-1' }, user: { id: 'user-1' } }, bookmarkRes);
    expect(bookmarkRes.json).toHaveBeenCalledWith({ bookmarked: true, bookmark_count: 4 });

    pool.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1', actor_type: 'helper', verified_kind: 'identity' }] })
      .mockResolvedValueOnce({ rows: [{ found: 1 }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 }) // insert repost
      .mockResolvedValueOnce({ rows: [{ repost_count: 3 }] });
    pool.query.mockResolvedValueOnce({ rows: [] }); // COMMIT
    const repostRes = resMock();
    await media.toggleRepost({ params: { id: 'post-1' }, user: { id: 'user-1' } }, repostRes);
    expect(repostRes.json).toHaveBeenCalledWith({ reposted: true, repost_count: 3 });
  });

  test('does not display a stale verified badge after actor verification is revoked', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM media_posts p')) return { rows: [] };
      if (sql.includes('FROM media_actors')) return {
        rows: [{ id: 'actor-1', actor_type: 'helper', handle: 'helper-1', display_name: 'Helper One', verified_kind: 'identity', current_actor_verified: false }],
      };
      return { rows: [] };
    });
    const searchRes = resMock();
    await media.searchMedia({ query: { q: 'helper' } }, searchRes);
    expect(searchRes.json).toHaveBeenCalledWith(expect.objectContaining({
      actors: [expect.objectContaining({ id: 'actor-1', verified_kind: 'none' })],
    }));
    expect(pool.query.mock.calls.find(([sql]) => sql.includes('current_actor_verified'))[0]).toContain('current_actor_verified');

    pool.query.mockReset().mockImplementation(async (sql) => {
      if (sql.includes('SELECT a.*')) return {
        rows: [{ id: 'actor-1', actor_type: 'helper', handle: 'helper-1', display_name: 'Helper One', verified_kind: 'identity', current_actor_verified: false }],
      };
      return { rows: [] };
    });
    const actorRes = resMock();
    await media.getActor({ params: { handle: 'helper-1' } }, actorRes);
    expect(actorRes.json).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ id: 'actor-1', verified_kind: 'none' }),
    }));
  });

  test('recomputes the count when a concurrent-safe toggle removes an action', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    pool.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'post-2' }] }) // visiblePost
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-2' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // insert conflict
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // remove existing action
      .mockResolvedValueOnce({ rows: [{ like_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [] }); // owner lookup
    const res = resMock();

    await media.toggleLike({ params: { id: 'post-2' }, user: { id: 'user-2' } }, res);

    expect(res.json).toHaveBeenCalledWith({ liked: false, like_count: 0 });
    expect(pool.query.mock.calls.some(([sql]) => /ON CONFLICT \(post_id, user_id\) DO NOTHING/.test(sql))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => /SELECT COUNT\(\*\)::int FROM media_likes/.test(sql))).toBe(true);
  });

  test('records a share once and returns the authoritative share count', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [{}] }) // insert share
      .mockResolvedValueOnce({ rows: [{ share_count: 6 }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const res = resMock();

    await media.recordShare({ params: { id: 'post-1' }, user: { id: 'user-1' }, ip: '127.0.0.1', headers: {} }, res);

    expect(res.json).toHaveBeenCalledWith({ shared: true, share_count: 6 });
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('ON CONFLICT (post_id, viewer_hash) DO NOTHING'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('SELECT COUNT(*)::int FROM media_shares'))).toBe(true);

    pool.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [] }) // duplicate share
      .mockResolvedValueOnce({ rows: [{ share_count: 6 }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const duplicateRes = resMock();
    await media.recordShare({ params: { id: 'post-1' }, user: { id: 'user-1' }, ip: '127.0.0.1', headers: {} }, duplicateRes);
    expect(duplicateRes.json).toHaveBeenCalledWith({ shared: false, share_count: 6 });
  });

  test('requires a verified business before creating a business post', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = resMock();
    await media.createPost({
      user: { id: 'user-1' },
      body: { business_id: '12', body: 'A local update' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query.mock.calls[0][0]).toMatch(/is_business_verified\s*=\s*TRUE/);
  });

  test('casts nullable draft reply parameters for PostgreSQL type inference', async () => {
    const actor = {
      id: 'actor-1', owner_user_id: 'helper-1', actor_type: 'helper', verified_kind: 'identity',
      handle: 'helper-1', display_name: 'Helper One', avatar_url: null,
    };
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM media_actors WHERE owner_user_id')) return { rows: [actor] };
      if (sql.includes('helper_profiles hp JOIN users u')) return { rows: [{ id: 'helper-1' }] };
      if (sql.includes('COUNT(*) AS c')) return { rows: [{ c: '0' }] };
      if (sql.includes('INSERT INTO media_posts')) return { rows: [{
        id: 'post-1', actor_id: actor.id, body: 'Draft body', visibility: 'unlisted', processing_status: 'draft',
      }] };
      return { rows: [] };
    });
    const res = resMock();

    await media.createPost({
      user: { id: 'helper-1' },
      body: { body: 'Draft body', draft: true },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO media_posts'));
    expect(insert[0]).toContain('CASE WHEN $3::uuid IS NOT NULL');
    expect(insert[0]).toContain('pg_advisory_xact_lock');
    expect(insert[0]).toContain('media_post_quota.count < $7');
    expect(insert[1][6]).toBe(10);
  });

  test('returns the daily quota error when the guarded post insert has no row', async () => {
    const actor = {
      id: 'actor-1', owner_user_id: 'helper-1', actor_type: 'helper', verified_kind: 'identity',
      handle: 'helper-1', display_name: 'Helper One', avatar_url: null,
    };
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM media_actors WHERE owner_user_id')) return { rows: [actor] };
      if (sql.includes('helper_profiles hp JOIN users u')) return { rows: [{ id: 'helper-1' }] };
      if (sql.includes('INSERT INTO media_posts')) return { rows: [] };
      return { rows: [] };
    });
    const res = resMock();

    await media.createPost({ user: { id: 'helper-1' }, body: { body: 'At capacity' } }, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'Daily post limit reached', code: 'media_daily_post_limit' });
  });

  test('does not let a user attach a photo to someone else\'s post', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await assets.uploadPhoto({
      user: { id: 'user-2' },
      body: { post_id: 'post-1' },
      file: { buffer: Buffer.from('synthetic photo') },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_post_forbidden' }));
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('only increments a view counter when the unique view insert succeeds', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 }) // insert view
      .mockResolvedValueOnce({ rows: [{ view_count: 1 }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const first = resMock();
    await media.recordView({ params: { id: 'post-1' }, ip: '127.0.0.1', headers: {} }, first);
    expect(first.json).toHaveBeenCalledWith({ ok: true, recorded: true, view_count: 1 });

    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // locked public post
      .mockResolvedValueOnce({ rows: [] }) // duplicate view
      .mockResolvedValueOnce({ rows: [{ view_count: 1 }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const duplicate = resMock();
    await media.recordView({ params: { id: 'post-1' }, ip: '127.0.0.1', headers: {} }, duplicate);
    expect(pool.query).toHaveBeenCalledTimes(6);
    expect(duplicate.json).toHaveBeenCalledWith({ ok: true, recorded: false });
  });

  test('searches only public launch entity types for the compose picker', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ target_id: '7', name: 'Local Cafe', price_snapshot_cents: null }] });
    const res = resMock();
    await media.searchMediaEntities({ query: { type: 'restaurant', q: 'cafe', limit: '8' } }, res);
    expect(pool.query.mock.calls[0][0]).toMatch(/food_restaurants/);
    expect(res.json).toHaveBeenCalledWith({
      entities: [{ target_id: '7', name: 'Local Cafe', price_snapshot_cents: null, link_type: 'restaurant', label: 'Local Cafe' }],
    });
  });

  test('searches v2 tool rental entities for the combined Media rollout', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ target_id: '12', name: 'Cordless saw', price_snapshot_cents: 2500 }] });
    const res = resMock();
    await media.searchMediaEntities({ query: { type: 'tool_rental', q: 'saw' } }, res);
    expect(pool.query.mock.calls[0][0]).toMatch(/tool_rentals/);
    expect(res.json).toHaveBeenCalledWith({
      entities: [{ target_id: '12', name: 'Cordless saw', price_snapshot_cents: 2500, link_type: 'tool_rental', label: 'Cordless saw' }],
    });
  });

  test('entity search applies two-way owner blocking before returning link targets', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = resMock();
    await media.searchMediaEntities({
      query: { type: 'helper', q: 'local', limit: '8' },
      user: { id: 'viewer-1' },
    }, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('user_blocks');
    expect(sql).toContain('$3::text');
    expect(sql).toContain('helper_profiles');
    expect(sql).toContain('u.is_active = TRUE');
    expect(params).toEqual(['%local%', 8, 'viewer-1']);
    expect(res.json).toHaveBeenCalledWith({ entities: [] });
  });

  test('keeps an unavailable dish link as a snapshot instead of a live action card', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.*, a.handle')) {
        return { rows: [{ id: 'post-dish', visibility: 'public', processing_status: 'ready',
          display_name: 'Local restaurant', owner_user_id: 'owner-1' }] };
      }
      if (sql.includes('FROM media_post_links')) {
        return { rows: [{ id: 'link-dish', link_type: 'food_item', target_id: '7:42',
          name_snapshot: 'Special of the day', price_snapshot_cents: 1200 }] };
      }
      if (sql.includes('FROM media_post_assets')) return { rows: [] };
      if (sql.includes('FROM food_menu_items i')) {
        expect(sql).toContain('i.is_available = TRUE');
        expect(sql).toContain('food_item_target_owner.is_active = TRUE');
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = resMock();

    await media.getPost({ params: { id: 'post-dish' }, user: null }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      post: expect.objectContaining({
        links: [expect.objectContaining({
          name: 'Special of the day', available: false, canonical_url: null,
        })],
      }),
    }));
  });

  test('hides linked entity cards owned by a blocked user while keeping the snapshot', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.*, a.handle')) {
        return { rows: [{ id: 'post-helper-link', visibility: 'public', processing_status: 'ready',
          display_name: 'Local business', owner_user_id: 'owner-1' }] };
      }
      if (sql.includes('FROM media_post_links')) {
        return { rows: [{ id: 'link-helper', link_type: 'helper', target_id: 'helper-outbound',
          name_snapshot: 'Blocked helper', price_snapshot_cents: null }] };
      }
      if (sql.includes('helper_profiles hp JOIN users u')) {
        expect(sql).toContain('user_blocks');
        expect(sql).toContain('$2::text');
        expect(sql).toContain('u.is_active = TRUE');
        expect(sql).toContain('u.is_banned = FALSE');
        return { rows: [] };
      }
      if (sql.includes('FROM media_post_assets')) return { rows: [] };
      return { rows: [] };
    });
    const res = resMock();

    await media.getPost({ params: { id: 'post-helper-link' }, user: { id: 'viewer-1' } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      post: expect.objectContaining({
        links: [expect.objectContaining({
          name: 'Blocked helper', available: false, canonical_url: null,
        })],
      }),
    }));
  });

  test('logistics cards require both active organizer and business owners', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.*, a.handle')) {
        return { rows: [{ id: 'post-logistics-link', visibility: 'public', processing_status: 'ready',
          display_name: 'Local business', owner_user_id: 'owner-1' }] };
      }
      if (sql.includes('FROM media_post_links')) {
        return { rows: [{ id: 'link-logistics', link_type: 'logistics_campaign', target_id: 'campaign-1',
          name_snapshot: 'Springfield delivery', price_snapshot_cents: 1000 }] };
      }
      if (sql.includes('FROM pooled_orders po')) {
        expect(sql).toContain('JOIN businesses b');
        expect(sql).toContain('logistics_business_target_owner.is_active = TRUE');
        expect(sql).toContain('user_blocks');
        return { rows: [] };
      }
      if (sql.includes('FROM media_post_assets')) return { rows: [] };
      return { rows: [] };
    });
    const res = resMock();

    await media.getPost({ params: { id: 'post-logistics-link' }, user: { id: 'viewer-1' } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      post: expect.objectContaining({
        links: [expect.objectContaining({ name: 'Springfield delivery', available: false, canonical_url: null })],
      }),
    }));
  });

  test('rejects arbitrary Media report reasons before creating a moderation row', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'post-report' }] });
    const res = resMock();

    await media.flagPost({
      params: { id: 'post-report' },
      user: { id: 'reporter-1' },
      body: { reason: 'invented-reason' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_report_reason_invalid' }));
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('normalizes valid report input and bounds moderation notes', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-report' }] }) // visiblePost
      .mockResolvedValueOnce({}) // begin
      .mockResolvedValueOnce({}) // reporter advisory lock
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // hourly limit
      .mockResolvedValueOnce({ rows: [] }) // duplicate report
      .mockResolvedValueOnce({ rows: [{ id: 'flag-1' }] }) // insert
      .mockResolvedValueOnce({}); // commit
    const res = resMock();

    await media.flagPost({
      params: { id: 'post-report' },
      user: { id: 'reporter-1' },
      body: { reason: '  COPYRIGHT ', note: '  This is my original work.  ' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO media_post_flags'));
    expect(insert[1]).toEqual(['post-report', 'reporter-1', 'copyright', 'This is my original work.']);

    pool.query.mockReset().mockResolvedValueOnce({ rows: [{ id: 'post-report' }] });
    const tooLong = resMock();
    await media.flagPost({
      params: { id: 'post-report' },
      user: { id: 'reporter-1' },
      body: { reason: 'spam', note: 'x'.repeat(1001) },
    }, tooLong);
    expect(tooLong.status).toHaveBeenCalledWith(400);
    expect(tooLong.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_report_note_too_long' }));
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('serializes duplicate reports and returns a stable conflict', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-report' }] }) // visiblePost
      .mockResolvedValueOnce({}) // begin
      .mockResolvedValueOnce({}) // reporter advisory lock
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // hourly limit
      .mockResolvedValueOnce({ rows: [{ found: 1 }] }) // duplicate report
      .mockResolvedValueOnce({}); // rollback
    const res = resMock();

    await media.flagPost({
      params: { id: 'post-report' },
      user: { id: 'reporter-1' },
      body: { reason: 'spam' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_report_exists' }));
    expect(client.release).toHaveBeenCalled();
  });

  test('enforces the hourly report cap before inserting', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-report' }] }) // visiblePost
      .mockResolvedValueOnce({}) // begin
      .mockResolvedValueOnce({}) // reporter advisory lock
      .mockResolvedValueOnce({ rows: [{ count: 30 }] }) // hourly limit
      .mockResolvedValueOnce({}); // rollback
    const res = resMock();

    await media.flagPost({
      params: { id: 'post-report' },
      user: { id: 'reporter-1' },
      body: { reason: 'spam' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_report_limit_reached' }));
    expect(client.release).toHaveBeenCalled();
  });

  test('deletes an owned post and refreshes reply and quote counts atomically', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({}) // begin
      .mockResolvedValueOnce({ rows: [{ id: 'post-1', parent_id: 'parent-1', quoted_post_id: 'quoted-1' }] })
      .mockResolvedValueOnce({ rows: [{ reply_count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ quote_count: 3 }] })
      .mockResolvedValueOnce({}); // commit
    const res = resMock();

    await media.deletePost({ params: { id: 'post-1' }, user: { id: 'owner-1' } }, res);

    expect(res.json).toHaveBeenCalledWith({ deleted: true, id: 'post-1' });
    expect(pool.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  test('does not delete a post owned by another user', async () => {
    const client = { query: (...args) => pool.query(...args), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    pool.query
      .mockResolvedValueOnce({}) // begin
      .mockResolvedValueOnce({ rows: [] }) // owner-scoped update
      .mockResolvedValueOnce({}); // rollback
    const res = resMock();

    await media.deletePost({ params: { id: 'post-1' }, user: { id: 'other-user' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_post_not_found' }));
    expect(pool.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});
