'use strict';

const fs = require('node:fs');
const { computeContentRelease } = require('./compute-content-release.cjs');
const { gitSha } = require('../server/utils/release');

function buildReleaseMetadata(env = process.env, rootDir, compute = computeContentRelease) {
  const sha = [env.GIT_SHA, env.COMMIT_SHA, env.SOURCE_COMMIT].map(gitSha).find(Boolean) || null;
  const release = [env.SENTRY_RELEASE, sha].map((value) => String(value || '').trim()).find(Boolean) || compute(rootDir);
  // A deployment UUID and an image's own final digest cannot be baked at build time.
  return { schemaVersion: 1, release, gitSha: sha };
}

if (require.main === module) {
  const metadata = buildReleaseMetadata();
  fs.writeFileSync('/release', `${metadata.release}\n`);
  fs.writeFileSync('/release-metadata.json', `${JSON.stringify(metadata)}\n`);
}

module.exports = { buildReleaseMetadata };
