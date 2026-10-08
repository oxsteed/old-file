'use strict';
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require('../db');
const media = require('../controllers/mediaController');
beforeEach(() => pool.query.mockReset().mockResolvedValue({ rows: [] }));

test('a previous unverified reply actor does not strand a newly verified helper', async () => {
  pool.query.mockImplementation(async sql => {
    if (sql.includes('SELECT * FROM media_actors')) return { rows: [{ id: 'reply', actor_type: 'user', verified_kind: 'none' }] };
    if (sql.includes('SELECT hp.id')) return { rows: [{ id: 9, profile_slug: 'existing-slug', is_verified: true, first_name: 'Synthetic', last_name: 'Helper' }] };
    if (sql.includes('INSERT INTO media_actors')) return { rows: [{ id: 'helper', actor_type: 'helper', verified_kind: 'identity' }] };
    return { rows: [] };
  });
  expect(await media.getOrCreateActor('owner')).toMatchObject({ actor_type: 'helper', verified_kind: 'identity' });
  expect(pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO media_actors'))[1][2]).toBe('existing-slug');
});

test('a business actor checks its own entity before considering another verified profile', async () => {
  pool.query.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT * FROM media_actors')) return { rows: [{ id: 'business', actor_type: 'business', business_id: 17 }] };
    if (sql.includes('SELECT 1 FROM businesses')) {
      expect(params).toEqual(['owner', 17]);
      expect(sql).toContain('id = $2');
      return { rows: [] };
    }
    return { rows: [] };
  });
  expect(await media.getOrCreateActor('owner')).toBeNull();
});

test('actor recognition reconciles a badge after identity approval', async () => {
  pool.query.mockImplementation(async sql => {
    if (sql.includes('SELECT * FROM media_actors')) return { rows: [{ id: 'helper', actor_type: 'helper', verified_kind: 'none' }] };
    if (sql.includes('SELECT 1 FROM helper_profiles')) return { rows: [{ found: true }] };
    return { rows: [] };
  });
  expect((await media.getOrCreateActor('owner')).verified_kind).toBe('identity');
  expect(pool.query).toHaveBeenCalledWith('UPDATE media_actors SET verified_kind=$2,updated_at=NOW() WHERE id=$1', ['helper', 'identity']);
});

test('new restaurant actors retain the existing restaurant slug and entity IDs', async () => {
  pool.query.mockImplementation(async sql => {
    if (sql.includes('SELECT r.id')) return { rows: [{ id: 28, business_id: 18, slug: 'existing-restaurant', display_name: 'Synthetic restaurant', is_verified: true }] };
    if (sql.includes('INSERT INTO media_actors')) return { rows: [{ id: 'restaurant', actor_type: 'restaurant' }] };
    return { rows: [] };
  });
  await media.getOrCreateActor('owner');
  const [sql, params] = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO media_actors'));
  expect(params[2]).toBe('existing-restaurant');
  expect(params.slice(6)).toEqual([18, 28]);
  expect(sql).toContain('media_actors.owner_user_id = EXCLUDED.owner_user_id');
});
