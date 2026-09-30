'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildReleaseMetadata } = require('./build-release-metadata.cjs');
const sha = 'a'.repeat(40);

test('persists build Git identity separately from a custom browser release', () => {
  const metadata = buildReleaseMetadata({ SENTRY_RELEASE: 'release-name', SOURCE_COMMIT: sha });
  assert.deepEqual(metadata, { schemaVersion: 1, release: 'release-name', gitSha: sha });
});

test('uses the available Git build inputs for the shared release', () => {
  for (const key of ['GIT_SHA', 'COMMIT_SHA', 'SOURCE_COMMIT']) {
    assert.deepEqual(buildReleaseMetadata({ [key]: ` ${sha.toUpperCase()} ` }),
      { schemaVersion: 1, release: sha, gitSha: sha });
  }
});

test('content identity never masquerades as a Git SHA, image digest, or deployment', () => {
  const metadata = buildReleaseMetadata({ SOURCE_COMMIT: 'unknown', COMMIT_SHA: 'HEAD',
    IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`, COOLIFY_DEPLOYMENT_ID: 'deploy123' }, '/fixture',
  (root) => { assert.equal(root, '/fixture'); return 'content-0123456789abcdef'; });
  assert.deepEqual(metadata, { schemaVersion: 1, release: 'content-0123456789abcdef', gitSha: null });
});
