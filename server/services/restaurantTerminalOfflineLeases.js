'use strict';
// F-08: offline card for real outages (Stripe Terminal store-and-forward).
//
// While online, a paired POS takes a bounded lease (budget, per-sale cap,
// allowed brands, expiry). During an outage the native app collects with the
// Terminal SDK's offline mode, setting metadata.offlineId to a UUID it made
// up, and keeps the sale locally. On reconnect it registers each offline
// payment here. A payment over a limit is still recorded (the card has been
// charged) but goes to the manager review queue instead of being dropped.
// Stripe's account-bound intent is the only thing that can mark money paid.
const crypto=require('crypto');
const pool=require('../db');
const AppError=require('../utils/appError');
const {withTransaction}=require('../utils/transaction');
const terminal=require('./restaurantPosTerminalService');
const offline=require('./restaurantTerminalOffline');
const cardStoreForward=require('./cardStoreForward');
const {reconcilePosOrderPayment}=require('./restaurantPosPaymentLedgerService');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const leaseHours=()=>Math.min(24,Math.max(1,Number(process.env.RESTAURANT_TERMINAL_OFFLINE_LEASE_HOURS)||12));
// Payments registered this long after the lease ended are still recorded,
// but flagged; Stripe forwards offline payments when the reader reconnects.
const LATE_GRACE_MS=10*60*1000;
const UNFORWARDED_REVIEW_HOURS=72;
const BACKLOG_HOURS=24;

function enabled(){if(process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED!=='true')throw new AppError('Offline Terminal is disabled',409,'terminal_offline_disabled');}
const lockKey=(r,l)=>`terminal-offline:${r}:${l}`;

async function issueLease({restaurantId,locationId,deviceId,shiftId,userId,budgetCents}){
  enabled();
  const account=await terminal.resolveRestaurantConnectAccount(restaurantId);
  return withTransaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey(restaurantId,locationId)]);
    const {rows:[policy]}=await client.query('SELECT * FROM restaurant_store_forward_settings WHERE restaurant_id=$1 AND location_id=$2 AND enabled=TRUE',[restaurantId,locationId]);
    if(!policy||!policy.allowed_card_brands?.length)throw new AppError('Review the store offline policy first',409,'terminal_offline_policy_required');
    const {rows:[device]}=await client.query("SELECT id FROM restaurant_devices WHERE id=$1 AND restaurant_id=$2 AND location_id=$3 AND device_role='pos' AND status='active'",[deviceId,restaurantId,locationId]);
    if(!device)throw new AppError('A paired POS is required',403,'pos_device_required');
    const {rows:[shift]}=await client.query("SELECT id FROM restaurant_pos_shifts WHERE id=$1 AND restaurant_id=$2 AND location_id=$3 AND staff_user_id=$4 AND status='open'",[shiftId,restaurantId,locationId,userId]);
    if(!shift)throw new AppError('Open your drawer first',409,'terminal_offline_ticket_invalid');
    // An unworked review queue means earlier outage money is unaccounted for;
    // do not hand out more offline exposure until a manager clears it.
    const {rows:[backlog]}=await client.query(`SELECT COUNT(*)::int AS n FROM restaurant_terminal_offline_payments
      WHERE restaurant_id=$1 AND location_id=$2 AND status='requires_reconciliation' AND created_at<NOW()-make_interval(hours=>$3)`,[restaurantId,locationId,BACKLOG_HOURS]);
    if(backlog.n)throw new AppError('Resolve the offline card review queue first',409,'terminal_offline_reconciliation_backlog');
    await client.query("UPDATE restaurant_terminal_offline_leases SET status='expired',closed_at=NOW() WHERE device_id=$1 AND status='active' AND expires_at<=NOW()",[deviceId]);
    const {rows:[current]}=await client.query("SELECT * FROM restaurant_terminal_offline_leases WHERE device_id=$1 AND status='active'",[deviceId]);
    if(current){
      if(Number(current.shift_id)!==Number(shiftId)||Number(current.restaurant_id)!==Number(restaurantId))throw new AppError('This POS already holds an offline lease',409,'terminal_offline_lease_conflict');
      return current;
    }
    const {rows:[store]}=await client.query('SELECT timezone FROM restaurant_locations WHERE id=$1 AND restaurant_id=$2',[locationId,restaurantId]);
    const {rows:[day]}=await client.query('SELECT (NOW() AT TIME ZONE $1)::date::text AS value',[store?.timezone||'UTC']);
    const remaining=Number(policy.max_daily_cents)-await offline.dailyExposure(client,{restaurantId,locationId,businessDate:day.value});
    const requested=budgetCents==null?Number(policy.max_daily_cents):Number(budgetCents);
    const budget=Math.min(requested,remaining);
    if(!(budget>0))throw new AppError('Offline risk limit exceeded',409,'terminal_offline_limit_exceeded');
    const {rows:[currency]}=await client.query("SELECT COALESCE(NULLIF(currency_code,''),'USD') AS code FROM food_restaurants WHERE id=$1",[restaurantId]);
    const {rows:[lease]}=await client.query(`INSERT INTO restaurant_terminal_offline_leases(id,restaurant_id,location_id,device_id,shift_id,provider_account_id,currency_code,business_date,
      budget_cents,max_transaction_cents,allowed_card_brands,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()+make_interval(hours=>$12),$13) RETURNING *`,
      [crypto.randomUUID(),restaurantId,locationId,deviceId,shiftId,account,(currency?.code||'USD').toUpperCase(),day.value,budget,
        Math.min(Number(policy.max_transaction_cents),budget),policy.allowed_card_brands,leaseHours(),userId]);
    return lease;
  });
}

async function closeLease({restaurantId,leaseId,deviceId}){
  if(!UUID.test(leaseId||''))throw new AppError('Invalid lease',400,'validation_failed');
  const {rows:[lease]}=await pool.query(`UPDATE restaurant_terminal_offline_leases SET status='closed',closed_at=NOW()
    WHERE id=$1 AND restaurant_id=$2 AND device_id=$3 AND status='active' RETURNING *`,[leaseId,restaurantId,deviceId]);
  if(lease)return lease;
  const {rows:[existing]}=await pool.query('SELECT * FROM restaurant_terminal_offline_leases WHERE id=$1 AND restaurant_id=$2 AND device_id=$3',[leaseId,restaurantId,deviceId]);
  if(!existing)throw new AppError('Offline lease not found',404,'terminal_offline_lease_not_found');
  return existing;
}

// Pure: why an offline payment needs a manager look, given its lease.
function reviewReasons(lease,{amountCents,collectedAt}){
  const reasons=[];
  if(amountCents>Number(lease.max_transaction_cents))reasons.push('over_transaction_limit');
  if(Number(lease.consumed_cents)+amountCents>Number(lease.budget_cents))reasons.push('over_lease_budget');
  const at=new Date(collectedAt).getTime();
  if(at<new Date(lease.created_at).getTime()-LATE_GRACE_MS||at>new Date(lease.closed_at||lease.expires_at).getTime()+LATE_GRACE_MS)reasons.push('outside_lease_window');
  return reasons;
}

async function registerPayment({restaurantId,deviceId,leaseId,offlineId,intentId,amountCents,collectedAt,screenTicketId,foodOrderId}){
  if(!UUID.test(leaseId||'')||!UUID.test(offlineId||''))throw new AppError('Invalid offline identity',400,'validation_failed');
  if(intentId!=null&&!/^pi_[A-Za-z0-9]+$/.test(intentId))throw new AppError('Invalid Terminal identity',400,'validation_failed');
  if(!Number.isInteger(amountCents)||amountCents<=0||amountCents>10000000)throw new AppError('Invalid amount',400,'validation_failed');
  if(screenTicketId!=null&&!UUID.test(screenTicketId))throw new AppError('Invalid ticket',400,'validation_failed');
  if(foodOrderId!=null)foodOrderId=Number(foodOrderId);
  if(foodOrderId!=null&&!(Number.isSafeInteger(foodOrderId)&&foodOrderId>0))throw new AppError('Invalid order',400,'validation_failed');
  if(screenTicketId==null&&foodOrderId==null)throw new AppError('A ticket or order is required',400,'validation_failed');
  const at=new Date(collectedAt);
  if(Number.isNaN(at.getTime())||at.getTime()>Date.now()+LATE_GRACE_MS)throw new AppError('Invalid collection time',400,'validation_failed');
  const row=await withTransaction(pool,async client=>{
    const {rows:[lease]}=await client.query('SELECT * FROM restaurant_terminal_offline_leases WHERE id=$1 AND restaurant_id=$2 AND device_id=$3 FOR UPDATE',[leaseId,restaurantId,deviceId]);
    // Registration is allowed after the lease ends: the money was taken while
    // offline and must reach the ledger or the review queue.
    if(!lease)throw new AppError('Offline lease not found',404,'terminal_offline_lease_not_found');
    const {rows:[existing]}=await client.query('SELECT * FROM restaurant_terminal_offline_payments WHERE offline_id=$1',[offlineId]);
    if(existing){
      if(existing.lease_id!==lease.id||existing.amount_cents!==amountCents||(intentId&&existing.provider_payment_intent_id&&existing.provider_payment_intent_id!==intentId))
        throw new AppError('Offline payment already registered differently',409,'terminal_offline_payment_conflict');
      if(intentId&&!existing.provider_payment_intent_id)
        await client.query('UPDATE restaurant_terminal_offline_payments SET provider_payment_intent_id=$2,updated_at=NOW() WHERE offline_id=$1',[offlineId,intentId]);
      return {...existing,provider_payment_intent_id:existing.provider_payment_intent_id||intentId,replayed:true};
    }
    const reasons=reviewReasons(lease,{amountCents,collectedAt:at});
    const {rows:[created]}=await client.query(`INSERT INTO restaurant_terminal_offline_payments(offline_id,lease_id,restaurant_id,location_id,screen_ticket_id,food_order_id,
      provider_payment_intent_id,amount_cents,collected_at,status,review_reasons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [offlineId,lease.id,restaurantId,lease.location_id,screenTicketId||null,foodOrderId||null,intentId||null,amountCents,at,reasons.length?'requires_reconciliation':'recorded',reasons]);
    await client.query('UPDATE restaurant_terminal_offline_leases SET consumed_cents=consumed_cents+$2 WHERE id=$1',[lease.id,amountCents]);
    return created;
  });
  return attach({restaurantId,offlineId:row.offline_id});
}

async function flag(client,offlineId,reason){
  await client.query(`UPDATE restaurant_terminal_offline_payments SET status='requires_reconciliation',
    review_reasons=CASE WHEN $2=ANY(review_reasons) THEN review_reasons ELSE array_append(review_reasons,$2) END,updated_at=NOW() WHERE offline_id=$1`,[offlineId,reason]);
}

// Attach an offline payment to its order (once the offline ticket has been
// accepted) as a pending tender, then let Stripe's intent settle it.
async function attach({restaurantId,offlineId}){
  const {rows:[payment]}=await pool.query('SELECT * FROM restaurant_terminal_offline_payments WHERE offline_id=$1 AND restaurant_id=$2',[offlineId,restaurantId]);
  if(!payment)throw new AppError('Offline payment not found',404,'terminal_offline_payment_not_found');
  if(['declined','voided'].includes(payment.status))return {payment,attached:false};
  const attachedState=await withTransaction(pool,async client=>{
    const {rows:[p]}=await client.query('SELECT * FROM restaurant_terminal_offline_payments WHERE offline_id=$1 FOR UPDATE',[offlineId]);
    const {rows:[permitExisting]}=await client.query('SELECT * FROM restaurant_terminal_offline_permits WHERE id=$1',[offlineId]);
    if(permitExisting)return {payment:p,permit:permitExisting};
    let orderId=p.food_order_id;
    if(!orderId&&p.screen_ticket_id){
      const {rows:[ticket]}=await client.query("SELECT order_id FROM restaurant_screen_tickets WHERE id=$1 AND restaurant_id=$2 AND status='accepted'",[p.screen_ticket_id,restaurantId]);
      orderId=ticket?.order_id||null;
    }
    if(!orderId)return {payment:p,waiting:true};
    const {rows:[lease]}=await client.query('SELECT * FROM restaurant_terminal_offline_leases WHERE id=$1',[p.lease_id]);
    const {rows:[order]}=await client.query('SELECT * FROM food_orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',[orderId,restaurantId]);
    if(!order||Number(order.location_id)!==Number(p.location_id)){await flag(client,offlineId,'order_not_found');return {payment:p,flagged:true};}
    const {rows:[other]}=await client.query('SELECT id FROM restaurant_terminal_offline_permits WHERE food_order_id=$1',[orderId]);
    if(other){await flag(client,offlineId,'order_already_has_offline_card');return {payment:p,flagged:true};}
    const {rows:[activity]}=await client.query("SELECT COUNT(*)::int AS n FROM restaurant_pos_payments WHERE food_order_id=$1 AND status IN ('pending','recorded','captured')",[orderId]);
    if(activity.n||order.payment_status==='paid'){await flag(client,offlineId,'order_already_paid');return {payment:p,flagged:true};}
    if(Number(order.total_cents)!==Number(p.amount_cents)){await flag(client,offlineId,'amount_differs_from_order');return {payment:p,flagged:true};}
    const {rows:[permit]}=await client.query(`INSERT INTO restaurant_terminal_offline_permits(id,restaurant_id,location_id,device_id,food_order_id,shift_id,amount_cents,
      currency_code,provider_account_id,business_date,expires_at,created_by,policy_snapshot,lease_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [offlineId,restaurantId,p.location_id,lease.device_id,orderId,lease.shift_id,p.amount_cents,lease.currency_code,lease.provider_account_id,lease.business_date,
        lease.expires_at,lease.created_by,{allowedBrands:lease.allowed_card_brands,maxTransactionCents:lease.max_transaction_cents,leaseId:lease.id},lease.id]);
    const {rows:[reservation]}=await client.query(`INSERT INTO restaurant_pos_payments
      (restaurant_id,location_id,food_order_id,shift_id,payment_type,amount_cents,status,provider,provider_account_id,idempotency_key,created_by,metadata)
      VALUES($1,$2,$3,$4,'card',$5,'pending','stripe_terminal',$6,$7,$8,$9) RETURNING id`,
      [restaurantId,p.location_id,orderId,lease.shift_id,p.amount_cents,lease.provider_account_id,`terminal-offline:${offlineId}`,lease.created_by,{offlinePermitId:offlineId,offlineLeaseId:lease.id}]);
    await client.query('UPDATE restaurant_terminal_offline_permits SET pos_payment_id=$2 WHERE id=$1',[offlineId,reservation.id]);
    await client.query(`UPDATE restaurant_terminal_offline_payments SET food_order_id=$2,status=CASE WHEN status='requires_reconciliation' THEN status ELSE 'attached' END,updated_at=NOW() WHERE offline_id=$1`,[offlineId,orderId]);
    await reconcilePosOrderPayment(client,orderId);
    return {payment:p,permit};
  });
  if(!attachedState.permit)return {...attachedState,attached:false};
  const intentId=attachedState.payment.provider_payment_intent_id||attachedState.permit.provider_payment_intent_id;
  if(!intentId)return {...attachedState,attached:true,settled:false};
  // Card store-and-forward settlement mode (flag-gated; see
  // cardStoreForward.js). Flag OFF, or an automatic-mode store, settles
  // exactly as before. A manual-review store with the flag ON records the
  // Stripe-verified payment but holds it for manager accept instead of
  // marking the order paid. With the flag off no policy query runs at all,
  // so the flag-off path is query-identical to before.
  const holdForManagerReview = cardStoreForward.isGloballyEnabled()
    && cardStoreForward.shouldHoldForManagerReview(
      await cardStoreForward.getStoreForwardPolicy(pool, restaurantId, attachedState.payment.location_id));
  try{
    const settled=await offline.reconcileForwarded({restaurantId,permitId:offlineId,intentId,holdForManagerReview});
    if(settled?.held){
      await withTransaction(pool,client=>flag(client,offlineId,'manual_review_required'));
      return {...attachedState,attached:true,settled:false,held:true,flagged:true};
    }
    return {...attachedState,attached:true,settled:true,result:settled};
  }catch(error){
    if(!(error instanceof AppError))throw error;
    await withTransaction(pool,client=>flag(client,offlineId,error.code||'stripe_mismatch'));
    return {...attachedState,attached:true,settled:false,flagged:true,code:error.code};
  }
}

// Background sweep: expire leases, attach payments whose tickets were
// accepted, and chase permits the device never reported back via Stripe.
async function sweep({limit=200,now=new Date()}={}){
  const out={expired:0,attached:0,reconciled:0,flagged:0};
  out.expired=(await pool.query("UPDATE restaurant_terminal_offline_leases SET status='expired',closed_at=NOW() WHERE status='active' AND expires_at<=$1",[now])).rowCount;
  const {rows:waiting}=await pool.query(`SELECT p.offline_id,p.restaurant_id FROM restaurant_terminal_offline_payments p
    WHERE p.status IN ('recorded','requires_reconciliation') AND NOT EXISTS (SELECT 1 FROM restaurant_terminal_offline_permits t WHERE t.id=p.offline_id)
    ORDER BY p.created_at LIMIT $1`,[limit]);
  for(const w of waiting){const r=await attach({restaurantId:w.restaurant_id,offlineId:w.offline_id}).catch(()=>null);if(r?.attached)out.attached+=1;}
  const {rows:permits}=await pool.query(`SELECT * FROM restaurant_terminal_offline_permits
    WHERE status IN ('issued','forwarded') AND expires_at<$1 AND (last_checked_at IS NULL OR last_checked_at<$1::timestamptz-INTERVAL '10 minutes')
    ORDER BY expires_at LIMIT $2`,[now,limit]);
  // One policy read per store per sweep pass: the settlement-mode decision
  // is per store, and permits in one pass usually share a handful of stores.
  const policyCache=new Map();
  const holdForPermit=async permit=>{
    // Flag off: no policy query at all, so the sweep is query-identical
    // to before. Flag on: one policy read per store per sweep pass.
    if(!cardStoreForward.isGloballyEnabled())return false;
    const key=`${permit.restaurant_id}:${permit.location_id}`;
    if(!policyCache.has(key))policyCache.set(key,await cardStoreForward.getStoreForwardPolicy(pool,permit.restaurant_id,permit.location_id));
    return cardStoreForward.shouldHoldForManagerReview(policyCache.get(key));
  };
  for(const permit of permits){
    await pool.query('UPDATE restaurant_terminal_offline_permits SET last_checked_at=$2 WHERE id=$1',[permit.id,now]);
    try{
      let intentId=permit.provider_payment_intent_id;
      if(!intentId){
        const found=await terminal.searchConnectedIntentByOfflineId(permit.id,permit.provider_account_id);
        if(found.length>1){await pool.query("UPDATE restaurant_terminal_offline_permits SET status='requires_reconciliation' WHERE id=$1",[permit.id]);out.flagged+=1;continue;}
        intentId=found[0]?.id;
      }
      if(intentId){
        const settled=await offline.reconcileForwarded({restaurantId:permit.restaurant_id,permitId:permit.id,intentId,holdForManagerReview:await holdForPermit(permit)});
        if(settled?.held)out.flagged+=1;else out.reconciled+=1;
        continue;
      }
      if(new Date(permit.expires_at).getTime()<now.getTime()-UNFORWARDED_REVIEW_HOURS*3600*1000){
        await pool.query("UPDATE restaurant_terminal_offline_permits SET status='requires_reconciliation' WHERE id=$1 AND status='issued'",[permit.id]);out.flagged+=1;
      }
    }catch{/* Stripe unreachable or mismatch: retried next sweep; mismatches surface via reconcile */}
  }
  return out;
}

async function queueDepth({restaurantId,locationIds=null}){
  // Ops visibility for the open queue: exact counts, not the capped lists
  // listOpen returns. Same open set semantics: payments awaiting settlement
  // or review, permits that expired while still unsettled.
  const scope=locationIds?' AND location_id=ANY($2::bigint[])':'';
  const args=locationIds?[restaurantId,locationIds]:[restaurantId];
  const {rows:pay}=await pool.query(`SELECT status,COUNT(*)::int AS n FROM restaurant_terminal_offline_payments
    WHERE restaurant_id=$1 AND status IN ('recorded','requires_reconciliation')${scope} GROUP BY status`,args);
  const {rows:perm}=await pool.query(`SELECT status,COUNT(*)::int AS n FROM restaurant_terminal_offline_permits
    WHERE restaurant_id=$1 AND status IN ('issued','forwarded','requires_reconciliation') AND expires_at<NOW()${scope} GROUP BY status`,args);
  const by=rows=>{const out={};for(const row of rows)out[row.status]=Number(row.n);return out;};
  return {payments:by(pay),permits:by(perm),generatedAt:new Date().toISOString()};
}

async function listOpen({restaurantId,locationIds=null}){
  const scope=locationIds?' AND location_id=ANY($2::bigint[])':'';
  const args=locationIds?[restaurantId,locationIds]:[restaurantId];
  const {rows:payments}=await pool.query(`SELECT offline_id,location_id,screen_ticket_id,food_order_id,provider_payment_intent_id,amount_cents,collected_at,status,review_reasons,created_at
    FROM restaurant_terminal_offline_payments WHERE restaurant_id=$1 AND status IN ('recorded','requires_reconciliation')${scope} ORDER BY created_at LIMIT 200`,args);
  const {rows:permits}=await pool.query(`SELECT id,location_id,food_order_id,provider_payment_intent_id,amount_cents,status,expires_at,lease_id
    FROM restaurant_terminal_offline_permits WHERE restaurant_id=$1 AND status IN ('issued','forwarded','requires_reconciliation') AND expires_at<NOW()${scope} ORDER BY expires_at LIMIT 200`,args);
  return {payments,permits};
}

// Manager resolution. 'void' only when Stripe has no intent for the id (the
// card was never actually charged); 'accept' keeps a Stripe-verified payment
// that was flagged for a limit and records who accepted it.
async function resolve({restaurantId,offlineId,action,note,userId}){
  if(!UUID.test(offlineId||''))throw new AppError('Invalid offline identity',400,'validation_failed');
  if(!['void','accept'].includes(action))throw new AppError('Choose void or accept',400,'validation_failed');
  const text=String(note||'').trim();
  if(text.length<5||text.length>500)throw new AppError('Add a short note',400,'validation_failed');
  const {rows:[payment]}=await pool.query('SELECT * FROM restaurant_terminal_offline_payments WHERE offline_id=$1 AND restaurant_id=$2',[offlineId,restaurantId]);
  const {rows:[permit]}=await pool.query('SELECT * FROM restaurant_terminal_offline_permits WHERE id=$1 AND restaurant_id=$2',[offlineId,restaurantId]);
  if(!payment&&!permit)throw new AppError('Offline payment not found',404,'terminal_offline_payment_not_found');
  const account=permit?.provider_account_id||(payment&&(await pool.query('SELECT provider_account_id FROM restaurant_terminal_offline_leases WHERE id=$1',[payment.lease_id])).rows[0]?.provider_account_id);
  const intents=await terminal.searchConnectedIntentByOfflineId(offlineId,account);
  const live=intents.filter(i=>i.status!=='canceled');
  if(action==='void'&&live.length)throw new AppError('Stripe has a payment for this; refund it instead of voiding',409,'terminal_offline_void_has_intent');
  if(action==='accept'){
    if(live.length!==1)throw new AppError('Stripe has no single payment to accept',409,'terminal_offline_accept_requires_intent');
    if(!permit)throw new AppError('Attach the payment to its order first',409,'terminal_offline_accept_requires_order');
    const settled=await offline.reconcileForwarded({restaurantId,permitId:offlineId,intentId:live[0].id});
    await pool.query(`UPDATE restaurant_terminal_offline_payments SET status='attached',provider_payment_intent_id=$2,resolved_by=$3,resolution_note=$4,updated_at=NOW() WHERE offline_id=$1`,[offlineId,live[0].id,userId,text]);
    if(permit.status==='requires_reconciliation'&&settled.payment?.status==='captured')
      await pool.query("UPDATE restaurant_terminal_offline_permits SET status='captured' WHERE id=$1",[offlineId]);
    return {action,resolved:true,payment_status:settled.payment?.status||null};
  }
  await withTransaction(pool,async client=>{
    if(permit){
      await client.query('SELECT id FROM food_orders WHERE id=$1 FOR UPDATE',[permit.food_order_id]);
      await client.query("UPDATE restaurant_pos_payments SET status='failed',metadata=metadata||$2::jsonb WHERE id=$1 AND status='pending'",[permit.pos_payment_id,JSON.stringify({offlineVoided:true})]);
      await client.query("UPDATE restaurant_terminal_offline_permits SET status='declined' WHERE id=$1 AND status<>'captured'",[offlineId]);
      await reconcilePosOrderPayment(client,permit.food_order_id);
    }
    if(payment){
      await client.query("UPDATE restaurant_terminal_offline_payments SET status='voided',resolved_by=$2,resolution_note=$3,updated_at=NOW() WHERE offline_id=$1",[offlineId,userId,text]);
      await client.query('UPDATE restaurant_terminal_offline_leases SET consumed_cents=GREATEST(0,consumed_cents-$2) WHERE id=$1',[payment.lease_id,payment.amount_cents]);
    }
  });
  return {action,resolved:true};
}

module.exports={issueLease,closeLease,registerPayment,attach,sweep,listOpen,queueDepth,resolve,reviewReasons,leaseHours};
