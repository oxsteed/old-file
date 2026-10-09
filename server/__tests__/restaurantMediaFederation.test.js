'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { dualWriteToMedia } = require('../controllers/restaurantMediaController');

const client = { query: (...args) => mockQuery(...args) };

beforeEach(() => resetMocks());

describe('restaurant Media federation', () => {
  test('reuses a source post and never duplicates the federated row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'post-existing' }] });

    const postId = await dualWriteToMedia(client, {
      restaurantId: 42,
      userId: 'customer-poster',
      ownerUserId: 'restaurant-owner',
      caption: 'Already copied',
      dishRows: [],
      restaurantName: 'Noodle House',
      sourceRestaurantMediaId: 'source-1',
      asset: { assetType: 'video_link', provider: 'youtube', externalUrl: 'https://youtu.be/abc' },
    });

    expect(postId).toBe('post-existing');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('anchors a new restaurant actor to the restaurant owner', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // source lookup
      .mockResolvedValueOnce({ rows: [] }) // actor lookup
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1' }] }) // actor insert
      .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // post insert
      .mockResolvedValueOnce({ rows: [] }) // asset insert
      .mockResolvedValueOnce({ rows: [] }); // restaurant link

    const postId = await dualWriteToMedia(client, {
      restaurantId: 42,
      userId: 'customer-poster',
      ownerUserId: 'restaurant-owner',
      caption: 'Fresh noodles',
      dishRows: [],
      restaurantName: 'Noodle House',
      sourceRestaurantMediaId: 'source-2',
      asset: { assetType: 'video_link', provider: 'youtube', externalUrl: 'https://youtu.be/abc' },
    });

    expect(postId).toBe('post-1');
    const actorInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO media_actors'));
    expect(actorInsert[1][0]).toBe('restaurant-owner');
    expect(actorInsert[1][0]).not.toBe('customer-poster');
  });

  test('repairs historical actor ownership when the restaurant owner changes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // source lookup
      .mockResolvedValueOnce({ rows: [{ id: 'actor-1', owner_user_id: 'old-owner' }] }) // actor lookup
      .mockResolvedValueOnce({ rows: [] }) // ownership repair
      .mockResolvedValueOnce({ rows: [{ id: 'post-2' }] }) // post insert
      .mockResolvedValueOnce({ rows: [] }) // asset insert
      .mockResolvedValueOnce({ rows: [] }); // restaurant link

    await dualWriteToMedia(client, {
      restaurantId: 42,
      userId: 'customer-poster',
      ownerUserId: 'new-owner',
      caption: 'Ownership changed',
      dishRows: [],
      restaurantName: 'Noodle House',
      sourceRestaurantMediaId: 'source-3',
      asset: { assetType: 'video_link', provider: 'youtube', externalUrl: 'https://youtu.be/abc' },
    });

    const repair = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE media_actors SET owner_user_id'));
    expect(repair[1]).toEqual(['new-owner', 'actor-1']);
  });
});