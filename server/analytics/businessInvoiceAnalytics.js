'use strict';
const AppError=require('../utils/appError');
const { PERIOD_INTERVAL }=require('./metricsRegistry');

// Only recorded invoice revenue is attributable to a currency. Expenses do
// not store one and cannot be silently folded into these currency accounts.
async function businessInvoiceAnalytics(db,businessId,{period='30d',currencyCode,offset=0}={}) {
  if(!Object.hasOwn(PERIOD_INTERVAL,period)) throw new AppError('Invalid period',400,'invalid_param');
  offset=Number(offset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Invalid page',400,'invalid_param');
  if(currencyCode!=null&&!Intl.supportedValuesOf('currency').includes(String(currencyCode).toUpperCase()))throw new AppError('Invalid currency',400,'invalid_currency');
  const client=await db.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    const {rows:accounts}=await client.query(`SELECT DISTINCT UPPER(currency_code) AS currency_code
      FROM business_invoices WHERE business_id=$1 ORDER BY 1`,[businessId]);
    const currency=currencyCode?String(currencyCode).toUpperCase():accounts[0]?.currency_code||'USD';
    const values=[businessId,currency,PERIOD_INTERVAL[period].interval];
    const where=`business_id=$1 AND UPPER(currency_code)=$2 AND status='paid' AND paid_at>=NOW()-$3::interval`;
    const {rows:[summary]}=await client.query(`SELECT COALESCE(SUM(total),0)::text AS revenue,
      COUNT(*)::int AS paid_invoices FROM business_invoices WHERE ${where}`,values);
    const {rows:monthly}=await client.query(`SELECT TO_CHAR(date_trunc('month',paid_at),'YYYY-MM') AS month,
      SUM(total)::text AS revenue,COUNT(*)::int AS paid_invoices FROM business_invoices
      WHERE ${where} GROUP BY 1 ORDER BY 1`,values);
    const {rows:invoices}=await client.query(`SELECT id,invoice_number,total::text AS revenue,paid_at
      FROM business_invoices WHERE ${where} ORDER BY paid_at DESC,id DESC LIMIT 21 OFFSET $4`,[...values,offset]);
    await client.query('COMMIT');
    return{contract:'business-invoice-revenue-v1',business_id:businessId,currency_code:currency,
      accounts:accounts.map(r=>r.currency_code),period,summary,monthly,invoices:invoices.slice(0,20),offset,hasMore:invoices.length>20};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
module.exports={businessInvoiceAnalytics};
