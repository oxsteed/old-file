'use strict';
const crypto=require('crypto');
const pool=require('../db');
const AppError=require('../utils/appError');
const {withTransaction}=require('../utils/transaction');
const terminal=require('./restaurantPosTerminalService');
const {reconcilePosOrderPayment}=require('./restaurantPosPaymentLedgerService');

async function issuePermit({restaurantId,locationId,deviceId,orderId,shiftId,userId}){
  if(process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED!=='true')throw new AppError('Offline Terminal is disabled',409,'terminal_offline_disabled');
  const account=await terminal.resolveRestaurantConnectAccount(restaurantId);
  return withTransaction(pool,async client=>{
    // One store/day exposure pool, including expired unresolved permits. A
    // network outage must not reset the cap or transfer it to another drawer.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`terminal-offline:${restaurantId}:${locationId}`]);
    const {rows:[policy]}=await client.query('SELECT * FROM restaurant_store_forward_settings WHERE restaurant_id=$1 AND location_id=$2 AND enabled=TRUE',[restaurantId,locationId]);
    if(!policy||!policy.allowed_card_brands?.length)throw new AppError('Review the store offline policy first',409,'terminal_offline_policy_required');
    const {rows:[device]}=await client.query("SELECT * FROM restaurant_devices WHERE id=$1 AND restaurant_id=$2 AND location_id=$3 AND device_role='pos' AND status='active'",[deviceId,restaurantId,locationId]);
    if(!device)throw new AppError('A paired POS is required',403,'pos_device_required');
    const {rows:[order]}=await client.query(`SELECT * FROM food_orders WHERE id=$1 AND restaurant_id=$2 AND location_id=$3 FOR UPDATE`,[orderId,restaurantId,locationId]);
    const {rows:[shift]}=await client.query("SELECT * FROM restaurant_pos_shifts WHERE id=$1 AND restaurant_id=$2 AND location_id=$3 AND staff_user_id=$4 AND status='open' FOR UPDATE",[shiftId,restaurantId,locationId,userId]);
    if(!shift||!order||['completed','cancelled','refunded'].includes(order.status))throw new AppError('An unpaid ticket and your open drawer are required',409,'terminal_offline_ticket_invalid');
    const {rows:[existing]}=await client.query('SELECT * FROM restaurant_terminal_offline_permits WHERE food_order_id=$1',[orderId]);
    if(existing){
      if(Number(existing.device_id)!==Number(deviceId)||Number(existing.shift_id)!==Number(shiftId))throw new AppError('Ticket already has an offline permit',409,'terminal_offline_permit_conflict');
      return existing;
    }
    if(order.payment_status!=='unpaid')throw new AppError('Resolve existing payments first',409,'terminal_offline_payment_conflict');
    const {rows:[activity]}=await client.query("SELECT COUNT(*)::int AS n FROM restaurant_pos_payments WHERE food_order_id=$1 AND status IN ('pending','recorded','captured')",[orderId]);
    if(activity.n)throw new AppError('Resolve existing payments first',409,'terminal_offline_payment_conflict');
    const {rows:[store]}=await client.query('SELECT timezone FROM restaurant_locations WHERE id=$1 AND restaurant_id=$2',[locationId,restaurantId]);
    const {rows:[day]}=await client.query("SELECT (NOW() AT TIME ZONE $1)::date::text AS value",[store.timezone||'UTC']);
    const {rows:[exposure]}=await client.query("SELECT COALESCE(SUM(amount_cents),0)::bigint AS cents FROM restaurant_terminal_offline_permits WHERE restaurant_id=$1 AND location_id=$2 AND business_date=$3 AND status<>'declined'",[restaurantId,locationId,day.value]);
    if(Number(order.total_cents)>policy.max_transaction_cents||Number(exposure.cents)+Number(order.total_cents)>policy.max_daily_cents)
      throw new AppError('Offline risk limit exceeded',409,'terminal_offline_limit_exceeded');
    if(policy.require_manager_pin_above_cents&&Number(order.total_cents)>policy.require_manager_pin_above_cents)
      throw new AppError('Use online checkout for transactions requiring a manager approval',409,'terminal_offline_manager_approval_required');
    const {rows:[permit]}=await client.query(`INSERT INTO restaurant_terminal_offline_permits(id,restaurant_id,location_id,device_id,food_order_id,shift_id,amount_cents,
      currency_code,provider_account_id,business_date,expires_at,created_by,policy_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+INTERVAL '1 hour',$11,$12) RETURNING *`,
      [crypto.randomUUID(),restaurantId,locationId,deviceId,orderId,shiftId,order.total_cents,order.currency_code,account,day.value,userId,
        {allowedBrands:policy.allowed_card_brands,maxTransactionCents:policy.max_transaction_cents,maxDailyCents:policy.max_daily_cents}]);
    // Reserve before collection. POS balance checks include pending tenders.
    const {rows:[reservation]}=await client.query(`INSERT INTO restaurant_pos_payments
      (restaurant_id,location_id,food_order_id,shift_id,payment_type,amount_cents,status,provider,provider_account_id,idempotency_key,created_by,metadata)
      VALUES($1,$2,$3,$4,'card',$5,'pending','stripe_terminal',$6,$7,$8,$9) RETURNING id`,
      [restaurantId,locationId,orderId,shiftId,order.total_cents,account,`terminal-offline:${permit.id}`,userId,{offlinePermitId:permit.id}]);
    await client.query('UPDATE restaurant_terminal_offline_permits SET pos_payment_id=$2 WHERE id=$1',[permit.id,reservation.id]);
    await reconcilePosOrderPayment(client,orderId);
    return {...permit,pos_payment_id:reservation.id};
  });
}

async function reconcileForwarded({restaurantId,permitId,intentId}){
  if(!/^[0-9a-f-]{36}$/i.test(permitId||'')||!/^pi_[A-Za-z0-9]+$/.test(intentId||''))throw new AppError('Invalid Terminal identity',400,'validation_failed');
  const {rows:[permit]}=await pool.query('SELECT * FROM restaurant_terminal_offline_permits WHERE id=$1 AND restaurant_id=$2',[permitId,restaurantId]);
  if(!permit)throw new AppError('Offline permit not found',404,'terminal_offline_permit_not_found');
  // SDK callbacks are hints. Only Stripe's account-bound response can move the
  // ledger. Reconcile even after the collection flag/permit has expired.
  const intent=await terminal.retrieveConnectedIntent(intentId,permit.provider_account_id);
  if(intent.metadata?.offlineId!==permit.id||intent.metadata?.food_order_id!==String(permit.food_order_id)
    ||Number(intent.amount)!==Number(permit.amount_cents)||intent.currency?.toUpperCase()!==permit.currency_code)
    throw new AppError('Forwarded intent does not match the permit',409,'terminal_offline_intent_mismatch');
  return withTransaction(pool,async client=>{
    await client.query('SELECT id FROM food_orders WHERE id=$1 FOR UPDATE',[permit.food_order_id]);
    const {rows:[current]}=await client.query('SELECT * FROM restaurant_terminal_offline_permits WHERE id=$1 FOR UPDATE',[permitId]);
    if(current.provider_payment_intent_id&&current.provider_payment_intent_id!==intentId)throw new AppError('Permit already forwarded',409,'terminal_offline_permit_conflict');
    if(intent.status==='canceled'){
      await client.query("UPDATE restaurant_pos_payments SET status='failed',metadata=metadata||$2::jsonb WHERE id=$1 AND status='pending'",[current.pos_payment_id,JSON.stringify({stripeStatus:'canceled'})]);
      await client.query("UPDATE restaurant_terminal_offline_permits SET status='declined',provider_payment_intent_id=$2 WHERE id=$1 AND status<>'captured'",[permitId,intentId]);
      return reconcilePosOrderPayment(client,permit.food_order_id);
    }
    if(!['requires_capture','succeeded'].includes(intent.status)){
      await client.query("UPDATE restaurant_terminal_offline_permits SET status='requires_reconciliation',provider_payment_intent_id=$2 WHERE id=$1",[permitId,intentId]);
      return {status:'requires_reconciliation',paid:false};
    }
    if(intent.status==='succeeded'&&Number(intent.amount_received)!==Number(permit.amount_cents))throw new AppError('Captured amount mismatch',409,'terminal_offline_intent_mismatch');
    const brand=intent.latest_charge?.payment_method_details?.card_present?.brand;
    const reviewRequired=!permit.policy_snapshot?.allowedBrands?.includes(brand);
    const {rows:[order]}=await client.query('SELECT * FROM food_orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',[permit.food_order_id,restaurantId]);
    if(!order||Number(order.total_cents)!==Number(permit.amount_cents)||Number(order.location_id)!==Number(permit.location_id))throw new AppError('Offline ticket changed',409,'terminal_offline_ticket_changed');
    const {rows:[payment]}=await client.query(`UPDATE restaurant_pos_payments SET
      status=CASE WHEN status='captured' THEN 'captured' ELSE $2::text END,
      provider_payment_intent_id=$3,metadata=metadata||$4::jsonb,updated_at=NOW()
      WHERE id=$1 AND food_order_id=$5 AND provider_account_id=$6 RETURNING *`,
      [current.pos_payment_id,intent.status==='succeeded'?'captured':'pending',intentId,
        JSON.stringify({stripeStatus:intent.status}),permit.food_order_id,permit.provider_account_id]);
    if(!payment)throw new AppError('Offline reservation missing',409,'terminal_offline_reservation_missing');
    await client.query('UPDATE restaurant_terminal_offline_permits SET status=$2,provider_payment_intent_id=$3,pos_payment_id=$4 WHERE id=$1',
      [permitId,payment.status==='captured'?'captured':reviewRequired?'requires_reconciliation':'forwarded',intentId,payment.id]);
    const reconciliation=await reconcilePosOrderPayment(client,permit.food_order_id);
    return {payment,...reconciliation,reviewRequired};
  });
}
module.exports={issuePermit,reconcileForwarded};
