'use strict';
const crypto=require('crypto');
const pool=require('../db');
const {encrypt}=require('../utils/encryption');
const AppError=require('../utils/appError');
const secrets=require('../services/restaurantProviderSecrets');
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length>4096||b.length>4096)return false;
  const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function verify(provider,body,headers,secret){
  if(typeof secret!=='string'||!secret)return false;
  if(provider==='uber_eats'){
    const expected=crypto.createHmac('sha256',secret).update(body).digest('hex');
    return equal(String(headers['x-uber-signature']||'').toLowerCase(),expected);
  }
  // DoorDash Marketplace subscriptions support a configured auth token.
  // Configure this exact Authorization value in the partner portal.
  if(provider==='doordash')return equal(headers.authorization,secret);
  // Grubhub contract and authentication must be approved before activation.
  return false;
}
exports.receive=async(req,res,next)=>{try{
  if(process.env.RESTAURANT_MARKETPLACE_WEBHOOKS_ENABLED!=='true')throw new AppError('Marketplace ingress is disabled',503,'delivery_ingress_disabled');
  if(!/^[1-9]\d{0,14}$/.test(req.params.integrationId)||!Buffer.isBuffer(req.body))throw new AppError('Invalid webhook',400,'delivery_webhook_invalid');
  const {rows:[integration]}=await pool.query("SELECT * FROM restaurant_delivery_marketplace_integrations WHERE id=$1 AND status='enabled'",[req.params.integrationId]);
  if(!integration?.webhook_secret_ref)throw new AppError('Webhook unavailable',404,'delivery_integration_not_found');
  const {webhookSecret}=await secrets.resolveReferences({webhookSecret:integration.webhook_secret_ref});
  if(!verify(integration.provider,req.body,req.headers,webhookSecret))throw new AppError('Invalid webhook signature',401,'delivery_webhook_signature_invalid');
  let payload;try{payload=JSON.parse(req.body.toString('utf8'));}catch{throw new AppError('Invalid webhook body',400,'delivery_webhook_invalid');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new AppError('Invalid webhook body',400,'delivery_webhook_invalid');
  const hash=crypto.createHash('sha256').update(req.body).digest('hex');
  const eventId=integration.provider==='uber_eats'?payload.event_id:payload.event?.id;
  const type=integration.provider==='uber_eats'?payload.event_type:payload.event?.type;
  if(typeof type!=='string'||type.length>100||(eventId!=null&&(typeof eventId!=='string'||eventId.length>200)))throw new AppError('Invalid event identity',400,'delivery_webhook_invalid');
  const id=eventId||hash;
  const {rows:[inserted]}=await pool.query(`INSERT INTO restaurant_marketplace_webhook_receipts
    (integration_id,event_id,body_hash,event_type,payload_ciphertext) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(integration_id,event_id) DO NOTHING RETURNING event_id`,[integration.id,id,hash,type,encrypt(JSON.stringify(payload))]);
  if(!inserted){
    const {rows:[existing]}=await pool.query('SELECT body_hash FROM restaurant_marketplace_webhook_receipts WHERE integration_id=$1 AND event_id=$2',[integration.id,id]);
    if(existing?.body_hash!==hash)throw new AppError('Event identity changed',409,'delivery_webhook_replay_conflict');
  }
  // Acknowledges durable receipt only. No guessed provider money semantics or
  // menu/modifier mapping may create a local order or invent a settled tender.
  res.status(200).json({received:true});
}catch(error){next(error);}};
exports.verify=verify;
