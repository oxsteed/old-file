'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { readVerifiedReceipt, requireCurrentHead, pullVerifiedImage, preflightSchema } = require('./promote-prebuilt-web.cjs');

const LEGACY_APP = 'tdrapz1vvcoftfwsk7fcdq0h';
const WEB_APP = 'sqbntzhvwhbbywhs9prfhw51';
const NETWORK = 'twsam5aiyvm0w1l2jqxx9ih3';
const SLOT_LABEL = 'com.oxsteed.worker-slot';
const SLOTS = ['oxsteed-worker-a', 'oxsteed-worker-b'];
const FULL_ID = /^[a-f0-9]{64}$/;
const ACTIVATION_FILE = '/run/oxsteed-worker-active';

function docker(args, timeout = 30000) {
  try {
    return execFileSync('docker', ['--context', 'colima', ...args], {
      encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Worker handoff Docker ${args[0]} operation failed.`);
  }
}

function inspect(id, run = docker) {
  if (!FULL_ID.test(id)) throw new Error('Pass a full immutable container ID.');
  return JSON.parse(run(['inspect', '--format', String.raw`{
    "id":{{json .Id}}, "running":{{json .State.Running}}, "exitCode":{{json .State.ExitCode}},
    "imageId":{{json .Image}}, "image":{{json .Config.Image}}, "labels":{{json .Config.Labels}},
    "aliases":{{json (index .NetworkSettings.Networks "twsam5aiyvm0w1l2jqxx9ih3").Aliases}},
    "ports":{{json .HostConfig.PortBindings}}, "privileged":{{json .HostConfig.Privileged}},
    "mounts":{{json .Mounts}}
  }`, id]));
}

function sharedStorage(info) {
  const shared = ['/app/server/runtime/uploads', '/app/server/runtime/web-assets'];
  const metadata = '/app/server/runtime/release-metadata';
  if (info.mounts.some(mount => !shared.includes(mount.Destination)
      && (mount.Destination !== metadata || mount.RW))) throw new Error('Unexpected worker mount.');
  return shared.map(destination => {
    const mounts = info.mounts.filter(mount => mount.Destination === destination);
    if (mounts.length !== 1 || !mounts[0].RW) throw new Error('Required shared worker storage is missing.');
    return mounts[0].Source;
  });
}

function runtimeFingerprint(id, nonce) {
  // Compare essential runtime settings in memory. The config remains in the
  // containers and is never printed, written to disk, or passed as arguments.
  return docker(['exec', id, 'node', '-e', String.raw`
    const { createHmac } = require('node:crypto');
    const keys = ['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'CLAMAV_HOST', 'CLAMAV_PORT', 'DEDICATED_WORKER_PROCESS'];
    console.log(createHmac('sha256', process.argv[1])
      .update(JSON.stringify(keys.map(key => process.env[key]))).digest('hex'));
  `, nonce]);
}

function workerAlias(info) {
  const slot = info.labels?.[SLOT_LABEL];
  if (SLOTS.includes(slot) && info.aliases?.includes(slot) && !info.privileged
      && !Object.keys(info.ports || {}).length && !Object.keys(info.labels).some(key => key.startsWith('traefik.'))) {
    return slot;
  }
  return null;
}

function incumbentAlias(info) {
  if (info.labels?.['coolify.applicationUuid'] === LEGACY_APP
      && info.labels?.['com.docker.compose.service'] === 'app' && info.aliases?.includes('app')) return 'app';
  return workerAlias(info);
}

function privateReady(id, url = 'http://127.0.0.1:5000/ready', run = docker) {
  return JSON.parse(run(['exec', id, 'node', '-e', String.raw`
    fetch(process.argv[1], { redirect: 'error', signal: AbortSignal.timeout(2500) }).then(async response => {
      if (!response.ok) { process.exitCode = 1; return; }
      const { status, releaseMetadata, checks } = await response.json();
      console.log(JSON.stringify({ status, releaseMetadata, worker: checks?.workers }));
    }).catch(() => { process.exitCode = 1; });
  `, url], 4500));
}

function workerReady(result, mode, sha, digest) {
  return result?.status === 'ready' && result.worker?.ok === true && result.worker.mode === mode
    && (!sha || result.releaseMetadata?.gitSha === sha)
    && (!digest || result.releaseMetadata?.imageDigest === digest);
}

function healthyWorkerContainers(run = docker) {
  const list = filters => run(['ps', '--quiet', '--no-trunc', '--filter', 'health=healthy', ...filters])
    .split(/\s+/).filter(Boolean);
  const legacy = list(['--filter', `label=coolify.applicationUuid=${LEGACY_APP}`, '--filter', 'label=com.docker.compose.service=app']);
  const slots = SLOTS.flatMap(slot => list(['--filter', `label=${SLOT_LABEL}=${slot}`]));
  return [...legacy, ...slots].filter(id => {
    try { return !!incumbentAlias(inspect(id, run)) && workerReady(privateReady(id, undefined, run), 'combined'); }
    catch { return false; }
  });
}

async function waitForOwner(id, read, expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      if (workerReady(await read(id), 'combined', expected.gitSha, expected.digest)) return;
    } catch { /* Readiness can fail while the worker starts. */ }
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error('The worker did not prove active ownership before the deadline.');
}

async function waitForWeb(sha, read) {
  const deadline = Date.now() + 15000;
  do {
    try { await read(sha); return; } catch { /* Allow the delegated probe to recover. */ }
    await delay(300);
  } while (Date.now() < deadline);
  throw new Error('The serving web did not recover delegated readiness.');
}

async function handoff({ incumbent, candidate, apply = false, verify, stop, activate, read, start, publicReady }) {
  const { old, next, webSha } = await verify();
  const result = { incumbent, candidate, workerSha: next.gitSha, webSha };
  if (!apply) return { ...result, status: 'standby_verified' };

  try {
    // Stop and drain the old process completely. The new one cannot contend
    // for the lease while staged, including during a controller interruption.
    await stop(incumbent, true);
    await activate(candidate);
    await waitForOwner(candidate, read, next);
    await waitForWeb(webSha, publicReady);
    return { ...result, status: 'worker_promoted' };
  } catch {
    // Keep the original container so its mounts, scanner, and startup
    // configuration survive. A candidate must be stopped before rollback.
    try {
      await stop(candidate, false);
      await start(incumbent);
      await waitForOwner(incumbent, read, old);
      await waitForWeb(webSha, publicReady);
    } catch {
      throw new Error('Worker handoff failed and rollback could not be verified; inspect both pinned containers.');
    }
    throw new Error('Worker handoff failed; the incumbent was restored and verified.');
  }
}

async function publicReady(sha) {
  const response = await fetch('https://oxsteed.com/ready', {
    headers: { 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(6000),
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ready' || body.checks?.workers?.mode !== 'delegated'
      || (sha && body.releaseMetadata?.gitSha !== sha)) {
    throw new Error('The serving web release failed its delegated readiness check.');
  }
  return body.releaseMetadata?.gitSha;
}

async function verifyStage(incumbent, candidate, runId) {
  if (incumbent === candidate || !FULL_ID.test(incumbent) || !FULL_ID.test(candidate)) {
    throw new Error('The incumbent and candidate must be different full container IDs.');
  }
  const { receipt: next } = readVerifiedReceipt(runId);
  if (!requireCurrentHead(next.gitSha)) throw new Error('The candidate must match the current default branch.');
  const { info: image, reference } = await pullVerifiedImage(next);
  if (preflightSchema(reference)) throw new Error('The reviewed schema must be ready before worker handoff.');
  const webSha = await publicReady();
  const active = inspect(incumbent);
  const stage = inspect(candidate);
  const oldHost = incumbentAlias(active);
  const newHost = workerAlias(stage);
  if (!oldHost || !newHost || oldHost === newHost || !active.running || !stage.running
      || stage.imageId !== image.id || stage.image !== reference) {
    throw new Error('Both worker containers must match the private handoff topology and verified image.');
  }
  const nonce = randomBytes(32).toString('hex');
  if (JSON.stringify(sharedStorage(active)) !== JSON.stringify(sharedStorage(stage))
      || runtimeFingerprint(incumbent, nonce) !== runtimeFingerprint(candidate, nonce)) {
    throw new Error('The staged worker must use the incumbent database, Redis, scanner and shared storage.');
  }
  const owners = healthyWorkerContainers();
  if (owners.length !== 1 || owners[0] !== incumbent) throw new Error('The incumbent is not the sole healthy owner.');
  const oldResult = privateReady(incumbent);
  const old = { gitSha: oldResult.releaseMetadata?.gitSha };
  if (!/^[a-f0-9]{40}$/.test(old.gitSha) || !workerReady(oldResult, 'combined', old.gitSha)
      || !workerReady(privateReady(candidate), 'combined-standby', next.gitSha, next.digest)) {
    throw new Error('The incumbent or staged worker did not prove its release identity and readiness.');
  }
  docker(['exec', candidate, 'sh', '-ec', 'test "$OXSTEED_MANAGED_WORKER" = true && test ! -e /run/oxsteed-worker-active']);
  const webIds = docker(['ps', '--quiet', '--no-trunc', '--filter', 'health=healthy',
    '--filter', `label=coolify.applicationUuid=${WEB_APP}`, '--filter', `network=${NETWORK}`]).split(/\s+/);
  if (webIds.length !== 1 || !FULL_ID.test(webIds[0])) throw new Error('The serving web container is ambiguous.');
  const web = webIds[0];
  const observation = JSON.parse(docker(['exec', '--workdir', '/app/server', web, 'node', '-e', String.raw`
    const { WORKER_HANDOFF_PROTOCOL } = require('./bootstrap/delegatedWorkers');
    console.log(JSON.stringify({ protocol: WORKER_HANDOFF_PROTOCOL, urls:
      [process.env.BACKGROUND_READINESS_URL, process.env.BACKGROUND_READINESS_FALLBACK_URL] }));
  `]));
  const endpoints = [`http://${oldHost}:5000/ready`, `http://${newHost}:5000/ready`];
  if (observation.protocol !== 1 || JSON.stringify(observation.urls.sort()) !== JSON.stringify([...endpoints].sort())
      || !workerReady(privateReady(web, endpoints[0]), 'combined', old.gitSha)
      || !workerReady(privateReady(web, endpoints[1]), 'combined-standby', next.gitSha, next.digest)) {
    throw new Error('The serving web must observe both exact worker endpoints before handoff.');
  }
  if (!requireCurrentHead(next.gitSha)) throw new Error('The default branch advanced during preflight.');
  return { old, next, webSha };
}

async function main(args) {
  const [mode, incumbent, candidate, runId] = args;
  if (args.length !== 4 || !['--check', '--apply'].includes(mode)) {
    throw new Error('Use --check|--apply <incumbent-container-id> <candidate-container-id> <verified-image-run-id>.');
  }
  const lock = path.join(os.homedir(), 'Library/Application Support/OxSteed/web-release/state.json.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, String(process.pid));
    return await handoff({
      incumbent, candidate, apply: mode === '--apply', verify: () => verifyStage(incumbent, candidate, runId),
      stop: (id, requireClean) => {
        if (inspect(id).running) docker(['stop', '--time', '20', id]);
        const stopped = inspect(id);
        if (stopped.running || (requireClean && stopped.exitCode !== 0)) throw new Error('Worker did not drain cleanly.');
      },
      activate: id => docker(['exec', id, 'node', '-e',
        "require('node:fs').writeFileSync(process.argv[1], '', { flag: 'wx', mode: 0o600 })", ACTIVATION_FILE]),
      read: privateReady,
      start: id => { if (!inspect(id).running) docker(['start', id]); },
      publicReady,
    });
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.code === 'EEXIST' ? 'The release observer or another worker handoff holds the deployment lock.' : error.message);
    process.exitCode = 1;
  });
}

module.exports = { handoff, healthyWorkerContainers, workerAlias, workerReady };
