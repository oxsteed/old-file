'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateReceipt,verifyAnonymousPull,pulledImageMatches}=require('./promote-prebuilt-web.cjs');
const receipt={gitSha:'a'.repeat(40),digest:'sha256:'+'b'.repeat(64),runId:'123',architecture:'arm64',image:'ghcr.io/oxsteed/old-file-web'};
const run={id:123,status:'completed',conclusion:'success',head_branch:'old-files-claude',path:'.github/workflows/web-image.yml',event:'workflow_run'};
test('accepts exact immutable receipt and rejects untrusted, failed, foreign, or malformed input before pulling',()=>{
 assert.equal(validateReceipt(receipt,run),receipt);
 for(const patch of [{gitSha:'main'},{digest:'latest'},{image:'other/image'},{architecture:'amd64'},{runId:'456'}])assert.throws(()=>validateReceipt({...receipt,...patch},run));
 for(const patch of [{status:'in_progress'},{conclusion:'failure'},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{event:'pull_request'}])assert.throws(()=>validateReceipt(receipt,{...run,...patch}));
});

const crypto=require('node:crypto');
const digest=body=>'sha256:'+crypto.createHash('sha256').update(body).digest('hex');
test('verifies index to ARM64 configuration rather than assuming Docker stores the index digest',async()=>{
 const config='sha256:'+'c'.repeat(64),platform=JSON.stringify({config:{digest:config}}),platformDigest=digest(platform);
 const index=JSON.stringify({manifests:[{digest:platformDigest,platform:{os:'linux',architecture:'arm64'}},{digest:'sha256:'+'d'.repeat(64),platform:{os:'unknown',architecture:'unknown'}}]});
 const root=digest(index);
 const fake=async url=>url.includes('/token?')?{ok:true,json:async()=>({token:'synthetic-public-scope'})}:{ok:true,headers:new Map([['docker-content-digest',url.endsWith(root)?root:platformDigest]]),text:async()=>url.endsWith(root)?index:platform};
 assert.deepEqual(await verifyAnonymousPull(root,fake),{indexDigest:root,platformDigest,configDigest:config});
 await assert.rejects(verifyAnonymousPull(root,async url=>url.includes('/token?')?fake(url):{ok:false,headers:new Map()}),/anonymous pulls/);
 await assert.rejects(verifyAnonymousPull(root,async url=>url.includes('/token?')?fake(url):{ok:true,headers:new Map([['docker-content-digest',root]]),text:async()=>'{"corrupted":true}'}),/manifest bytes/);
});

test('supports verified Docker engine ID representations and refuses unrelated IDs, source or architecture',()=>{
 const manifest={indexDigest:receipt.digest,platformDigest:'sha256:'+'c'.repeat(64),configDigest:'sha256:'+'d'.repeat(64)};
 const info={architecture:'arm64',revision:receipt.gitSha};
 for(const id of Object.values(manifest))assert.equal(pulledImageMatches({...info,id},receipt,manifest),true);
 assert.equal(pulledImageMatches({...info,id:'sha256:'+'e'.repeat(64)},receipt,manifest),false);
 assert.equal(pulledImageMatches({...info,id:receipt.digest,revision:'f'.repeat(40)},receipt,manifest),false);
 assert.equal(pulledImageMatches({...info,id:receipt.digest,architecture:'amd64'},receipt,manifest),false);
});
