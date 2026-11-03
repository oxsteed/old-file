'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateReceipt,verifyAnonymousPull,pulledImageMatches,preflightSchema}=require('./promote-prebuilt-web.cjs');
const receipt={gitSha:'a'.repeat(40),digest:'sha256:'+'b'.repeat(64),runId:'123',architecture:'arm64',image:'ghcr.io/oxsteed/old-file-web'};
const run={id:123,status:'completed',conclusion:'success',head_branch:'old-files-claude',path:'.github/workflows/web-image.yml',event:'workflow_run'};
test('bridge promotion requires its own successful manual workflow, pinned base and explicit mode',()=>{
 const bridge={...receipt,kind:'schema-bridge',baseImage:require('../deploy/web-schema-bridge-20261102.json').baseImage};
 const bridgeRun={...run,path:'.github/workflows/web-schema-bridge.yml',event:'workflow_dispatch'};
 assert.equal(validateReceipt(bridge,bridgeRun,{bridge:true}),bridge);
 assert.throws(()=>validateReceipt(bridge,bridgeRun));
 assert.throws(()=>validateReceipt(bridge,run,{bridge:true}));
 assert.throws(()=>validateReceipt(receipt,bridgeRun,{bridge:true}));
 assert.throws(()=>validateReceipt({...bridge,baseImage:'unreviewed'},bridgeRun,{bridge:true}));
 assert.throws(()=>validateReceipt(bridge,{...bridgeRun,event:'workflow_run'},{bridge:true}));
});
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

test('schema preflight reads the healthy app database and checks the exact candidate offline', () => {
  const reference = `${receipt.image}@${receipt.digest}`;
  const snapshot = JSON.stringify([{ filename: 'synthetic.sql', status: 'applied', checksum: null }]);
  const counts = { pending: 3, unexpected: 0, incomplete: 0, unverified: 1, changed: 0, duplicate: 0 };
  let verdict = { ok: false, counts };
  const fakeDocker = (args, input) => {
    if (args[0] === 'ps') {
      assert.ok(args.includes('health=healthy'));
      return 'a'.repeat(12);
    }
    if (args[0] === 'exec') {
      assert.match(args.at(-1), /BEGIN READ ONLY/);
      assert.match(args.at(-1), /SELECT filename, status, checksum FROM public\._migrations/);
      return snapshot;
    }
    assert.equal(args[0], 'run');
    for (const option of ['--network=none', '--pull=never', '--read-only', reference]) assert.ok(args.includes(option));
    assert.ok(!args.some(arg => /^--(env|volume|mount)/.test(arg)));
    assert.equal(input, snapshot);
    return JSON.stringify(verdict);
  };
  assert.deepEqual(preflightSchema(reference, fakeDocker), counts);
  verdict = { ok: true, appliedMigrations: 1 };
  assert.equal(preflightSchema(reference, fakeDocker), null);
  verdict = { ok: false, counts: { ...counts, changed: 1 } };
  assert.throws(() => preflightSchema(reference, fakeDocker), /markers are incompatible/);
  verdict = { ok: true };
  assert.throws(() => preflightSchema(reference, fakeDocker), /invalid schema preflight result/);
  assert.throws(() => preflightSchema(reference, () => ''), /exactly one healthy/);
});
