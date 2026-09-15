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

module.exports = { RELEASE_FILE, getRelease };
