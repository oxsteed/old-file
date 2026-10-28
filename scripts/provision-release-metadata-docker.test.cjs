'use strict';

// Explicit isolated rehearsal. Never starts the API or mounts production data.
// OXSTEED_PROVENANCE_DOCKER_TEST=true node --test scripts/provision-release-metadata-docker.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { provisionReleaseMetadata } = require('./provision-release-metadata.cjs');

test('prefixed metadata volume supports pinned overlapping candidates without stale-container reuse', {
  skip: process.env.OXSTEED_PROVENANCE_DOCKER_TEST !== 'true', timeout: 120000,
}, () => {
  const applicationUuid = `provenance-rehearsal-${randomBytes(6).toString('hex')}`;
  const volume = `${applicationUuid}_oxsteed-release-metadata`;
  const sha = 'a'.repeat(40), image = `${applicationUuid}_app:${sha}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-provenance-'));
  const containers = [];
  let imageCreated = false, volumeCreated = false;
  const docker = (args, input) => execFileSync('docker', ['--context', 'colima', ...args], {
    encoding: 'utf8', input, timeout: 55000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  try {
    // Require the known official base to be cached; don't fetch a new image.
    docker(['image', 'inspect', 'node:22-alpine', '--format', '{{.Id}}']);
    fs.copyFileSync(path.join(__dirname, '../server/utils/release.js'), path.join(root, 'release.js'));
    fs.writeFileSync(path.join(root, 'Dockerfile'), `FROM node:22-alpine\nLABEL org.opencontainers.image.revision="${sha}" oxsteed.test.fixture="${applicationUuid}"\nWORKDIR /app\nCOPY release.js /app/server/utils/release.js\n`);
    docker(['build', '--pull=false', '--network', 'none', '-t', image, root]);imageCreated = true;
    docker(['volume', 'create', volume]);volumeCreated = true;
    const start = deployment => {
      const id = docker(['run', '-d', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--label', `com.docker.compose.project=${applicationUuid}`,
        '--label', 'com.docker.compose.service=app', '--label', `com.docker.compose.project.config_files=/artifacts/${deployment}/compose.yml`,
        '--mount', `type=volume,source=${volume},target=/app/server/runtime/release-metadata,readonly`,
        '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},1000)']);
      assert.match(id, /^[a-f0-9]{64}$/);containers.push(id);return id;
    };
    const first = start('first-deployment'), second = start('second-deployment');
    assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker }), /exactly one/);
    const read = id => JSON.parse(docker(['exec', id, 'node', '-e', "console.log(JSON.stringify(require('/app/server/utils/release.js').getReleaseMetadata()))"]));
    const provision = (id, deployment) => provisionReleaseMetadata({ applicationUuid, docker, expectedContainerId: id,
      expected: { gitSha: sha, deploymentId: deployment } });
    const observed = provision(first, 'first-deployment');
    assert.equal(observed.metadataVolumeName, volume);
    assert.equal(observed.canProvision, true);
    assert.equal(read(first).gitSha, sha);
    assert.equal(read(first).deploymentId, 'first-deployment');
    assert.equal(read(first).imageDigest, observed.imageDigest);
    assert.equal(read(second).gitSha, null);
    assert.equal(read(second).deploymentId, null);
    assert.equal(provision(first, 'first-deployment').changed, false);
    provision(second, 'second-deployment');
    assert.equal(read(second).deploymentId, 'second-deployment');
    assert.equal(read(first).deploymentId, 'first-deployment');
  } finally {
    for (const id of containers) docker(['rm', '-f', id]);
    if (volumeCreated) docker(['volume', 'rm', volume]);
    if (imageCreated) docker(['image', 'rm', image]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
