'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const RELEASE_FILE = path.join(__dirname, '../.release');
const BUILD_METADATA_FILE = path.join(__dirname, '../.release-metadata.json');
const DEPLOYMENT_METADATA_DIRECTORY = path.join(__dirname, '../runtime/release-metadata');

function firstNonEmpty(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || null;
}

function gitSha(value) {
  const candidate = String(value || '').trim();
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(candidate) ? candidate.toLowerCase() : null;
}

function imageDigest(value) {
  const candidate = String(value || '').trim();
  return /^sha256:[a-f0-9]{64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

function deploymentId(value) {
  const candidate = String(value || '').trim();
  return /^[a-z0-9_-]+$/i.test(candidate) && !/^(unknown|null|undefined)$/i.test(candidate) ? candidate : null;
}

function readMetadata(file) {
  try {
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    return metadata?.schemaVersion === 1 ? metadata : {};
  } catch {
    return {};
  }
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

// Build provenance survives blank Compose runtime overrides. Host-observed
// provenance lives in a separate volume, scoped to the Docker container ID.
// Never use the content release or Docker image config ID as a manifest digest.
function getReleaseMetadata(env = process.env, {
  releaseFile = RELEASE_FILE,
  buildMetadataFile = BUILD_METADATA_FILE,
  deploymentMetadataDirectory = DEPLOYMENT_METADATA_DIRECTORY,
  hostname = os.hostname(),
} = {}) {
  const build = readMetadata(buildMetadataFile);
  const configuredSha = [env.GIT_SHA, env.COMMIT_SHA, env.SOURCE_COMMIT].map(gitSha).find(Boolean);
  const builtSha = gitSha(build.gitSha);
  let deployed = /^[a-f0-9]{12,64}$/.test(hostname)
    ? readMetadata(path.join(deploymentMetadataDirectory, `${hostname}.json`)) : {};
  if (!/^[a-f0-9]{64}$/.test(deployed.containerId || '') || !deployed.containerId.startsWith(hostname) ||
      !imageDigest(deployed.imageId) ||
      [configuredSha, builtSha].some((sha) => sha && sha !== gitSha(deployed.gitSha))) {
    deployed = {};
  }
  return {
    release: getRelease(env, releaseFile),
    gitSha: configuredSha || builtSha || gitSha(deployed.gitSha),
    imageDigest: imageDigest(env.IMAGE_DIGEST) || imageDigest(deployed.imageDigest),
    deploymentId: deploymentId(env.COOLIFY_DEPLOYMENT_ID) || deploymentId(env.DEPLOYMENT_ID) || deploymentId(deployed.deploymentId),
  };
}

module.exports = { RELEASE_FILE, getRelease, getReleaseMetadata, gitSha, imageDigest, deploymentId };
