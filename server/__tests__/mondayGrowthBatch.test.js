'use strict';
const {mockQuery,resetMocks}=require('./setup');
jest.mock('../jobs/jobLockingService',()=>({withFencedJobLock:async(_name,fn)=>fn({db:require('../db'),assertActive(){},fencedTransaction:async fn=>fn(require('../db'))})}));
jest.mock('../growth/gate',()=>({contexts:jest.fn(),allow:jest.fn(async ctx=>({allowed:ctx.allowed,context:ctx}))}));
jest.mock('../growth/geo/resolve',()=>({resolveBatch:jest.fn(async()=>[11,12])}));
jest.mock('../growth/propensity',()=>({computeAll:jest.fn(async()=>({users:0}))}));
jest.mock('../growth/rollups/domain',()=>({...jest.requireActual('../growth/rollups/domain'),collectDomainDay:jest.fn(async()=>({sources:{}}))}));
jest.mock('../growth/clickhouse',()=>({getClient:jest.fn()}));
const gate=require('../growth/gate');
const ch=require('../growth/clickhouse');
const {run}=require('../jobs/growthNightlyRollups');
test('nightly batches eligibility and locks, then rechecks consent before writing profiles',async()=>{
 resetMocks();jest.useFakeTimers().setSystemTime(Date.parse('2026-10-26T04:00:00Z'));
 const old={off:process.env.GROWTH_TRACKING_HARD_OFF,ch:process.env.GROWTH_CLICKHOUSE_URL};
 process.env.GROWTH_TRACKING_HARD_OFF='false';process.env.GROWTH_CLICKHOUSE_URL='http://synthetic.test';
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 const subjects=ids.map((user_id,i)=>({user_id,subject_key:String(i+1).repeat(64)}));
 const contexts=new Map(ids.map(id=>[id,{allowed:true,consents:{},user:{id,country_confirmed:true,country:'US',zip_code:'12345'}}]));
 const fresh=new Map(contexts);fresh.set(ids[1],{...contexts.get(ids[1]),allowed:false});
 gate.contexts.mockResolvedValueOnce(contexts).mockResolvedValueOnce(fresh);
 const events=subjects.map(s=>({subject_key:s.subject_key,entity_id:'00000000-0000-4000-8000-000000000099',event_name:'job.posted',postal_ref:11,events:1}));
 ch.getClient.mockReturnValue({query:async()=>({stream:async function*(){yield events.map(event=>({json:()=>event}));}})});
 mockQuery.mockImplementation(async(sql)=>{
   if(sql.includes('INSERT INTO growth_rollup_runs'))return {rows:[{id:1}]};
   if(sql.includes('FROM growth_subject_eligibility WHERE subject_key=ANY'))return {rows:subjects};
   if(sql.includes('DISTINCT ON(i.entity_id)'))return {rows:[{entity_id:events[0].entity_id,node_id:7,sensitive:false}]};
   return {rows:[]};
 });
 try{
   await run();
   expect(gate.contexts).toHaveBeenCalledTimes(2);
   expect(gate.contexts.mock.calls[1][1]).toMatchObject({lockPolicy:true});
   expect(mockQuery.mock.calls.filter(([sql])=>sql.includes('FROM growth_subject_eligibility'))).toHaveLength(1);
   const writes=mockQuery.mock.calls.find(([sql])=>sql.includes('INSERT INTO user_interest_profiles'));
   expect(writes[1]).toContain(ids[0]);expect(writes[1]).not.toContain(ids[1]);
   expect(mockQuery.mock.calls.filter(([sql])=>sql.includes('pg_advisory_xact_lock_shared'))).toHaveLength(1);
 }finally{
   if(old.off===undefined)delete process.env.GROWTH_TRACKING_HARD_OFF;else process.env.GROWTH_TRACKING_HARD_OFF=old.off;
   if(old.ch===undefined)delete process.env.GROWTH_CLICKHOUSE_URL;else process.env.GROWTH_CLICKHOUSE_URL=old.ch;
   jest.useRealTimers();
 }
});
