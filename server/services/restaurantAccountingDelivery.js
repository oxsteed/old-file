'use strict';
const crypto=require('crypto');
const db=require('../db');
const provider=require('./restaurantAccountingProvider');
const {withTransaction}=require('../utils/transaction');

async function processExports({limit=5}={}){
  if(process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED!=='true')return {disabled:true};
  // Never reclaim an uncertain POST automatically, even after the provider's
  // idempotency window expires (Xero's window is only six minutes).
  await db.query(`UPDATE restaurant_accounting_documents d SET status='requires_reconciliation',error_code='worker_lease_expired'
    FROM restaurant_accounting_exports e WHERE d.export_id=e.id AND d.status='sending'
      AND e.status='sending' AND e.leased_at<NOW()-INTERVAL '10 minutes'`);
  await db.query(`UPDATE restaurant_accounting_exports SET status='requires_reconciliation',lease_token=NULL,last_error='worker_lease_expired'
    WHERE status='sending' AND leased_at<NOW()-INTERVAL '10 minutes'`);
  const lease=crypto.randomUUID();
  const {rows}=await db.query(`WITH candidates AS (
    SELECT e.id FROM restaurant_accounting_exports e JOIN restaurant_accounting_integrations i ON i.id=e.integration_id
    WHERE e.status='pending' AND i.status='active' ORDER BY e.created_at FOR UPDATE OF e SKIP LOCKED LIMIT $1)
    UPDATE restaurant_accounting_exports e SET status='sending',lease_token=$2,leased_at=NOW(),attempts=attempts+1
    FROM candidates c WHERE e.id=c.id RETURNING e.*`,[Math.min(Math.max(Number(limit)||5,1),10),lease]);
  let posted=0;
  for(const batch of rows){
    try{
      const {rows:[integration]}=await db.query("SELECT * FROM restaurant_accounting_integrations WHERE id=$1 AND status='active'",[batch.integration_id]);
      if(!integration)throw Object.assign(Error('provider_disabled'),{code:'provider_disabled'});
      const credentials=await provider.tokens(integration);
      await withTransaction(db,async client=>{
        const groups=new Map();
        for(const line of batch.payload.lines){if(!groups.has(line.date))groups.set(line.date,[]);groups.get(line.date).push(line);}
        for(const [date,lines]of groups){
          require('./restaurantAccountingService').assertJournal(lines,date,date,batch.currency_code);
          // One immutable provider journal per company/business day/currency.
          // A changed snapshot or account mapping must not repost earlier sales.
          const hex=require('./restaurantAccountingService').payloadHash({integrationId:integration.id,date,currency:batch.currency_code}).slice(0,32);
          const documentId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
          await client.query(`INSERT INTO restaurant_accounting_documents(id,export_id,document_date,payload)
            VALUES($1,$2,$3,$4) ON CONFLICT(export_id,document_date) DO NOTHING`,
            [documentId,batch.id,date,{currency:batch.currency_code,lines}]);
        }
      });
      const {rows:documents}=await db.query(`SELECT d.*,d.document_date::text AS document_date FROM restaurant_accounting_documents d WHERE export_id=$1 AND status='pending' ORDER BY d.document_date LIMIT 10`,[batch.id]);
      for(const document of documents){
        const claimed=await db.query("UPDATE restaurant_accounting_documents SET status='sending',attempted_at=NOW() WHERE id=$1 AND status='pending' RETURNING id",[document.id]);
        if(!claimed.rowCount)continue;
        try{
          const externalId=await provider.postDocument(integration,document,credentials);
          const ack=await db.query(`UPDATE restaurant_accounting_documents d SET status='posted',external_id=$2,posted_at=NOW(),error_code=NULL
            WHERE d.id=$1 AND d.status='sending' AND EXISTS(SELECT 1 FROM restaurant_accounting_exports e WHERE e.id=d.export_id AND e.lease_token=$3) RETURNING d.id`,
            [document.id,externalId,lease]);
          if(!ack.rowCount)throw Object.assign(Error('provider_ack_fenced'),{code:'provider_ack_fenced'});
        }catch(error){
          await db.query("UPDATE restaurant_accounting_documents SET status='requires_reconciliation',error_code=$2 WHERE id=$1 AND status='sending'",[document.id,String(error.code||'provider_outcome_unknown').slice(0,100)]);
          throw error;
        }
      }
      const {rows:[counts]}=await db.query(`SELECT COUNT(*) FILTER(WHERE status<>'posted')::int AS remaining FROM restaurant_accounting_documents WHERE export_id=$1`,[batch.id]);
      const done=counts.remaining===0;
      await db.query(`UPDATE restaurant_accounting_exports SET status=$3::text,external_batch_id=CASE WHEN $3::text='posted' THEN 'oxsteed-export:'||id ELSE external_batch_id END,
        lease_token=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1 AND lease_token=$2`,[batch.id,lease,done?'posted':'pending']);
      if(done){posted++;await db.query('UPDATE restaurant_accounting_integrations SET last_export_at=NOW() WHERE id=$1',[integration.id]);}
    }catch(error){
      await db.query(`UPDATE restaurant_accounting_exports e SET status=CASE WHEN EXISTS(SELECT 1 FROM restaurant_accounting_documents d WHERE d.export_id=e.id AND d.status='requires_reconciliation')
        THEN 'requires_reconciliation' ELSE 'failed' END,lease_token=NULL,last_error=$3,updated_at=NOW() WHERE id=$1 AND lease_token=$2`,
        [batch.id,lease,String(error.code||'provider_unavailable').slice(0,100)]);
    }
  }
  return {claimed:rows.length,posted};
}
module.exports={processExports};
