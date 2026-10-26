'use strict';
const {mockQuery,resetMocks}=require('./setup');
const {createSession}=require('../controllers/diditController');
const {encrypt}=require('../utils/encryption');
const {sendVerificationCode}=require('../services/guestProfileChatVerification');
const {sendOTPEmail}=require('../utils/email');
const broadcast=require('../services/broadcastDeliveryService');
const {publishBatch}=require('../services/restaurantScreenSync');
const {createSingleFlightCache}=require('../utils/singleFlightCache');
const {mapBounded}=require('../utils/boundedBatch');
beforeEach(()=>{resetMocks();jest.clearAllMocks();});
test('a pending Didit session reuses its encrypted URL without making a paid request',async()=>{
  mockQuery.mockResolvedValueOnce({rows:[{didit_status:'pending',didit_session_id:'session-a',didit_session_payload_ciphertext:encrypt(JSON.stringify({verificationUrl:'https://verify.example.test/resume'}))}]});
  const original=global.fetch;global.fetch=jest.fn();
  const res={json:jest.fn(),status:jest.fn().mockReturnThis()};
  await createSession({user:{id:'user-a'}},res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({sessionId:'session-a',reused:true,verificationUrl:'https://verify.example.test/resume'}));
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls[0][0]).toContain('FOR UPDATE');
  global.fetch=original;
});
test('guest cooldown rejects before invalidating the previous code or sending another email',async()=>{
  const db={query:jest.fn(async()=>({rows:[]}))};
  await expect(sendVerificationCode('session-a','a@example.test','Guest',db)).rejects.toMatchObject({status:429,code:'verification_send_limited'});
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][0]).toContain("INTERVAL '60 seconds'");
  expect(sendOTPEmail).not.toHaveBeenCalled();
});
test('oversized broadcast refuses expansion; the allowed audience uses the checked recipient ids',async()=>{
  const old=process.env.BROADCAST_MAX_RECIPIENTS;process.env.BROADCAST_MAX_RECIPIENTS='2';
  const client={query:jest.fn().mockResolvedValueOnce({rows:[{id:1,status:'draft',channel:'email'}]}).mockResolvedValueOnce({rows:[{id:10},{id:11},{id:12}]})};
  await expect(broadcast.queueBroadcast(client,{businessId:2,broadcastId:1})).rejects.toMatchObject({code:'broadcast_audience_limit'});
  expect(client.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO business_broadcast_recipients'))).toBe(false);
  client.query.mockReset().mockResolvedValueOnce({rows:[{id:1,status:'draft',channel:'email'}]}).mockResolvedValueOnce({rows:[{id:10},{id:11}]}).mockResolvedValue({rows:[{id:1}]});
  await broadcast.queueBroadcast(client,{businessId:2,broadcastId:1});
  const insert=client.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO business_broadcast_recipients'));
  expect(insert[1][2]).toEqual([10,11]);
  expect(insert[0]).toContain('ANY($3::bigint[])');
  if(old===undefined)delete process.env.BROADCAST_MAX_RECIPIENTS;else process.env.BROADCAST_MAX_RECIPIENTS=old;
});
test('an idle screen outbox does not begin a transaction',async()=>{
  mockQuery.mockResolvedValue({rows:[]});
  await expect(publishBatch()).resolves.toEqual({published:0});
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
test('duplicate AI work shares a promise, failed work retries and cache capacity stays bounded',async()=>{
  const cache=createSingleFlightCache({max:1});
  let finish;const work=jest.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const a=cache(['message'],work),b=cache(['message'],work);
  await Promise.resolve();finish('draft');
  expect(await a).toBe('draft');expect(await b).toBe('draft');expect(work).toHaveBeenCalledTimes(1);
  expect(await cache(['other'],async()=>'other')).toBe('other');
  await expect(cache(['failure'],async()=>{throw Error('outage');})).rejects.toThrow('outage');
  expect(await cache(['failure'],async()=>'recovered')).toBe('recovered');
});
test('bounded concurrency processes a slow first item without stalling the entire page',async()=>{
  let active=0,peak=0;const seen=[];
  const result=await mapBounded([1,2,3,4,5],2,async value=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));seen.push(value);active--;return value*2;});
  expect(result).toEqual([2,4,6,8,10]);expect(peak).toBe(2);expect(seen).toHaveLength(5);
});
test('a terminal gift delivery webhook routes to gift fulfillment and clears the polling lease',async()=>{
  const {applyEvent}=require('../services/resendWebhookService');
  const client={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:17}]})};
  const result=await applyEvent(client,{type:'email.delivered',created_at:'2026-10-26T08:00:00Z',data:{email_id:'provider-id'}});
  expect(result).toEqual({outcome:'applied',giftCardDeliveryId:17});
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(client.query.mock.calls[1][0]).toContain('lease_token=NULL');
  expect(client.query.mock.calls[1][1].slice(0,2)).toEqual(['provider-id','delivered']);
});
test('parallel lifecycle SMS calls stop at the per-order allowance before sending',async()=>{
  const {sendOrderCreatedSMS}=require('../services/smsNotificationService');
  let reserved=0;
  mockQuery.mockImplementation(async sql=>{
    if(sql.includes('FROM users u'))return {rows:[{phone_number:'+15551234567',phone_e164:'+15551234567',phone_verified:true,sms_enabled:true,sms_notifications:true}]};
    if(sql.includes('FROM sms_logs'))return {rows:[{count:'0'}]};
    if(sql.includes('INSERT INTO order_sms_budgets'))return {rows:++reserved<=2?[{reserved}]:[]};
    return {rows:[],rowCount:1};
  });
  const results=await Promise.all(Array.from({length:5},()=>sendOrderCreatedSMS('user-1',42,1000)));
  expect(results.filter(Boolean)).toHaveLength(2);
  expect(mockQuery.mock.calls.filter(([sql])=>sql.includes('INSERT INTO sms_logs'))).toHaveLength(2);
});
