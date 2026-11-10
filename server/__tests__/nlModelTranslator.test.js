'use strict';
// Security review 2026-11-10 F-04: the NL model fallback runs on the
// self-hosted Ollama server only; no external AI client exists.
jest.mock('../services/localAiChat',()=>({isLocalAiConfigured:jest.fn(()=>true),localAiModel:()=>'synthetic-model',fetchLocalAiChat:jest.fn()}));
const localAi=require('../services/localAiChat');
const {translateWithModel}=require('../analytics/nlModelTranslator');
const catalog=[{name:'platform_revenue_cents',dimensions:['period'],filters:[],periods:['7d','30d']}];
const old=process.env.ANALYTICS_NL_MODEL_ENABLED;
beforeEach(()=>{process.env.ANALYTICS_NL_MODEL_ENABLED='true';jest.clearAllMocks();});
afterAll(()=>{if(old==null)delete process.env.ANALYTICS_NL_MODEL_ENABLED;else process.env.ANALYTICS_NL_MODEL_ENABLED=old;});

test('a valid proposal becomes a normalized spec and only catalog/question reach the provider',async()=>{
  const spec={metric:'platform_revenue_cents',dimensions:['period'],filters:{},period:'7d'};
  localAi.fetchLocalAiChat.mockResolvedValue({ok:true,reply:JSON.stringify(spec)});
  expect(await translateWithModel('Quels sont nos revenus sur sept jours ?',catalog)).toEqual(spec);
  const payload=JSON.parse(localAi.fetchLocalAiChat.mock.calls[0][0][1].content);
  expect(Object.keys(payload).sort()).toEqual(['catalog','question']);
});
test('no external AI client module remains for this path',()=>{
  for(const mod of ['../services/openRouterChat','../services/metaChatProvider','../services/openRouterSpendGuard']){
    expect(()=>require.resolve(mod)).toThrow();
  }
});
test.each([
  'SELECT * FROM users',
  '{"metric":"platform_revenue_cents","dimensions":[],"filters":{},"period":"7d","sql":"SELECT * FROM users"}',
  '{"metric":"open_disputes","dimensions":[],"filters":{},"period":"7d"}',
  '{"metric":"platform_revenue_cents","dimensions":[],"filters":{"restaurantId":12},"period":"7d"}',
  '{"metric":"platform_revenue_cents","dimensions":"period","filters":{},"period":"7d"}',
])('rejects an invalid or unauthorized model proposal: %s',async reply=>{
  localAi.fetchLocalAiChat.mockResolvedValue({ok:true,reply});
  expect((await translateWithModel('Question',catalog)).rejected).toBe(true);
});
test('the provider is never called when disabled or the permitted catalog is empty',async()=>{
  process.env.ANALYTICS_NL_MODEL_ENABLED='false';
  expect((await translateWithModel('Question',catalog)).rejected).toBe(true);
  expect(localAi.fetchLocalAiChat).not.toHaveBeenCalled();
  process.env.ANALYTICS_NL_MODEL_ENABLED='true';
  expect((await translateWithModel('Question',[])).rejected).toBe(true);
  expect(localAi.fetchLocalAiChat).not.toHaveBeenCalled();
});
test('a provider error fails closed as a rejected proposal',async()=>{
  localAi.fetchLocalAiChat.mockResolvedValue({ok:false,error:'HTTP 429'});
  const result=await translateWithModel('Question',catalog);
  expect(result).toEqual({rejected:true,reason:'model translation unavailable'});
});
