'use strict';

const fs = require('fs');
const { getRelease } = require('../utils/release');

test('prefers explicit release metadata in stable order', () => {
  expect(getRelease({ SENTRY_RELEASE: 'sentry-release', COMMIT_SHA: 'commit', SOURCE_COMMIT: 'source' }, '/missing')).toBe('sentry-release');
  expect(getRelease({ SENTRY_RELEASE: '', COMMIT_SHA: 'commit', SOURCE_COMMIT: 'source' }, '/missing')).toBe('commit');
  expect(getRelease({ SENTRY_RELEASE: '', COMMIT_SHA: '', SOURCE_COMMIT: 'source' }, '/missing')).toBe('source');
});

test('uses the image release file when deployment variables are blank', () => {
  const readFile = jest.spyOn(fs, 'readFileSync').mockReturnValue('content-0123456789abcdef\n');
  expect(getRelease({ SENTRY_RELEASE: '', COMMIT_SHA: '', SOURCE_COMMIT: '' }, '/app/server/.release')).toBe('content-0123456789abcdef');
  readFile.mockRestore();
});

test('returns null when neither configured nor image release metadata exists', () => {
  const readFile = jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('missing'); });
  expect(getRelease({ SENTRY_RELEASE: '', COMMIT_SHA: '', SOURCE_COMMIT: '' }, '/missing')).toBeNull();
  readFile.mockRestore();
});
