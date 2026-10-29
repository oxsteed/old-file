'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { observeMetadata, provisionReleaseMetadata, findApplicationContainer, resolveLocalGitSha } = require('./provision-release-metadata.cjs');
const { getReleaseMetadata } = require('../server/utils/release');

const applicationUuid = 'app123';
const sha = 'a'.repeat(40);
const imageId = `sha256:${'b'.repeat(64)}`;
const digest = `sha256:${'c'.repeat(64)}`;
const container = { containerId: 'd'.repeat(64), hostname: 'd'.repeat(12), imageId,
  name: '/app-app123-current', service: 'app', running: true,
  imageReference: `${applicationUuid}_app:${sha}`, project: applicationUuid,
  configFiles: '/artifacts/deploy123/docker-compose.coolify.yml',
  mounts: [{ Type: 'volume', Name: 'oxsteed-release-metadata', Destination: '/app/server/runtime/release-metadata', RW: false }] };
const image = { imageId, repoDigests: [`${applicationUuid}_app@${digest}`], revision: '' };

test('observes Git, manifest digest, and deployment from distinct Docker provenance', () => {
  const observed = observeMetadata(container, image, applicationUuid);
  assert.equal(observed.metadata.gitSha, sha);
  assert.equal(observed.metadata.imageDigest, digest);
  assert.equal(observed.metadata.deploymentId, 'deploy123');
  assert.equal(observed.canProvision, true);
});

test('does not substitute an image config ID, tag, or unrelated repository digest', () => {
  for (const repoDigests of [[], [`other/repository@${digest}`],
    [`${applicationUuid}_app@${digest}`, `${applicationUuid}_app@${imageId}`]]) {
    assert.equal(observeMetadata(container, { ...image, repoDigests }, applicationUuid).metadata.imageDigest, null);
  }
});

test('unsupported image tags and Compose paths remain unknown', () => {
  const observed = observeMetadata({ ...container, imageReference: 'other:latest', configFiles: '/local/compose.yml' }, image, applicationUuid);
  assert.equal(observed.metadata.gitSha, null);
  assert.equal(observed.metadata.deploymentId, null);
  const multiple = observeMetadata({ ...container, configFiles: `${container.configFiles},/artifacts/other/override.yml` }, image, applicationUuid);
  assert.equal(multiple.metadata.deploymentId, null);
});

test('rejects conflicting images, application identities, commits, and deployment receipts', () => {
  assert.throws(() => observeMetadata({ ...container, project: 'other' }, image, applicationUuid));
  assert.throws(() => observeMetadata(container, { ...image, imageId: digest }, applicationUuid));
  assert.throws(() => observeMetadata(container, { ...image, revision: 'f'.repeat(40) }, applicationUuid));
  assert.throws(() => observeMetadata(container, image, applicationUuid, { gitSha: 'f'.repeat(40) }));
  assert.throws(() => observeMetadata(container, image, applicationUuid, { deploymentId: 'other' }));
});

function fixture(overrides = {}) {
  const calls = [];
  const docker = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'ps') return container.hostname;
    if (args[0] === 'inspect') return JSON.stringify({ ...container, ...overrides });
    if (args[0] === 'image') return JSON.stringify(image);
    if (args[0] === 'exec') return 'null';
    if (args[0] === 'run') return '';
    throw new Error('unexpected command');
  };
  return { calls, docker };
}

test('check mode performs only reads, including when the new volume is absent', () => {
  const f = fixture({ mounts: [] });
  const result = provisionReleaseMetadata({ applicationUuid, checkOnly: true, docker: f.docker });
  assert.equal(result.provisioned, false);
  assert.equal(result.canProvision, false);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(f.calls.map((call) => call.args[0]), ['ps', 'inspect', 'image']);
});

test('an unchanged durable record avoids the writer on every subsequent cycle', () => {
  const f = fixture();
  const metadata = observeMetadata(container, image, applicationUuid).metadata;
  const docker = (args, input) => args[0] === 'exec' ? JSON.stringify(metadata) : f.docker(args, input);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const result = provisionReleaseMetadata({ applicationUuid, docker });
    assert.equal(result.changed, false);
    assert.equal(result.provisioned, true);
  }
  assert.ok(f.calls.every(({ args }) => args[0] !== 'run'));
});

test('does not degrade a verified Git SHA when a short label cannot be resolved', () => {
  const f = fixture();
  const metadata = observeMetadata(container, image, applicationUuid).metadata;
  const docker = (args, input) => args[0] === 'exec' ? JSON.stringify(metadata) : f.docker(args, input);
  const result = provisionReleaseMetadata({ applicationUuid, docker, resolveSha: () => null });
  assert.equal(result.gitSha, sha);
  assert.equal(result.changed, false);
  assert.deepEqual(result.missing, []);
  assert.ok(f.calls.every(({ args }) => args[0] !== 'run'));
});

test('a replaced container, malformed record, and discovery identity mismatches fail safely', () => {
  const f = fixture();
  assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker: f.docker,
    expectedContainerId: 'e'.repeat(64) }), /changed/);
  assert.ok(f.calls.every(({ args }) => args[0] !== 'run'));
  for (const overrides of [{ project: 'other' }, { service: 'postgres' }, { running: false }, { name: '/bad/name' }]) {
    const bad = fixture(overrides);
    assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker: bad.docker }), /identity/);
  }
});

test('provisions only the dedicated volume with an isolated immutable-image writer', () => {
  const f = fixture();
  const result = provisionReleaseMetadata({ applicationUuid, docker: f.docker,
    expected: { gitSha: sha, deploymentId: 'deploy123' } });
  assert.equal(result.provisioned, true);
  const write = f.calls.at(-1);
  assert.equal(write.args[0], 'run');
  assert.ok(write.args.includes(imageId));
  assert.ok(write.args.includes('type=volume,source=oxsteed-release-metadata,target=/metadata'));
  assert.ok(write.args.includes('none'));
  assert.ok(write.args.includes('never'));
  assert.equal(JSON.parse(write.input).containerId, container.containerId);
  assert.ok(write.args.some((arg) => arg.includes('renameSync')));
});

test('provisions the actual Coolify-prefixed mount without creating a second volume', () => {
  const volume = `${applicationUuid}_oxsteed-release-metadata`;
  const f = fixture({ mounts: [{ ...container.mounts[0], Name: volume }] });
  const result = provisionReleaseMetadata({ applicationUuid, docker: f.docker });
  assert.equal(result.canProvision, true);
  assert.equal(result.metadataVolumeName, volume);
  assert.ok(f.calls.at(-1).args.includes(`type=volume,source=${volume},target=/metadata`));
  assert.ok(!f.calls.at(-1).args.includes('type=volume,source=oxsteed-release-metadata,target=/metadata'));
});

test('an explicit immutable candidate can be provisioned during overlap, while default discovery stays ambiguous', () => {
  const f = fixture();
  const docker = (args, input) => args[0] === 'ps' ? `${container.hostname}\n${'e'.repeat(12)}` : f.docker(args, input);
  assert.throws(() => findApplicationContainer({ applicationUuid, docker }), /exactly one/);
  const result = provisionReleaseMetadata({ applicationUuid, docker, expectedContainerId: container.containerId,
    expected: { gitSha: sha, deploymentId: 'deploy123' } });
  assert.equal(result.containerId, container.containerId);
  assert.equal(result.provisioned, true);
  for (const expectedContainerId of [container.hostname, 'app-name', 'e'.repeat(64)]) {
    assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker, expectedContainerId }));
  }
});

test('a pinned candidate still rejects a different inspected container or deployment receipt', () => {
  const f = fixture({ containerId: 'd'.repeat(63) + 'e' });
  assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker: f.docker, expectedContainerId: container.containerId }), /changed/);
  assert.ok(f.calls.every(({args}) => args[0] !== 'run'));
  const good = fixture();
  assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker: good.docker, expectedContainerId: container.containerId,
    expected: { deploymentId: 'different-candidate' } }), /deployment/);
  assert.ok(good.calls.every(({args}) => args[0] !== 'run'));
});

test('web discovery requires explicit mode, resource marker and exact generated service identity', () => {
  const name = `${applicationUuid}-20261028T210700`;
  const web = fixture({ service: name, name: `/${name}`, runtimeRole: 'web' });
  assert.throws(() => findApplicationContainer({ applicationUuid, docker: web.docker }), /identity/);
  assert.equal(findApplicationContainer({ applicationUuid, runtime: 'web', docker: web.docker }).name, name);
  assert.ok(web.calls.at(-2).args.includes('label=com.oxsteed.runtime=web'));
  for (const overrides of [{ runtimeRole: '' }, { runtimeRole: 'combined' }, { service: 'postgres' },
    { service: 'other-20261028T210700' }, { name: '/another-name' }]) {
    const bad = fixture({ service: name, name: `/${name}`, runtimeRole: 'web', ...overrides });
    assert.throws(() => findApplicationContainer({ applicationUuid, runtime: 'web', docker: bad.docker }), /identity/);
  }
  assert.throws(() => findApplicationContainer({ applicationUuid, runtime: 'unknown', docker: web.docker }), /Runtime/);
});

test('Dockerfile image tags retain commit provenance without accepting another repository', () => {
  const webImage = { ...image, repoDigests: [`${applicationUuid}@${digest}`] };
  assert.equal(observeMetadata({ ...container, imageReference: `${applicationUuid}:${sha}` }, webImage, applicationUuid).metadata.gitSha, sha);
  assert.equal(observeMetadata({ ...container, imageReference: `other:${sha}` }, webImage, applicationUuid).metadata.gitSha, null);
});

test('resolves an abbreviated Coolify revision only through the host Git checkout', () => {
  const short = sha.slice(0, 9);
  const resolved = resolveLocalGitSha(short, {
    exec: (command, args) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['rev-parse', '--verify', `${short}^{commit}`]);
      return `${sha}\n`;
    },
  });
  assert.equal(resolved, sha);
  assert.equal(resolveLocalGitSha('not-a-revision', { exec: () => { throw new Error('must not run'); } }), null);
});

test('stores a full SHA when Coolify exposes only a short image revision', () => {
  const short = sha.slice(0, 9);
  const webImage = { ...image, revision: short, repoDigests: [`${applicationUuid}@${digest}`] };
  const observed = observeMetadata({ ...container, imageReference: `${applicationUuid}:${short}` }, webImage, applicationUuid, {}, {
    resolveSha: (value) => value === short ? sha : null,
  });
  assert.equal(observed.metadata.gitSha, sha);
});

test('ambiguous containers or missing/writable/foreign volumes fail before writes', () => {
  assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker: () => 'abc def' }));
  for (const mounts of [[], [{ ...container.mounts[0], RW: true }], [{ ...container.mounts[0], Name: 'uploads' }],
    [{ ...container.mounts[0], Name: 'other-app_oxsteed-release-metadata' }],
    [container.mounts[0], container.mounts[0]]]) {
    const f = fixture({ mounts });
    assert.throws(() => provisionReleaseMetadata({ applicationUuid, docker: f.docker }), /volume/);
    assert.ok(f.calls.every((call) => call.args[0] !== 'run'));
  }
});

test('the writer record is consumed by the runtime and survives a fresh module load', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-release-provenance-'));
  try {
    const f = fixture();
    provisionReleaseMetadata({ applicationUuid, docker: f.docker });
    const write = f.calls.at(-1);
    const writer = write.args[write.args.indexOf('-e') + 1]
      .replace("'/metadata/'", JSON.stringify(`${directory}/`));
    execFileSync(process.execPath, ['-e', writer, container.hostname], { input: write.input, timeout: 5000 });
    const options = { deploymentMetadataDirectory: directory, hostname: container.hostname,
      buildMetadataFile: path.join(directory, 'missing-build'), releaseFile: path.join(directory, 'missing-release') };
    const expected = { release: null, gitSha: sha, imageDigest: digest, deploymentId: 'deploy123' };
    assert.deepEqual(getReleaseMetadata({}, options), expected);
    const source = `console.log(JSON.stringify(require(${JSON.stringify(require.resolve('../server/utils/release'))}).getReleaseMetadata({},${JSON.stringify(options)})));`;
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 5000 })), expected);
    assert.deepEqual(fs.readdirSync(directory), [`${container.hostname}.json`]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
