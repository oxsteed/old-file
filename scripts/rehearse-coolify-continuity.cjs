'use strict';

// Opt-in rehearsal against the installed controller and proxy. Creates a new
// private network and a synthetic app; never clones environments or storage.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { reconcileRejectedWebCandidates } = require('./reconcile-rejected-web-candidates.cjs');

function docker(args, input) {
  return execFileSync('docker', ['--context', 'colima', ...args], { input, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function php(code, data = {}) {
  const prelude = `$p=json_decode(base64_decode('${Buffer.from(JSON.stringify(data)).toString('base64')}'),true);`;
  const guarded = `${prelude}try{${code}}catch(\\Throwable $e){echo "OXSTEED_RESULT:".json_encode(['operationError'=>get_class($e),'file'=>basename($e->getFile()),'line'=>$e->getLine()]);}`;
  const encoded = Buffer.from(guarded).toString('base64');
  let result;
  try { result = docker(['exec', 'coolify', 'php', 'artisan', 'tinker', '--execute', `eval(base64_decode('${encoded}'));`]); }
  catch { throw new Error('Disposable Coolify operation failed. Inspect its synthetic resource in the controller.'); }
  const match = /OXSTEED_RESULT:(.*)/.exec(result);
  if (!match) throw new Error('Controller did not return a rehearsal receipt.');
  const parsed = JSON.parse(match[1]);
  if (parsed.operationError) throw new Error(`Disposable operation failed: ${parsed.operationError} in ${parsed.file}:${parsed.line}`);
  return parsed;
}
const emit = 'echo "OXSTEED_RESULT:".json_encode($result);';
const appGuard = String.raw`$a=App\Models\Application::where('uuid',$p['application'])->firstOrFail(); if($a->name!=='OxSteed disposable continuity rehearsal') throw new RuntimeException('Fixture identity mismatch');`;

function fixtureDockerfile(release, readyAfterMs = 0, failed = false, readinessLatencyMs = 1200) {
  if (!/^[a-z-]+$/.test(release)) throw new Error('Invalid synthetic release');
  if (!Number.isInteger(readinessLatencyMs) || readinessLatencyMs < 0 || readinessLatencyMs > 2000) throw new Error('Invalid readiness latency');
  const source = `const http=require('node:http');const started=Date.now();let draining=false;const release=${JSON.stringify(release)};const server=http.createServer((req,res)=>{const respond=()=>{const ready=!draining&&!${failed}&&Date.now()-started>=${readyAfterMs};res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');if(req.url==='/ready')res.statusCode=ready?200:503;res.end(JSON.stringify({release,ready}));};if(req.url==='/ready'&&!draining)setTimeout(respond,${readinessLatencyMs});else respond();});server.listen(5000,'0.0.0.0');process.on('SIGTERM',()=>{draining=true;setTimeout(()=>server.close(()=>process.exit(0)),5000);});`;
  return `FROM node:22-alpine\nWORKDIR /fixture\nRUN echo '${Buffer.from(source).toString('base64')}' | base64 -d > server.cjs\nEXPOSE 5000\nHEALTHCHECK --interval=1s --timeout=3s --start-period=1s --retries=30 CMD wget -q -O /dev/null http://127.0.0.1:5000/ready || exit 1\nCMD ["node", "server.cjs"]\n`;
}

function request(hostname) {
  return new Promise(resolve => {
    const start = Date.now();
    // /ready intentionally turns 503 during withdrawal. User traffic must
    // continue succeeding while the proxy observes that private health change.
    const req = http.get({ host: '127.0.0.1', port: 80, path: '/', headers: { Host: hostname }, timeout: 1500 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let release = null;
        try { release = JSON.parse(body).release; } catch { /* Proxy errors remain explicit status failures. */ }
        resolve({ at: new Date().toISOString(), status: res.statusCode, release, ms: Date.now() - start });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ at: new Date().toISOString(), status: 0, release: null, ms: Date.now() - start }));
  });
}

async function main() {
  if (process.env.OXSTEED_DISPOSABLE_CONTINUITY_REHEARSAL !== 'true') throw new Error('Set OXSTEED_DISPOSABLE_CONTINUITY_REHEARSAL=true to create the synthetic Coolify resource.');
  // The opt-in 1s baseline reproduces a false outage when real readiness
  // takes longer than a second while ordinary requests are still fast.
  const proxyTimeout = process.env.OXSTEED_REHEARSAL_PROXY_TIMEOUT === '1s' ? '1s' : '3s';
  const output = path.resolve(process.argv[2] || '/tmp/oxsteed-continuity-rehearsal.json');
  const nonce = crypto.randomBytes(5).toString('hex');
  const hostname = `continuity-${nonce}.invalid`;
  const network = `oxsteed-continuity-${nonce}`;
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), hostname, network, proxyTimeout, readinessLatencyMs: 1200, cases: [] };
  let fixture;
  function save() { fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
  try {
    fixture = php(String.raw`
      $source=App\Models\Application::where('uuid','tdrapz1vvcoftfwsk7fcdq0h')->firstOrFail();
      $destination=App\Models\StandaloneDocker::create(['server_id'=>$source->destination->server_id,'name'=>'OxSteed disposable continuity network','network'=>$p['network']]);
      $a=new App\Models\Application(['name'=>'OxSteed disposable continuity rehearsal','repository_project_id'=>0,'git_repository'=>'coollabsio/coolify','git_branch'=>'main','build_pack'=>'dockerfile','dockerfile'=>$p['dockerfile'],'ports_exposes'=>'5000','environment_id'=>$source->environment_id,'destination_id'=>$destination->id,'destination_type'=>$destination->getMorphClass(),'health_check_enabled'=>true,'health_check_host'=>'127.0.0.1','health_check_path'=>'/ready','health_check_port'=>'5000','health_check_interval'=>1,'health_check_timeout'=>3,'health_check_retries'=>40,'health_check_start_period'=>1,'source_id'=>0,'source_type'=>App\Models\GithubApp::class,'fqdn'=>'http://'.$p['hostname'].':5000']);
      $a->save(); $a->settings->update(['is_auto_deploy_enabled'=>false,'is_consistent_container_name_enabled'=>false,'rolling_update_drain_seconds'=>5]);
      $result=['application'=>$a->uuid,'destination'=>$destination->id,'network'=>$destination->network];
    ` + emit, { network, hostname, dockerfile: fixtureDockerfile('stable') });
    report.fixture = fixture;
    save();
    php(appGuard + String.raw`
      $labels=generateLabelsApplication($a); $ports=array_values(array_filter($labels,fn($l)=>preg_match('/^traefik\.http\.services\..+\.loadbalancer\.server\.port=5000$/',$l)));
      if(count($ports)!==1)throw new RuntimeException('Expected one fixture proxy service');
      $prefix=explode('.server.port=',$ports[0])[0];
      $labels[]=$prefix.'.healthcheck.path=/ready';$labels[]=$prefix.'.healthcheck.interval=1s';$labels[]=$prefix.'.healthcheck.timeout='.$p['proxyTimeout'];
      $labels[]='com.oxsteed.runtime=web';
      $a->update(['custom_labels'=>base64_encode(implode("\n",$labels))]);
      $result=['configured'=>true];
    ` + emit, { ...fixture, proxyTimeout });
    console.log(`Created disposable fixture ${fixture.application} on ${network}`);

    function queue(dockerfile) {
      return php(appGuard + String.raw`
        $a->update(['dockerfile'=>$p['dockerfile']]); $uuid=new_public_id();
        queue_application_deployment(application:$a,deployment_uuid:$uuid,force_rebuild:true);
        $result=['deployment'=>$uuid];
      ` + emit, { ...fixture, dockerfile });
    }
    function snapshot(deployment) {
      return php(appGuard + String.raw`
        $q=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->where('deployment_uuid',$p['deployment'])->firstOrFail();
        $logs=(string)$q->logs;
        $result=['status'=>$q->status,'rolling'=>str_contains($logs,'Rolling update started'),'retainedOld'=>str_contains($logs,'rolling back to the old container'),'cancelObserved'=>str_contains($logs,'cancelled'),'healthy'=>str_contains($logs,'New container is healthy')];
      ` + emit, { ...fixture, deployment });
    }
    async function waitTerminal(deployment, samples, cancelWhenStarting = false) {
      const deadline = Date.now() + 180000;
      let cancelled = false;
      while (Date.now() < deadline) {
        const state = snapshot(deployment);
        if (cancelWhenStarting && state.rolling && !cancelled && state.status === 'in_progress') {
          php(appGuard + String.raw`
            $q=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->where('deployment_uuid',$p['deployment'])->firstOrFail();
            if(!in_array($q->status,['queued','in_progress'])) throw new RuntimeException('No active fixture deployment');
            $q->update(['status'=>'cancelled-by-user']);
            App\Actions\Application\CleanupCancelledDeployment::run($q,(int)$a->team()->id);
            $result=['cancelled'=>true];
          ` + emit, { ...fixture, deployment });
          cancelled = true;
        }
        if (['finished', 'failed', 'cancelled-by-user'].includes(state.status)) return state;
        // Sample continuously through build, readiness and proxy propagation.
        for (let i = 0; i < 5; i++) { samples?.push(await request(hostname)); await delay(200); }
      }
      throw new Error('Fixture deployment observation timed out; existing resource retained for inspection.');
    }

    const initial = queue(fixtureDockerfile('stable'));
    const initialState = await waitTerminal(initial.deployment, null);
    if (initialState.status !== 'finished') throw new Error('Synthetic baseline failed to deploy.');
    let baseline;
    report.baselineSamples = [];
    for (let i = 0; i < 30; i++) {
      baseline = await request(hostname);
      report.baselineSamples.push(baseline);
      if (baseline.status === 200 && baseline.release === 'stable') break;
      await delay(500);
    }
    if (baseline.status !== 200 || baseline.release !== 'stable') throw new Error('Synthetic baseline never became routable.');
    for (const scenario of [
      { name: 'slow-success', release: 'replacement', delay: 10000, failed: false, expected: 'finished', active: 'replacement' },
      { name: 'failed-readiness', release: 'rejected', delay: 0, failed: true, expected: 'failed', active: 'replacement' },
      { name: 'cancelled-startup', release: 'cancelled', delay: 60000, failed: false, cancel: true, expected: 'cancelled-by-user', active: 'replacement' },
    ]) {
      const row = { name: scenario.name, samples: [], startedAt: new Date().toISOString() };
      report.cases.push(row); save();
      const queued = queue(fixtureDockerfile(scenario.release, scenario.delay, scenario.failed));
      row.deployment = queued.deployment;
      row.result = await waitTerminal(queued.deployment, row.samples, scenario.cancel);
      for (let i = 0; i < 30; i++) { row.samples.push(await request(hostname)); await delay(200); }
      // Terminal queue state precedes asynchronous container cleanup. Keep
      // sampling user traffic until it finishes, rather than treating the
      // queue receipt as proof that a rejected candidate can no longer route.
      const cleanupDeadline = Date.now() + 20000;
      do {
        row.rejectionCleanup = reconcileRejectedWebCandidates({ applicationUuid: fixture.application, docker });
        row.runningContainers = docker(['ps', '--filter', `label=com.docker.compose.project=${fixture.application}`, '--format', '{{.ID}}']).split(/\s+/).filter(Boolean).length;
        if (row.runningContainers === 1) break;
        for (let i = 0; i < 5; i++) { row.samples.push(await request(hostname)); await delay(200); }
      } while (Date.now() < cleanupDeadline);
      row.failures = row.samples.filter(sample => sample.status !== 200 || !['stable', 'replacement'].includes(sample.release));
      row.final = row.samples.at(-1);
      row.passed = row.result.status === scenario.expected && row.failures.length === 0 && row.final.release === scenario.active && row.runningContainers === 1;
      save();
      console.log(`${scenario.name}: ${row.result.status}; ${row.samples.length} requests, ${row.failures.length} failures`);
      if (!row.passed) throw new Error(`Continuity rehearsal failed: ${scenario.name}`);
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    // Explicitly scoped cleanup. No production mount, environment or app is touched.
    if (fixture) {
      try {
        php(appGuard + String.raw`
          $active=App\Models\ApplicationDeploymentQueue::where('application_id',$a->id)->whereIn('status',['queued','in_progress'])->get();
          foreach($active as $q){$q->update(['status'=>'cancelled-by-user']);App\Actions\Application\CleanupCancelledDeployment::run($q,(int)$a->team()->id);}
          $result=['safe'=>true];
        ` + emit, fixture);
        const ids = docker(['ps', '-aq', '--filter', `label=coolify.applicationId=${fixture.application}`]).split(/\s+/).filter(Boolean);
        const composeIds = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${fixture.application}`]).split(/\s+/).filter(Boolean);
        for (const id of new Set([...ids, ...composeIds])) {
          if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid fixture container identifier');
          docker(['rm', '-f', id]);
        }
        php(appGuard + String.raw`
          $destination=$a->destination;
          if($destination->id!==$p['destination'] || $destination->network!==$p['network'] || $destination->applications()->count()!==1) throw new RuntimeException('Fixture destination changed');
          $a->forceDelete(); $destination->delete(); $result=['deleted'=>true];
        ` + emit, fixture);
        try { docker(['network', 'disconnect', network, 'coolify-proxy']); } catch { /* Already detached. */ }
        docker(['network', 'rm', network]);
        report.cleanedUp = true;
      } catch { report.cleanedUp = false; }
    }
    save();
    console.log(`Report: ${output}; cleanup=${report.cleanedUp === true}`);
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { fixtureDockerfile };
