'use strict';
// Real installed Traefik, synthetic backends, isolated network, bounded resources.
// Emulate the brief interval before active health checks withdraw a backend.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { retryConfig } = require('./configure-web-readiness.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rehearse(image) {
  const directory = fs.mkdtempSync(path.join(os.homedir(), '.oxsteed-readiness-test-'));
  const network = `oxsteed-ready-test-${process.pid}`;
  const names = ['old','new','proxy'].map(name => network + '-' + name);
  const docker = args => execFileSync('docker', ['--context','colima',...args], {encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
  const state = (name, ready) => fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify({ready}));
  const probe = async (route, method = 'GET', count = 1) => JSON.parse(docker(['exec',names[0],'node','-e',`(async()=>{const r=[];for(let i=0;i<${count};i++){const x=await fetch('http://proxy:8080'+${JSON.stringify(route)},{method:${JSON.stringify(method)},signal:AbortSignal.timeout(5000)});r.push({status:x.status,backend:x.headers.get('x-fixture')});await x.text()}console.log(JSON.stringify(r))})().catch(()=>process.exit(1))`]));
  const counts = () => JSON.parse(docker(['exec',names[0],'node','-e',`Promise.all(['old','new'].map(async n=>(await fetch('http://'+n+':5000/__counts')).json())).then(v=>console.log(JSON.stringify(v)))`]));
  const sum = counts => counts.reduce((n, value) => n + Object.values(value).reduce((a,b) => a+b,0), 0);
  try {
    fs.writeFileSync(path.join(directory,'server.cjs'), `const http=require('http'),fs=require('fs');let counts={};http.createServer((q,s)=>{if(q.url==='/__counts')return s.end(JSON.stringify(counts));const key=q.method+' '+q.url;counts[key]=(counts[key]||0)+1;s.setHeader('x-fixture',process.env.FIXTURE_NAME);s.statusCode=q.url==='/ready'&&fs.readFileSync('/fixture/'+process.env.FIXTURE_NAME+'.json','utf8').includes('true')?200:503;s.end(JSON.stringify({ready:s.statusCode===200}));}).listen(5000,'0.0.0.0');`);
    const config = {http:{routers:{ready:{rule:'Path(`/ready`) && (Method(`GET`) || Method(`HEAD`))',priority:100,service:'app',middlewares:['ready-retry']},fallback:{rule:'PathPrefix(`/`)',service:'app'}},middlewares:{'ready-retry':{retry:retryConfig}},services:{app:{loadBalancer:{servers:[{url:'http://old:5000'},{url:'http://new:5000'}]}}}}};
    // JSON syntax is valid YAML; Traefik's file provider requires a YAML suffix.
    fs.writeFileSync(path.join(directory,'proxy.yml'), JSON.stringify(config));
    state('old', false); state('new', true);
    docker(['network','create','--internal',network]);
    const mount = `type=bind,src=${directory},dst=/fixture,readonly`;
    for (let i=0;i<2;i++) docker(['run','-d','--name',names[i],'--network',network,'--network-alias',i?'new':'old','--memory','64m','--cpus','0.25','--read-only','--no-healthcheck','--mount',mount,'--env',`FIXTURE_NAME=${i?'new':'old'}`,'--entrypoint','node',image,'/fixture/server.cjs']);
    const proxyImage = docker(['inspect','coolify-proxy','--format','{{.Image}}']);
    docker(['run','-d','--name',names[2],'--network',network,'--network-alias','proxy','--memory','96m','--cpus','0.25','--read-only','--mount',mount,proxyImage,'--entrypoints.web.address=:8080','--providers.file.filename=/fixture/proxy.yml','--log.level=ERROR']);
    let results;
    for (let attempt=0;attempt<30;attempt++) {try {results=await probe('/ready');if(results[0].status===200)break;}catch{}await delay(200);}
    assert.equal(results?.[0]?.status,200,'isolated proxy must start successfully');
    results=await probe('/ready','GET',30);
    assert.ok(results.every(row=>row.status===200&&row.backend==='new'),'stale retiring backend must fail over to the healthy backend');
    state('new',false);
    let before=sum(counts());
    const allFailed=await probe('/ready');
    let attempts=sum(counts())-before;
    assert.equal(allFailed[0].status,503,'genuine service failure must remain visible');
    assert.equal(attempts,3,'readiness failure is bounded to three attempts');
    const unreplayed=[];
    for (const [route,method] of [['/ready','POST'],['/api/financial-fixture','POST'],['/api/financial-fixture','GET']]) {
      before=sum(counts());const response=await probe(route,method);attempts=sum(counts())-before;
      assert.equal(response[0].status,503);assert.equal(attempts,1,`${method} ${route} must not be replayed`);
      unreplayed.push({route,method,attempts});
    }
    return {healthyFailovers:results.length,allFailedStatus:allFailed[0].status,allFailedAttempts:3,unreplayed,isolatedNetwork:true};
  } catch (error) {
    // This proxy has only synthetic configuration and no credentials.
    try { console.error(docker(['logs','--tail','12',names[2]])); } catch {}
    throw error;
  } finally {
    for(const name of names)try{docker(['rm','-f',name]);}catch{}
    try{docker(['network','rm',network]);}catch{}
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
if(require.main===module){if(process.argv[2]!=='--image'||process.argv.length!==4){console.error('Use --image <existing-node-runtime-image>');process.exitCode=1;}else rehearse(process.argv[3]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error instanceof assert.AssertionError?error.message:'Isolated readiness retry rehearsal failed; inspect only synthetic containers.');process.exitCode=1;});}
module.exports={rehearse};
