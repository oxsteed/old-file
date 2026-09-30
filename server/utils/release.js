'use strict';

const fs = require('fs');
const path = require('path');

const RELEASE_FILE = path.join(__dirname, '../.release');

function firstNonEmpty(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || null;
}

function getRelease(env = process.env, releaseFile = RELEASE_FILE) {
  const configured = firstNonEmpty(env.SENTRY_RELEASE, env.COMMIT_SHA, env.SOURCE_COMMIT);
  if (configured) return configured;

  try {
    return firstNonEmpty(fs.readFileSync(releaseFile, 'utf8'));
  } catch {
    return null;
  }
}

// Structured release metadata for /ready. All fields are safe operational
// metadata (never secrets). Values come from deploy-time environment
// variables (Coolify can inject GIT_SHA, IMAGE_DIGEST, and
// COOLIFY_DEPLOYMENT_ID); absent values are null rather than guessed.
function getReleaseMetadata(env = process.env) {
  return {
    release: getRelease(env),
    gitSha: firstNonEmpty(env.GIT_SHA, env.COMMIT_SHA, env.SOURCE_COMMIT),
    imageDigest: firstNonEmpty(env.IMAGE_DIGEST),
    deploymentId: firstNonEmpty(env.COOLIFY_DEPLOYMENT_ID, env.DEPLOYMENT_ID),
  };
}

module.exports = { RELEASE_FILE, getRelease, getReleaseMetadata };
