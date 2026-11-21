'use strict';
const crypto=require('crypto'),pool=require('../db'),{withTransaction}=require('../utils/transaction'),AppError=require('../utils/appError');
const access=require('./access/accessService'),permissions=require('./permissionsService');
const ROLES=['manager','representative','employee','support_agent'];
const fail=(status,code)=>{throw new AppError(code,status,code);};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function owner(db,businessId,userId){
 if(!/^[1-9]\d*$/.test(String(businessId))||!Number.isSafeInteger(Number(businessId)))fail(400,'validation_failed');
 const {rows:[row]}=await db.query('SELECT id,user_id FROM businesses WHERE id=$1 AND deleted_at IS NULL AND is_active=TRUE FOR SHARE',[businessId]);
 if(!row||String(row.user_id)!==String(userId))fail(404,'not_found');
}
async function normalize(db,body){
 if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>100||!ROLES.includes(body.role)||!Array.isArray(body.overrides)||body.overrides.length>200)fail(400,'validation_failed');
 const {rows}=await db.query('SELECT code FROM team_permissions'),codes=new Set(rows.map(row=>row.code)),seen=new Set();
 const overrides=body.overrides.map(item=>{
  if(!codes.has(item?.permission_code)||!['allow','deny'].includes(item.effect)||seen.has(item.permission_code))fail(400,'validation_failed');seen.add(item.permission_code);
  return {permission_code:item.permission_code,effect:item.effect};
 }).sort((a,b)=>a.permission_code.localeCompare(b.permission_code));
 return {name:body.name.trim(),role:body.role,overrides};
}
async function list(businessId,userId){
 await owner(pool,businessId,userId);
 const {rows:templates}=await pool.query('SELECT * FROM business_role_templates WHERE business_id=$1 ORDER BY name,id LIMIT 50',[businessId]);
 const {rows:members}=await pool.query(`SELECT bm.id,bm.role,bm.permission_version,u.first_name,u.last_name FROM business_members bm JOIN users u ON u.id=bm.member_id WHERE bm.business_id=$1 AND bm.status='active' AND (bm.access_valid_until IS NULL OR bm.access_valid_until>NOW()) AND bm.member_id<>$2 ORDER BY bm.id LIMIT 200`,[businessId,userId]);
 const {rows:history}=await pool.query('SELECT id,template_name,reason,membership_id,created_at FROM business_role_template_history WHERE business_id=$1 ORDER BY id DESC LIMIT 50',[businessId]);
 return {templates,members,history,catalog:await permissions.getCatalog()};
}
async function save(businessId,userId,body,id=null){
 return withTransaction(pool,async db=>{
  await owner(db,businessId,userId);const value=await normalize(db,body);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`role-templates:${businessId}`]);
  if(id){
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!Number.isInteger(body.expectedVersion))fail(400,'validation_failed');
   const {rows:[row]}=await db.query('UPDATE business_role_templates SET name=$3,role=$4,overrides=$5,version=version+1 WHERE id=$1 AND business_id=$2 AND version=$6 RETURNING *',[id,businessId,value.name,value.role,JSON.stringify(value.overrides),body.expectedVersion]);
   if(!row)fail(409,'role_template_conflict');return row;
  }
  const {rows:[count]}=await db.query('SELECT COUNT(*)::int AS n FROM business_role_templates WHERE business_id=$1',[businessId]);if(count.n>=50)fail(409,'template_limit');
  return (await db.query('INSERT INTO business_role_templates(business_id,name,role,overrides) VALUES($1,$2,$3,$4) RETURNING *',[businessId,value.name,value.role,JSON.stringify(value.overrides)])).rows[0];
 },'business_role_template_save');
}
async function snapshot(db,businessId,userId,templateId,memberId){
 const {rows:[member]}=await db.query("SELECT * FROM business_members WHERE id=$1 AND business_id=$2 AND status='active' AND (access_valid_until IS NULL OR access_valid_until>NOW()) FOR UPDATE",[memberId,businessId]);
 if(!member||!member.member_id||String(member.member_id)===String(userId))fail(404,'not_found');
 const {rows:[template]}=await db.query('SELECT * FROM business_role_templates WHERE id=$1 AND business_id=$2 FOR SHARE',[templateId,businessId]);if(!template)fail(404,'not_found');
 const {rows:defaults}=await db.query('SELECT r.code AS role,p.code,rp.allow FROM team_role_permissions rp JOIN team_roles r ON r.id=rp.role_id JOIN team_permissions p ON p.id=rp.permission_id WHERE r.code=ANY($1::text[])',[[member.role,template.role]]);
 const {rows:overrides}=await db.query('SELECT p.code AS permission_code,o.effect FROM membership_permission_overrides o JOIN team_permissions p ON p.id=o.permission_id WHERE o.membership_id=$1 AND (o.expires_at IS NULL OR o.expires_at>NOW()) ORDER BY p.code',[member.id]);
 const resolve=(role,items)=>{const result=new Set(defaults.filter(row=>row.role===role&&row.allow).map(row=>row.code));for(const item of items){if(item.effect==='allow')result.add(item.permission_code);else result.delete(item.permission_code);}return [...result].sort();};
 const before=resolve(member.role,overrides),after=resolve(template.role,template.overrides);
 const preview={template_id:template.id,template_version:template.version,membership_id:member.id,membership_version:member.permission_version,before_role:member.role,after_role:template.role,before,after,added:after.filter(code=>!before.includes(code)),removed:before.filter(code=>!after.includes(code))};
 return {member,template,preview:{...preview,confirmation:hash(preview)}};
}
async function preview(businessId,userId,templateId,memberId){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(templateId||'')||!Number.isSafeInteger(Number(memberId))||Number(memberId)<1)fail(400,'validation_failed');
 return withTransaction(pool,async db=>{await owner(db,businessId,userId);return (await snapshot(db,businessId,userId,templateId,memberId)).preview;},'business_role_template_preview');
}
async function apply(businessId,userId,templateId,body){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(templateId||''))fail(400,'validation_failed');
 if(typeof body?.reason!=='string'||!body.reason.trim()||body.reason.length>500||body.confirm!==true||typeof body.confirmation!=='string'||!Number.isSafeInteger(Number(body.membership_id))||Number(body.membership_id)<1)fail(400,'validation_failed');
 const result=await withTransaction(pool,async db=>{
  await owner(db,businessId,userId);
  const {member,template,preview}=await snapshot(db,businessId,userId,templateId,body.membership_id);
  await normalize(db,template);
  if(preview.confirmation!==body.confirmation)fail(409,'role_template_conflict');
  await db.query('UPDATE business_members SET role=$2,role_updated_by=$3,role_updated_at=NOW() WHERE id=$1',[member.id,template.role,userId]);
  await db.query('DELETE FROM membership_permission_overrides WHERE membership_id=$1',[member.id]);
  for(const item of template.overrides)await db.query('INSERT INTO membership_permission_overrides(membership_id,permission_id,effect,reason,granted_by_user_id) SELECT $1,id,$2,$3,$4 FROM team_permissions WHERE code=$5',[member.id,item.effect,body.reason.trim(),userId,item.permission_code]);
  await db.query('INSERT INTO business_role_template_history(business_id,membership_id,actor_id,template_name,reason,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)',[businessId,member.id,userId,template.name,body.reason.trim(),JSON.stringify({role:preview.before_role,permissions:preview.before}),JSON.stringify({role:preview.after_role,permissions:preview.after})]);
  await access.bumpProjection(db,member.member_id);
  return {user_id:member.member_id,preview};
 },'business_role_template_apply');
 permissions.invalidateCache(businessId,result.user_id);return result.preview;
}
async function remove(businessId,userId,id,expectedVersion){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!Number.isInteger(expectedVersion))fail(400,'validation_failed');
 return withTransaction(pool,async db=>{await owner(db,businessId,userId);const result=await db.query('DELETE FROM business_role_templates WHERE id=$1 AND business_id=$2 AND version=$3',[id,businessId,expectedVersion]);if(!result.rowCount)fail(409,'role_template_conflict');},'business_role_template_remove');
}
module.exports={list,save,preview,apply,remove};
