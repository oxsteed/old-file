'use strict';
const feed = require('../services/mediaFeedContext');
const all = { city: '', state: '', latitude: null, longitude: null };
const db = { query: jest.fn() };
beforeEach(() => db.query.mockReset());

test('guests can choose a city/state and coordinates are rounded without an identity dependency', async () => {
  expect(await feed.resolveLocation({ city: ' Springfield ', state: ' OH ' }, null, db))
    .toEqual({ ...all, city: 'springfield', state: 'oh' });
  expect(await feed.resolveLocation({ latitude: '39.92412', longitude: '-83.81055' }, null, db))
    .toEqual({ ...all, latitude: 39.924, longitude: -83.811 });
  expect(db.query).not.toHaveBeenCalled();
});
test.each([
  { city: 'Springfield' }, { state: 'OH' }, { latitude: '39' },
  { latitude: '', longitude: '' }, { latitude: 'NaN', longitude: '2' },
  { latitude: '91', longitude: '2' }, { latitude: '0', longitude: '-181' },
  { city: ['town'], state: 'OH' }, { location_mode: 'all', city: 'town', state: 'OH' },
  { location_mode: 'custom' }, { location_mode: 'surprise' },
])('rejects malformed or conflicting location choices: %j', async query => {
  await expect(feed.resolveLocation(query, null, db)).rejects.toMatchObject({ status: 400, code: 'media_location_invalid' });
});
test('explicit all locations overrides the profile; otherwise reuse existing city/state', async () => {
  expect(await feed.resolveLocation({ location_mode: 'all' }, 'viewer', db)).toEqual(all);
  expect(db.query).not.toHaveBeenCalled();
  db.query.mockResolvedValue({ rows: [{ city: 'Springfield', state: 'OH' }] });
  expect(await feed.resolveLocation({}, 'viewer', db)).toEqual({ ...all, city: 'springfield', state: 'oh' });
});
test('pagination binds location, account, tab and version, preserving a precise timestamp and cutoff', () => {
  const context = feed.contextKey('home', 'viewer', all);
  const row = { id: 'synthetic', cursor_created_at: '2026-10-08T12:00:00.123456Z', link_count: 2, locality_boost: 3, feed_position: 5 };
  const cursor = feed.encodeCursor(row, context, 'ranked', '2026-10-08T13:00:00Z');
  expect(feed.decodeCursor(cursor, context)).toMatchObject({ v: 2, created_at: row.cursor_created_at, feed_position: 5, mode: 'ranked', as_of: '2026-10-08T13:00:00Z' });
  for (const other of [feed.contextKey('following', 'viewer', all), feed.contextKey('home', null, all),
    feed.contextKey('home', 'viewer', { ...all, city: 'springfield', state: 'oh' })]) {
    expect(() => feed.decodeCursor(cursor, other)).toThrow();
  }
  for (const change of [{ v: 0 }, { locality_boost: 99 }, { link_count: -1 }, { as_of: 'invalid' }, { mode: 'invented' }]) {
    const tampered = Buffer.from(JSON.stringify({ ...feed.decodeCursor(cursor, context), ...change })).toString('base64url');
    expect(() => feed.decodeCursor(tampered, context)).toThrow();
  }
  for (const invalid of ['2026-10-08T12:00:00Z', 'broken', 'x'.repeat(1600)]) {
    expect(() => feed.decodeCursor(invalid, context)).toThrow();
  }
});
