'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deploymentConfig, deployCoolify, deployCoolifyImage } = require('./deploy-coolify.cjs');

const env = {
  COOLIFY_WEBHOOK_URL: 'https://coolify.example.test/api/v1/deploy?uuid=website123&force=false',
  COOLIFY_TOKEN: 'test-token-do-not-log',
  GITHUB_REPOSITORY: 'oxsteed/old-file',
  GITHUB_REF_NAME: 'old-files-claude',
  GITHUB_SHA: 'a'.repeat(40),
};
const application = { uuid: 'website123', git_repository: env.GITHUB_REPOSITORY, git_branch: env.GITHUB_REF_NAME };
const queued = { deployments: [{ resource_uuid: 'website123', deployment_uuid: 'deploy123' }] };
const finished = { deployment_uuid: 'deploy123', status: 'finished', commit: env.GITHUB_SHA };
const imageEnv = {
  COOLIFY_IMAGE_WEBHOOK_URL: 'https://coolify.example.test/api/v1/deploy?uuid=image123&force=false',
  COOLIFY_IMAGE_NAME: 'ghcr.io/oxsteed/old-file',
  COOLIFY_IMAGE_TAG: env.GITHUB_SHA,
};
const imageApplication = {
  uuid: 'image123',
  docker_registry_image_name: imageEnv.COOLIFY_IMAGE_NAME,
  docker_registry_image_tag: 'previous-release',
};
const imageQueued = { deployments: [{ resource_uuid: 'image123', deployment_uuid: 'image-deploy123' }] };
const imageFinished = { deployment_uuid: 'image-deploy123', status: 'finished' };

function fixture(responses, overrides = {}) {
  const calls = [];
  const logs = [];
  let clock = 0;
  return {
    calls, logs,
    run: (options = {}) => deployCoolify({
      env: { ...env, ...overrides },
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      timeoutMs: 10000,
      log: (text) => logs.push(text),
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), ...options });
        assert.ok(responses.length, 'unexpected extra request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return { ok: !response.errorStatus, status: response.errorStatus || 200, json: async () => response };
      },
      ...options,
    }),
  };
}

function imageFixture(responses, overrides = {}) {
  const calls = [];
  const logs = [];
  let clock = 0;
  return {
    calls, logs,
    run: (options = {}) => deployCoolifyImage({
      env: { ...env, ...imageEnv, ...overrides },
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      timeoutMs: 10000,
      log: (text) => logs.push(text),
      fetchImpl: async (url, requestOptions) => {
        calls.push({ url: String(url), ...requestOptions });
        assert.ok(responses.length, 'unexpected extra request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return { ok: !response.errorStatus, status: response.errorStatus || 200, json: async () => response };
      },
      ...options,
    }),
  };
}

test('invalid configuration makes no requests', async () => {
  for (const overrides of [
    { COOLIFY_TOKEN: '' }, { COOLIFY_WEBHOOK_URL: 'not a url' },
    { COOLIFY_WEBHOOK_URL: 'http://coolify.example.test/api/v1/deploy?uuid=website123' },
    { COOLIFY_WEBHOOK_URL: 'https://user:secret@coolify.example.test/api/v1/deploy?uuid=website123' },
    { COOLIFY_WEBHOOK_URL: 'https://coolify.example.test/api/v1/deploy?tag=production' },
    { COOLIFY_WEBHOOK_URL: 'https://coolify.example.test/api/v1/deploy?uuid=a&uuid=b' },
    { COOLIFY_WEBHOOK_URL: `${env.COOLIFY_WEBHOOK_URL}&pr=7` },
  ]) {
    const f = fixture([], overrides);
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 0);
  }
});

test('missing resource and invalid token fail before any deployment POST', async () => {
  for (const status of [401, 403, 404]) {
    const f = fixture([{ errorStatus: status, message: env.COOLIFY_TOKEN }]);
    await assert.rejects(f.run(), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.ok(!error.message.includes(env.COOLIFY_TOKEN));
      return true;
    });
    assert.deepEqual(f.calls.map((call) => call.method), ['GET']);
  }
});

test('a wrong application, repository, or branch is never deployed', async () => {
  for (const mismatch of [{ uuid: 'other' }, { git_repository: 'oxsteed/other' }, { git_branch: 'main' }]) {
    const f = fixture([{ ...application, ...mismatch }]);
    await assert.rejects(f.run(), /different/);
    assert.equal(f.calls.length, 1);
  }
});

test('check-only mode reads the application without posting a deployment', async () => {
  const f = fixture([{ ...application, git_repository: 'https://github.com/oxsteed/old-file.git' }]);
  assert.deepEqual(await f.run({ checkOnly: true }), { checked: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].redirect, 'error');
});

test('success requires the exact queued deployment to finish the workflow commit', async () => {
  const f = fixture([application, queued, { ...finished, status: 'in_progress' }, finished]);
  assert.deepEqual(await f.run(), { deploymentUuid: 'deploy123' });
  assert.deepEqual(f.calls.map((call) => call.method), ['GET', 'POST', 'GET', 'GET']);
  assert.equal(f.calls[0].url, 'https://coolify.example.test/api/v1/applications/website123');
  assert.equal(f.calls[1].url, env.COOLIFY_WEBHOOK_URL);
  assert.equal(f.calls[2].url, 'https://coolify.example.test/api/v1/deployments/deploy123');
  assert.ok(f.calls.every((call) => call.headers.Authorization === `Bearer ${env.COOLIFY_TOKEN}`));
  assert.ok(!f.logs.join('\n').includes(env.COOLIFY_TOKEN));
});

test('HTTP success without a deployment for this application is rejected', async () => {
  for (const response of [{}, { deployments: [] }, { deployments: [{ resource_uuid: 'other', deployment_uuid: 'deploy123' }] }]) {
    await assert.rejects(fixture([application, response]).run(), /did not queue/);
  }
});

test('failed, cancelled, unrelated, and wrong-commit deployments cannot pass', async () => {
  for (const status of ['failed', 'cancelled-by-user', 'unknown']) {
    await assert.rejects(fixture([application, queued, { ...finished, status }]).run(), /failed, was cancelled/);
  }
  await assert.rejects(fixture([application, queued, { ...finished, deployment_uuid: 'other' }]).run(), /different deployment/);
  await assert.rejects(fixture([application, queued, { ...finished, commit: 'b'.repeat(40) }]).run(), /different commit/);
});

test('pending deployment polling is bounded without a duplicate POST', async () => {
  const f = fixture([application, queued, { ...finished, status: 'queued' }, { ...finished, status: 'in_progress' }]);
  await assert.rejects(f.run(), /Timed out waiting/);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

test('transport errors do not leak secret values or endpoint URLs', async () => {
  const f = fixture([new Error(`${env.COOLIFY_TOKEN} at ${env.COOLIFY_WEBHOOK_URL}`)]);
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /request failed or timed out/);
    assert.ok(!error.message.includes(env.COOLIFY_TOKEN));
    assert.ok(!error.message.includes(env.COOLIFY_WEBHOOK_URL));
    return true;
  });
});

test('image deployment updates the verified tag before deploying', async () => {
  const f = imageFixture([imageApplication, { uuid: 'image123' }, imageQueued, { ...imageFinished, status: 'in_progress' }, imageFinished]);
  assert.deepEqual(await f.run(), { deploymentUuid: 'image-deploy123' });
  assert.deepEqual(f.calls.map((call) => call.method), ['GET', 'PATCH', 'POST', 'GET', 'GET']);
  assert.equal(f.calls[0].url, 'https://coolify.example.test/api/v1/applications/image123');
  assert.equal(f.calls[1].url, f.calls[0].url);
  assert.deepEqual(JSON.parse(f.calls[1].body), { docker_registry_image_tag: imageEnv.COOLIFY_IMAGE_TAG });
  assert.equal(f.calls[2].url, imageEnv.COOLIFY_IMAGE_WEBHOOK_URL);
  assert.ok(f.calls.every((call) => call.headers.Authorization === `Bearer ${env.COOLIFY_TOKEN}`));
});

test('image deployment refuses a different registry image', async () => {
  const f = imageFixture([{ ...imageApplication, docker_registry_image_name: 'ghcr.io/oxsteed/wrong-image' }]);
  await assert.rejects(f.run(), /different Docker image/);
  assert.equal(f.calls.length, 1);
});

test('image check-only mode does not update or deploy', async () => {
  const f = imageFixture([imageApplication]);
  assert.deepEqual(await f.run({ checkOnly: true }), { checked: true });
  assert.equal(f.calls.length, 1);
});

test('image deployments can retarget a shared Coolify webhook by application UUID', async () => {
  const config = deploymentConfig({
    COOLIFY_IMAGE_WEBHOOK_URL: env.COOLIFY_WEBHOOK_URL,
    COOLIFY_IMAGE_APPLICATION_UUID: 'image123',
    COOLIFY_TOKEN: env.COOLIFY_TOKEN,
  }, { image: true });
  assert.equal(config.uuid, 'image123');
  assert.equal(config.url.searchParams.get('uuid'), 'image123');
  assert.equal(config.url.searchParams.get('force'), 'false');
});
