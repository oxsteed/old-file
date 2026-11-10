'use strict';
// Download only an immutable image receipt from the verified release workflow.
// Production receives a prebuilt image; Coolify's image buildpack cannot compile source.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { REPOSITORY, BRANCH, ghJson, verifyCommit } = require('./verify-web-release.cjs');
const APPLICATION = 'sqbntzhvwhbbywhs9prfhw51';
const COMBINED_APPLICATION = 'tdrapz1vvcoftfwsk7fcdq0h';
const IMAGE = 'ghcr.io/oxsteed/old-file-web';
function bridgePlan(sha, api = ghJson) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full candidate commit is required for the schema plan.');
  const file = api(['api', `repos/${REPOSITORY}/contents/deploy/web-schema-bridge.json?ref=${sha}`]);
  if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string'
      || file.content.length > 32_768) throw new Error('Invalid schema bridge plan file.');
  const source = Buffer.from(file.content, 'base64');
  const plan = JSON.parse(source);
  if (plan.version !== 1 || !/^[a-f0-9]{40}$/.test(plan.baseCommit)
      || (plan.workerBaseCommit !== undefined && !/^[a-f0-9]{40}$/.test(plan.workerBaseCommit))
      || !/^ghcr\.io\/oxsteed\/old-file-web@sha256:[a-f0-9]{64}$/.test(plan.baseImage)
      || !plan.migrations || typeof plan.migrations !== 'object'
      || !Object.keys(plan.migrations).length
      || Object.entries(plan.migrations).some(([name, hash]) =>
        !/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Invalid schema bridge plan.');
  }
  if (plan.transactionWrapped !== undefined && (!Array.isArray(plan.transactionWrapped)
      || new Set(plan.transactionWrapped).size !== plan.transactionWrapped.length
      || plan.transactionWrapped.some(name => !Object.hasOwn(plan.migrations, name)))) {
    throw new Error('Invalid schema bridge transaction wrappers.');
  }
  return { ...plan, checksum: createHash('sha256').update(source).digest('hex') };
}
function command(program, args, input, timeout = 120000) {
  try { return execFileSync(program, args, { input, encoding:'utf8',timeout,stdio:['pipe','pipe','pipe'] }).trim(); }
  catch { throw new Error(`${program} operation failed; credentials and response bodies were omitted.`); }
}
const docker = (args, input, timeout = 600000) => command('docker',['--context','colima',...args],input,timeout);
function validateReceipt(receipt, run, { bridge = false, plan } = {}) {
  if(run.status!=='completed'||run.conclusion!=='success'||run.head_branch!==BRANCH
    ||run.path!==(bridge ? '.github/workflows/web-schema-bridge.yml' : '.github/workflows/web-image.yml')
    ||!(bridge ? ['workflow_dispatch'] : ['workflow_run','workflow_dispatch']).includes(run.event)
    ||receipt.runId!==String(run.id)||receipt.image!==IMAGE||receipt.architecture!=='arm64'
    ||!/^[a-f0-9]{40}$/.test(receipt.gitSha)||!/^sha256:[a-f0-9]{64}$/.test(receipt.digest)) {
    throw new Error('Unverified release workflow or image receipt.');
  }
  if (bridge ? !plan || receipt.kind !== 'schema-bridge' || run.head_sha !== receipt.gitSha
    || receipt.baseImage !== plan.baseImage || receipt.planChecksum !== plan.checksum
    : receipt.kind !== undefined) throw new Error('Unexpected bridge receipt; explicit bridge promotion is required.');
  return receipt;
}
function controller(code) {
  const encoded=Buffer.from(String.raw`
    $a=App\Models\Application::where('uuid','sqbntzhvwhbbywhs9prfhw51')->firstOrFail();
    if($a->git_branch!=='old-files-claude'||$a->settings->is_auto_deploy_enabled||$a->settings->is_consistent_container_name_enabled||count($a->ports_mappings_array)>0)throw new RuntimeException('Unsafe deployment target');
  `+code+String.raw`echo 'OXSTEED_RESULT:'.json_encode($result);`).toString('base64');
  const output=docker(['exec','coolify','php','artisan','tinker','--execute',`eval(base64_decode('${encoded}'));`]);
  const match=/OXSTEED_RESULT:(.*)/.exec(output);
  if(!match)throw new Error('Controller did not return a release receipt.');
  return JSON.parse(match[1]);
}
async function verifyAnonymousPull(digest, fetchImpl=fetch) {
  const response=await fetchImpl('https://ghcr.io/token?service=ghcr.io&scope=repository:oxsteed/old-file-web:pull',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Anonymous image access preflight failed.');
  const token=(await response.json()).token;
  if(typeof token!=='string'||!token)throw new Error('Registry did not return anonymous image access.');
  async function manifest(wanted) {
    const result=await fetchImpl(`https://ghcr.io/v2/oxsteed/old-file-web/manifests/${wanted}`,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}});
    if(!result.ok||result.headers.get('docker-content-digest')!==wanted)throw new Error('The source-only image package must allow anonymous pulls before promotion.');
    const bytes=await result.text();
    if('sha256:'+require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==wanted)throw new Error('Registry manifest bytes differ from their digest.');
    return JSON.parse(bytes);
  }
  let platformDigest=digest;
  let image=await manifest(digest);
  if(Array.isArray(image.manifests)) {
    const targets=image.manifests.filter(m=>m.platform?.os==='linux'&&m.platform?.architecture==='arm64');
    if(targets.length!==1||!/^sha256:[a-f0-9]{64}$/.test(targets[0].digest))throw new Error('Image index must contain exactly one Linux ARM64 image.');
    platformDigest=targets[0].digest;
    image=await manifest(platformDigest);
  }
  if(!/^sha256:[a-f0-9]{64}$/.test(image.config?.digest))throw new Error('Platform image has no immutable configuration identity.');
  return {indexDigest:digest,platformDigest,configDigest:image.config.digest};
}
function pulledImageMatches(info,receipt,manifest) {
  // Classic Docker exposes the config ID; the containerd image store can
  // expose the index or platform manifest ID. All accepted identities are
  // cryptographically bound to the same verified immutable registry reference.
  return info.architecture==='arm64'&&info.revision===receipt.gitSha
    &&[manifest.indexDigest,manifest.platformDigest,manifest.configDigest].includes(info.id);
}

function healthyContainer(application, runDocker = docker) {
  const service = application === COMBINED_APPLICATION ? ['--filter', 'label=com.docker.compose.service=app'] : [];
  const output = runDocker(['ps', '--quiet', '--no-trunc', '--filter', `label=coolify.applicationUuid=${application}`,
    '--filter', 'health=healthy', ...service]);
  if (!output) return null;
  if (!/^[a-f0-9]{64}$/.test(output)) {
    throw new Error('Schema preflight found ambiguous healthy production containers.');
  }
  return output;
}

function preflightSchema(reference, runDocker = docker) {
  const container = healthyContainer(APPLICATION, runDocker) || healthyContainer(COMBINED_APPLICATION, runDocker);
  if (!container) return { status: 'waiting_for_healthy_runtime' };

  // Read from the healthy web or combined application. The candidate receives
  // only migration metadata and has no production network or credentials.
  const snapshot = runDocker(['exec', '--workdir', '/app/server', container, 'node', '-e', `
    const { Client } = require('pg');
    const { getDatabaseSslConfig } = require('./utils/databaseConfig');
    const { DATABASE_URL, NODE_ENV } = process.env;
    if (!DATABASE_URL) process.exit(1);
    const client = new Client({ connectionString: DATABASE_URL,
      ssl: getDatabaseSslConfig(DATABASE_URL, NODE_ENV), connectionTimeoutMillis: 5000,
      statement_timeout: 10000, query_timeout: 12000, application_name: 'oxsteed-promotion-schema-check' });
    (async () => {
      try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
        const { rows } = await client.query('SELECT filename, status, checksum FROM public._migrations');
        await client.query('COMMIT');
        console.log(JSON.stringify(rows));
      } finally { await client.end(); }
    })().catch(() => { process.exitCode = 1; });
  `], undefined, 25000);
  const result = JSON.parse(runDocker(['run', '--rm', '--interactive', '--pull=never', '--network=none',
    '--read-only', '--cap-drop=ALL', '--no-healthcheck', '--memory=128m', '--cpus=0.5',
    '--workdir', '/app/server', '--entrypoint', 'node', reference, 'scripts/check-web-schema-snapshot.cjs'],
  snapshot, 25000));
  if (result?.ok === true && Number.isSafeInteger(result.appliedMigrations) && result.appliedMigrations > 0) return null;
  const fields = ['pending', 'unexpected', 'incomplete', 'unverified', 'changed', 'duplicate'];
  if (result?.ok !== false || fields.some(key => !Number.isSafeInteger(result.counts?.[key]) || result.counts[key] < 0)) {
    throw new Error('Candidate returned an invalid schema preflight result.');
  }
  const counts = Object.fromEntries(fields.map(key => [key, result.counts[key]]));
  if (counts.unexpected || counts.incomplete || counts.changed || counts.duplicate || !counts.pending) {
    throw new Error('Candidate schema markers are incompatible; inspect before an explicit retry.');
  }
  return { status: 'waiting_for_schema', counts };
}

async function publicReadiness() {
  try {
    const response=await fetch('https://oxsteed.com/ready',{signal:AbortSignal.timeout(8000),headers:{'cache-control':'no-cache'}});
    const result=await response.json();
    return response.ok && result.status === 'ready' ? result : null;
  } catch {return null;}
}
async function ready(sha,imageId) {
  const result = await publicReadiness();
  return result?.releaseMetadata?.gitSha === sha
    && result.releaseMetadata.imageDigest === imageId && result.checks?.workers?.mode === 'delegated';
}

async function requireRecoverySource(sha, { findContainer = healthyContainer, readPublic = publicReadiness } = {}) {
  if (findContainer(APPLICATION) || !findContainer(COMBINED_APPLICATION)) {
    throw new Error('Recovery requires an unhealthy or absent web app and one healthy combined app.');
  }
  const current = await readPublic();
  if (current?.releaseMetadata?.gitSha !== sha || current.checks?.workers?.mode !== 'combined') {
    throw new Error('Recovery image must match the healthy combined release serving public traffic.');
  }
}

async function requireBridgeSource(plan, readPublic = publicReadiness) {
  const current = await readPublic();
  if (current?.releaseMetadata?.gitSha !== plan.baseCommit
      || current.releaseMetadata.imageDigest !== plan.baseImage.split('@')[1]
      || current.checks?.workers?.mode !== 'delegated') {
    throw new Error('The schema bridge must preserve the exact healthy web image currently serving traffic.');
  }
}

function readVerifiedReceipt(runId, { bridge = false } = {}) {
  if(!/^\d+$/.test(String(runId)))throw new Error('A numeric workflow run ID is required.');
  const run=ghJson(['api',`repos/${REPOSITORY}/actions/runs/${runId}`]);
  // Validate the workflow before downloading any artifact.
  const workflow = bridge ? '.github/workflows/web-schema-bridge.yml' : '.github/workflows/web-image.yml';
  if(run.status!=='completed'||run.conclusion!=='success'||run.path!==workflow||run.head_branch!==BRANCH)throw new Error('Image workflow has not succeeded.');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oxsteed-image-'));
  try {
    command('gh',['run','download',String(runId),'--repo',REPOSITORY,'--name','web-image-receipt','--dir',directory]);
    const file=path.join(directory,'web-image-receipt.json');
    if(fs.readdirSync(directory).length!==1||fs.statSync(file).size>4096)throw new Error('Unexpected image receipt artifact.');
    const candidate=JSON.parse(fs.readFileSync(file));
    const plan=bridge ? bridgePlan(candidate.gitSha) : undefined;
    const receipt=validateReceipt(candidate,run,{bridge,plan});
    verifyCommit(receipt.gitSha);
    return { receipt, plan };
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}

function requireCurrentHead(sha) {
  return sha === ghJson(['api', `repos/${REPOSITORY}/git/ref/heads/${BRANCH}`]).object.sha;
}

async function pullVerifiedImage(receipt) {
  const manifest=await verifyAnonymousPull(receipt.digest);
  const reference=`${IMAGE}@${receipt.digest}`;
  docker(['pull','--platform','linux/arm64',reference]);
  const info=JSON.parse(docker(['image','inspect',reference,'--format','{"id":{{json .Id}},"architecture":{{json .Architecture}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"digests":{{json .RepoDigests}}}']));
  if(!pulledImageMatches(info,receipt,manifest))throw new Error('Pulled image identity differs from the verified release.');
  return { reference, info };
}

async function promote(runId,{redeploy=false,bridge=false,recover=false,beforePromotion}={}) {
  if (recover && (redeploy || bridge)) throw new Error('Recovery cannot be combined with other promotion modes.');
  const { receipt, plan } = readVerifiedReceipt(runId, { bridge });
  if (recover) await requireRecoverySource(receipt.gitSha);
  else if (!requireCurrentHead(receipt.gitSha)) {
    return { status: 'waiting_for_current_default_branch_image', gitSha: receipt.gitSha };
  }
  const hold = await beforePromotion?.(receipt.gitSha);
  if (hold) return hold;
  const current=controller(String.raw`$latest=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->orderByDesc('id')->first();$active=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->whereIn('status',['queued','in_progress'])->exists();$result=['buildPack'=>$a->build_pack,'image'=>$a->docker_registry_image_name,'tag'=>$a->docker_registry_image_tag,'active'=>$active,'latest'=>$latest?['status'=>$latest->status,'commit'=>$latest->commit]:null];`);
  if(current.active)return {status:'release_in_progress',gitSha:receipt.gitSha};
  const sameTarget=current.buildPack==='dockerimage'&&current.image===IMAGE&&current.tag===`sha256-${receipt.digest.slice(7)}`;
  if(!redeploy&&sameTarget&&current.latest?.commit===receipt.gitSha&&['failed','cancelled-by-user'].includes(current.latest.status))throw new Error('This replacement was rejected; inspect it before an explicit retry.');
  if(!redeploy&&current.buildPack==='dockerimage'&&current.image===IMAGE&&current.tag===`sha256-${receipt.digest.slice(7)}`&&await ready(receipt.gitSha,receipt.digest))return {status:'already_current',gitSha:receipt.gitSha};
  if(!redeploy&&sameTarget&&current.latest?.commit===receipt.gitSha&&current.latest.status==='finished')return {status:'waiting_for_runtime_identity',gitSha:receipt.gitSha};
  // Coolify's image buildpack pulls from the registry itself. Prove that
  // this source-only image is anonymously readable; never copy a user token
  // into the production VM or controller.
  const { reference, info } = await pullVerifiedImage(receipt);
  // Historical bridge images predate the snapshot checker and use their own
  // explicitly reviewed promotion path. Automatic web releases always check.
  if (!bridge) {
    const blocked = preflightSchema(reference);
    if (blocked) return { ...blocked, gitSha: receipt.gitSha };
    if (recover) await requireRecoverySource(receipt.gitSha);
    else if (!requireCurrentHead(receipt.gitSha)) {
      return { status: 'waiting_for_current_default_branch_image', gitSha: receipt.gitSha };
    }
  } else {
    await requireBridgeSource(plan);
  }
  const queued=controller(String.raw`
    if($a->health_check_path!=='/ready'||App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->whereIn('status',['queued','in_progress'])->exists())throw new RuntimeException('Health or active deployment conflict');
    $a->update(['build_pack'=>'dockerimage','docker_registry_image_name'=>'${IMAGE}','docker_registry_image_tag'=>'sha256-${receipt.digest.slice(7)}','git_commit_sha'=>'${receipt.gitSha}']);
    $a->environment_variables()->updateOrCreate(['key'=>'IMAGE_DIGEST','is_preview'=>false],['value'=>'${receipt.digest}','is_runtime'=>true,'is_buildtime'=>false,'is_literal'=>true]);
    $uuid=new_public_id();queue_application_deployment(application:$a,deployment_uuid:$uuid,commit:'${receipt.gitSha}',force_rebuild:false);
    $result=['deployment'=>$uuid];
  `);
  if(!/^[a-z0-9]{1,64}$/.test(queued.deployment))throw new Error('Invalid deployment receipt.');
  const deadline=Date.now()+600000;
  while(Date.now()<deadline){
    const state=controller(String.raw`$q=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->where('deployment_uuid','${queued.deployment}')->firstOrFail();$result=['status'=>$q->status];`);
    if(['failed','cancelled-by-user'].includes(state.status))throw new Error(`Replacement ${queued.deployment} was ${state.status}; inspect the retained working release.`);
    if(state.status==='finished'&&await ready(receipt.gitSha,receipt.digest))return {status:'finished',gitSha:receipt.gitSha,imageDigest:receipt.digest,imageId:info.id,deployment:queued.deployment,runId:String(runId)};
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  throw new Error('Replacement observation timed out; inspect its exact deployment before retrying.');
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length<2||args[0]!=='--run'||args.some((a,i)=>i>1&&!['--redeploy','--bridge','--recover'].includes(a))){console.error('Use --run <verified-image-run-id> [--redeploy|--bridge|--recover]');process.exitCode=1;}
  else promote(args[1],{redeploy:args.includes('--redeploy'),bridge:args.includes('--bridge'),recover:args.includes('--recover')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={bridgePlan,validateReceipt,verifyAnonymousPull,pulledImageMatches,preflightSchema,requireRecoverySource,requireBridgeSource,
  readVerifiedReceipt, requireCurrentHead, pullVerifiedImage, promote};
