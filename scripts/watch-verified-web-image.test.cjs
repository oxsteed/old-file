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

test('rechecks pending migrations after five minutes and sees newer releases immediately', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-observer-schema-test-'));
 const file = path.join(dir, 'state.json');
 try {
  let id = 123;
  const api = () => ({ workflow_runs: [{ id, conclusion: 'success', event: 'workflow_run' }] });
  const attempted = [];
  const promoteImage = async runId => {
   attempted.push(runId);
   return { status: 'waiting_for_schema', counts: { pending: 1 } };
  };
  await watch(file, { api, promoteImage });
  assert.equal((await watch(file, { api, promoteImage })).status, 'already_observed');
  const state = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...state, at: '2000-01-01T00:00:00Z' }));
  await watch(file, { api, promoteImage });
  id = 124;
  await watch(file, { api, promoteImage });
  assert.deepEqual(attempted, ['123', '123', '124']);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
