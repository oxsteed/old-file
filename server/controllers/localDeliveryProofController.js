'use strict';
const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const scanner = require('../services/fileScanService');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');
const { idempotencyKey, pinDigest, recordActivity } = require('../services/localDeliveryIntegrity');

exports.uploadGuard = async (req,res,next) => {
  try {
    if (!scanner.isConfigured()) throw new AppError('Proof scanning is unavailable',503,'delivery_proof_scanner_unavailable');
    const {rows}=await pool.query("SELECT id FROM delivery_jobs WHERE id=$1 AND status IN ('in_transit','failed') AND (helper_user_id=$2 OR internal_driver_user_id=$2)",[req.params.id,req.user.id]);
    if (!rows[0]) throw new AppError('Assigned delivery not found',404,'delivery_not_found');
    next();
  } catch(error) {next(error);}
};
exports.upload = async (req,res,next) => {
  let client;
  try {
    if (!req.file || !['image/jpeg','image/png','image/webp','application/pdf'].includes(req.file.mimetype) || req.file.size<=0 || req.file.size>10485760) throw new AppError('Select an image or signed PDF under 10 MB',400,'delivery_proof_upload_required');
    client=await pool.connect(); await client.query('BEGIN');
    const {rows}=await client.query("SELECT * FROM delivery_jobs WHERE id=$1 AND status IN ('in_transit','failed') AND (helper_user_id=$2 OR internal_driver_user_id=$2) FOR UPDATE",[req.params.id,req.user.id]);
    const job=rows[0];
    if (!job || !['photo','signature'].includes(job.proof_preference) || (job.proof_preference==='photo' && !req.file.mimetype.startsWith('image/'))) throw new AppError('Proof upload is unavailable',409,'delivery_proof_mismatch');
    const objectKey=await uploadFile(req.file.buffer,`delivery-private/${job.id}/${req.user.id}`,req.file.originalname,req.file.mimetype);
    if (!objectKey) throw new AppError('Storage unavailable',503,'storage_unavailable');
    const result=await client.query("INSERT INTO delivery_proof_uploads(delivery_job_id,owner_user_id,object_key,content_type,size_bytes,sha256,scan_status) VALUES($1,$2,$3,$4,$5,$6,'clean') RETURNING id",[job.id,req.user.id,objectKey,req.file.mimetype,req.file.size,crypto.createHash('sha256').update(req.file.buffer).digest('hex')]);
    await client.query('COMMIT');
    res.status(201).json({success:true,uploadId:result.rows[0].id});
  } catch(error) { if(client) await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally {client?.release();}
};
exports.rotatePin = async (req,res,next) => {
  let client;
  try {
    const key=idempotencyKey(req);
    client=await pool.connect(); await client.query('BEGIN');
    const {rows}=await client.query("SELECT * FROM delivery_jobs WHERE id=$1 AND customer_user_id=$2 AND status NOT IN ('delivered','cancelled','returned') FOR UPDATE",[req.params.id,req.user.id]);
    const job=rows[0];
    if(!job || job.proof_preference!=='pin') throw new AppError('PIN unavailable',404,'delivery_not_found');
    const previous=await client.query("SELECT 1 FROM delivery_action_idempotency WHERE delivery_job_id=$1 AND actor_user_id=$2 AND action='pin:rotate' AND idempotency_key=$3",[job.id,req.user.id,key]);
    if(previous.rows[0]) throw new AppError('This PIN was already issued. Request a new PIN.',409,'delivery_pin_already_issued');
    const pin=String(crypto.randomInt(100000,1000000));
    await client.query('UPDATE delivery_jobs SET proof_pin_digest=$1,proof_pin_attempts=0,proof_pin_locked_until=NULL,proof_pin_consumed_at=NULL WHERE id=$2',[pinDigest(pin,job.reference),job.id]);
    await client.query("INSERT INTO delivery_action_idempotency(delivery_job_id,actor_user_id,action,idempotency_key,request_hash) VALUES($1,$2,'pin:rotate',$3,$4)",[job.id,req.user.id,key,crypto.createHash('sha256').update(key).digest('hex')]);
    await recordActivity(client,job.id,req.user.id,'delivery_pin_rotated',{},false);
    await client.query('COMMIT'); res.setHeader('Cache-Control','no-store'); res.json({success:true,proofPin:pin});
  }catch(error){if(client) await client.query('ROLLBACK').catch(()=>{}); next(error);}finally{client?.release();}
};
exports.download = async(req,res,next)=>{
  try {
    const {rows}=await pool.query(`SELECT dp.object_key FROM delivery_proofs dp JOIN delivery_jobs dj ON dj.id=dp.delivery_job_id
      WHERE dp.id=$1 AND dj.id=$2 AND dp.verification_status='verified'
      AND (dj.customer_user_id=$3 OR dj.helper_user_id=$3 OR dj.internal_driver_user_id=$3)`,[req.params.proofId,req.params.id,req.user.id]);
    if(!rows[0]?.object_key) throw new AppError('Proof not found',404,'delivery_not_found');
    res.setHeader('Cache-Control','no-store'); res.json({url:await getSignedDownloadUrl(rows[0].object_key,120)});
  }catch(error){next(error);}
};
