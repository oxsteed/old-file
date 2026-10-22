'use strict';
// The NL model fallback must go through OpenRouter, never the Meta Model API
// (Emile's 2026-10-14 standing rule: OpenRouter-only on user-facing paths).
jest.mock('../services/openRouterChat',()=>({isOpenRouterConfigured:jest.fn(()=>true),openRouterChatModel:()=>'synthetic-model',fetchOpenRouterChat:jest.fn()}));
jest.mock('../services/aiChatProvider',()=>({isMetaConfigured:jest.fn(()=>false),getMetaModel:()=>'synthetic-meta-model',fetchMetaChat:jest.fn()}));
const openRouter=require('../services/openRouterChat');
const metaProvider=require('../services/aiChatProvider');
const {translateWithModel}=require('../analytics/nlModelTranslator');
const catalog=[{name:'platform_revenue_cents',dimensions:['period'],filters:[],periods:['7d','30d']}];
const old=process.env.ANALYTICS_NL_MODEL_ENABLED;
beforeEach(()=>{process.env.ANALYTICS_NL_MODEL_ENABLED='true';jest.clearAllMocks();});
afterAll(()=>{if(old==null)delete process.env.ANALYTICS_NL_MODEL_ENABLED;else process.env.ANALYTICS_NL_MODEL_ENABLED=old;});

test('a valid proposal becomes a normalized spec and only catalog/question reach the provider',async()=>{
  const spec={metric:'platform_revenue_cents',dimensions:['period'],filters:{},period:'7d'};
  openRouter.fetchOpenRouterChat.mockResolvedValue({ok:true,reply:JSON.stringify(spec)});
  expect(await translateWithModel('Quels sont nos revenus sur sept jours ?',catalog)).toEqual(spec);
  const payload=JSON.parse(openRouter.fetchOpenRouterChat.mock.calls[0][1][1].content);
  expect(Object.keys(payload).sort()).toEqual(['catalog','question']);
});
test('the Meta provider is never called, even when it claims to be configured',async()=>{
  const spec={metric:'platform_revenue_cents',dimensions:['period'],filters:{},period:'7d'};
  metaProvider.isMetaConfigured.mockReturnValue(true);
  openRouter.fetchOpenRouterChat.mockResolvedValue({ok:true,reply:JSON.stringify(spec)});
  expect(await translateWithModel('Question',catalog)).toEqual(spec);
  expect(metaProvider.fetchMetaChat).not.toHaveBeenCalled();
});
test.each([
  'SELECT * FROM users',
  '{"metric":"platform_revenue_cents","dimensions":[],"filters":{},"period":"7d","sql":"SELECT * FROM users"}',
  '{"metric":"open_disputes","dimensions":[],"filters":{},"period":"7d"}',
  '{"metric":"platform_revenue_cents","dimensions":[],"filters":{"restaurantId":12},"period":"7d"}',
  '{"metric":"platform_revenue_cents","dimensions":"period","filters":{},"period":"7d"}',
])('rejects an invalid or unauthorized model proposal: %s',async reply=>{
  openRouter.fetchOpenRouterChat.mockResolvedValue({ok:true,reply});
  expect((await translateWithModel('Question',catalog)).rejected).toBe(true);
});
test('the provider is never called when disabled or the permitted catalog is empty',async()=>{
  process.env.ANALYTICS_NL_MODEL_ENABLED='false';
  expect((await translateWithModel('Question',catalog)).rejected).toBe(true);
  expect(openRouter.fetchOpenRouterChat).not.toHaveBeenCalled();
  process.env.ANALYTICS_NL_MODEL_ENABLED='true';
  expect((await translateWithModel('Question',[])).rejected).toBe(true);
  expect(openRouter.fetchOpenRouterChat).not.toHaveBeenCalled();
});
test('a provider error fails closed as a rejected proposal',async()=>{
  openRouter.fetchOpenRouterChat.mockResolvedValue({ok:false,error:'HTTP 429'});
  const result=await translateWithModel('Question',catalog);
  expect(result).toEqual({rejected:true,reason:'model translation unavailable'});
});
