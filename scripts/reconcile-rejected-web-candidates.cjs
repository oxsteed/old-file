'use strict';

// Follow Coolify's rejection decision; never initiate a deployment or select a
// new release. A cancelled startup must not become routable after its job exits.
const { runDocker, validateApplicationUuid, findApplicationContainer } = require('./provision-release-metadata.cjs');
const { deploymentId, imageDigest } = require('../server/utils/release');

function collectReceipts(applicationUuid, docker = runDocker) {
  validateApplicationUuid(applicationUuid);
  const sql = `SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM (
    SELECT q.deployment_uuid AS "deploymentId", q.status
      FROM application_deployment_queues q
      JOIN applications a ON a.id::text = q.application_id
     WHERE a.uuid = '${applicationUuid}'
     ORDER BY q.id DESC LIMIT 100
  ) r;`;
  // Credentials remain inside the existing DB container's process. Only
  // resource/deployment IDs and statuses enter this process or its output.
  const result = JSON.parse(docker(['exec', '-i', 'coolify-db', 'sh', '-c',
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql));
  if (!Array.isArray(result) || result.length > 100 || result.some(row => !deploymentId(row.deploymentId)
      || !['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user'].includes(row.status))) {
    throw new Error('Coolify web deployment receipts could not be verified.');
  }
  return result;
}

function containerDeployment(container) {
  const files = String(container.configFiles || '').split(',').map(file => file.trim());
  const ids = files.map(file => /^\/artifacts\/([a-zA-Z0-9_-]+)\//.exec(file)?.[1]);
  return ids.length && ids.every(id => deploymentId(id)) && new Set(ids).size === 1 ? ids[0] : null;
}

function health(containerId, docker) {
  const result = JSON.parse(docker(['inspect', containerId, '--format',
    '{"running":{{json .State.Running}},"health":{{json .State.Health.Status}}}']));
  return result.running === true && result.health === 'healthy';
}

function routeRules(containerId, docker) {
  // Read label names first, then only public router rules. Never collect the
  // whole label map, which may contain unrelated authentication middleware.
  const keys = docker(['inspect', containerId, '--format', '{{range $key, $value := .Config.Labels}}{{println $key}}{{end}}'])
    .split(/\s+/).filter(key => /^traefik\.http\.routers\.[a-zA-Z0-9_.-]+\.rule$/.test(key));
  if (!keys.length || keys.length > 16) return [];
  const enabled = JSON.parse(docker(['inspect', containerId, '--format', '{{json (index .Config.Labels "traefik.enable")}}']));
  if (enabled !== 'true') return [];
  return keys.map(key => JSON.parse(docker(['inspect', containerId, '--format', `{{json (index .Config.Labels "${key}")}}`])))
    .filter(rule => typeof rule === 'string' && rule.length <= 8192 && /Host\(/.test(rule));
}

function reconcileRejectedWebCandidates({ applicationUuid, backgroundApplicationUuid, docker = runDocker,
  receipts = collectReceipts, routes = routeRules } = {}) {
  validateApplicationUuid(applicationUuid);
  if (backgroundApplicationUuid) {
    validateApplicationUuid(backgroundApplicationUuid);
    if (backgroundApplicationUuid === applicationUuid) throw new Error('Background fallback must be a different resource.');
  }
  const decisions = receipts(applicationUuid, docker);
  const ids = docker(['ps', '--no-trunc', '--filter', `label=com.docker.compose.project=${applicationUuid}`,
    '--filter', 'label=com.oxsteed.runtime=web', '--format', '{{.ID}}']).split(/\s+/).filter(Boolean);
  if (ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('Web candidate identifiers could not be verified.');
  const candidates = ids.map(id => findApplicationContainer({ applicationUuid, runtime: 'web', expectedContainerId: id, docker }));
  if (candidates.some(candidate => !imageDigest(candidate.imageId))) throw new Error('Immutable candidate image identity could not be verified.');
  const removed = [];
  const preserved = [];
  for (const candidate of candidates) {
    const deployment = containerDeployment(candidate);
    const decision = decisions.find(row => row.deploymentId === deployment);
    if (!decision || !['failed', 'cancelled-by-user'].includes(decision.status)) continue;
    // Coolify deliberately retains a healthy release if a later bookkeeping
    // step fails. Do not turn such a failure into an outage.
    if (decision.status === 'failed' && health(candidate.containerId, docker)) {
      preserved.push(candidate.containerId); continue;
    }
    const candidateRules = routes(candidate.containerId, docker);
    if (!candidateRules.length) { preserved.push(candidate.containerId); continue; }
    const sharesRoute = other => routes(other.containerId, docker).some(rule => candidateRules.includes(rule));
    const otherHealthyWeb = candidates.some(other => other.containerId !== candidate.containerId
      && decisions.some(row => row.deploymentId === containerDeployment(other) && row.status === 'finished')
      && health(other.containerId, docker) && sharesRoute(other));
    let backgroundFallback = false;
    if (!otherHealthyWeb && backgroundApplicationUuid) {
      const background = findApplicationContainer({ applicationUuid: backgroundApplicationUuid, docker });
      backgroundFallback = health(background.containerId, docker) && sharesRoute(background);
    }
    if (!otherHealthyWeb && !backgroundFallback) {
      preserved.push(candidate.containerId); continue;
    }
    // Recheck both immutable identity and controller state immediately before
    // removal. Unknown, changed and now-successful candidates are never stopped.
    const current = findApplicationContainer({ applicationUuid, runtime: 'web', expectedContainerId: candidate.containerId, docker });
    const latest = receipts(applicationUuid, docker).find(row => row.deploymentId === deployment);
    if (!latest || latest.status !== decision.status || current.imageId !== candidate.imageId
        || containerDeployment(current) !== deployment) throw new Error('Candidate identity or deployment decision changed; cleanup refused.');
    if (latest.status === 'failed' && health(current.containerId, docker)) { preserved.push(current.containerId); continue; }
    try {
      docker(['stop', '--time', '15', current.containerId]);
      docker(['rm', current.containerId]);
    } catch {
      // The controller may complete its own removal concurrently. Accept only
      // verified absence; a transport error or an existing container retries.
      const remaining = docker(['ps', '-aq', '--no-trunc', '--filter', `id=${current.containerId}`]).split(/\s+/).filter(Boolean);
      if (remaining.length) throw new Error('Rejected candidate cleanup is incomplete; retry next cycle.');
    }
    removed.push({ containerId: current.containerId, deploymentId: deployment, status: latest.status });
  }
  return { applicationUuid, removed, preserved };
}

module.exports = { collectReceipts, containerDeployment, routeRules, reconcileRejectedWebCandidates };
