'use strict';

const { setTimeout: delay } = require('node:timers/promises');

function deploymentConfig(env) {
  if (!env.COOLIFY_WEBHOOK_URL || !env.COOLIFY_TOKEN) {
    throw new Error('Configure COOLIFY_WEBHOOK_URL and COOLIFY_TOKEN in GitHub Actions secrets.');
  }
  let url;
  try { url = new URL(env.COOLIFY_WEBHOOK_URL); } catch {
    throw new Error('COOLIFY_WEBHOOK_URL must be an HTTPS Coolify API deployment URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname !== '/api/v1/deploy') {
    throw new Error('COOLIFY_WEBHOOK_URL must use HTTPS and /api/v1/deploy, without embedded credentials or a fragment.');
  }
  const uuid = url.searchParams.get('uuid');
  if (!uuid || !/^[a-zA-Z0-9_-]+$/.test(uuid) || url.searchParams.getAll('uuid').length !== 1 ||
      [...url.searchParams.keys()].some((key) => !['uuid', 'force'].includes(key))) {
    throw new Error('Use the live application webhook with exactly one uuid; tags and preview deployments are not supported here.');
  }
  if (url.searchParams.has('force') && !['true', 'false'].includes(url.searchParams.get('force'))) {
    throw new Error('The webhook force parameter must be true or false.');
  }
  return { url, uuid, token: env.COOLIFY_TOKEN };
}

async function deployCoolify({ env = process.env, fetchImpl = fetch, sleep = delay, now = Date.now,
  timeoutMs = 15 * 60 * 1000, checkOnly = false, log = console.log, provisionMetadata = null } = {}) {
  const { url, uuid, token } = deploymentConfig(env);
  const deadline = now() + timeoutMs;
  async function request(target, method = 'GET') {
    let response;
    try {
      response = await fetchImpl(target, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - now()))),
      });
    } catch {
      // URLs, response bodies, and transport errors may contain credentials.
      throw new Error('Coolify API request failed or timed out. Check the HTTPS endpoint and network access.');
    }
    if (!response.ok) {
      const advice = response.status === 404
        ? 'Check the live instance, application UUID, and token team access; no matching resource was found.'
        : [401, 403].includes(response.status)
          ? 'Check that the token exists on this Coolify instance and grants read and deploy access to the application team.'
          : 'Inspect the Coolify deployment and server logs.';
      throw new Error(`Coolify API returned HTTP ${response.status}. ${advice}`);
    }
    try { return await response.json(); } catch {
      throw new Error('Coolify returned an invalid JSON response. Check the API endpoint.');
    }
  }

  const apiUrl = (pathname) => new URL(`/api/v1/${pathname}`, url.origin);
  const application = await request(apiUrl(`applications/${uuid}`));
  if (application?.uuid !== uuid) throw new Error('Coolify returned a different application UUID; deployment stopped.');
  const repository = String(application.git_repository || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (env.GITHUB_REPOSITORY && repository !== env.GITHUB_REPOSITORY) {
    throw new Error('The Coolify application points at a different GitHub repository; deployment stopped.');
  }
  if (env.GITHUB_REF_NAME && application.git_branch !== env.GITHUB_REF_NAME) {
    throw new Error('The Coolify application tracks a different branch; deployment stopped.');
  }
  log('Coolify application and source configuration verified.');
  if (checkOnly) return { checked: true };

  const queued = await request(url, 'POST');
  const deployment = queued?.deployments?.find((item) => item.resource_uuid === uuid);
  if (!deployment?.deployment_uuid || !/^[a-zA-Z0-9_-]+$/.test(deployment.deployment_uuid)) {
    throw new Error('Coolify did not queue a deployment for this application; inspect its deployment queue.');
  }
  log('Coolify accepted the deployment; waiting for completion.');
  while (now() < deadline) {
    const result = await request(apiUrl(`deployments/${deployment.deployment_uuid}`));
    if (result?.deployment_uuid !== deployment.deployment_uuid) {
      throw new Error('Coolify returned a different deployment; completion could not be verified.');
    }
    if (result.status === 'finished') {
      if (env.GITHUB_SHA && result.commit !== env.GITHUB_SHA) {
        throw new Error('Coolify finished a different commit; verify the deployed release before marking this workflow successful.');
      }
      log('Coolify finished the requested deployment.');
      if (provisionMetadata) {
        const provenance = await provisionMetadata({ applicationUuid: uuid,
          expected: { gitSha: result.commit, deploymentId: deployment.deployment_uuid } });
        log(`Release metadata provisioned; unavailable fields: ${provenance.missing.join(', ') || 'none'}.`);
      }
      return { deploymentUuid: deployment.deployment_uuid };
    }
    if (!['queued', 'in_progress'].includes(result.status)) {
      throw new Error('Coolify deployment failed, was cancelled, or returned an unexpected status. Inspect its deployment logs.');
    }
    await sleep(Math.min(5000, Math.max(0, deadline - now())));
  }
  throw new Error('Timed out waiting for Coolify deployment. It may still be running; inspect it before retrying.');
}

module.exports = { deploymentConfig, deployCoolify };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--deploy'].includes(args[0])) {
    console.error('Usage: node scripts/deploy-coolify.cjs --check|--deploy');
    process.exitCode = 1;
  } else {
    // Enable only on the MacBook/Colima runner. GitHub-hosted runners cannot
    // provision local Docker provenance. No Coolify environment API writes.
    const provisionMetadata = process.env.COOLIFY_PROVISION_LOCAL_METADATA === 'true'
      ? require('./provision-release-metadata.cjs').provisionReleaseMetadata : null;
    deployCoolify({ checkOnly: args[0] === '--check', provisionMetadata }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
