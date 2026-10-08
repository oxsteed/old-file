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
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ post_id: 'post-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const first = resMock();
    await media.recordView({ params: { id: 'post-1' }, ip: '127.0.0.1', headers: {} }, first);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][0]).toMatch(/view_count = view_count \+ 1/);
    expect(first.json).toHaveBeenCalledWith({ ok: true, recorded: true });

    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const duplicate = resMock();
    await media.recordView({ params: { id: 'post-1' }, ip: '127.0.0.1', headers: {} }, duplicate);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(duplicate.json).toHaveBeenCalledWith({ ok: true, recorded: false });
  });
});
