'use strict';
const pool=require('../db');
const access=require('./access/accessService');
const {withTransaction}=require('../utils/transaction');
const AppError=require('../utils/appError');
async function authorized(db,id){if(!(await access.can(id,'helper.offer_services',undefined,db)).allowed)throw new AppError('Effective helper access required',403,'access_required');}
async function read(id){await authorized(pool,id);const {rows:[row]}=await pool.query('SELECT daily_job_limit,travel_buffer_minutes,capacity_version FROM helper_profiles WHERE user_id=$1',[id]);return row||{daily_job_limit:null,travel_buffer_minutes:0,capacity_version:1};}
async function save(id,body){
 if(!body||!Number.isInteger(body.expectedVersion)||body.expectedVersion<1||!(body.daily_job_limit===null||(Number.isInteger(body.daily_job_limit)&&body.daily_job_limit>=1&&body.daily_job_limit<=30))||!Number.isInteger(body.travel_buffer_minutes)||body.travel_buffer_minutes<0||body.travel_buffer_minutes>240)throw new AppError('Invalid capacity policy',400,'validation_failed');
 return withTransaction(pool,async db=>{
  await authorized(db,id);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`appointments:${id}`]);
  await db.query('INSERT INTO helper_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',[id]);
  const {rows:[row]}=await db.query(`UPDATE helper_profiles SET daily_job_limit=$2,travel_buffer_minutes=$3,capacity_version=capacity_version+1 WHERE user_id=$1 AND capacity_version=$4 RETURNING daily_job_limit,travel_buffer_minutes,capacity_version`,[id,body.daily_job_limit,body.travel_buffer_minutes,body.expectedVersion]);
  if(!row)throw new AppError('Capacity changed',409,'capacity_version_conflict');
  return row;
 },'helper_capacity_save');
}
module.exports={read,save};
