import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { jobDetailView, samePartyId, matchingHelpersPath, jobList, jobMediaType, JOB_STATUS_KEYS } from '../src/utils/jobDetailModel.js';
const base={id:'job-one',client_id:'1',assigned_helper_id:'2',status:'published',bid_count:0};
const owner={id:1,role:'customer'},helper={id:2,role:'helper'};
const view=(user,job={},options={})=>jobDetailView({job:{...base,...job},user,bidsStatus:'success',canApplyToJobs:true,...options});
test('ownership and assignment require signed-in nonempty normalized IDs; owner wins over helper role',()=>{
  assert.equal(samePartyId({},{}),false); assert.equal(samePartyId([],[]),false); assert.equal(samePartyId(undefined,undefined),false); assert.equal(samePartyId('', ''),false);assert.equal(samePartyId(2,' 2 '),true);
  for(const user of [null,{}, {id:''}]) {const state=view(user,{client_id:undefined,assigned_helper_id:undefined});assert.equal(state.isOwner,false);assert.equal(state.isAssignedHelper,false);}
  const both=view({id:1,role:'helper'},{assigned_helper_id:1,status:'accepted'});assert.equal(both.action,'payment');assert.equal(both.canSubmitBid,false);assert.equal(both.isAssignedHelper,false);
});
test('owners get review, discovery, payment, completion and eligible review priorities',()=>{
  assert.equal(view(owner).action,'findHelpers');
  for(const status of ['published','matched','negotiating'])assert.equal(view(owner,{status,bid_count:5},{bids:[{id:1,helper_id:2}]}).action,'reviewBids');
  assert.equal(view(owner,{status:'accepted'}).action,'payment');assert.equal(view(owner,{status:'in_progress'}).action,'complete');
  for(const status of ['completed','closed']){assert.equal(view(owner,{status},{reviewEligible:true}).action,'review');assert.equal(view(owner,{status}).action,null);}
});
test('helper eligibility, onboarding and existing bid checks gate bidding',()=>{
  assert.equal(view(helper).action,'bid');assert.equal(view(helper,{}, {needsOnboarding:true,canApplyToJobs:false}).action,'onboarding');
  for(const bidsStatus of ['idle','loading','error']) {const state=view(helper,{}, {bidsStatus});assert.equal(state.canSubmitBid,false);assert.equal(state.action,bidsStatus==='error'?'retry':null);}
  assert.equal(view(helper,{}, {canApplyToJobs:false}).canSubmitBid,false);
  for(const role of ['helper','helper_pro','broker'])assert.equal(view({...helper,role}).canSubmitBid,true);
  for(const role of ['customer','admin','business_owner'])assert.equal(view({...helper,role}).canSubmitBid,false);
  for(const status of ['pending','accepted','rejected','withdrawn']){const state=view(helper,{}, {bids:[{helper_id:'2',status}]});assert.equal(state.action,'manageBid');assert.equal(state.canSubmitBid,false);}
});
test('assigned helpers get start, messages and review; unrelated viewers do not',()=>{
  assert.equal(view(helper,{status:'accepted'}).action,'start');assert.equal(view(helper,{status:'in_progress'}).action,'messages');
  assert.equal(view(helper,{status:'closed'},{reviewEligible:true}).action,'review');
  for(const status of ['accepted','in_progress','completed','closed'])assert.equal(view({id:3,role:'helper'},{status},{reviewEligible:true}).action,null);
  assert.equal(view({id:3,role:'customer'}).action,null);assert.equal(view(null).action,'signIn');
});
test('all status labels and terminal action gates are explicit and unknown status is neutral',()=>{
  assert.deepEqual(Object.keys(JOB_STATUS_KEYS),['draft','published','matched','negotiating','accepted','in_progress','completed','closed','cancelled']);
  for(const status of ['draft','cancelled','unrecognized'])for(const user of [owner,helper,null]) {const state=view(user,{status});assert.equal(state.action,null);assert.equal(state.canSubmitBid,false);assert.equal(state.canCancelBeforeAcceptance,false);assert.equal(state.canCancelAfterAcceptance,false);}
  for(const status of ['published','matched','negotiating'])assert.equal(view(owner,{status}).canCancelBeforeAcceptance,true);
  for(const status of ['accepted','in_progress']){assert.equal(view(owner,{status}).canCancelAfterAcceptance,true);assert.equal(view(helper,{status}).canCancelAfterAcceptance,true);assert.equal(view({id:4,role:'helper'},{status}).canCancelAfterAcceptance,false);}
});
test('owner total is independent of loaded list; bidders only see their server-filtered bid',()=>{
  const bids=[{id:1,helper_id:2},{id:2,helper_id:3},null];
  const own=view(owner,{bid_count:'12'},{bids});assert.equal(own.totalBids,12);assert.equal(own.visibleBids.length,2);
  const bidder=view(helper,{bid_count:12},{bids});assert.deepEqual(bidder.visibleBids,[bids[0]]);
  assert.deepEqual(view(null,{}, {bids}).visibleBids,[]);
  for(const bid_count of [undefined,null,-1,'bad'])assert.equal(view(owner,{bid_count}).totalBids,null);
});
test('matching helper links only include usable skill IDs; malformed lists and media types remain safe',()=>{
  assert.equal(matchingHelpersPath([{id:1},{id:'uuid-one'},{id:1},{id:{}},{id:''},{id:'unsafe&x'}]),'/helpers?requiredSkillIds=1%2Cuuid-one');
  for(const input of [null,'bad','{}',{},[null]])assert.equal(matchingHelpersPath(input),'/helpers');
  assert.deepEqual(jobList('[{"id":1},null]'),[{id:1}]);assert.deepEqual(jobList('{}'),[]);
  assert.equal(jobMediaType('/audio.ogg?key=value'),'audio');assert.equal(jobMediaType('/clip.mp4'),'video');assert.equal(jobMediaType('/image.png'),'image');
});
test('new translations have matching legacy and namespace copies in every language',async()=>{
  for(const language of ['en','es','fr','ht','ar']){
    const legacy=JSON.parse(await readFile(new URL(`../src/locales/${language}.json`,import.meta.url)));
    const common=JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`,import.meta.url)));
    assert.equal(Object.keys(common.jobDetail).length,44);
    for(const [key,value]of Object.entries(common.jobDetail)){assert.ok(value.trim());assert.equal(legacy.jobDetail[key],value,`${language} ${key}`);}
  }
});
