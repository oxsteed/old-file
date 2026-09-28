'use strict';

const crypto = require('crypto');
const AppError = require('../utils/appError');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}
function fingerprint(body) { return crypto.createHash('sha256').update(JSON.stringify(stableValue(body || {}))).digest('hex'); }
function idempotencyKey(req) {
  const value = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'] || req.body?.clientRequestId || req.body?.idempotencyKey;
  if (typeof value !== 'string' || !/^[A-Za-z0-9:._-]{8,120}$/.test(value)) throw new AppError('A valid request ID is required', 400, 'delivery_idempotency_required');
  return value;
}
const actorId = user => typeof user === 'object' ? user.id : user;
async function actionReplay(client, job, user, action, key, body) {
  const jobId = typeof job === 'object' ? job.id : job;
  const { rows } = await client.query('SELECT request_hash, response_snapshot FROM delivery_action_idempotency WHERE delivery_job_id=$1 AND actor_user_id=$2 AND action=$3 AND idempotency_key=$4', [jobId, actorId(user), action, key]);
  if (!rows[0]) return null;
  if (rows[0].request_hash !== fingerprint(body)) throw new AppError('Request ID already used for different details', 409, 'delivery_idempotency_conflict');
  return { ...rows[0].response_snapshot, duplicate: true };
}
async function saveAction(client, job, user, action, key, body, response) {
  await client.query('INSERT INTO delivery_action_idempotency(delivery_job_id,actor_user_id,action,idempotency_key,request_hash,response_snapshot) VALUES($1,$2,$3,$4,$5,$6)', [typeof job === 'object' ? job.id : job, actorId(user), action, key, fingerprint(body), JSON.stringify(response)]);
}
function maskPhone(value) { return value ? `••••${String(value).slice(-4)}` : null; }
function customerSafeJob(job, user) {
  const own = String(job.customer_user_id) === String(user.id);
  const assigned = [job.helper_user_id,job.internal_driver_user_id].some(id => id && String(id) === String(user.id));
  const fields = ['id','reference','status','origin_city','origin_state','destination_city','destination_state','distance_miles','duration_minutes','package_type','weight_lbs','pieces','package_length_in','package_width_in','package_height_in','contents_category','fragile','perishable','service_level','proof_preference','handling_requirements','pickup_window_start','pickup_window_end','delivery_window_start','delivery_window_end','created_at','updated_at','assigned_at','picked_up_at','delivered_at','cancelled_at','returned_at','approaching_at'];
  if (own) fields.push('customer_user_id','customer_total_cents','declared_value_cents','support_case_id');
  if (own || assigned) fields.push('origin_address','destination_address','origin_lat','origin_lng','destination_lat','destination_lng','origin_contact_name','destination_contact_name','origin_instructions','destination_instructions','notes');
  // Helpers need their offered compensation before claiming; never expose internal margins to customers.
  if (!own) fields.push('driver_payout_cents');
  const safe = Object.fromEntries(fields.filter(key => job[key] !== undefined).map(key => [key,job[key]]));
  if (own || assigned) {
    safe.origin_contact_phone = maskPhone(job.origin_contact_phone);
    safe.destination_contact_phone = maskPhone(job.destination_contact_phone);
  }
  safe.is_assigned_operator = assigned;
  safe.marketplace_available = !own && job.status === 'posted' && job.dispatch_state === 'marketplace_posted' && !job.internal_driver_user_id && !job.helper_user_id;
  safe.eta = { available: Boolean(job.estimated_arrival_at && job.eta_updated_at && Date.now()-new Date(job.eta_updated_at).getTime()<15*60000 && !['delivered','cancelled','returned'].includes(job.status)), estimatedArrivalAt: null, updatedAt: job.eta_updated_at || null };
  if (safe.eta.available) safe.eta.estimatedArrivalAt = job.estimated_arrival_at;
  return safe;
}
async function recordActivity(client, jobId, actor, type, payload = {}, customerVisible = true) {
  await client.query('SELECT id FROM delivery_jobs WHERE id=$1 FOR UPDATE', [jobId]);
  await client.query('INSERT INTO delivery_activity(delivery_job_id,actor_user_id,event_type,customer_visible,payload) VALUES($1,$2,$3,$4,$5)', [jobId,actor || null,type,customerVisible,JSON.stringify(payload)]);
  const { rows } = await client.query(`INSERT INTO delivery_events(delivery_job_id,event_type,event_version,actor_user_id,payload,customer_visible)
    SELECT $1::bigint,$2,COALESCE(MAX(event_version),0)+1,$3,$4,$5 FROM delivery_events WHERE delivery_job_id=$1::bigint RETURNING id`, [jobId,type,actor || null,JSON.stringify(payload),customerVisible]);
  if (customerVisible) await client.query("INSERT INTO delivery_event_deliveries(event_id,consumer) VALUES($1,'notifications'),($1,'realtime')", [rows[0].id]);
  return rows[0].id;
}
function pinDigest(pin, reference) { return crypto.scryptSync(String(pin), String(reference), 32).toString('hex'); }
async function validateProof(client, job, body, userId) {
  const type = body.proofType || job.proof_preference;
  if (type !== job.proof_preference || !['pin','photo','signature','recipient_confirmation'].includes(type)) throw new AppError('Proof must match the requested method',400,'delivery_proof_mismatch');
  const proof = { proofType:type, proofValue:null, recipientName:null, uploadId:null, objectKey:null, mediaUrl:null };
  if (type === 'pin') {
    if (job.proof_pin_consumed_at || !job.proof_pin_digest || (job.proof_pin_locked_until && new Date(job.proof_pin_locked_until)>new Date())) throw new AppError('PIN verification is unavailable. Ask the customer for a new PIN.',429,'delivery_proof_pin_locked');
    const actual = /^\d{6}$/.test(String(body.proofValue)) ? pinDigest(body.proofValue,job.reference) : '';
    if (actual.length !== String(job.proof_pin_digest).length || !crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(job.proof_pin_digest))) {
      // Caller commits this counter before returning the validation error.
      await client.query("UPDATE delivery_jobs SET proof_pin_attempts=proof_pin_attempts+1, proof_pin_locked_until=CASE WHEN proof_pin_attempts+1>=5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE id=$1",[job.id]);
      const error = new AppError('Delivery PIN is invalid',400,'delivery_proof_pin_invalid');
      error.commitValidation = true;
      throw error;
    }
  } else if (type === 'recipient_confirmation') {
    const name = String(body.recipientName || '').trim();
    const contact = String(body.recipientContact || '').replace(/\D/g,'');
    const expected = String(job.destination_contact_phone || '').replace(/\D/g,'');
    if (name.length<2 || name.length>160 || body.confirmed !== true || contact.length<7 || contact !== expected) throw new AppError('Confirm the recipient name, contact and receipt',400,'delivery_recipient_confirmation_required');
    proof.recipientName = name;
    proof.proofValue = 'recipient_attestation';
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(String(body.uploadId || ''))) throw new AppError('Upload verified proof first',400,'delivery_proof_upload_required');
    const {rows} = await client.query("SELECT * FROM delivery_proof_uploads WHERE id=$1 AND delivery_job_id=$2 AND owner_user_id=$3 AND consumed_at IS NULL AND scan_status='clean' FOR UPDATE",[body.uploadId,job.id,userId]);
    const upload = rows[0];
    if (!upload || (type==='photo' && !upload.content_type.startsWith('image/'))) throw new AppError('Proof upload is unavailable',400,'delivery_proof_upload_required');
    proof.uploadId=upload.id; proof.objectKey=upload.object_key;
  }
  return proof;
}
async function recordProof(client,job,proof,userId,key) {
  const {rows} = await client.query("INSERT INTO delivery_proofs(delivery_job_id,proof_type,proof_value,object_key,upload_id,recipient_name,submitted_by_user_id,verification_status,verified_at,verified_by_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,'verified',NOW(),$7,$8) RETURNING id",[job.id,proof.proofType,proof.proofValue,proof.objectKey,proof.uploadId,proof.recipientName,userId,key]);
  if (proof.uploadId) await client.query('UPDATE delivery_proof_uploads SET consumed_at=NOW() WHERE id=$1',[proof.uploadId]);
  if (proof.proofType==='pin') await client.query('UPDATE delivery_jobs SET proof_pin_digest=NULL,proof_pin_consumed_at=NOW() WHERE id=$1',[job.id]);
  return rows[0];
}
module.exports={stableValue,fingerprint,idempotencyKey,actionReplay,saveAction,customerSafeJob,recordActivity,pinDigest,validateProof,recordProof};
