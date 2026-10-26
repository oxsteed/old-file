'use strict';
jest.mock('../utils/redis',()=>null);
jest.mock('../utils/logger',()=>({warn:jest.fn(),error:jest.fn()}));
const guard=require('../services/openRouterSpendGuard');
const body={model:'unknown-model',messages:[{role:'user',content:'hello'}],max_tokens:100};
const env={NODE_ENV:'test',OPENROUTER_DAILY_SPEND_CAP_USD:'0.05'};
beforeEach(()=>guard._resetLocal());
test('parallel reservations cannot cross the cap, and settlement releases only the excess once',async()=>{
  const unit=guard.estimateMicros(body,env);
  const capEnv={...env,OPENROUTER_DAILY_SPEND_CAP_USD:String(unit*2/1e6)};
  const reservations=await Promise.all(Array.from({length:20},()=>guard.reserve(body,capEnv)));
  expect(reservations.filter(Boolean)).toHaveLength(2);
  const first=reservations.find(Boolean);
  await guard.settle(first,{cost:0});
  await guard.settle(first,{cost:0});
  expect(await guard.reserve(body,capEnv)).toBeTruthy();
  expect(await guard.reserve(body,capEnv)).toBeNull();
});
test('long history, images and a more expensive model reserve more than a short text request',()=>{
  const short=guard.estimateMicros({...body,model:'openai/gpt-mini'},env);
  expect(guard.estimateMicros(body,env)).toBeGreaterThan(short);
  expect(guard.estimateMicros({...body,messages:[{content:'x'.repeat(20000)}]},env)).toBeGreaterThan(guard.estimateMicros(body,env));
  expect(guard.estimateMicros({...body,messages:[{content:[{type:'image_url',image_url:{url:'https://example.com/image'}}]}]},env)).toBeGreaterThan(guard.estimateMicros(body,env));
});
test('missing usage keeps the reservation and a production missing shared store fails closed',async()=>{
  const estimate=guard.estimateMicros(body,env);
  const e={...env,OPENROUTER_DAILY_SPEND_CAP_USD:String(estimate/1e6)};
  const held=await guard.reserve(body,e);
  await guard.settle(held,{});
  expect(await guard.reserve(body,e)).toBeNull();
  expect(await guard.reserve(body,{...env,NODE_ENV:'production'})).toBeNull();
  expect(await guard.reserve({...body,model:'google/model:free'},{NODE_ENV:'production',OPENROUTER_DAILY_SPEND_CAP_USD:'0'})).toEqual({free:true});
});
test('the shared HTTP boundary settles provider cost even for text consumers',async()=>{
  const old=global.fetch;
  global.fetch=jest.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({usage:{cost:0},choices:[{message:{content:'reply'}}]})}));
  const response=await guard.guardedFetch('https://example.test/chat',{body:JSON.stringify(body)});
  expect((await response.json()).usage.cost).toBe(0);
  expect(await response.text()).toContain('reply');
  global.fetch=old;
});
