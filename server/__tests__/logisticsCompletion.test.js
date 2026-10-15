'use strict';
const {mockQuery,resetMocks}=require('./setup');
const fake=require('./helpers/logisticsPaymentFakeDb');
const payments=require('../services/logisticsPaymentService');
const quotes=require('../services/logisticsQuoteService');
const refunds=require('../services/logisticsRefundService');
const guards=require('../services/logisticsTransitionGuards');
const stripe=require('stripe').__mockInstance;
const key=n=>`11111111-2222-4333-8555-${String(n).padStart(12,'0')}`;
let store,po,quote;
beforeEach(()=>{resetMocks();jest.clearAllMocks();store=fake.createStore();fake.installRoutes(mockQuery,store);
 po=fake.seedPurchaseOrder(store,{id:101,buyer_user_id:'buyer-1'});
 quote=fake.seedQuote(store,{subject_type:'purchase_order',purchase_order_id:101});process.env.STRIPE_SECRET_KEY='sk_test_synthetic';stripe.paymentIntents.create.mockResolvedValue({id:'pi_synthetic',client_secret:'synthetic_confirmation'});});
const pay=(id=1,method='stripe',amount)=>payments.createPaymentAttempt('buyer-1',{idempotencyKey:key(id),subjectType:'purchase_order',purchaseOrderId:101,installment:'deposit',method,amountCents:amount});
test('two confirmations with different keys reuse the existing card intent',async()=>{
 const a=await pay(1);const b=await pay(2);expect(b.attempt.id).toBe(a.attempt.id);expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);expect(store.attempts).toHaveLength(1);
});
test('changing methods while a card is pending cannot also debit Credit',async()=>{
 await pay();await expect(pay(2,'credit')).rejects.toMatchObject({code:'payment_in_progress'});expect(store.attempts).toHaveLength(1);
});
test('settled retry replays before recomputing the zero outstanding balance',async()=>{
 const first=await pay();store.attempts[0].status='succeeded';po.deposit_paid_cents=3000;
 const replay=await pay();expect(replay.attempt.id).toBe(first.attempt.id);expect(replay.idempotentReplay).toBe(true);
});
test('a newly accepted higher quote collects only its outstanding amount',async()=>{
 fake.seedAttempt(store,{buyer_user_id:'buyer-1',subject_type:'purchase_order',purchase_order_id:101,quote_id:quote.id,installment:'deposit',method:'stripe',amount_cents:3000,status:'succeeded',idempotency_key:key(1)});
 po.deposit_paid_cents=3000;fake.seedQuote(store,{subject_type:'purchase_order',purchase_order_id:101,version:2,deposit_cents:4500,final_cents:10500,total_cents:15000});
 const next=await pay(2,'stripe',1500);expect(next.attempt.amount_cents).toBe(1500);expect(next.attempt.quote_id).not.toBe(quote.id);
});
test('quote schedule preserves due amount but exposes only remaining cents to checkout',()=>{
 expect(quotes.buildSchedule({deposit_cents:4500,final_cents:10500},{depositPaidCents:3000,finalPaidCents:0},new Set())[0]).toMatchObject({amount_cents:4500,outstanding_cents:1500,status:'unpaid'});
});
test('duplicate Stripe charges are eligible for staff refund review',async()=>{
 const query=jest.fn().mockResolvedValue({rows:[]});query.mockImplementation(async sql=>({rows:sql.includes('RETURNING *')?[{id:12}]:sql.includes('remaining')?[{refunded_cents:0}]:[]}));
 const deps={query,paymentPort:{getPaymentAttempt:async()=>({id:'9',buyerUserId:'buyer-1',currency:'USD',status:'superseded',method:'stripe',amountCents:3000})},notifyPort:{notify:async()=>{}},withTransaction:async fn=>fn(query),disputePort:{},stripePort:{},creditPort:{},userPort:{}};
 await expect(refunds.proposeRefund(deps,{proposerUserId:'admin',paymentAttemptId:9,amountCents:3000,refundMethod:'stripe',reason:'Duplicate processor charge'})).resolves.toBeDefined();
});
test.each([{deposit_net_cents:299,final_net_cents:700},{deposit_net_cents:300,final_net_cents:699}])('release blocks underfunding or refund encumbrance %j',async balance=>{
 const client={query:jest.fn().mockResolvedValue({rows:[{status:'accepted',deposit_cents:300,final_cents:700,...balance}]})};
 expect(await guards.subjectFullyFunded(client,'pooled_participant',7,'final')).toBe(false);
});
test('a fully prepaid quote releases goods without requiring a nonexistent final payment',async()=>{
 const client={query:jest.fn().mockResolvedValue({rows:[{status:'accepted',deposit_cents:1000,final_cents:0,deposit_net_cents:1000,final_net_cents:0}]})};
 expect(await guards.subjectFullyFunded(client,'purchase_order',1,'final')).toBe(true);
});

test('a transient processor failure retains one resumable attempt', async () => {
  stripe.paymentIntents.create.mockRejectedValueOnce(Object.assign(new Error('Synthetic timeout'), {statusCode:503}));
  await expect(pay(20)).rejects.toMatchObject({code:'processor_unavailable'});
  expect(store.attempts).toHaveLength(1);
  expect(store.attempts[0].status).toBe('pending');
  const retry=await pay(20);
  expect(retry.attempt.id).toBe(store.attempts[0].id);
  expect(store.attempts).toHaveLength(1);
  expect(stripe.paymentIntents.create.mock.calls[0][1].idempotencyKey)
    .toBe(stripe.paymentIntents.create.mock.calls[1][1].idempotencyKey);
});
test('a settled payment cannot be cancelled through unconfirmed-payment recovery', async () => {
  const attempt=fake.seedAttempt(store,{status:'succeeded',method:'stripe'});
  await expect(payments.cancelAttempt(attempt.id)).rejects.toMatchObject({code:'payment_in_progress'});
  expect(store.attempts[0].status).toBe('succeeded');
});
