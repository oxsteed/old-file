'use strict';
const fs=require('node:fs');const path=require('node:path');
const {ghJson,REPOSITORY,BRANCH}=require('./verify-web-release.cjs');
const {promote}=require('./promote-prebuilt-web.cjs');
const PREFLIGHT_RECHECK_MS = 5 * 60 * 1000;
const PREFLIGHT_WAIT = ['waiting_for_schema', 'waiting_for_healthy_runtime', 'worker_release_requires_rolling_target'];
const RETRYABLE = ['started', 'release_in_progress', 'waiting_for_runtime_identity',
  'waiting_for_current_default_branch_image', 'waiting_for_schema_bridge',
  'waiting_for_schema_apply', 'waiting_for_worker_promotion',
  'worker_release_in_progress', ...PREFLIGHT_WAIT];
async function watch(stateFile,{api=ghJson,promoteImage=promote}={}){
 fs.mkdirSync(path.dirname(stateFile),{recursive:true,mode:0o700});
 const lock=stateFile+'.lock';let descriptor;
 try {descriptor=fs.openSync(lock,'wx',0o600);fs.writeFileSync(descriptor,String(process.pid));}
 catch(error){if(error.code!=='EEXIST')throw error;const pid=Number(fs.readFileSync(lock,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('Invalid release lock; inspect before retrying.');try{process.kill(pid,0);return{status:'release_in_progress'};}catch(e){if(e.code!=='ESRCH')throw e;fs.unlinkSync(lock);return{status:'stale_lock_removed'};}}
 const save=data=>{const temp=stateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify({...data,at:new Date().toISOString()},null,2),{mode:0o600});fs.renameSync(temp,stateFile);};
 try {
  const runs=api(['api',`repos/${REPOSITORY}/actions/workflows/web-image.yml/runs?status=success&branch=${BRANCH}&per_page=10`]).workflow_runs;
  const run=runs.find(r=>r.conclusion==='success'&&['workflow_run','workflow_dispatch'].includes(r.event));
  if(!run)return{status:'waiting_for_verified_image'};
  const previous=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
  if (previous.runId === String(run.id)) {
   if (PREFLIGHT_WAIT.includes(previous.status) && Date.now() - Date.parse(previous.at) < PREFLIGHT_RECHECK_MS) {
    return { status: 'already_observed', previousStatus: previous.status };
   }
   // Versions before fallback discovery recorded this pre-queue condition as a failure.
   const legacyPreflight = previous.status === 'failed'
     && previous.error === 'Schema preflight requires exactly one healthy production web container.';
   if (!RETRYABLE.includes(previous.status) && !legacyPreflight) return {status:'already_observed',previousStatus:previous.status};
  }
  save({runId:String(run.id),status:'started'});
  try{const result=await promoteImage(String(run.id));save({...result,runId:String(run.id)});return result;}
  catch(error){save({runId:String(run.id),status:'failed',error:error.message});throw error;}
 }finally{fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
if(require.main===module){const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--state-file'||!path.isAbsolute(args[1])){console.error('Use --state-file <absolute path>');process.exitCode=1;}else watch(args[1]).then(r=>{if(!['already_observed','waiting_for_verified_image','release_in_progress'].includes(r.status))console.log(JSON.stringify(r));}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={watch};
