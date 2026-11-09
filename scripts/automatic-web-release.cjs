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

function combinedController(code) {
  const encoded = Buffer.from(String.raw`
    $a=App\Models\Application::where('uuid','${COMBINED_APPLICATION}')->firstOrFail();
    if($a->git_repository!=='oxsteed/old-file'||$a->git_branch!=='${BRANCH}'||$a->build_pack!=='dockercompose'
      ||$a->settings->is_auto_deploy_enabled||$a->settings->is_consistent_container_name_enabled)
      throw new RuntimeException('Unsafe combined worker deployment target');
  ` + code + `echo 'OXSTEED_RESULT:'.json_encode($result);`).toString('base64');
  const output = docker(['exec','coolify','php','artisan','tinker','--execute',`eval(base64_decode('${encoded}'));`]);
  const match = /OXSTEED_RESULT:(.*)/.exec(output);
  if (!match) throw new Error('Controller did not return a worker deployment receipt.');
  return JSON.parse(match[1]);
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

async function promoteCombinedWorker(gitSha, { runDocker = docker, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const current = combinedController(String.raw`
    $latest=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->orderByDesc('id')->first();
    $active=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->whereIn('status',['queued','in_progress'])->exists();
    $result=['active'=>$active,'latest'=>$latest?['status'=>$latest->status,'commit'=>$latest->commit]:null];
  `);
  if (current.active) return { status: 'worker_release_in_progress', gitSha };
  if (current.latest?.commit === gitSha && ['failed', 'cancelled-by-user'].includes(current.latest.status)) {
    throw new Error('This worker replacement was rejected; inspect it before an explicit retry.');
  }
  const healthy = healthyCombinedContainers(runDocker);
  if (current.latest?.commit === gitSha && current.latest.status === 'finished' && healthy.length === 1) {
    try {
      const ready = combinedReady(healthy[0], runDocker);
      if (ready.status === 'ready' && ready.checks?.workers?.mode === 'combined'
          && ready.releaseMetadata?.gitSha === gitSha) {
        return { status: 'worker_already_current', gitSha };
      }
    } catch { /* retry the exact source commit below */ }
  }
  // The first worker-aware release must not overlap the legacy combined
  // runtime, which predates the advisory ownership lock. Later replacements
  // can roll alongside the old owner and wait in combined-standby until the
  // old process drains and releases the lock.
  let bootstrapOwner = false;
  let legacyContainer = null;
  if (healthy.length === 1) {
    try {
      runDocker(['exec', healthy[0], 'node', '-e', "require('./bootstrap/workerOwnership'); process.stdout.write('owner-aware')"]);
    } catch {
      bootstrapOwner = true;
      legacyContainer = healthy[0];
      runDocker(['stop', '--time', '30', legacyContainer]);
    }
  }
  try {
  const queued = combinedController(String.raw`
    $a->environment_variables()->updateOrCreate(['key'=>'SOURCE_COMMIT','is_preview'=>false],['value'=>'${gitSha}','is_runtime'=>true,'is_buildtime'=>true,'is_literal'=>true]);
    $a->environment_variables()->updateOrCreate(['key'=>'COMMIT_SHA','is_preview'=>false],['value'=>'${gitSha}','is_runtime'=>true,'is_buildtime'=>true,'is_literal'=>true]);
    $a->environment_variables()->updateOrCreate(['key'=>'GIT_SHA','is_preview'=>false],['value'=>'${gitSha}','is_runtime'=>true,'is_buildtime'=>true,'is_literal'=>true]);
    $uuid=new_public_id();
    queue_application_deployment(application:$a,deployment_uuid:$uuid,commit:'${gitSha}',force_rebuild:true);
    $result=['deployment'=>$uuid];
  `);
  if (!/^[a-z0-9]{1,64}$/.test(queued.deployment)) throw new Error('Invalid worker deployment receipt.');
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    const state = combinedController(String.raw`
      $q=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->where('deployment_uuid','${queued.deployment}')->firstOrFail();
      $result=['status'=>$q->status,'commit'=>$q->commit];
    `);
    if (['failed','cancelled-by-user'].includes(state.status)) {
      throw new Error(`Worker replacement ${queued.deployment} was ${state.status}; inspect the retained owner.`);
    }
    if (state.status === 'finished') {
      const candidates = healthyCombinedContainers(runDocker);
      if (candidates.length !== 1) {
        await sleep(5000);
        continue;
      }
      try {
        const ready = combinedReady(candidates[0], runDocker);
        if (ready.status === 'ready' && ready.checks?.workers?.mode === 'combined'
            && ready.releaseMetadata?.gitSha === gitSha) {
          return { status: 'worker_finished', gitSha, deployment: queued.deployment };
        }
      } catch { /* keep observing until the replacement owns workers */ }
    }
    await sleep(5000);
  }
  throw new Error('Timed out waiting for the worker replacement; inspect its exact deployment.');
  } catch (error) {
    if (bootstrapOwner && legacyContainer) {
      try {
        runDocker(['start', legacyContainer]);
        const recoveryDeadline = Date.now() + 120000;
        while (Date.now() < recoveryDeadline) {
          try {
            if (combinedReady(legacyContainer, runDocker).status === 'ready') break;
          } catch { /* keep waiting for the retained owner */ }
          await sleep(2000);
        }
      } catch { /* preserve the original deployment error */ }
    }
    throw error;
  }
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
  const initial = await (deps.promote || promote)(runId);
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
    web = await (deps.promote || promote)(runId);
  }
  if (!['finished', 'already_current'].includes(web.status)) return web;
  const worker = await (deps.promoteWorker || promoteCombinedWorker)(web.gitSha);
  if (!['worker_finished', 'worker_already_current'].includes(worker.status)) {
    return { status: 'waiting_for_worker_promotion', gitSha: web.gitSha, workerStatus: worker.status };
  }
  return { ...web, worker: worker.status, gitSha: web.gitSha };
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

module.exports = { bridgeRuns, ensureBridge, applyBridgeSchema, promoteAutomatic, promoteCombinedWorker };
