import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GUIDES,HANDBOOKS,guidesForRoute,searchGuides,suggestedAudience,validateRegistry} from '../src/sop/guideRegistry.js';
import {compareSnapshots} from '../../scripts/sop/check-manifest.mjs';

test('published guides and role handbooks form a complete registry',()=>{
 assert.deepEqual(validateRegistry(),{guides:[],handbooks:[]});
 assert.equal(GUIDES.length,81);
 for(const h of HANDBOOKS) {
  assert.ok(h.guideIds.length>0);
  assert.deepEqual(h.guideIds,GUIDES.filter(g=>g.audiences.includes(h.role)).map(g=>g.id));
 }
});
test('contextual routes include actual tasks, dynamic routes and mode suggestions',()=>{
 for(const route of ['/post-job','/settings','/statements','/helper-dashboard','/business/3/onboarding','/logistics/organizer']) assert.ok(guidesForRoute(route).length,route);
 assert.equal(guidesForRoute('/post-job',{default_mode:'customer'})[0].id,'hiring-post-job');
 assert.equal(suggestedAudience({role:'customer',default_mode:'helper'}),'helper');
 assert.equal(suggestedAudience({role:'helper_pro'}),'helper');
 assert.equal(suggestedAudience({role:'customer',default_mode:'business_owner'}),'business');
 for(const route of ['/admin','/admin/jobs','/support/agent','/how-it-works/guides']) assert.deepEqual(guidesForRoute(route),[]);
 assert.ok(searchGuides('statement',{audience:'business'}).every(g=>g.audiences.includes('business')));
});
test('every published step has two real screenshot assets and downloadable guide',()=>{
 const sidecar=JSON.parse(fs.readFileSync(new URL('../src/sop/screenshots.json',import.meta.url)));
 for(const g of GUIDES) {
  for(const s of g.steps) for(const vp of ['desktop','mobile']) {
   const shot=sidecar[`${g.id}/${s.id}/${vp}`]; assert.ok(shot?.src,`${g.id}/${s.id}/${vp}`);
   const bytes=fs.readFileSync(new URL('../public'+shot.src,import.meta.url));
   assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);
  }
  assert.equal(fs.readFileSync(new URL(`../public/sop/pdfs/guides/${g.id}.pdf`,import.meta.url)).subarray(0,5).toString(),'%PDF-');
 }
});
test('review manifest detects changed controls, routes, screenshot bytes, and PDFs',()=>{
 const base={guides:{demo:{sources:{page:'hash'},routes:['/task'],screenshots:{s:'hash'},pdf:'hash'}},handbooks:{helper:{pdf:'hash'}}};
 assert.deepEqual(compareSnapshots(base,structuredClone(base)),[]);
 for(const field of ['sources','routes','screenshots','pdf']) {const after=structuredClone(base);after.guides.demo[field]='changed';assert.deepEqual(compareSnapshots(base,after),['demo']);}
 const after=structuredClone(base);after.handbooks.helper.pdf='changed';assert.deepEqual(compareSnapshots(base,after),['handbook:helper']);
});
