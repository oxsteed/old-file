'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));

const pool = require('../db');
const media = require('../controllers/mediaController');
const assets = require('../controllers/mediaAssetController');

function resMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('OxSteed Media launch contracts', () => {
  beforeEach(() => pool.query.mockReset());

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
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ like_count: 9 }] })
      .mockResolvedValueOnce({ rows: [] });
    const likeRes = resMock();
    await media.toggleLike({ params: { id: 'post-1' }, user: { id: 'user-1' } }, likeRes);
    expect(likeRes.json).toHaveBeenCalledWith({ liked: true, like_count: 9 });

    pool.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ bookmark_count: 4 }] });
    const bookmarkRes = resMock();
    await media.toggleBookmark({ params: { id: 'post-1' }, user: { id: 'user-1' } }, bookmarkRes);
    expect(bookmarkRes.json).toHaveBeenCalledWith({ bookmarked: true, bookmark_count: 4 });

    pool.query.mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1', verified_kind: 'helper' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ repost_count: 3 }] });
    const repostRes = resMock();
    await media.toggleRepost({ params: { id: 'post-1' }, user: { id: 'user-1' } }, repostRes);
    expect(repostRes.json).toHaveBeenCalledWith({ reposted: true, repost_count: 3 });
  });

  test('records a share once and returns the authoritative share count', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [{ post_id: 'post-1' }] })
      .mockResolvedValueOnce({ rows: [{ share_count: 6 }] });
    const res = resMock();

    await media.recordShare({ params: { id: 'post-1' }, user: { id: 'user-1' }, ip: '127.0.0.1', headers: {} }, res);

    expect(res.json).toHaveBeenCalledWith({ shared: true, share_count: 6 });
    expect(pool.query.mock.calls[1][0]).toContain('ON CONFLICT (post_id, viewer_hash) DO NOTHING');
    expect(pool.query.mock.calls[2][0]).toContain('share_count = share_count + CASE');
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

  test('does not let a user attach a photo to someone else\'s post', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await assets.photoUpload({
      user: { id: 'user-2' },
      body: { post_id: 'post-1', storage_key: 'uploads/photo.jpg' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_post_forbidden' }));
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('only increments a view counter when the unique view insert succeeds', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ post_id: 'post-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const first = resMock();
    await media.recordView({ params: { id: 'post-1' }, ip: '127.0.0.1', headers: {} }, first);
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls[2][0]).toMatch(/view_count = view_count \+ 1/);
    expect(first.json).toHaveBeenCalledWith({ ok: true, recorded: true });

    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const duplicate = resMock();
    await media.recordView({ params: { id: 'post-1' }, ip: '127.0.0.1', headers: {} }, duplicate);
    expect(pool.query).toHaveBeenCalledTimes(2);
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
});
