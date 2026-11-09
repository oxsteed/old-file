'use strict';

// Single host-side release controller. GitHub Actions publishes immutable
// artifacts; this process is the only component allowed to promote them.
const { execFileSync } = require('node:child_process');
const { ghJson, REPOSITORY, BRANCH } = require('./verify-web-release.cjs');
const { promote } = require('./promote-prebuilt-web.cjs');
const { watch } = require('./watch-verified-web-image.cjs');

const BRIDGE_WORKFLOW = 'web-schema-bridge.yml';
const WEB_APPLICATION = 'sqbntzhvwhbbywhs9prfhw51';
const COMBINED_APPLICATION = 'tdrapz1vvcoftfwsk7fcdq0h';
const PLAN_FILES = [
  '20261108173000_franchise_royalty_redrive.sql',
  '20261109080000_customer360_worker_heartbeats.sql',
];

function command(args, input = undefined) {
  return execFileSync(args[0], args.slice(1), {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function bridgeRuns(api = ghJson) {
  const result = api(['api', `repos/${REPOSITORY}/actions/workflows/${BRIDGE_WORKFLOW}/runs?branch=${BRANCH}&per_page=30`]);
  return Array.isArray(result.workflow_runs) ? result.workflow_runs : [];
}

function dispatchBridge(sha) {
  command(['gh', 'api', '--method', 'POST',
    `repos/${REPOSITORY}/actions/workflows/${BRIDGE_WORKFLOW}/dispatches`,
    '-f', `ref=${BRANCH}`, '-f', `inputs[release_sha]=${sha}`]);
}

function ensureBridge(sha, api = ghJson, dispatch = dispatchBridge) {
  const existing = bridgeRuns(api)
    .filter(run => run.head_sha === sha && run.event === 'workflow_dispatch')
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (existing) return existing;
  dispatch(sha);
  return null;
}

function docker(args, input) {
  return command(['docker', '--context', 'colima', ...args], input);
}

function bridgePlanPath() {
  const path = require('node:path');
  const local = path.join(__dirname, 'deploy/web-schema-bridge-20261102.json');
  return require('node:fs').existsSync(local)
    ? local : path.join(__dirname, '../deploy/web-schema-bridge-20261102.json');
}

function applyBridgeSchema({ gitSha, runId, list = () => docker([
  'ps', '--quiet', '--no-trunc', '--filter', `label=coolify.applicationUuid=${WEB_APPLICATION}`,
  '--filter', 'health=healthy',
  ]), inspect = id => docker(['inspect', '--format', '{{json .}}', id]), exec = (id, args) => docker(['exec', id, ...args]),
  combinedList = () => docker(['ps', '--quiet', '--no-trunc', '--filter', `label=coolify.applicationUuid=${COMBINED_APPLICATION}`, '--filter', 'health=healthy']),
  copyManifest = (id) => docker(['cp', bridgePlanPath(), `${id}:/app/server/migration-compatibility.json`]),
  verifyCombined = id => JSON.parse(exec(id, ['node', '-e', "fetch('http://127.0.0.1:5000/ready').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"])) } = {}) {
  const ids = String(list()).split(/\s+/).filter(Boolean);
  const candidates = ids.map(id => {
    let info;
    try { info = JSON.parse(inspect(id)); } catch { return null; }
    const labels = info.Config?.Labels || {};
    const revision = labels['org.opencontainers.image.revision'];
    const kind = labels['com.oxsteed.release.kind'];
    return revision === gitSha && kind === 'schema-bridge' ? { id, info } : null;
  }).filter(Boolean);
  if (candidates.length !== 1) {
    return { status: 'waiting_for_schema_apply', gitSha, runId,
      reason: candidates.length ? 'ambiguous_schema_bridge_runtime' : 'schema_bridge_not_healthy' };
  }
  let result;
  try {
    result = JSON.parse(exec(candidates[0].id, ['node', '/app/scripts/apply-reviewed-web-schema.cjs', '--apply']));
  } catch {
    return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'schema_apply_failed' };
  }
  const applied = new Set(result.applied || []);
  if (result.ok !== true || result.pending?.length || PLAN_FILES.some(file => !applied.has(file))) {
    return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'schema_apply_incomplete' };
  }
  const combined = String(combinedList()).split(/\s+/).filter(Boolean);
  if (combined.length !== 1) return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'combined_runtime_not_healthy' };
  try { copyManifest(combined[0]); verifyCombined(combined[0]); }
  catch { return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'combined_runtime_compatibility_not_ready' }; }
  return { status: 'schema_applied', gitSha, runId, applied: PLAN_FILES };
}

async function promoteAutomatic(runId, deps = {}) {
  const candidate = await (deps.promote || promote)(runId);
  if (!['waiting_for_schema', 'waiting_for_schema_apply'].includes(candidate.status)) return candidate;
  const bridge = ensureBridge(candidate.gitSha, deps.api || ghJson, deps.dispatch || dispatchBridge);
  if (!bridge) return { status: 'waiting_for_schema_bridge', gitSha: candidate.gitSha };
  if (bridge.status !== 'completed' || bridge.conclusion !== 'success') {
    return { status: 'waiting_for_schema_bridge', gitSha: candidate.gitSha, bridgeRunId: String(bridge.id), bridgeStatus: bridge.status, bridgeConclusion: bridge.conclusion };
  }
  const bridgeResult = await (deps.promote || promote)(String(bridge.id), { bridge: true });
  if (!['finished', 'already_current'].includes(bridgeResult.status)) {
    return { status: 'waiting_for_schema_apply', gitSha: candidate.gitSha, bridgeRunId: String(bridge.id), bridgeStatus: bridgeResult.status };
  }
  const applied = (deps.applySchema || applyBridgeSchema)({ gitSha: candidate.gitSha, runId: String(bridge.id) });
  if (applied.status !== 'schema_applied') return applied;
  return (deps.promote || promote)(runId);
}

async function main(stateFile) {
  return watch(stateFile, { promoteImage: runId => promoteAutomatic(runId) });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--state-file' || !require('node:path').isAbsolute(args[1])) {
    console.error('Use --state-file <absolute path>'); process.exitCode = 1;
  } else {
    main(args[1]).then(result => {
      if (!['already_observed', 'waiting_for_verified_image', 'release_in_progress'].includes(result.status)) console.log(JSON.stringify(result));
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { bridgeRuns, ensureBridge, applyBridgeSchema, promoteAutomatic };
