'use strict';
const pool=require('../db');
const {withTransaction}=require('../utils/transaction');
const AppError=require('../utils/appError');
const fail=(status,code)=>{throw new AppError(code,status,code);};
function terms(value){if(typeof value!=='string'||value.length>4000)fail(400,'validation_failed');return value.trim();}
function template(body){
 if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>100||!Array.isArray(body.line_items)||!body.line_items.length||body.line_items.length>50)fail(400,'validation_failed');
 const line_items=body.line_items.map(item=>{
  if(typeof item?.description!=='string'||!item.description.trim()||item.description.length>500||typeof item.quantity!=='number'||!Number.isFinite(item.quantity)||item.quantity<=0||item.quantity>10000||!Number.isSafeInteger(item.unit_price_cents)||item.unit_price_cents<0||item.unit_price_cents>100000000)fail(400,'validation_failed');
  return {description:item.description.trim(),quantity:item.quantity,unit_price_cents:item.unit_price_cents,unit_price:item.unit_price_cents/100};
 });
 if(typeof body.tax_rate!=='number'||!Number.isFinite(body.tax_rate)||body.tax_rate<0||body.tax_rate>100)fail(400,'validation_failed');
 return {name:body.name.trim(),line_items,tax_rate:Math.round(body.tax_rate*100)/100,terms:terms(body.terms)};
}
async function read(businessId){
 const {rows:[defaults]}=await pool.query('SELECT terms,version FROM business_quote_standards WHERE business_id=$1',[businessId]);
 const {rows:templates}=await pool.query('SELECT * FROM business_quote_templates WHERE business_id=$1 ORDER BY name,id LIMIT 50',[businessId]);
 return {defaults:defaults||{terms:'',version:1},templates};
}
async function save(businessId,body){
 const value=terms(body?.terms);if(!Number.isInteger(body.expectedVersion)||body.expectedVersion<1)fail(400,'validation_failed');
 return withTransaction(pool,async db=>{
  await db.query('INSERT INTO business_quote_standards(business_id) VALUES($1) ON CONFLICT DO NOTHING',[businessId]);
  const {rows:[row]}=await db.query('UPDATE business_quote_standards SET terms=$2,version=version+1 WHERE business_id=$1 AND version=$3 RETURNING terms,version',[businessId,value,body.expectedVersion]);
  if(!row)fail(409,'quote_standards_conflict');return row;
 },'business_quote_standards_save');
}
async function saveTemplate(businessId,body,id=null){
 const value=template(body);
 return withTransaction(pool,async db=>{
  // Bound creates and serialize edits in the business scope.
  await db.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
  if(id){
   if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isInteger(body.expectedVersion))fail(400,'validation_failed');
   const {rows:[row]}=await db.query('UPDATE business_quote_templates SET name=$3,line_items=$4,tax_rate=$5,terms=$6,version=version+1 WHERE id=$1 AND business_id=$2 AND version=$7 RETURNING *',[id,businessId,value.name,JSON.stringify(value.line_items),value.tax_rate,value.terms,body.expectedVersion]);
   if(!row)fail(409,'quote_standards_conflict');return row;
  }
  const {rows:[count]}=await db.query('SELECT COUNT(*)::int AS n FROM business_quote_templates WHERE business_id=$1',[businessId]);if(count.n>=50)fail(409,'template_limit');
  return (await db.query('INSERT INTO business_quote_templates(business_id,name,line_items,tax_rate,terms) VALUES($1,$2,$3,$4,$5) RETURNING *',[businessId,value.name,JSON.stringify(value.line_items),value.tax_rate,value.terms])).rows[0];
 },'business_quote_template_save');
}
async function remove(businessId,id,expectedVersion){
 if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isInteger(expectedVersion))fail(400,'validation_failed');
 const result=await pool.query('DELETE FROM business_quote_templates WHERE id=$1 AND business_id=$2 AND version=$3',[id,businessId,expectedVersion]);
 if(!result.rowCount)fail(409,'quote_standards_conflict');
}
module.exports={read,save,saveTemplate,remove};
