'use strict';

const fs = require('fs');
const path = require('path');
const { getRelease, getReleaseMetadata } = require('../utils/release');
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

afterEach(() => jest.restoreAllMocks());

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
    GIT_SHA: sha,
    IMAGE_DIGEST: digest,
    COOLIFY_DEPLOYMENT_ID: 'deploy-1',
  });
  expect(meta).toEqual({
    release: null,
    gitSha: sha,
    imageDigest: digest,
    deploymentId: 'deploy-1',
  });
});

test('release metadata is null for absent deploy-time values', () => {
  const meta = getReleaseMetadata({});
  expect(meta.gitSha).toBeNull();
  expect(meta.imageDigest).toBeNull();
  expect(meta.deploymentId).toBeNull();
});

test('blank runtime overrides preserve baked Git identity independently of release', () => {
  jest.spyOn(fs, 'readFileSync').mockImplementation((file) => {
    if (file === '/image/build.json') return JSON.stringify({ schemaVersion: 1, gitSha: sha });
    if (file === '/image/release') return 'custom-release\n';
    throw new Error('missing');
  });
  expect(getReleaseMetadata({ GIT_SHA: '', COMMIT_SHA: '', SOURCE_COMMIT: '' }, {
    buildMetadataFile: '/image/build.json', releaseFile: '/image/release', hostname: 'local',
  })).toEqual({ release: 'custom-release', gitSha: sha, imageDigest: null, deploymentId: null });
});

test('host provenance is scoped to the running container and does not leak across recreations', () => {
  const id = 'c'.repeat(64);
  const record = { schemaVersion: 1, containerId: id, imageId: `sha256:${'d'.repeat(64)}`,
    gitSha: sha, imageDigest: digest, deploymentId: 'deploy123' };
  jest.spyOn(fs, 'readFileSync').mockImplementation((file) => {
    if (path.normalize(file) === path.normalize(`/metadata/${id.slice(0, 12)}.json`)) return JSON.stringify(record);
    throw new Error('missing');
  });
  const options = { deploymentMetadataDirectory: '/metadata', hostname: id.slice(0, 12) };
  expect(getReleaseMetadata({}, options)).toEqual({ release: null, gitSha: sha, imageDigest: digest, deploymentId: 'deploy123' });
  const other = getReleaseMetadata({}, { ...options, hostname: 'e'.repeat(12) });
  expect(other.imageDigest).toBeNull();
  expect(other.deploymentId).toBeNull();
  record.containerId = 'f'.repeat(64);
  expect(getReleaseMetadata({}, options).deploymentId).toBeNull();
});

test('rejects stale host records and malformed metadata without breaking readiness', () => {
  const id = 'c'.repeat(64);
  jest.spyOn(fs, 'readFileSync').mockImplementation((file) => {
    if (file.endsWith('.json')) return JSON.stringify({ schemaVersion: 1, containerId: id,
      imageId: `sha256:${'d'.repeat(64)}`, gitSha: 'e'.repeat(40), imageDigest: digest, deploymentId: 'old' });
    throw new Error('missing');
  });
  const options = { buildMetadataFile: '/missing-build', hostname: id.slice(0, 12) };
  expect(getReleaseMetadata({ GIT_SHA: sha }, options)).toEqual({ release: null, gitSha: sha, imageDigest: null, deploymentId: null });
  fs.readFileSync.mockReturnValue('{bad json');
  expect(getReleaseMetadata({ SOURCE_COMMIT: 'unknown', IMAGE_DIGEST: 'sha256:deadbeef', DEPLOYMENT_ID: 'null' }, options))
    .toEqual({ release: 'unknown', gitSha: null, imageDigest: null, deploymentId: null });
});
