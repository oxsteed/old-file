'use strict';
const pool=require('../db');
const AppError=require('../utils/appError');
const v=require('../utils/restaurantReviewValidation');
const {resolveRestaurantAccess}=require('../services/scopeModel');
const permissions=require('../services/permissionsService');
const {getLocationScope}=require('../services/restaurantLocationAccessService');
const offline=require('../services/restaurantTerminalOffline');
const cardStoreForward=require('../services/cardStoreForward');
const {withTransaction}=require('../utils/transaction');
const {logBusinessAction}=require('../services/businessAuditLog');
async function access(req,code){
  const restaurant=await resolveRestaurantAccess(req.user.id,v.integer(req.params.restaurantId,'restaurantId'));
  if(!await permissions.hasRestaurantPermission(restaurant,req.user.id,[code]))throw new AppError('Permission denied',403,'forbidden');
  return {...restaurant,scope:await getLocationScope(restaurant,req.user.id)};
}
function scope(restaurant,id){if(restaurant.scope.mode==='assigned'&&!restaurant.scope.location_ids.includes(Number(id)))throw new AppError('Store access denied',403,'location_scope_forbidden');}
exports.policy=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.manage');
  const locationId=v.integer(req.params.locationId,'locationId');scope(restaurant,locationId);
  const enabled=req.body.enabled===true;
  const brands=req.body.allowedCardBrands||[];
  if(!Array.isArray(brands)||brands.length>4||brands.some(b=>!['visa','mastercard','amex','discover'].includes(b))||(enabled&&!brands.length))
    throw new AppError('Select supported card brands',400,'validation_failed');
  const perSale=v.integer(req.body.maxTransactionCents,'maxTransactionCents',1,100000);
  const perDay=v.integer(req.body.maxDailyCents,'maxDailyCents',perSale,1000000);
  // Card store-and-forward settlement mode: previously forced to
  // 'manual_review' while no code read the column. The stored mode only
  // takes effect when CARD_STORE_FORWARD_ENABLED is on (see
  // cardStoreForward.js); with the flag off, settlement behaves exactly as
  // before regardless of the stored mode.
  const settlementMode=cardStoreForward.normalizeSettlementMode(req.body.settlementMode??req.body.settlement_mode);
  await withTransaction(pool,async client=>{
    const {rows:[store]}=await client.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2 FOR UPDATE',[restaurant.id,locationId]);
    if(!store)throw new AppError('Store not found',404,'location_not_found');
    await client.query(`INSERT INTO restaurant_store_forward_settings(restaurant_id,location_id,enabled,max_transaction_cents,max_daily_cents,allowed_card_brands,settlement_mode,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(restaurant_id,location_id) DO UPDATE SET enabled=$3,max_transaction_cents=$4,
      max_daily_cents=$5,allowed_card_brands=$6,settlement_mode=$7,updated_by=$8,updated_at=NOW()`,[restaurant.id,locationId,enabled,perSale,perDay,brands,settlementMode,req.user.id]);
    await logBusinessAction(req,{business_id:restaurant.business_id,action:'restaurant.terminal.offline_policy_updated',target_type:'location',target_id:locationId,
      after_state:{enabled,maxTransactionCents:perSale,maxDailyCents:perDay,allowedCardBrands:brands,settlementMode},client,throwOnError:true});
  });
  res.json({configured:true,enabled,settlementMode});
}catch(error){next(error);}};
exports.permit=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.use');
  const locationId=v.integer(req.body.locationId,'locationId');scope(restaurant,locationId);
  const deviceId=v.integer(req.body.deviceId,'deviceId');
  const device=await require('../services/restaurantDeviceCredentials').authenticateRegistryDevice(pool,{restaurantId:restaurant.id,registryId:deviceId,token:req.get('X-Device-Token')});
  if(device.locationId!==locationId||device.role!=='pos')throw new AppError('A store POS is required',403,'pos_device_required');
  const permit=await offline.issuePermit({restaurantId:restaurant.id,locationId,deviceId,orderId:v.integer(req.params.orderId,'orderId'),
    shiftId:v.integer(req.body.shiftId,'shiftId'),userId:req.user.id});
  res.set('Cache-Control','no-store').json({permit:{id:permit.id,orderId:Number(permit.food_order_id),amountCents:permit.amount_cents,currencyCode:permit.currency_code,
    stripeAccount:permit.provider_account_id,expiresAt:permit.expires_at,captureMethod:'manual',allowedBrands:permit.policy_snapshot.allowedBrands,
    metadata:{offlineId:permit.id,food_order_id:String(permit.food_order_id)}}});
}catch(error){next(error);}};
exports.reconcile=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.use');
  if(!/^[a-f0-9-]{36}$/i.test(req.params.permitId))throw new AppError('Invalid permit',400,'validation_failed');
  const {rows:[permit]}=await pool.query('SELECT location_id FROM restaurant_terminal_offline_permits WHERE restaurant_id=$1 AND id=$2',[restaurant.id,req.params.permitId]);
  if(!permit)throw new AppError('Permit not found',404,'terminal_offline_permit_not_found');scope(restaurant,permit.location_id);
  // Manual-review hold applies to this staff-triggered path too when the
  // store-and-forward flag is armed: only manager accept settles in that
  // mode. Flag off, or automatic mode, reconciles exactly as before (and
  // with the flag off no policy query runs at all).
  const holdForManagerReview = cardStoreForward.isGloballyEnabled()
    && cardStoreForward.shouldHoldForManagerReview(
      await cardStoreForward.getStoreForwardPolicy(pool, restaurant.id, permit.location_id));
  res.json(await offline.reconcileForwarded({restaurantId:restaurant.id,permitId:req.params.permitId,intentId:req.body.intentId,
    holdForManagerReview}));
}catch(error){next(error);}};

// F-08 outage mode: device-held leases, payment registration on reconnect,
// and the manager review queue.
const leases=require('../services/restaurantTerminalOfflineLeases');
async function posDevice(req,restaurant,locationId){
  const deviceId=v.integer(req.body.deviceId,'deviceId');
  const device=await require('../services/restaurantDeviceCredentials').authenticateRegistryDevice(pool,{restaurantId:restaurant.id,registryId:deviceId,token:req.get('X-Device-Token')});
  if((locationId!=null&&device.locationId!==locationId)||device.role!=='pos')throw new AppError('A store POS is required',403,'pos_device_required');
  return {deviceId,device};
}
const leaseView=l=>({id:l.id,locationId:Number(l.location_id),stripeAccount:l.provider_account_id,currencyCode:l.currency_code,budgetCents:Number(l.budget_cents),
  maxTransactionCents:Number(l.max_transaction_cents),consumedCents:Number(l.consumed_cents),allowedBrands:l.allowed_card_brands,expiresAt:l.expires_at,status:l.status,
  captureMethod:'manual',metadataKeys:['offlineId','offlineLeaseId']});
exports.lease=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.use');
  const locationId=v.integer(req.body.locationId,'locationId');scope(restaurant,locationId);
  const {deviceId}=await posDevice(req,restaurant,locationId);
  const budget=req.body.budgetCents==null?null:v.integer(req.body.budgetCents,'budgetCents',1,1000000);
  const lease=await leases.issueLease({restaurantId:restaurant.id,locationId,deviceId,shiftId:v.integer(req.body.shiftId,'shiftId'),userId:req.user.id,budgetCents:budget});
  await logBusinessAction(req,{business_id:restaurant.business_id,action:'restaurant.terminal.offline_lease_issued',target_type:'location',target_id:locationId,
    after_state:{leaseId:lease.id,budgetCents:Number(lease.budget_cents),maxTransactionCents:Number(lease.max_transaction_cents),deviceId}});
  res.set('Cache-Control','no-store').json({lease:leaseView(lease)});
}catch(error){next(error);}};
exports.closeLease=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.use');
  const {deviceId}=await posDevice(req,restaurant,null);
  res.json({lease:leaseView(await leases.closeLease({restaurantId:restaurant.id,leaseId:req.params.leaseId,deviceId}))});
}catch(error){next(error);}};
exports.registerPayment=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.use');
  const {deviceId}=await posDevice(req,restaurant,null);
  const b=req.body||{};
  const result=await leases.registerPayment({restaurantId:restaurant.id,deviceId,leaseId:req.params.leaseId,offlineId:b.offlineId,intentId:b.intentId??null,
    amountCents:b.amountCents,collectedAt:b.collectedAt,screenTicketId:b.screenTicketId??null,foodOrderId:b.foodOrderId??null});
  const status=(await pool.query('SELECT status,review_reasons FROM restaurant_terminal_offline_payments WHERE offline_id=$1',[b.offlineId])).rows[0];
  res.status(result.attached?200:202).json({offlineId:b.offlineId,attached:Boolean(result.attached),settled:Boolean(result.settled),
    waitingForTicket:Boolean(result.waiting),status:status?.status||null,reviewReasons:status?.review_reasons||[]});
}catch(error){next(error);}};
exports.openQueue=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.manage');
  const locationIds=restaurant.scope.mode==='assigned'?restaurant.scope.location_ids:null;
  const result=await leases.listOpen({restaurantId:restaurant.id,locationIds});
  // Queue depth is part of the flag-gated store-and-forward surface: with
  // the flag off the response shape is exactly today's (payments, permits).
  if(cardStoreForward.isGloballyEnabled())result.depth=await leases.queueDepth({restaurantId:restaurant.id,locationIds});
  res.set('Cache-Control','no-store').json(result);
}catch(error){next(error);}};
exports.resolve=async(req,res,next)=>{try{
  const restaurant=await access(req,'pos.manage');
  if(!/^[a-f0-9-]{36}$/i.test(req.params.offlineId))throw new AppError('Invalid offline identity',400,'validation_failed');
  const {rows:[row]}=await pool.query(`SELECT location_id FROM restaurant_terminal_offline_payments WHERE offline_id=$1 AND restaurant_id=$2
    UNION ALL SELECT location_id FROM restaurant_terminal_offline_permits WHERE id=$1 AND restaurant_id=$2 LIMIT 1`,[req.params.offlineId,restaurant.id]);
  if(!row)throw new AppError('Offline payment not found',404,'terminal_offline_payment_not_found');scope(restaurant,row.location_id);
  const result=await leases.resolve({restaurantId:restaurant.id,offlineId:req.params.offlineId,action:req.body.action,note:req.body.note,userId:req.user.id});
  await logBusinessAction(req,{business_id:restaurant.business_id,action:`restaurant.terminal.offline_payment_${req.body.action==='void'?'voided':'accepted'}`,
    target_type:'offline_payment',target_id:req.params.offlineId,after_state:{note:String(req.body.note||'').slice(0,500)}});
  res.json(result);
}catch(error){next(error);}};
