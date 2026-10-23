const { displayManifest } = require('../utils/pwaManifest');
const main = require('../../client/public/manifest.json');
test('display installs retain their destination and separate orientation from the main app', () => {
  expect(main.orientation).toBe('any');
  for (const type of ['kitchen', 'queue', 'kiosk']) {
    for (const prefix of ['restaurants', 'food']) {
      const path = `/${prefix}/${type}/42`,
        result = displayManifest(main, path);
      expect(result.start_url).toBe(path);
      expect(result.id).toBe(path);
      expect(result.orientation).toBe(type === 'kiosk' ? 'any' : 'landscape');
      expect(result.share_target).toBeUndefined();
      expect(result.shortcuts).toEqual([]);
    }
  }
});
test('display manifests reject external, query-bearing and non-display destinations', () => {
  for (const path of [
    '/kitchen',
    '//evil.test',
    'https://evil.test/kitchen/1',
    '/restaurants/kitchen/1?token=private',
    '/wallet',
    null,
  ]) {
    expect(displayManifest(main, path)).toBeNull();
  }
});
