'use strict';

// Single host-side release controller. GitHub Actions publishes immutable
// artifacts; this process is the only component allowed to promote them.
const { execFileSync } = require('node:child_process');
const { ghJson, REPOSITORY, BRANCH } = require('./verify-web-release.cjs');
const { bridgePlan, promote } = require('./promote-prebuilt-web.cjs');
const { watch } = require('./watch-verified-web-image.cjs');

const BRIDGE_WORKFLOW = 'web-schema-bridge.yml';
const WEB_APPLICATION = 'sqbntzhvwhbbywhs9prfhw51';
const COMBINED_APPLICATION = 'tdrapz1vvcoftfwsk7fcdq0h';

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

function healthyCombinedContainers(runDocker = docker) {
  return runDocker([
    'ps', '--quiet', '--no-trunc', '--filter', `label=coolify.applicationUuid=${COMBINED_APPLICATION}`,
    '--filter', 'label=com.docker.compose.service=app', '--filter', 'health=healthy',
  ]).split(/\s+/).filter(Boolean);
}

function combinedReady(id, runDocker = docker) {
  return JSON.parse(runDocker(['exec', id, 'node', '-e',
    "fetch('http://127.0.0.1:5000/ready').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"]));
}

const OBSERVER_FILES = new Set([
  'scripts/automatic-web-release.cjs',
  'scripts/automatic-web-release.test.cjs',
  'scripts/promote-prebuilt-web.cjs',
  'scripts/promote-prebuilt-web.test.cjs',
  'scripts/watch-verified-web-image.cjs',
]);

function isWebOnly(file) {
  return typeof file === 'string' && (file.startsWith('client/') || file.startsWith('docs/')
    || file.startsWith('.github/') || OBSERVER_FILES.has(file));
}

function verifyWorkerContinuity(gitSha, { list = healthyCombinedContainers, read = combinedReady, api = ghJson } = {}) {
  const healthy = list();
  const unavailable = { status: 'waiting_for_healthy_runtime', gitSha };
  if (healthy.length !== 1) return unavailable;
  let ready;
  try { ready = read(healthy[0]); } catch { return unavailable; }
  const workerSha = ready.releaseMetadata?.gitSha;
  if (ready.status !== 'ready' || ready.checks?.workers?.mode !== 'combined' || !/^[a-f0-9]{40}$/.test(workerSha)) {
    return unavailable;
  }
  if (workerSha === gitSha) return { status: 'worker_already_current', gitSha, workerSha };
  // Coolify's Compose path stops every old service before starting the new
  // deployment. Keep the healthy owner and allow only changes that can ship
  // independently of it until a rolling worker target exists.
  const diff = api(['api', `repos/${REPOSITORY}/compare/${workerSha}...${gitSha}?per_page=1`,
    '--jq', '{status, files: [.files[]? | {filename, previous_filename}]}']);
  if (diff.status === 'ahead' && Array.isArray(diff.files) && diff.files.length > 0 && diff.files.length < 300
      && diff.files.every(file => isWebOnly(file.filename)
        && (file.previous_filename == null || isWebOnly(file.previous_filename)))) {
    return { status: 'worker_retained', gitSha, workerSha };
  }
  return { status: 'worker_release_requires_rolling_target', gitSha, workerSha };
}

function installCombinedCompatibility(id, migrations) {
  docker(['exec', '--user', '0', '--interactive', '--workdir', '/app/server', id, 'node', '-e', String.raw`
    const fs = require('node:fs');
    const { loadCompatibility } = require('./services/migrationCompatibility');
    const file = 'migration-compatibility.json';
    const approved = loadCompatibility();
    for (const [name, hash] of Object.entries(JSON.parse(fs.readFileSync(0, 'utf8')))) {
      if (Object.hasOwn(approved, name) && approved[name] !== hash) throw Error('Conflicting schema approval');
      approved[name] = hash;
    }
    const tmp = file + '.next';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, migrations: approved }), { mode: 0o644, flag: 'wx' });
    try { loadCompatibility(tmp); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  `], JSON.stringify(migrations));
}

function applyBridgeSchema({ gitSha, runId, plan, list = () => docker([
  'ps', '--quiet', '--no-trunc', '--filter', `label=coolify.applicationUuid=${WEB_APPLICATION}`,
  '--filter', 'health=healthy',
  ]), inspect = id => docker(['inspect', '--format', '{{json .}}', id]), exec = (id, args) => docker(['exec', id, ...args]),
  combinedList = healthyCombinedContainers, copyManifest = installCombinedCompatibility,
  verifyCombined = combinedReady } = {}) {
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
  const combined = combinedList();
  if (combined.length !== 1) {
    return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'combined_runtime_not_healthy' };
  }
  try {
    const verifyOwner = () => {
      const ready = verifyCombined(combined[0]);
      if (ready.status !== 'ready' || ready.releaseMetadata?.gitSha !== plan.baseCommit
          || ready.checks?.workers?.mode !== 'combined') throw Error('Expected healthy worker owner');
    };
    verifyOwner();
    copyManifest(combined[0], plan.migrations);
    verifyOwner();
  } catch {
    return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'combined_runtime_compatibility_not_ready' };
  }
  let result;
  try {
    result = JSON.parse(exec(candidates[0].id, ['node', '/app/scripts/apply-reviewed-web-schema.cjs', '--apply']));
  } catch {
    return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'schema_apply_failed' };
  }
  if (result.ok !== true || !Array.isArray(result.pending) || result.pending.length
      || !Array.isArray(result.applied) || result.applied.some(file => !Object.hasOwn(plan.migrations, file))) {
    return { status: 'waiting_for_schema_apply', gitSha, runId, reason: 'schema_apply_incomplete' };
  }
  return { status: 'schema_applied', gitSha, runId, applied: result.applied };
}

async function promoteAutomatic(runId, deps = {}) {
  const promoteImage = deps.promote || promote;
  let worker;
  const beforePromotion = sha => {
    worker = (deps.verifyWorker || verifyWorkerContinuity)(sha);
    if (!['worker_already_current', 'worker_retained'].includes(worker.status)) return worker;
    return null;
  };
  const initial = await promoteImage(runId, { beforePromotion });
  let web = initial;
  if (['waiting_for_schema', 'waiting_for_schema_apply'].includes(initial.status)) {
    const bridge = ensureBridge(initial.gitSha, deps.api || ghJson, deps.dispatch || dispatchBridge);
    if (!bridge) return { status: 'waiting_for_schema_bridge', gitSha: initial.gitSha };
    if (bridge.status !== 'completed' || bridge.conclusion !== 'success') {
      return { status: 'waiting_for_schema_bridge', gitSha: initial.gitSha, bridgeRunId: String(bridge.id), bridgeStatus: bridge.status, bridgeConclusion: bridge.conclusion };
    }
    const bridgeResult = await (deps.promote || promote)(String(bridge.id), { bridge: true });
    if (!['finished', 'already_current'].includes(bridgeResult.status)) {
      return { status: 'waiting_for_schema_apply', gitSha: initial.gitSha, bridgeRunId: String(bridge.id), bridgeStatus: bridgeResult.status };
    }
    const plan = (deps.loadPlan || bridgePlan)(initial.gitSha);
    const applied = (deps.applySchema || applyBridgeSchema)({ gitSha: initial.gitSha, runId: String(bridge.id), plan });
    if (applied.status !== 'schema_applied') return applied;
    web = await promoteImage(runId, { beforePromotion });
  }
  if (!['finished', 'already_current'].includes(web.status)) return web;
  return { ...web, worker: worker.status, workerSha: worker.workerSha };
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

module.exports = { bridgeRuns, ensureBridge, applyBridgeSchema, promoteAutomatic, verifyWorkerContinuity };
