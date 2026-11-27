'use strict';
const pool=require('../db'),access=require('./access/accessService'),{withTransaction}=require('../utils/transaction'),AppError=require('../utils/appError');
const {parseDateOnlyUTC}=require('../utils/dateOnly');
const fail=(status,code)=>{throw new AppError(code,status,code);};
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
function id(value){if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))fail(400,'validation_failed');return String(value);}
function text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'validation_failed');return value.trim();}
async function effective(db,userId){if(!(await access.can(userId,'tool_owner.list_equipment',undefined,db)).allowed)fail(403,'access_required');}
async function tool(db,toolId,userId,write=false){
 id(toolId);if(write)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tool-rental:${toolId}`]);
 const {rows:[row]}=await db.query(`SELECT id,user_id,name,owner_rules,accessories,condition_checklist,equipment_version FROM tool_rentals WHERE id=$1${write?' FOR UPDATE':''}`,[toolId]);
 if(!row||String(row.user_id)!==String(userId))fail(404,'not_found');await effective(db,userId);return row;
}
async function booking(db,bookingId,userId,write=false){
 id(bookingId);const {rows:[ref]}=await db.query('SELECT tool_id FROM tool_rentals_bookings WHERE id=$1',[bookingId]);if(!ref)fail(404,'not_found');
 const {rows:[row]}=await db.query(`SELECT *,start_date::text AS start_date,end_date::text AS end_date FROM tool_rentals_bookings WHERE id=$1${write?' FOR UPDATE':''}`,[bookingId]);
 if(!row)fail(404,'not_found');
 // Existing UPDATE paths lock the booking row before the calendar trigger
 // takes the tool lock. Match that order to avoid a row/advisory deadlock.
 if(write)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tool-rental:${ref.tool_id}`]);
 const owner=String(row.owner_id)===String(userId),renter=String(row.customer_id)===String(userId);
 if(!owner&&!renter)fail(404,'not_found');if(owner)await tool(db,row.tool_id,userId);
 return {row,owner};
}
function policy(body){
 if(!Array.isArray(body?.accessories)||body.accessories.length>50||!Array.isArray(body.checklist)||body.checklist.length>40||typeof body.rules!=='string'||body.rules.length>4000||!Number.isInteger(body.expectedVersion))fail(400,'validation_failed');
 const seen=new Set(),accessories=body.accessories.map(item=>{const name=text(item?.name,100);if(seen.has(name)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>999)fail(400,'validation_failed');seen.add(name);return {name,quantity:item.quantity};});
 const checklist=body.checklist.map(item=>text(item,200));if(new Set(checklist).size!==checklist.length)fail(400,'validation_failed');
 return {accessories,checklist,rules:body.rules.trim()};
}
async function readTool(toolId,userId){
 const row=await tool(pool,toolId,userId);
 const {rows:repairs}=await pool.query("SELECT id,notes,occurred_on,created_at FROM equipment_records WHERE tool_id=$1 AND kind='repair' ORDER BY occurred_on DESC,id DESC LIMIT 100",[toolId]);
 const {rows:overdue}=await pool.query("SELECT id,start_date,end_date,status FROM tool_rentals_bookings WHERE tool_id=$1 AND status='payment_confirmed' AND end_date<CURRENT_DATE ORDER BY end_date LIMIT 100",[toolId]);return {tool:row,repairs,overdue};
}
async function saveTool(toolId,userId,body){const value=policy(body);return withTransaction(pool,async db=>{
 await tool(db,toolId,userId,true);
 const {rows:[row]}=await db.query('UPDATE tool_rentals SET accessories=$3,condition_checklist=$4,owner_rules=$5 WHERE id=$1 AND user_id=$2 AND equipment_version=$6 RETURNING equipment_version',[toolId,userId,JSON.stringify(value.accessories),JSON.stringify(value.checklist),value.rules,body.expectedVersion]);if(!row)fail(409,'equipment_changed');return row;
},'equipment_policy_save');}
async function readBooking(bookingId,userId){
 const {row,owner}=await booking(pool,bookingId,userId);
 const {rows:reports}=await pool.query('SELECT r.*,m.items AS missing_items,m.resolved_at,m.resolution,m.version AS missing_version,m.ack_status AS missing_ack_status FROM equipment_reports r LEFT JOIN equipment_missing_accessories m ON m.report_id=r.id WHERE r.booking_id=$1 ORDER BY r.created_at,r.id LIMIT 200',[bookingId]);
 const {rows:evidence}=await pool.query("SELECT e.id,e.report_id,e.uploaded_by,e.image_url,e.created_at,u.first_name AS uploader_first_name,u.last_name AS uploader_last_name FROM tool_rental_report_evidence e LEFT JOIN users u ON u.id=e.uploaded_by WHERE e.booking_id=$1 ORDER BY e.created_at,e.id LIMIT 200",[bookingId]);
 const {rows:extensions}=await pool.query('SELECT * FROM equipment_extensions WHERE booking_id=$1 ORDER BY created_at DESC LIMIT 50',[bookingId]);
 const {rows:followups}=await pool.query("SELECT id,notes,occurred_on FROM equipment_records WHERE booking_id=$1 AND kind='late_return_followup' ORDER BY created_at DESC LIMIT 100",[bookingId]);
 return {booking:{id:row.id,tool_id:row.tool_id,status:row.status,end_date:row.end_date,equipment:row.equipment_snapshot||{accessories:[],checklist:[],rules:''},owner_id:row.owner_id},owner,reports,evidence,extensions,followups};
}
// 587: photo evidence on a condition/damage report. The image goes through
// the same storage path as the listing gallery (uploadFile / getPublicUrl,
// data-URL fallback when no storage is configured); only the URL is stored.
async function addEvidence(bookingId,userId,body,file){
 if(!file||!file.mimetype||!file.mimetype.startsWith('image/'))fail(400,'validation_failed');
 if(!uuid(body?.report_id))fail(400,'validation_failed');
 const {uploadFile,getPublicUrl}=require('../utils/storage');
 const key=await uploadFile(file.buffer,'tool-rentals/evidence',file.originalname,file.mimetype);
 let imageUrl=null;
 if(key){imageUrl=getPublicUrl(key);if(!imageUrl){const {deleteFile}=require('../utils/storage');await deleteFile(key).catch(()=>{});fail(503,'unavailable');}}
 if(!imageUrl){
  if(file.size>2*1024*1024)fail(400,'validation_failed');
  imageUrl=`data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
 }
 return withTransaction(pool,async db=>{
  const {row}=await booking(db,bookingId,userId,true);
  const {rows:[report]}=await db.query('SELECT id FROM equipment_reports WHERE id=$1 AND booking_id=$2',[body.report_id,bookingId]);
  if(!report)fail(404,'not_found');
  void row;
  return (await db.query('INSERT INTO tool_rental_report_evidence(report_id,booking_id,uploaded_by,image_url,storage_key) VALUES($1,$2,$3,$4,$5) RETURNING id,report_id,uploaded_by,image_url,created_at',[body.report_id,bookingId,userId,imageUrl,key||null])).rows[0];
 },'equipment_evidence_add');
}
async function report(bookingId,userId,body){
 if(!['pickup','return'].includes(body?.phase)||!Number.isInteger(body.expectedVersion)||body.expectedVersion<0||!Array.isArray(body.counts)||!Array.isArray(body.checklist))fail(400,'validation_failed');const notes=text(body.notes);
 return withTransaction(pool,async db=>{
  const {row}=await booking(db,bookingId,userId,true);
  if(!['payment_confirmed','returned','completed'].includes(row.status)||(body.phase==='pickup'&&row.status!=='payment_confirmed'))fail(409,'equipment_state_conflict');
  const snapshot=row.equipment_snapshot||{accessories:[],checklist:[]},inventory=snapshot.accessories||[],checks=snapshot.checklist||[];
  if(body.counts.length!==inventory.length||body.checklist.length!==checks.length)fail(409,'equipment_changed');
  const counts=inventory.map((item,index)=>{const value=body.counts[index];if(!Number.isInteger(value)||value<0||value>999)fail(400,'validation_failed');return {name:item.name,quantity:value};});
  const checklist=checks.map((label,index)=>{if(typeof body.checklist[index]!=='boolean')fail(400,'validation_failed');return {label,checked:body.checklist[index]};});
  const {rows:[version]}=await db.query('SELECT COALESCE(MAX(version),0)::int AS n FROM equipment_reports WHERE booking_id=$1 AND actor_id=$2 AND phase=$3',[bookingId,userId,body.phase]);
  if(version.n!==body.expectedVersion)fail(409,'equipment_changed');if(version.n>=20)fail(409,'record_limit');
  const {rows:[saved]}=await db.query('INSERT INTO equipment_reports(booking_id,actor_id,phase,version,counts,checklist,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[bookingId,userId,body.phase,version.n+1,JSON.stringify(counts),JSON.stringify(checklist),notes]);
  if(body.phase==='return'){
   const {rows:[pickup]}=await db.query("SELECT counts FROM equipment_reports WHERE booking_id=$1 AND actor_id=$2 AND phase='pickup' ORDER BY version DESC LIMIT 1",[bookingId,row.owner_id]);
   const expected=pickup?.counts||inventory,missing=expected.map((item,index)=>({name:item.name,quantity:Math.max(0,item.quantity-counts[index].quantity)})).filter(item=>item.quantity>0);
   if(missing.length)await db.query('INSERT INTO equipment_missing_accessories(report_id,items) VALUES($1,$2)',[saved.id,JSON.stringify(missing)]);
  }
  return saved;
 },'equipment_condition_report');
}
async function resolveMissing(bookingId,userId,reportId,body){
 if(!uuid(reportId)||!Number.isInteger(body?.expectedVersion))fail(400,'validation_failed');const notes=text(body.notes);
 return withTransaction(pool,async db=>{const {owner}=await booking(db,bookingId,userId,true);if(!owner)fail(403,'access_required');
 const {rows:[row]}=await db.query('UPDATE equipment_missing_accessories m SET resolution=$4,resolved_at=NOW(),version=m.version+1,ack_status=$5,acknowledged_by=NULL,acknowledged_at=NULL FROM equipment_reports r WHERE r.id=m.report_id AND r.booking_id=$1 AND m.report_id=$2 AND m.version=$3 AND m.resolved_at IS NULL RETURNING m.*',[bookingId,reportId,body.expectedVersion,notes,'pending']);if(!row)fail(409,'equipment_changed');return row;},'equipment_missing_resolve');
}
async function extend(bookingId,userId,body){
 const end=parseDateOnlyUTC(body?.end_date);if(!end||!uuid(body.requestId)||body.no_additional_charge!==true)fail(400,'validation_failed');
 return withTransaction(pool,async db=>{
  const {row,owner}=await booking(db,bookingId,userId,true);if(owner)fail(403,'access_required');if(row.status!=='payment_confirmed')fail(409,'equipment_state_conflict');
  const old=new Date(row.end_date);if(end<=old||end-old>90*86400000)fail(400,'validation_failed');
  const existing=await db.query('SELECT *,requested_end::text AS requested_end FROM equipment_extensions WHERE request_id=$1',[body.requestId]);
  if(existing.rows[0]){const prior=existing.rows[0];if(String(prior.booking_id)!==String(bookingId)||String(prior.requested_by)!==String(userId)||new Date(prior.requested_end).getTime()!==end.getTime())fail(409,'equipment_changed');return prior;}
  if((await db.query("SELECT 1 FROM equipment_extensions WHERE booking_id=$1 AND status='pending'",[bookingId])).rows.length)fail(409,'equipment_changed');
  return (await db.query('INSERT INTO equipment_extensions(booking_id,requested_by,old_end,requested_end,request_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[bookingId,userId,row.end_date,body.end_date,body.requestId])).rows[0];
 },'equipment_extension_request');
}
async function decideExtension(bookingId,userId,extensionId,body){
 if(!uuid(extensionId)||!['approved','declined','cancelled'].includes(body?.status))fail(400,'validation_failed');
 return withTransaction(pool,async db=>{
  const {row,owner}=await booking(db,bookingId,userId,true);if(owner?body.status==='cancelled':body.status!=='cancelled')fail(403,'access_required');
  const {rows:[extension]}=await db.query('SELECT *,old_end::text AS old_end FROM equipment_extensions WHERE id=$1 AND booking_id=$2 FOR UPDATE',[extensionId,bookingId]);if(!extension)fail(404,'not_found');if(extension.status!=='pending'||row.status!=='payment_confirmed')fail(409,'equipment_state_conflict');
  if(body.status==='approved'){
   if(body.no_additional_charge!==true||new Date(extension.old_end).getTime()!==new Date(row.end_date).getTime())fail(409,'equipment_changed');
   await db.query('UPDATE tool_rentals_bookings SET end_date=$2 WHERE id=$1',[bookingId,extension.requested_end]);
  }
  return (await db.query('UPDATE equipment_extensions SET status=$2,decided_at=NOW(),decided_by=$3 WHERE id=$1 RETURNING *',[extensionId,body.status,userId])).rows[0];
 },'equipment_extension_decide');
}
async function record(toolId,userId,body){
 if(!['repair','late_return_followup'].includes(body?.kind)||!parseDateOnlyUTC(body.occurred_on)||body.occurred_on>new Date().toISOString().slice(0,10))fail(400,'validation_failed');const notes=text(body.notes);
 return withTransaction(pool,async db=>{
  if(body.kind==='late_return_followup'){
   const {row,owner}=await booking(db,body.booking_id,userId,true);if(!owner||String(row.tool_id)!==String(toolId)||row.status!=='payment_confirmed'||new Date(row.end_date)>=new Date(new Date().toISOString().slice(0,10)))fail(409,'equipment_state_conflict');
  }
  await tool(db,toolId,userId,true);
  return (await db.query('INSERT INTO equipment_records(tool_id,booking_id,actor_id,kind,notes,occurred_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[toolId,body.kind==='repair'?null:body.booking_id,userId,body.kind,notes,body.occurred_on])).rows[0];
 },'equipment_record_create');
}
module.exports={readTool,saveTool,readBooking,report,resolveMissing,extend,decideExtension,record,addEvidence};
