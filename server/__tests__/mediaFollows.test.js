'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue(undefined) }));

const pool = require('../db');
const media = require('../controllers/mediaController');
const { sendNotification } = require('../services/notificationService');

function resMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('OxSteed Media follows', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.connect = jest.fn(async () => ({
      query: (...args) => pool.query(...args),
      release: jest.fn(),
    }));
    sendNotification.mockClear();
  });

  test('requires authentication for the Following feed', async () => {
    const res = resMock();
    await media.getFeed({ query: { tab: 'following' }, user: null }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_following_auth_required' }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('requires authentication for the Profile Studio mine feed', async () => {
    const res = resMock();
    await media.getFeed({ query: { tab: 'mine' }, user: null }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_mine_auth_required' }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('scopes the mine feed to the signed-in owner', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = resMock();
    await media.getFeed({ query: { tab: 'mine', limit: '5', location_mode: 'all' }, user: { id: 'viewer-1' } }, res);
    expect(pool.query.mock.calls[0][0]).toMatch(/a\.owner_user_id = \$3/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ posts: [], tab: 'mine' }));
  });

  test('follows an accessible actor and returns the follower count', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1', owner_user_id: 'owner-1', display_name: 'Local Helper' }] })
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] })
      .mockResolvedValueOnce({ rows: [{ follower_count: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await media.toggleFollow({ params: { actorId: 'actor-1' }, user: { id: 'viewer-1' } }, res);

    expect(pool.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(pool.query.mock.calls[2][0]).toContain('ON CONFLICT (follower_user_id, actor_id) DO NOTHING');
    expect(res.json).toHaveBeenCalledWith({ following: true, follower_count: 3 });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'media_follow',
      idempotencyKey: 'media_follow:actor-1:viewer-1',
      action_url: '/media',
    }));
  });

  test('follow lookup excludes inactive, banned, or deleted actor owners', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await media.toggleFollow({ params: { actorId: 'inactive-actor' }, user: { id: 'viewer-1' } }, res);

    expect(pool.query.mock.calls[1][0]).toMatch(/follow_owner\.deleted_at IS NULL/);
    expect(pool.query.mock.calls[1][0]).toMatch(/follow_owner\.is_active = TRUE/);
    expect(pool.query.mock.calls[1][0]).toMatch(/follow_owner\.is_banned = FALSE/);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('unfollows an actor without sending a notification', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1', owner_user_id: 'owner-1', display_name: 'Local Helper' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [{ follower_count: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await media.toggleFollow({ params: { actorId: 'actor-1' }, user: { id: 'viewer-1' } }, res);

    expect(pool.query.mock.calls[3][0]).toContain('DELETE FROM media_follows');
    expect(res.json).toHaveBeenCalledWith({ following: false, follower_count: 2 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('prevents following the current user actor', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1', owner_user_id: 'viewer-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resMock();

    await media.toggleFollow({ params: { actorId: 'actor-1' }, user: { id: 'viewer-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_follow_self' }));
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
