'use strict';
const { execFileSync } = require('node:child_process');

// Execute the real bridge checkers, catalog and immutable manifest with only a
// synthetic metadata query boundary. No network, production data or volumes.
function verifyBridge(image) {
  const probe = String.raw`
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const {verifyWebSchema}=require('./services/webSchemaPreflight');
const {migrationStatus}=require('./services/readinessService');
const approved=require('./migration-compatibility.json').migrations;
const rows=fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).map(filename=>({filename,status:'applied',checksum:crypto.createHash('sha256').update(fs.readFileSync('migrations/'+filename)).digest('hex')}));
const additions=Object.entries(approved).map(([filename,checksum])=>({filename,checksum,status:'applied'}));
const cases=[
 ['baseline',rows,true],
 ['expanded schema',[...rows,...additions],true],
 ['required migration missing',rows.slice(1),false],
 ['unreviewed future',[...rows,{filename:'20990101000000_unreviewed.sql',status:'applied',checksum:'a'.repeat(64)}],false],
 ['changed addition',[...rows,{...additions[0],checksum:'b'.repeat(64)}],false],
 ['unfinished addition',[...rows,{...additions[0],status:'applying'}],false],
 ['legacy baseline',[{...rows[0],checksum:null},...rows.slice(1),...additions],true],
];
(async()=>{for(const [name,markers,ok] of cases){const query=async sql=>{assert.match(sql,/^(BEGIN READ ONLY|SET LOCAL|SELECT|COMMIT|ROLLBACK)/);return {rows:sql.startsWith('SELECT filename')?markers:[]}};const pool={query,connect:async()=>({query,release(){}})};
let startup=true;try{await verifyWebSchema({pool})}catch(e){assert.equal(e.code,'WEB_SCHEMA_NOT_READY');startup=false}
assert.equal(startup,ok,name+' startup');assert.equal((await migrationStatus(pool)).ok,ok,name+' runtime');}
console.log(JSON.stringify({ok:true,cases:cases.length,baseline:rows.length,reviewedAdditions:additions.length}));process.exit(0)})().catch(()=>{console.error('Bridge schema compatibility check failed');process.exit(1)});
`;
  const args = ['run','--rm','--network','none','--read-only','--cpus','0.25','--memory','256m',
    '--entrypoint','node','-e','NODE_ENV=test',image,'-e',probe];
  // Local production inspection is always explicit; hosted runners have their
  // own disposable daemon and no colima context.
  const context = process.platform === 'darwin' ? ['--context','colima'] : [];
  const output = execFileSync('docker',[...context,...args],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  const result = output.split('\n').find(line=>line.startsWith('{"ok":true,'));
  if (!result) throw Error('Bridge did not return a verification receipt');
  return JSON.parse(result);
}
if(require.main===module){
  if(process.argv.length!==4||process.argv[2]!=='--image')throw Error('Use --image <immutable bridge image>');
  console.log(JSON.stringify(verifyBridge(process.argv[3])));
}
module.exports={verifyBridge};
