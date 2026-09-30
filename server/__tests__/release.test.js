'use strict';

const fs = require('fs');
const { getRelease, getReleaseMetadata } = require('../utils/release');

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

test('exposes git SHA, image digest, and deployment ID without guessing', () => {
  const meta = getReleaseMetadata({
    GIT_SHA: 'abc123',
    IMAGE_DIGEST: 'sha256:deadbeef',
    COOLIFY_DEPLOYMENT_ID: 'deploy-1',
  });
  expect(meta).toEqual({
    release: null,
    gitSha: 'abc123',
    imageDigest: 'sha256:deadbeef',
    deploymentId: 'deploy-1',
  });
});

test('release metadata is null for absent deploy-time values', () => {
  const meta = getReleaseMetadata({});
  expect(meta.gitSha).toBeNull();
  expect(meta.imageDigest).toBeNull();
  expect(meta.deploymentId).toBeNull();
});
