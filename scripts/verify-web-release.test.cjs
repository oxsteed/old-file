'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED, successfulChecks, verifyCommit } = require('./verify-web-release.cjs');
const sha = 'a'.repeat(40), head = 'b'.repeat(40);
const green = { total_count: 4, check_runs: REQUIRED.map((name,id) => ({ name,id,status:'completed',conclusion:'success' })) };
test('requires every named check and rejects a newer failure or pending rerun', () => {
  assert.equal(successfulChecks(green),true);
  assert.equal(successfulChecks({ ...green, check_runs: green.check_runs.slice(1) }),false);
  for(const status of ['in_progress','completed']) assert.equal(successfulChecks({total_count:5,check_runs:[...green.check_runs,{id:99,name:REQUIRED[0],status,conclusion:'failure'}]}),false);
});
test('accepts verified source or the exact merged pull request, rejecting foreign and unmerged source', () => {
  assert.equal(verifyCommit(sha,()=>green).checkedCommit,sha);
  const pr = {merged_at:'2026-10-30',merge_commit_sha:sha,base:{ref:'old-files-claude'},head:{sha:head,repo:{full_name:'oxsteed/old-file'}},number:1};
  const api = p => p[1].includes('/pulls')?[pr]:p[1].includes(head)?green:{check_runs:[],total_count:0};
  assert.equal(verifyCommit(sha,api).checkedCommit,head);
  for(const patch of [{merged_at:null},{merge_commit_sha:head},{base:{ref:'other'}},{head:{sha:head,repo:{full_name:'other/repo'}}}]) {
    assert.throws(()=>verifyCommit(sha,p=>p[1].includes('/pulls')?[{...pr,...patch}]:{check_runs:[],total_count:0}),/four required CI/);
  }
  assert.throws(()=>verifyCommit('main',api),/full Git commit/);
});
