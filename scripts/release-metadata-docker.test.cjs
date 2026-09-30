'use strict';

// Opt-in isolated build-stage verification; never runs the API or touches
// production containers/volumes. OXSTEED_RELEASE_DOCKER_TEST=true node --test ...
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { computeContentRelease } = require('./compute-content-release.cjs');
const repository = path.resolve(__dirname, '..');

test('Docker persists authoritative build Git metadata and honest content fallback', {
  skip: process.env.OXSTEED_RELEASE_DOCKER_TEST !== 'true', timeout: 120000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-release-docker-'));
  const images = [];
  const docker = (args) => execFileSync('docker', ['--context', 'colima', ...args], {
    encoding: 'utf8', timeout: 55000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  try {
    for (const directory of ['scripts', 'server/utils', 'client']) fs.mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of ['scripts/build-release-metadata.cjs', 'scripts/compute-content-release.cjs', 'server/utils/release.js']) {
      fs.copyFileSync(path.join(repository, file), path.join(root, file));
    }
    fs.writeFileSync(path.join(root, 'client/index.html'), 'isolated client fixture');
    const sha = 'a'.repeat(40);
    for (const buildArgs of [['--build-arg', `SOURCE_COMMIT=${sha}`, '--build-arg', 'SENTRY_RELEASE=custom-release'], []]) {
      // iidfile stays outside the build context, keeping the fallback deterministic.
      const iidfile = `${root}.iid`;
      try {
        docker(['build', '--target', 'release-meta', '--iidfile', iidfile,
          ...buildArgs, '-f', path.join(repository, 'Dockerfile'), root]);
        const id = fs.readFileSync(iidfile, 'utf8').trim();
        images.push(id);
        const source = "const fs=require('node:fs');console.log(JSON.stringify({release:fs.readFileSync('/release','utf8').trim(),metadata:JSON.parse(fs.readFileSync('/release-metadata.json','utf8'))}));";
        const output = JSON.parse(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
          '--entrypoint', 'node', id, '-e', source]));
        assert.equal(output.metadata.gitSha, buildArgs.length ? sha : null);
        assert.equal(output.release, buildArgs.length ? 'custom-release' : computeContentRelease(root));
        assert.equal(output.metadata.release, output.release);
        assert.equal(output.metadata.imageDigest, undefined);
        assert.equal(output.metadata.deploymentId, undefined);
      } finally {
        fs.rmSync(iidfile, { force: true });
      }
    }
  } finally {
    for (const id of images) docker(['image', 'rm', id]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
