'use strict';
const pool=require('../db');
const AppError=require('../utils/appError');
const v=require('../utils/restaurantReviewValidation');
const {resolveRestaurantAccess}=require('../services/scopeModel');
const permissions=require('../services/permissionsService');
const {getLocationScope}=require('../services/restaurantLocationAccessService');
const offline=require('../services/restaurantTerminalOffline');
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
  await withTransaction(pool,async client=>{
    const {rows:[store]}=await client.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2 FOR UPDATE',[restaurant.id,locationId]);
    if(!store)throw new AppError('Store not found',404,'location_not_found');
    await client.query(`INSERT INTO restaurant_store_forward_settings(restaurant_id,location_id,enabled,max_transaction_cents,max_daily_cents,allowed_card_brands,settlement_mode,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,'manual_review',$7) ON CONFLICT(restaurant_id,location_id) DO UPDATE SET enabled=$3,max_transaction_cents=$4,
      max_daily_cents=$5,allowed_card_brands=$6,settlement_mode='manual_review',updated_by=$7,updated_at=NOW()`,[restaurant.id,locationId,enabled,perSale,perDay,brands,req.user.id]);
    await logBusinessAction(req,{business_id:restaurant.business_id,action:'restaurant.terminal.offline_policy_updated',target_type:'location',target_id:locationId,
      after_state:{enabled,maxTransactionCents:perSale,maxDailyCents:perDay,allowedCardBrands:brands,settlementMode:'manual_review'},client,throwOnError:true});
  });
  res.json({configured:true,enabled,settlementMode:'manual_review'});
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
  res.json(await offline.reconcileForwarded({restaurantId:restaurant.id,permitId:req.params.permitId,intentId:req.body.intentId}));
}catch(error){next(error);}};
