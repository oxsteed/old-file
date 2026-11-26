'use strict';
const pool=require('../db'),{withTransaction}=require('../utils/transaction'),AppError=require('../utils/appError');
const {applyStaffOffboarding}=require('./staffOffboarding'),{bumpProjection}=require('./access/accessService'),permissions=require('./permissionsService');
const {sendNotification}=require('./notificationService'),logger=require('../utils/logger');
const REMAINING_ACCESS_URL='/vortex#remaining-access';
const fail=(status,code)=>{throw new AppError(code,status,code);};
async function schedule(businessId,userId,membershipId,body){
 if(!/^[1-9]\d*$/.test(String(membershipId))||!Number.isInteger(body?.expectedVersion)||!(body.expires_at===null||(typeof body.expires_at==='string'&&Number.isFinite(Date.parse(body.expires_at))&&Date.parse(body.expires_at)>Date.now())))fail(400,'validation_failed');
 const result=await withTransaction(pool,async db=>{
  const {rows:[business]}=await db.query('SELECT id,user_id,business_name FROM businesses WHERE id=$1 AND deleted_at IS NULL AND is_active=TRUE FOR SHARE',[businessId]);if(!business||String(business.user_id)!==String(userId))fail(404,'not_found');
  const {rows:[member]}=await db.query("SELECT * FROM business_members WHERE id=$1 AND business_id=$2 AND status='active' FOR UPDATE",[membershipId,businessId]);
  if(!member||!member.member_id||String(member.member_id)===String(userId))fail(404,'not_found');
  if(member.permission_version!==body.expectedVersion||(member.access_valid_until&&new Date(member.access_valid_until)<=new Date()))fail(409,'team_record_changed');
  const {rows:[updated]}=await db.query('UPDATE business_members SET access_valid_until=$2 WHERE id=$1 RETURNING id,access_valid_until,permission_version',[membershipId,body.expires_at]);
  await db.query('INSERT INTO business_membership_expiry_history(membership_id,business_id,actor_id,event,expires_at) VALUES($1,$2,$3,$4,$5)',[member.id,businessId,userId,body.expires_at===null?'cleared':'scheduled',body.expires_at]);
  await bumpProjection(db,member.member_id);return {...updated,user_id:member.member_id,role:member.role,business_name:business.business_name};
 },'business_membership_expiry_schedule');permissions.invalidateCache(businessId,result.user_id);
 // G5-8 (296): scheduling an end date warns the member up front (the
 // expiry itself notifies below). Clearing a date notifies nobody.
 // Fire-and-forget: a failed send must not fail the schedule.
 if(body.expires_at)sendNotification({userId:result.user_id,type:'membership_expiring',
   data:{business_id:businessId,membership_id:membershipId,expires_at:body.expires_at,
     params:{businessName:result.business_name,role:result.role,expiresAt:String(body.expires_at).slice(0,10)}},
   action_url:REMAINING_ACCESS_URL,idempotencyKey:`membership-expiring:${membershipId}:${String(body.expires_at).slice(0,10)}`})
   .catch(err=>logger.warn('Membership expiry warning failed',{businessId,membershipId,error:err.message}));
 return result;
}
async function expireForUser(userId){
 try{
  const due=await pool.query("SELECT id FROM business_members WHERE member_id=$1 AND status='active' AND access_valid_until<=NOW() LIMIT 1",[userId]);
  if(!due.rows.length)return 0;
  const changed=await withTransaction(pool,async db=>{
   const {rows}=await db.query("SELECT m.id,m.business_id,m.member_id,m.role,m.access_valid_until,b.business_name FROM business_members m JOIN businesses b ON b.id=m.business_id WHERE m.member_id=$1 AND m.status='active' AND m.access_valid_until<=NOW() ORDER BY m.id FOR UPDATE",[userId]);
   for(const member of rows){
    await db.query("UPDATE business_members SET status='revoked' WHERE id=$1",[member.id]);
    await applyStaffOffboarding(db,{businessId:member.business_id,userId,membershipId:member.id,reason:'Membership access period ended',revokeAccountSessions:false});
    await bumpProjection(db,userId);
    await db.query("INSERT INTO business_membership_expiry_history(membership_id,business_id,event,expires_at) VALUES($1,$2,'expired',$3)",[member.id,member.business_id,member.access_valid_until]);
   }
   return rows;
  },'business_membership_expire');
  for(const member of changed)permissions.invalidateCache(member.business_id,userId);
  // G5-8 (296): expiry used to revoke silently. The member now gets the
  // same member_removed notice as a manual removal, linked to their
  // remaining access. Fire-and-forget: a failed send must not fail the
  // expiry (the sweep already committed).
  for(const member of changed)sendNotification({userId,type:'member_removed',
    data:{business_id:member.business_id,membership_id:member.id,
      params:{businessName:member.business_name,role:member.role}},
    action_url:REMAINING_ACCESS_URL,idempotencyKey:`member-expired:${member.id}`})
    .catch(err=>logger.warn('Membership expiry notice failed',{businessId:member.business_id,membershipId:member.id,error:err.message}));
  return changed.length;
 }catch(error){require('../utils/logger').error('Membership expiry check failed',{error:error.message});fail(503,'membership_expiry_unavailable');}
}
async function sweep(){
 const {rows}=await pool.query("SELECT DISTINCT member_id FROM business_members WHERE status='active' AND access_valid_until<=NOW() AND member_id IS NOT NULL ORDER BY member_id LIMIT 100");
 let count=0;for(const row of rows)count+=await expireForUser(row.member_id);return count;
}
module.exports={schedule,expireForUser,sweep};
