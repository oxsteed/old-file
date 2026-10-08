'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({ getSignedDownloadUrl: jest.fn(async (key) => `/signed/${key}`) }));

const pool = require('../db');
const media = require('../controllers/mediaController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('Media ranked feed journey', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.*, a.handle')) {
        return {
          rows: [
            {
              id: 'post-linked-nearby', created_at: '2026-10-08T12:00:00.000Z',
              actor_id: 'actor-1', handle: 'local-one', display_name: 'Local One',
              link_count: '2', locality_boost: '2',
            },
            {
              id: 'post-plain-away', created_at: '2026-10-08T11:00:00.000Z',
              actor_id: 'actor-2', handle: 'local-two', display_name: 'Local Two',
              link_count: '0', locality_boost: '0',
            },
            {
              id: 'post-third', created_at: '2026-10-08T10:00:00.000Z',
              actor_id: 'actor-3', handle: 'local-three', display_name: 'Local Three',
              link_count: '0', locality_boost: '0',
            },
          ],
        };
      }
      if (sql.includes('media_post_links')) return { rows: [] };
      if (sql.includes('media_post_assets')) return { rows: [] };
      if (sql.includes('media_likes') || sql.includes('media_bookmarks') || sql.includes('media_reposts')) return { rows: [] };
      return { rows: [] };
    });
  });

  test('returns ranked posts with a cursor that preserves link and locality order', async () => {
    const first = response();
    await media.getFeed({ query: { limit: '2', city: 'Springfield', state: 'OH' }, user: { id: 'viewer-1' } }, first);

    const payload = first.json.mock.calls[0][0];
    expect(payload.posts.map((post) => post.id)).toEqual(['post-linked-nearby', 'post-plain-away']);
    expect(payload.has_more).toBe(true);
    expect(payload.next_before).toBeTruthy();

    const firstSql = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT p.*, a.handle'))[0];
    expect(firstSql).toContain('NOT EXISTS (');
    expect(firstSql).toContain('user_blocks');
    expect(firstSql).toContain('geo_scope');
    expect(firstSql).toContain('hp.service_lat');
    expect(firstSql).toContain('r.latitude');
    expect(firstSql).toContain('j.location_approx_lat');
    expect(firstSql).toContain('TRIM(split_part(nearby.geo_scope');
    expect(firstSql).not.toContain('j.deleted_at');
    expect(firstSql).toContain('ORDER BY locality_boost DESC, link_count DESC, ranked.created_at DESC, ranked.id DESC');

    pool.query.mockClear();
    const second = response();
    await media.getFeed({ query: { limit: '2', city: 'Springfield', state: 'OH', before: payload.next_before }, user: { id: 'viewer-1' } }, second);

    const secondCall = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT p.*, a.handle'));
    expect(secondCall[0]).toContain('WHERE (locality_boost <');
    expect(secondCall[1]).toEqual(expect.arrayContaining([3, 'viewer-1', 0, 0, '2026-10-08T11:00:00.000Z', 'post-plain-away']));
  });

  test('does not advertise another page when the result ends on a full page', async () => {
    pool.query.mockReset().mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.*, a.handle')) {
        return { rows: [{
          id: 'only-post', created_at: '2026-10-08T12:00:00.000Z', actor_id: 'actor-1',
          handle: 'local-one', display_name: 'Local One', link_count: '0', locality_boost: '0',
        }] };
      }
      return { rows: [] };
    });
    const result = response();
    await media.getFeed({ query: { limit: '1', location_mode: 'all' }, user: { id: 'viewer-1' } }, result);

    expect(result.json.mock.calls[0][0]).toMatchObject({ posts: [{ id: 'only-post' }], has_more: false, next_before: null });
    const feedCall = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT p.*, a.handle'));
    expect(feedCall[1][0]).toBe(2);
  });

  test('falls back to a read-only chronological feed during an optional schema rollout', async () => {
    const ranked = pool.query.mockImplementationOnce(async () => {
      const error = new Error('column jobs.deleted_at does not exist');
      error.code = '42703';
      throw error;
    });
    expect(ranked).toBeTruthy();
    const fallbackPost = {
      id: 'fallback-post', created_at: '2026-10-08T10:00:00.000Z', actor_id: 'actor-1',
      handle: 'local-one', display_name: 'Local One', link_count: '0', locality_boost: '0',
    };
    pool.query.mockImplementationOnce(async (sql) => {
      if (sql.includes('0::bigint AS link_count')) return { rows: [fallbackPost] };
      return { rows: [] };
    });
    const result = response();
    await media.getFeed({ query: { limit: '1', location_mode: 'all' }, user: { id: 'viewer-1' } }, result);
    expect(result.status).not.toHaveBeenCalled();
    expect(result.json.mock.calls[0][0].posts[0]).toMatchObject({ id: 'fallback-post' });
  });

  test('fails closed when the active-author predicate is unavailable', async () => {
    pool.query
      .mockImplementationOnce(async () => { throw Object.assign(new Error('ranked query failed'), { code: '42703' }); })
      .mockImplementationOnce(async () => { throw Object.assign(new Error('users.is_banned missing'), { code: '42703' }); });
    const result = response();
    await media.getFeed({ query: { limit: '1', location_mode: 'all' }, user: { id: 'viewer-1' } }, result);
    expect(result.status).toHaveBeenCalledWith(500);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(result.json.mock.calls[0][0].posts).toBeUndefined();
  });

  test('never silently changes ranking after a ranked page cursor', async () => {
    const contexts = require('../services/mediaFeedContext');
    const cursor = contexts.encodeCursor({ id: 'post', created_at: '2026-10-08T10:00:00.000Z', link_count: 1, locality_boost: 2 },
      contexts.contextKey('home', 'viewer', { city: '', state: '', latitude: null, longitude: null }), 'ranked', '2026-10-08T11:00:00.000Z');
    pool.query.mockImplementationOnce(async () => { throw Object.assign(new Error('optional column missing'), { code: '42703' }); });
    const result = response();
    await media.getFeed({ query: { before: cursor, location_mode: 'all' }, user: { id: 'viewer' } }, result);
    expect(result.status).toHaveBeenCalledWith(500);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('the cursor retains database timestamp precision beyond JavaScript milliseconds', async () => {
    pool.query.mockImplementationOnce(async () => ({ rows: [
      { id: 'precise', created_at: new Date('2026-10-08T12:00:00.123Z'),
        cursor_created_at: '2026-10-08T12:00:00.123456Z', link_count: 0, locality_boost: 0 },
      { id: 'next', created_at: new Date('2026-10-08T12:00:00.123Z'),
        cursor_created_at: '2026-10-08T12:00:00.123455Z', link_count: 0, locality_boost: 0 },
    ] }));
    const result = response();
    await media.getFeed({ query: { limit: '1', location_mode: 'all' } }, result);
    const payload = result.json.mock.calls[0][0];
    expect(JSON.parse(Buffer.from(payload.next_before, 'base64url').toString()).created_at)
      .toBe('2026-10-08T12:00:00.123456Z');
  });

  test('a chronological rollout page retains its mode and cutoff even after schema recovery', async () => {
    const contexts = require('../services/mediaFeedContext');
    const cutoff = '2026-10-08T13:00:00.000Z';
    const cursor = contexts.encodeCursor({ id: 'fallback-post', created_at: '2026-10-08T12:00:00.123456Z' },
      contexts.contextKey('home', null, { city: '', state: '', latitude: null, longitude: null }), 'chronological', cutoff);
    const result = response();
    await media.getFeed({ query: { before: cursor, location_mode: 'all' } }, result);
    expect(result.status).not.toHaveBeenCalled();
    const [sql, parameters] = pool.query.mock.calls[0];
    expect(sql).toContain('0::bigint AS link_count');
    expect(sql).toContain('p.created_at <= $2::timestamptz');
    expect(parameters).toEqual(expect.arrayContaining([cutoff, '2026-10-08T12:00:00.123456Z', 'fallback-post']));
    expect(sql).toContain('au.is_banned = FALSE');
    expect(sql).toContain('safety_asset');
  });

  test('invalid or changed-context cursors return a recoverable error before selecting posts', async () => {
    const first = response(); await media.getFeed({ query: { limit: '1' } }, first);
    const cursor = first.json.mock.calls[0][0].next_before;
    pool.query.mockClear();
    for (const query of [{ before: cursor, city: 'Springfield', state: 'OH' }, { before: 'bad-cursor' }]) {
      const result = response(); await media.getFeed({ query }, result);
      expect(result.status).toHaveBeenCalledWith(400);
      expect(result.json.mock.calls[0][0].code).toBe('media_feed_cursor_invalid');
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
});
