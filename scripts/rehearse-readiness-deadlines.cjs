'use strict';

// Installed Traefik with synthetic HTTP only. No published ports, deployment
// environment, application startup, database, Redis or production volumes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { proxyHealthTimeoutMs } = require('../server/config/readinessBudgets.json');

function rehearse(image) {
  const directory = fs.mkdtempSync(path.join(os.homedir(), '.oxsteed-readiness-deadlines-'));
  const network = `oxsteed-ready-deadlines-${process.pid}`;
  const backend = `${network}-backend`, proxy = `${network}-proxy`;
  const docker = (args, timeout = 30000) => execFileSync('docker', ['--context', 'colima', ...args], {
    encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const server = `
const http=require('node:http');let mode={ready:true,delay:0},writes=0;
http.createServer(async(req,res)=>{
 if(req.url==='/__control'){let body='';for await(const part of req)body+=part;mode=JSON.parse(body);return res.end('{}');}
 if(req.url==='/__counts')return res.end(JSON.stringify({writes}));
 if(req.url==='/ready')return setTimeout(()=>{if(mode.ready===null)return;res.statusCode=mode.ready?200:503;res.end(JSON.stringify({ready:mode.ready}));},mode.delay);
 if(req.method==='POST')writes++;
 res.end('Synthetic traffic remains available');
}).listen(5000,'0.0.0.0');`;
  const probe = `
const assert=require('node:assert/strict'),fs=require('node:fs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const request=async path=>{const response=await fetch('http://proxy:8080'+path,{signal:AbortSignal.timeout(2000)});await response.text();return{status:response.status,version:response.headers.get('x-rollout-version')};};
const status=async path=>(await request(path)).status;
const mode=async value=>{await fetch('http://backend:5000/__control',{method:'POST',body:JSON.stringify(value)});};
async function until(check,limit){const start=Date.now();while(Date.now()-start<limit){try{if(await check())return Date.now()-start;}catch{}await delay(200);}throw Error('Synthetic observation deadline exceeded');}
(async()=>{
 await until(async()=>await status('/legacy')===200&&await status('/aligned')===200,15000);
 await mode({ready:true,delay:3500});
 let legacyFailures=0,alignedFailures=0,samples=0;
 const slowStart=Date.now();while(Date.now()-slowStart<8500){const [old,current]=await Promise.all([status('/legacy'),status('/aligned')]);samples++;if(old!==200)legacyFailures++;if(current!==200)alignedFailures++;await delay(200);}
 assert.ok(legacyFailures>0,'the old 3s deadline must reproduce false withdrawal');
 assert.equal(alignedFailures,0,'a healthy 3.5s readiness response must retain user traffic');
 await mode({ready:false,delay:0});
 const explicitFailureMs=await until(async()=>await status('/aligned')===503,6000);
 await mode({ready:true,delay:0});await until(async()=>await status('/aligned')===200,6000);
 const config=JSON.parse(fs.readFileSync('/fixture/proxy.yml','utf8'));
 const publish=()=>{fs.writeFileSync('/fixture/proxy.yml.tmp',JSON.stringify(config));fs.renameSync('/fixture/proxy.yml.tmp','/fixture/proxy.yml');};
 config.http.middlewares={'roll-old':{headers:{customResponseHeaders:{'X-Rollout-Version':'old'}}},'roll-new':{headers:{customResponseHeaders:{'X-Rollout-Version':'new'}}}};
 config.http.routers['roll-health4']={rule:'PathPrefix(\`/roll\`)',service:'legacy',priority:220,middlewares:['roll-old']};publish();
 await until(async()=>(await request('/roll')).version==='old',6000);
 config.http.routers['roll-health5']={rule:'PathPrefix(\`/roll\`)',service:'aligned',priority:221,middlewares:['roll-new']};publish();
 let rolloverSamples=0,rolloverFailures=0,newObserved=false;
 const rolloverStart=Date.now();while(Date.now()-rolloverStart<4000){const response=await request('/roll');rolloverSamples++;if(response.status!==200)rolloverFailures++;if(response.version==='new')newObserved=true;await delay(100);}
 assert.equal(rolloverFailures,0,'overlapping versioned routers retain user traffic');assert.ok(newObserved,'the new healthy route must take over');
 delete config.http.routers['roll-health4'];delete config.http.routers.legacy;delete config.http.services.legacy;publish();
 await until(async()=>{const r=await request('/roll');return r.status===200&&r.version==='new';},6000);
 const write=await fetch('http://proxy:8080/aligned/write-fixture',{method:'POST',body:'synthetic'});assert.equal(write.status,200);
 const count=await(await fetch('http://backend:5000/__counts')).json();assert.equal(count.writes,1,'ordinary writes must not be replayed');
 await mode({ready:null,delay:0});
 const timeoutFailureMs=await until(async()=>await status('/aligned')===503,${proxyHealthTimeoutMs + 4000});
 console.log(JSON.stringify({samples,legacyFailures,alignedFailures,explicitFailureMs,timeoutFailureMs,rolloverSamples,rolloverFailures,newObserved,writes:count.writes,proxyHealthTimeoutMs:${proxyHealthTimeoutMs},isolatedNetwork:true}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});`;
  try {
    fs.writeFileSync(path.join(directory, 'server.cjs'), server);
    fs.writeFileSync(path.join(directory, 'probe.cjs'), probe);
    const services = Object.fromEntries([['legacy', '3s'], ['aligned', `${proxyHealthTimeoutMs / 1000}s`]].map(([name, timeout]) => [name, {
      loadBalancer: { servers: [{ url: 'http://backend:5000' }], healthCheck: { path: '/ready', interval: '1s', timeout } },
    }]));
    fs.writeFileSync(path.join(directory, 'proxy.yml'), JSON.stringify({ http: {
      routers: Object.fromEntries(['legacy', 'aligned'].map(name => [name, { rule: `PathPrefix(\`/${name}\`)`, service: name }])), services,
    } }));
    docker(['network', 'create', '--internal', network]);
    const mount = `type=bind,src=${directory},dst=/fixture,readonly`;
    docker(['run', '-d', '--name', backend, '--network', network, '--network-alias', 'backend', '--read-only', '--no-healthcheck', '--memory', '64m', '--cpus', '0.25', '--mount', `type=bind,src=${directory},dst=/fixture`, '--entrypoint', 'node', image, '/fixture/server.cjs']);
    const proxyImage = docker(['inspect', 'coolify-proxy', '--format', '{{.Image}}']);
    docker(['run', '-d', '--name', proxy, '--network', network, '--network-alias', 'proxy', '--read-only', '--memory', '128m', '--cpus', '0.25', '--mount', mount, proxyImage, '--entrypoints.web.address=:8080', '--providers.file.filename=/fixture/proxy.yml', '--log.level=ERROR']);
    return JSON.parse(docker(['exec', backend, 'node', '/fixture/probe.cjs'], 60000));
  } finally {
    for (const name of [proxy, backend]) try { docker(['rm', '-f', name]); } catch { /* Only this fixture. */ }
    try { docker(['network', 'rm', network]); } catch { /* Only this fixture. */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
if (require.main === module) {
  if (process.argv.length !== 4 || process.argv[2] !== '--image') {
    console.error('Use --image <existing-node-runtime-image>'); process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(rehearse(process.argv[3]))); }
    catch { console.error('Isolated readiness deadline rehearsal failed; production resources were not changed.'); process.exitCode = 1; }
  }
}
module.exports = { rehearse };
