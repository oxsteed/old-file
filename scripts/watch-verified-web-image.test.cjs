'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const assert=require('node:assert/strict');const {watch}=require('./watch-verified-web-image.cjs');
test('resumes interrupted attempts, waits for active replacements and stops retrying completed or rejected releases',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'web-observer-test-')),file=path.join(dir,'state.json');
 try {
  const api=()=>({workflow_runs:[{id:123,conclusion:'success',event:'workflow_run'}]});let calls=0;
  fs.writeFileSync(file,JSON.stringify({runId:'123',status:'started'}));
  const promoteImage=async()=>({status:++calls===1?'release_in_progress':'finished'});
  assert.equal((await watch(file,{api,promoteImage})).status,'release_in_progress');
  assert.equal((await watch(file,{api,promoteImage})).status,'finished');
  assert.equal((await watch(file,{api,promoteImage})).status,'already_observed');assert.equal(calls,2);
  fs.writeFileSync(file,JSON.stringify({runId:'123',status:'started'}));
  await assert.rejects(watch(file,{api,promoteImage:async()=>{calls++;throw Error('synthetic rejection');}}),/synthetic rejection/);
  await watch(file,{api,promoteImage});assert.equal(calls,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
