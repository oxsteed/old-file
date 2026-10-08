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
    await media.getFeed({ query: { limit: '2' }, user: { id: 'viewer-1' } }, first);

    const payload = first.json.mock.calls[0][0];
    expect(payload.posts.map((post) => post.id)).toEqual(['post-linked-nearby', 'post-plain-away']);
    expect(payload.has_more).toBe(true);
    expect(payload.next_before).toBeTruthy();

    const firstSql = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT p.*, a.handle'))[0];
    expect(firstSql).toContain('NOT EXISTS (');
    expect(firstSql).toContain('user_blocks');
    expect(firstSql).toContain('geo_scope');
    expect(firstSql).toContain('viewer_location.state');
    expect(firstSql).toContain('TRIM(split_part(nearby.geo_scope');
    expect(firstSql).not.toContain('j.deleted_at');
    expect(firstSql).toContain('ORDER BY link_count DESC, locality_boost DESC, p.created_at DESC, p.id DESC');

    pool.query.mockClear();
    const second = response();
    await media.getFeed({ query: { limit: '2', before: payload.next_before }, user: { id: 'viewer-1' } }, second);

    const secondCall = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT p.*, a.handle'));
    expect(secondCall[0]).toContain('HAVING (link_count <');
    expect(secondCall[1]).toEqual(expect.arrayContaining(['viewer-1', 2, 2, '2026-10-08T11:00:00.000Z', 'post-plain-away']));
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
    await media.getFeed({ query: { limit: '1' }, user: { id: 'viewer-1' } }, result);
    expect(result.status).not.toHaveBeenCalled();
    expect(result.json.mock.calls[0][0].posts[0]).toMatchObject({ id: 'fallback-post' });
  });

  test('keeps the feed readable when the active-author predicate is unavailable', async () => {
    pool.query
      .mockImplementationOnce(async () => { throw Object.assign(new Error('ranked query failed'), { code: '42703' }); })
      .mockImplementationOnce(async () => { throw Object.assign(new Error('users.is_banned missing'), { code: '42703' }); })
      .mockImplementationOnce(async (sql) => {
        if (sql.includes('0::bigint AS link_count')) return { rows: [{
          id: 'minimal-post', created_at: '2026-10-08T09:00:00.000Z', actor_id: 'actor-1',
          handle: 'local-one', display_name: 'Local One', link_count: '0', locality_boost: '0',
        }] };
        return { rows: [] };
      });
    const result = response();
    await media.getFeed({ query: { limit: '1' }, user: { id: 'viewer-1' } }, result);
    expect(result.status).not.toHaveBeenCalled();
    expect(result.json.mock.calls[0][0].posts[0]).toMatchObject({ id: 'minimal-post' });
  });
});
