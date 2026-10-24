import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const compiled=await build({entryPoints:[path.join(root,'src/pages/food/restaurantOperationsContext.jsx')],bundle:true,write:false,platform:'browser',format:'esm',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'no-network',setup(plugin){plugin.onResolve({filter:/api\/axios$/},()=>({path:'axios',namespace:'fixture'}));plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default {};'}));}}]});
const {storeInstant,localDate,localInput}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test('operational local dates respect store timezone and 23/25-hour DST days',()=>{
 assert.equal(storeInstant('2026-03-08','America/New_York'),'2026-03-08T05:00:00.000Z');
 assert.equal(Date.parse(storeInstant('2026-03-09','America/New_York'))-Date.parse(storeInstant('2026-03-08','America/New_York')),23*3600000);
 assert.equal(Date.parse(storeInstant('2026-11-02','America/New_York'))-Date.parse(storeInstant('2026-11-01','America/New_York')),25*3600000);
 assert.equal(storeInstant('2026-03-08','America/New_York',true),'2026-03-09T03:59:59.999Z');
 assert.equal(storeInstant('2027-01-01T18:30','Pacific/Honolulu'),'2027-01-02T04:30:00.000Z');
 assert.equal(localDate('Pacific/Honolulu',new Date('2027-01-02T04:30Z')),'2027-01-01');
 assert.equal(localInput('2027-01-02T04:30Z','Pacific/Honolulu'),'2027-01-01T18:30');
});
test('nonexistent local times and impossible calendar dates fail explicitly',()=>{
 assert.throws(()=>storeInstant('2026-03-08T02:30','America/New_York'));
 for(const value of ['2026-02-30','2026-13-01','0000-01-01','2026-01-01T25:00']){
  assert.throws(()=>storeInstant(value,'UTC'));
  assert.throws(()=>storeInstant(value,'UTC',true));
 }
});
