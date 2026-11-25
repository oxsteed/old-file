'use strict';
const pool=require('../db'),{withTransaction}=require('../utils/transaction'),AppError=require('../utils/appError');
const fail=(status,code)=>{throw new AppError(code,status,code);};
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'validation_failed');return value.trim();}
async function actor(db,businessId,userId){
 if(!/^[1-9]\d*$/.test(String(businessId)))fail(400,'validation_failed');
 const {rows:[business]}=await db.query('SELECT id,user_id FROM businesses WHERE id=$1 AND deleted_at IS NULL AND is_active=TRUE FOR SHARE',[businessId]);if(!business)fail(404,'not_found');
 const owner=String(business.user_id)===String(userId);
 const membership=owner?null:(await db.query("SELECT id,role,access_valid_until FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' AND (access_valid_until IS NULL OR access_valid_until>NOW()) FOR SHARE",[businessId,userId])).rows[0];
 if(!owner&&!membership)fail(404,'not_found');
 return {owner,business,membership};
}
async function read(businessId,userId){
 const {owner,business,membership}=await actor(pool,businessId,userId);
 const canAllocate=owner||membership?.role==='manager';
 const {rows:documents}=await pool.query(`SELECT DISTINCT ON(d.kind) d.*,EXISTS(SELECT 1 FROM business_team_acknowledgments a WHERE a.document_id=d.id AND a.user_id=$2) AS acknowledged FROM business_team_documents d WHERE d.business_id=$1 ORDER BY d.kind,d.version DESC`,[businessId,userId]);
 const {rows:history}=await pool.query(`SELECT a.id AS acknowledgment_id,d.id,d.kind,d.version,d.title,a.user_id,a.acknowledged_at,u.first_name,u.last_name FROM business_team_acknowledgments a JOIN business_team_documents d ON d.id=a.document_id LEFT JOIN users u ON u.id=a.user_id WHERE d.business_id=$1 AND ($3::boolean OR a.user_id=$2) ORDER BY a.acknowledged_at DESC LIMIT 100`,[businessId,userId,owner]);
 // D-464 (267, G5-16): a member sees tasks assigned to them or created by
 // them, so a manager who allocated a task to someone else can track it.
 const {rows:tasks}=await pool.query(`SELECT t.*,t.status='open' AND t.due_at<NOW() AS overdue,u.first_name,u.last_name,j.title AS job_title FROM business_team_tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN jobs j ON j.id=t.job_id WHERE t.business_id=$1 AND ($3::boolean OR t.assignee_id=$2 OR t.created_by=$2) ORDER BY (t.status='open') DESC,t.due_at LIMIT 100`,[businessId,userId,owner]);
 const {rows:[counts]}=await pool.query("SELECT COUNT(*)::int AS overdue FROM business_team_tasks WHERE business_id=$1 AND ($3::boolean OR assignee_id=$2 OR created_by=$2) AND status='open' AND due_at<NOW()",[businessId,userId,owner]);
 const members=canAllocate?(await pool.query("SELECT u.id,u.first_name,u.last_name,bm.id AS membership_id,bm.permission_version,bm.access_valid_until FROM users u LEFT JOIN business_members bm ON bm.business_id=$1 AND bm.member_id=u.id AND bm.status='active' WHERE u.id=$2 OR bm.id IS NOT NULL ORDER BY u.first_name,u.id LIMIT 200",[businessId,business.user_id])).rows:[];
 const offboarding=owner?(await pool.query(`SELECT r.id,r.reason,r.removed_at,r.retain_until,r.team_tasks_reassigned,r.crew_tasks_reassigned,r.corrective_actions_reassigned,r.pins_deactivated,r.drawers_flagged,u.first_name,u.last_name FROM staff_offboarding_records r LEFT JOIN users u ON u.id=r.user_id WHERE r.business_id=$1 ORDER BY r.removed_at DESC LIMIT 100`,[businessId])).rows:[];
 const expiryHistory=owner?(await pool.query('SELECT membership_id,event,expires_at,created_at FROM business_membership_expiry_history WHERE business_id=$1 ORDER BY id DESC LIMIT 100',[businessId])).rows:[];
 return {owner,canAllocate,documents,history,tasks,members,offboarding,expiryHistory,access_valid_until:membership?.access_valid_until||null,overdue_count:counts.overdue};
}
async function publish(businessId,userId,body){
 if(!['guide','policy'].includes(body?.kind)||!Number.isInteger(body.expectedVersion)||body.expectedVersion<0)fail(400,'validation_failed');const title=text(body.title,200),content=text(body.body,4000);
 return withTransaction(pool,async db=>{
  if(!(await actor(db,businessId,userId)).owner)fail(403,'access_required');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`team-document:${businessId}:${body.kind}`]);
  const {rows:[current]}=await db.query('SELECT COALESCE(MAX(version),0)::int AS n FROM business_team_documents WHERE business_id=$1 AND kind=$2',[businessId,body.kind]);if(current.n!==body.expectedVersion)fail(409,'team_record_changed');
  return (await db.query('INSERT INTO business_team_documents(business_id,kind,version,title,body,published_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[businessId,body.kind,current.n+1,title,content,userId])).rows[0];
 },'team_document_publish');
}
async function acknowledge(businessId,userId,documentId){
 if(!uuid(documentId))fail(400,'validation_failed');
 return withTransaction(pool,async db=>{await actor(db,businessId,userId);const {rows:[document]}=await db.query('SELECT id,kind,version FROM business_team_documents WHERE id=$1 AND business_id=$2',[documentId,businessId]);if(!document)fail(404,'not_found');
  // Historical acknowledgments stay historical. Do not silently acknowledge
  // a newly published version when the person read an older one.
  await db.query('INSERT INTO business_team_acknowledgments(document_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[documentId,userId]);return document;
 },'team_document_acknowledge');
}
async function createTask(businessId,userId,body){
 if(!uuid(body?.requestId)||!['task','reminder'].includes(body.kind)||!uuid(body.assignee_id)||typeof body.due_at!=='string'||!Number.isFinite(Date.parse(body.due_at)))fail(400,'validation_failed');
 const title=text(body.title,200);
 // D-464 (267, G5-16): an optional job link, validated against the real
 // jobs table; a null job_id means an unlinked task.
 const jobId=body.job_id==null?null:(uuid(body.job_id)?String(body.job_id):fail(400,'validation_failed'));
 return withTransaction(pool,async db=>{
  const {owner,business,membership}=await actor(db,businessId,userId);
  const canAllocate=owner||membership?.role==='manager';
  if(!canAllocate&&(body.kind!=='reminder'||body.assignee_id!==userId))fail(403,'access_required');
  if(jobId&&!(await db.query('SELECT id FROM jobs WHERE id=$1',[jobId])).rows.length)fail(404,'not_found');
  if(body.assignee_id!==String(business.user_id)&&!(await db.query("SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' AND (access_valid_until IS NULL OR access_valid_until>NOW()) FOR SHARE",[businessId,body.assignee_id])).rows.length)fail(404,'not_found');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`team-task:${userId}:${body.requestId}`]);
  const existing=(await db.query('SELECT * FROM business_team_tasks WHERE created_by=$1 AND request_id=$2',[userId,body.requestId])).rows[0];
  if(existing){if(String(existing.business_id)!==String(businessId)||existing.title!==title||existing.kind!==body.kind||existing.assignee_id!==body.assignee_id||String(existing.job_id||'')!==String(jobId||'')||new Date(existing.due_at).getTime()!==Date.parse(body.due_at))fail(409,'team_record_changed');return existing;}
  return (await db.query('INSERT INTO business_team_tasks(business_id,assignee_id,created_by,request_id,kind,title,due_at,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[businessId,body.assignee_id,userId,body.requestId,body.kind,title,body.due_at,jobId])).rows[0];
 },'team_task_create');
}
async function completeTask(businessId,userId,taskId,body){
 if(!uuid(taskId)||!Number.isInteger(body?.expectedVersion)||!['open','completed'].includes(body.status))fail(400,'validation_failed');
 return withTransaction(pool,async db=>{const {owner}=await actor(db,businessId,userId);const {rows:[row]}=await db.query('UPDATE business_team_tasks SET status=$4,version=version+1 WHERE id=$1 AND business_id=$2 AND (assignee_id=$3 OR $5::boolean) AND version=$6 RETURNING *',[taskId,businessId,userId,body.status,owner,body.expectedVersion]);if(!row)fail(409,'team_record_changed');return row;},'team_task_complete');
}
module.exports={read,publish,acknowledge,createTask,completeTask};
