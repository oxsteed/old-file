'use strict';

// P1-287: an auto-hidden post notifies its author once.
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({}) }));
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const media = require('../controllers/mediaController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function setup({ openFlags, held }) {
  pool.query.mockReset().mockResolvedValue({ rows: [{ id: 'post-1' }] }); // visiblePost
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/COUNT\(\*\)::int AS count FROM media_post_flags\s+WHERE user_id/.test(sql)) return { rows: [{ count: 0 }] };
      if (/SELECT 1 FROM media_post_flags/.test(sql)) return { rows: [] };
      if (/WHERE post_id = \$1 AND status = 'open'/.test(sql)) return { rows: [{ count: openFlags }] };
      if (/UPDATE media_posts p/.test(sql)) return { rows: held ? [{ id: 'post-1', owner_user_id: 'author-1' }] : [] };
      return { rows: [] };
    }),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => jest.clearAllMocks());

test('crossing the threshold holds the post and notifies the author', async () => {
  setup({ openFlags: 5, held: true });
  const res = response();
  await media.flagPost({ params: { id: 'post-1' }, user: { id: 'reporter' }, body: { reason: 'spam' } }, res);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'author-1', action_url: '/media/post/post-1', idempotencyKey: 'media-report-hold:post-1',
  }));
});

test('an already-held post does not notify again', async () => {
  setup({ openFlags: 6, held: false });
  const res = response();
  await media.flagPost({ params: { id: 'post-1' }, user: { id: 'reporter' }, body: { reason: 'spam' } }, res);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(sendNotification).not.toHaveBeenCalled();
});
