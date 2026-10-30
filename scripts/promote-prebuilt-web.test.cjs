'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateReceipt}=require('./promote-prebuilt-web.cjs');
const receipt={gitSha:'a'.repeat(40),digest:'sha256:'+'b'.repeat(64),runId:'123',architecture:'arm64',image:'ghcr.io/oxsteed/old-file-web'};
const run={id:123,status:'completed',conclusion:'success',head_branch:'old-files-claude',path:'.github/workflows/web-image.yml',event:'workflow_run'};
test('accepts exact immutable receipt and rejects untrusted, failed, foreign, or malformed input before pulling',()=>{
 assert.equal(validateReceipt(receipt,run),receipt);
 for(const patch of [{gitSha:'main'},{digest:'latest'},{image:'other/image'},{architecture:'amd64'},{runId:'456'}])assert.throws(()=>validateReceipt({...receipt,...patch},run));
 for(const patch of [{status:'in_progress'},{conclusion:'failure'},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{event:'pull_request'}])assert.throws(()=>validateReceipt(receipt,{...run,...patch}));
});
