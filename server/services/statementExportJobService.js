'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const AppError=require('../utils/appError');
const snapshots=require('./statementSnapshotService');
const exportsRenderer=require('./creditStatementExport');
const {periodFor}=require('./creditStatementService');

const BUDGET=Object.freeze({workers:2,chunkRows:2000,pdfRows:2000,maxRows:1000000,
  queue:1024,perRequester:8,maxAttempts:5,maxBytes:512*1024*1024,minFreeDisk:256*1024*1024,
  freezeMs:5*60*1000,freezeLeaseSeconds:360,attemptMs:60*60*1000,leaseSeconds:45});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS=new Set(['oxsteed','restaurant','restaurant_settlement','helper_earnings','business']);
const LANGUAGES=new Set(['en','es','fr','ht','ar']);
const missing=()=>{throw new AppError('Statement export not found',404,'statement_export_not_found');};
const fail=(code,status=409)=>{throw new AppError(code,status,code);};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function isoDay(value) { return value instanceof Date?value.toISOString().slice(0,10):String(value); }
function shapeJob(row) {
  return {id:row.id,contract:'statement-export-job-v1',product:row.product,currencyCode:row.currency_code,
    period:{from:isoDay(row.period_from),to:isoDay(row.period_to)},format:row.format,language:row.language,state:row.state,
    cancelRequested:row.cancel_requested===true,attempts:row.attempts,rowsTotal:row.row_count===null?null:Number(row.row_count),
    rowsRendered:Number(row.rows_rendered),sourceFrozen:!!row.frozen_header,cutoffAt:row.frozen_at,
    errorCode:row.error_code||null,canRetry:['failed','cancelled'].includes(row.state)&&row.attempts<BUDGET.maxAttempts,
    manifestUrl:row.state==='complete'?`/api/statements/exports/${row.id}/manifest`:null,
    createdAt:row.created_at,completedAt:row.completed_at};
}

async function authorizeScope(db,userId,product,scopeId,currency,expectedAccount) {
  if (!UUID.test(String(userId))) missing();
  let account;
  if (product==='oxsteed'||product==='restaurant') {
    const {rows}=await db.query(product==='oxsteed'
      ? `SELECT id FROM oxsteed_credit_accounts WHERE customer_id=$1 AND account_type='customer_wallet' AND currency_code=$2`
      : `SELECT id FROM food_customer_wallet_accounts WHERE customer_id=$1 AND currency_code=$2 AND restaurant_id=$3`,
    product==='oxsteed'?[userId,currency]:[userId,currency,scopeId]);
    account=rows[0]?.id;
  } else if (product==='helper_earnings') {
    if (String(scopeId).toLowerCase()!==String(userId).toLowerCase()) missing();
    account=userId;
  } else {
    const {rows:[standing]}=await db.query(product==='restaurant_settlement'
      ? `SELECT a.id FROM food_restaurants r JOIN businesses b ON b.id=r.business_id
         JOIN oxsteed_credit_accounts a ON a.restaurant_id=r.id AND a.account_type='restaurant_sub_bank' AND a.currency_code=$3
         WHERE r.id=$1 AND (r.owner_user_id=$2 OR b.user_id=$2 OR EXISTS
           (SELECT 1 FROM business_members m WHERE m.business_id=b.id AND m.member_id=$2 AND m.status='active' AND m.role='manager'))`
      : `SELECT b.id FROM businesses b WHERE b.id=$1 AND (b.user_id=$2 OR EXISTS
           (SELECT 1 FROM business_members m WHERE m.business_id=b.id AND m.member_id=$2 AND m.status='active' AND m.role='manager'))
           AND $3::text IS NOT NULL`, [scopeId,userId,currency]);
    account=standing?.id;
  }
  if (!account||(expectedAccount!==undefined&&String(expectedAccount)!==String(account))) missing();
  return String(account);
}

function parseRequest(input,userId) {
  const product=String(input.product||'');
  if (!PRODUCTS.has(product)) fail('statement_invalid_product',400);
  const currency=String(input.currencyCode||'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)||!Intl.supportedValuesOf('currency').includes(currency)) fail('statement_invalid_currency',400);
  const format=input.format||'csv',language=input.language||'en';
  if (!['csv','pdf'].includes(format)||!LANGUAGES.has(language)) fail('statement_export_invalid_format',400);
  const period=periodFor(input.from,input.to);
  const scope=product==='oxsteed'||product==='helper_earnings'?String(userId)
    :String(product==='business'?input.businessId:input.restaurantId);
  if (!['oxsteed','helper_earnings'].includes(product)&&(!/^[1-9]\d*$/.test(scope)||!Number.isSafeInteger(Number(scope)))) fail('statement_invalid_account',400);
  return {product,currency_code:currency,period_from:period.from,period_to:period.to,scope_id:scope,format,language};
}

// Explicit dependencies make isolated tests and the parent's genuinely private
// storage adapter usable without consulting uploads credentials or production.
// storage: { assertPrivate(), uploadFile({filePath,objectKey,contentType,
// byteLength,checksum,signal}), getObjectStream(objectKey) }. No public fallback.
function createService({db=require('../db'),storage=require('../utils/statementStorage'),materialize,
  renderPdf=exportsRenderer.renderStatementPdfInWorker,notify=args=>require('./notificationService').sendNotification(args),
  tempRoot=os.tmpdir(),diskCheck=async directory=>{
    const stats=await fs.promises.statfs(directory);
    return Number(stats.bavail)*Number(stats.bsize);
  }}={}) {
  let timer=null,running=null,stopping=false;
  const controllers=new Set();
  async function requireJob(id,userId) {
    if (!UUID.test(String(id))) missing();
    const {rows:[job]}=await db.query(
      `SELECT j.*,EXISTS(SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=j.id) AS cancel_requested
       FROM statement_export_jobs j WHERE j.id=$1 AND j.requested_by=$2`,[id,userId]);
    if (!job) missing();
    await authorizeScope(db,userId,job.product,job.scope_id,job.currency_code,job.account_id);
    return job;
  }
  async function request(userId,input,idempotencyKey) {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey||''))) fail('statement_export_idempotency_required',400);
    const parsed=parseRequest(input,userId);
    const account=await authorizeScope(db,userId,parsed.product,parsed.scope_id,parsed.currency_code);
    const requestHash=hash(JSON.stringify({...parsed,account_id:account}));
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(693001)');
      const {rows:[existing]}=await client.query('SELECT * FROM statement_export_jobs WHERE requested_by=$1 AND idempotency_key=$2',[userId,idempotencyKey]);
      if (existing) {
        if (existing.request_hash!==requestHash) fail('statement_export_idempotency_conflict');
        await client.query('COMMIT'); return shapeJob(existing);
      }
      const {rows:[counts]}=await client.query(
        `SELECT count(*) FILTER (WHERE state IN ('pending','freezing','rendering'))::int AS total,
          count(*) FILTER (WHERE requested_by=$1 AND state IN ('pending','freezing','rendering'))::int AS own
         FROM statement_export_jobs`,[userId]);
      if (counts.total>=BUDGET.queue||counts.own>=BUDGET.perRequester) fail('statement_export_queue_full',429);
      const {rows:[job]}=await client.query(
        `INSERT INTO statement_export_jobs (id,requested_by,product,account_id,scope_id,currency_code,period_from,period_to,format,language,idempotency_key,request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [crypto.randomUUID(),userId,parsed.product,account,parsed.scope_id,parsed.currency_code,parsed.period_from,
          parsed.period_to,parsed.format,parsed.language,idempotencyKey,requestHash]);
      await client.query('COMMIT'); return shapeJob(job);
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  async function status(id,userId) {return shapeJob(await requireJob(id,userId));}
  async function cancel(id,userId) {
    const job=await requireJob(id,userId);
    if (job.state==='complete') return shapeJob(job);
    await db.query('INSERT INTO statement_export_cancellations(job_id) VALUES ($1) ON CONFLICT DO NOTHING',[id]);
    await db.query(`UPDATE statement_export_jobs SET state='cancelled',updated_at=now()
      WHERE id=$1 AND state IN ('pending','failed')`,[id]);
    return status(id,userId);
  }
  async function retry(id,userId) {
    await requireJob(id,userId);
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(693001)');
      const {rows:[job]}=await client.query('SELECT * FROM statement_export_jobs WHERE id=$1 FOR UPDATE',[id]);
      if (!['failed','cancelled'].includes(job.state)) {await client.query('COMMIT');return shapeJob(job);}
      if (job.attempts>=BUDGET.maxAttempts) fail('statement_export_attempt_budget_exhausted');
      const {rows:[counts]}=await client.query(
        `SELECT count(*) FILTER (WHERE state IN ('pending','freezing','rendering'))::int AS total,
          count(*) FILTER (WHERE requested_by=$1 AND state IN ('pending','freezing','rendering'))::int AS own
         FROM statement_export_jobs`,[userId]);
      if (counts.total>=BUDGET.queue||counts.own>=BUDGET.perRequester) fail('statement_export_queue_full',429);
      await client.query('DELETE FROM statement_export_cancellations WHERE job_id=$1',[id]);
      const {rows:[retried]}=await client.query(
        `UPDATE statement_export_jobs SET state='pending',cancel_requested=false,error_code=NULL,retry_at=now(),
         lease_owner=NULL,lease_until=NULL,fence=fence+1,updated_at=now() WHERE id=$1 RETURNING *`,[id]);
      await client.query('COMMIT');return shapeJob(retried);
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  async function claim() {
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(693001)');
      await client.query(`UPDATE statement_export_jobs SET state=CASE WHEN EXISTS
        (SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=statement_export_jobs.id) THEN 'cancelled' ELSE 'failed' END,
        error_code='statement_export_attempt_budget_exhausted',lease_owner=NULL,lease_until=NULL,updated_at=now()
        WHERE state IN ('freezing','rendering') AND lease_until<=now() AND attempts>=5`);
      const {rows:[capacity]}=await client.query(
        `SELECT count(*)::int AS active FROM statement_export_jobs WHERE state IN ('freezing','rendering') AND lease_until>now()`);
      if (capacity.active>=BUDGET.workers) {await client.query('COMMIT');return null;}
      const {rows:[candidate]}=await client.query(
        `SELECT j.* FROM statement_export_jobs j WHERE j.attempts<5 AND NOT EXISTS
           (SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=j.id)
         AND ((j.state='pending' AND j.retry_at<=now()) OR (j.state IN ('freezing','rendering') AND j.lease_until<=now()))
         AND NOT EXISTS (SELECT 1 FROM statement_export_jobs a WHERE a.id<>j.id AND a.product=j.product
           AND a.account_id=j.account_id AND a.currency_code=j.currency_code AND a.state IN ('freezing','rendering') AND a.lease_until>now())
         ORDER BY COALESCE((SELECT max(a.updated_at) FROM statement_export_jobs a WHERE a.product=j.product
           AND a.account_id=j.account_id AND a.currency_code=j.currency_code AND a.attempts>0),j.created_at),j.created_at,j.id
         LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
      if (!candidate) {await client.query('COMMIT');return null;}
      const {rows:[claimed]}=await client.query(
        `UPDATE statement_export_jobs SET state=CASE WHEN frozen_header IS NULL THEN 'freezing' ELSE 'rendering' END,
         lease_owner=$2,fence=fence+1,attempts=attempts+1,lease_until=now()+interval '150 seconds',updated_at=now()
         WHERE id=$1 RETURNING *`,[candidate.id,crypto.randomUUID()]);
      await client.query('COMMIT');return claimed;
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  async function checkpoint(job,signal,{rowsRendered,freezing=false}={}) {
    if (signal?.aborted||stopping) fail('statement_export_cancelled',499);
    const {rows:[current]}=await db.query(
      `UPDATE statement_export_jobs SET lease_until=now()+($4::int*interval '1 second'),
       rows_rendered=COALESCE($5,rows_rendered),updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND lease_until>now()
       AND state IN ('freezing','rendering') AND NOT EXISTS
         (SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=$1) RETURNING id`,
       [job.id,job.lease_owner,job.fence,freezing?BUDGET.freezeLeaseSeconds:BUDGET.leaseSeconds,rowsRendered??null]);
    if (!current) fail('statement_export_lease_lost');
  }
  async function* chunks(job,signal) {
    let cursor=0;
    for (;;) {
      await checkpoint(job,signal);
      const rows=await snapshots.readExportChunk(db,job.id,cursor,BUDGET.chunkRows);
      if (!rows.length) break;
      cursor=rows.at(-1).ordinal;
      yield rows;
    }
  }
  async function verifyObject(file,signal) {
    const config=await storage.assertPrivate();
    if(config?.bucket!==file.storage_bucket)fail('statement_storage_bucket_mismatch',503);
    const stream=await storage.getObjectStream(file.object_key);
    if (!stream) fail('statement_export_object_missing',503);
    let bytes=0;const digest=crypto.createHash('sha256');
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) fail('statement_export_cancelled',499);
        bytes+=chunk.length;
        if (bytes>Number(file.byte_length)) fail('statement_export_object_corrupt',502);
        digest.update(chunk);
      }
    } finally {stream.destroy?.();}
    if (bytes!==Number(file.byte_length)||digest.digest('hex')!==file.sha256) fail('statement_export_object_corrupt',502);
  }
  async function publish(job,local,metadata,signal) {
    await checkpoint(job,signal);
    const {rows:[existing]}=await db.query('SELECT * FROM statement_export_files WHERE job_id=$1 AND part=$2',[job.id,metadata.part]);
    if (existing) {
      if (existing.row_hash!==metadata.row_hash||String(existing.row_from)!==String(metadata.row_from)
          ||String(existing.row_to)!==String(metadata.row_to)) fail('statement_integrity_failed');
      await verifyObject(existing,signal);return existing;
    }
    const id=crypto.randomUUID();
    const config=await storage.assertPrivate();
    if(!config?.bucket)fail('statement_storage_unconfigured',503);
    const prefix=String(process.env.STATEMENT_ARTIFACT_PREFIX||'statements').replace(/^\/+|\/+$/g,'');
    if(!prefix||prefix.includes('..')||prefix.includes('\\'))fail('statement_storage_unconfigured',503);
    const key=`${prefix}/stmt/exports/${job.id}/${id}.${job.format}`;
    const file={id,job_id:job.id,...metadata,object_key:key,storage_bucket:config.bucket};
    try {
      await storage.uploadFile({filePath:local,objectKey:key,contentType:file.media_type,
        byteLength:file.byte_length,checksum:file.sha256,signal});
    } catch(error) {
      // Upload timeouts are uncertain; adopt only the exact verified bytes.
      await verifyObject(file,signal);
    }
    await verifyObject(file,signal);
    await checkpoint(job,signal);
    const {rows:[saved]}=await db.query(
      `INSERT INTO statement_export_files
       (id,job_id,part,kind,row_from,row_to,opening_minor,closing_minor,credits_minor,debits_minor,row_hash,sha256,byte_length,media_type,object_key,storage_bucket)
       SELECT $4,$1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18 FROM statement_export_jobs
       WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND lease_until>now() AND state='rendering'
       AND NOT EXISTS (SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=$1)
       ON CONFLICT (job_id,part) DO NOTHING RETURNING *`,
      [job.id,job.lease_owner,job.fence,id,file.part,file.kind,file.row_from,file.row_to,file.opening_minor,file.closing_minor,
        file.credits_minor,file.debits_minor,file.row_hash,file.sha256,file.byte_length,file.media_type,key,file.storage_bucket]);
    if (!saved) fail('statement_export_lease_lost');
    return saved;
  }
  function shapeFile(file) {
    return {id:file.id,part:file.part,kind:file.kind,rowFrom:Number(file.row_from),rowTo:Number(file.row_to),
      rowCount:Number(file.row_to)===0?0:Number(file.row_to)-Number(file.row_from)+1,
      openingMinor:String(file.opening_minor),closingMinor:String(file.closing_minor),creditsMinor:String(file.credits_minor),
      debitsMinor:String(file.debits_minor),rowHash:file.row_hash,sha256:file.sha256,byteLength:Number(file.byte_length),
      mediaType:file.media_type,storageBucket:file.storage_bucket,downloadUrl:`/api/statements/exports/${file.job_id}/files/${file.id}`};
  }
  async function processExportJob(job) {
    const controller=new AbortController();controllers.add(controller);
    const signal=controller.signal;let directory,heartbeatBusy=false,heartbeatError;
    const deadline=setTimeout(()=>controller.abort(),BUDGET.attemptMs);
    const heartbeat=setInterval(async()=>{
      if (heartbeatBusy) return;heartbeatBusy=true;
      try {await checkpoint(job,signal,{freezing:!job.frozen_header});}
      catch(error) {heartbeatError=error;controller.abort();}
      finally {heartbeatBusy=false;}
    },10000);
    try {
      if (!storage||typeof storage.assertPrivate!=='function'||typeof storage.uploadFile!=='function'||typeof storage.getObjectStream!=='function') fail('statement_storage_unconfigured',503);
      await storage.assertPrivate();
      if (await diskCheck(tempRoot)<BUDGET.minFreeDisk+BUDGET.maxBytes) fail('statement_export_disk_budget',503);
      await authorizeScope(db,job.requested_by,job.product,job.scope_id,job.currency_code,job.account_id);
      job.period_from=isoDay(job.period_from);job.period_to=isoDay(job.period_to);
      // Freeze holds the export-job row lock while materializing a consistent
      // source snapshot. Extend the lease before entering that transaction so
      // heartbeats cannot expire while blocked behind the lock.
      await checkpoint(job,signal,{freezing:true});
      const header=await snapshots.freezeExportSource(db,job,{materialize,timeoutMs:BUDGET.freezeMs});
      job.frozen_header=header;
      await checkpoint(job,signal);
      directory=await fs.promises.mkdtemp(path.join(tempRoot,'statement-export-'));
      const evidence=exportsRenderer.createEvidenceAccumulator(header);
      const files=[];let bytesUsed=0,rendered=0,opening=String(header.openingBalanceCents);
      if (job.format==='csv') {
        const local=path.join(directory,'complete.csv');
        const digest=crypto.createHash('sha256');let bytes=0;
        const measure=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;
          if (bytes>BUDGET.maxBytes) return done(new AppError('Export byte budget exceeded',409,'statement_export_budget_exceeded'));
          digest.update(chunk);done(null,chunk);}});
        await pipeline(Readable.from(exportsRenderer.streamStatementCsv(header,chunks(job,signal),
          {language:job.language,onRow:row=>{evidence.add(row);rendered+=1;}})),measure,fs.createWriteStream(local,{flags:'wx',mode:0o600}),{signal});
        const result=evidence.finish();
        files.push(await publish(job,local,{part:1,kind:'csv',row_from:header.transactionCount?1:0,row_to:header.transactionCount,
          opening_minor:opening,closing_minor:String(header.closingBalanceCents),credits_minor:String(header.totalCreditsCents),
          debits_minor:String(header.totalDebitsCents),row_hash:result.sourceHash,sha256:digest.digest('hex'),byte_length:bytes,media_type:'text/csv; charset=utf-8'},signal));
        bytesUsed=bytes;
        await checkpoint(job,signal,{rowsRendered:rendered});
        await fs.promises.unlink(local);
      } else {
        const parts=Math.max(1,Math.ceil(header.transactionCount/BUDGET.pdfRows));
        for (let part=1;part<=parts;part+=1) {
          await checkpoint(job,signal);
          const rows=await snapshots.readExportChunk(db,job.id,rendered,BUDGET.pdfRows);
          if (rows.length!==Math.min(BUDGET.pdfRows,header.transactionCount-rendered)) fail('statement_integrity_failed');
          rows.forEach(row=>evidence.add(row));
          const rowHash=hash(rows.map(exportsRenderer.rowDescriptor).join(''));
          const {rows:[existing]}=await db.query('SELECT * FROM statement_export_files WHERE job_id=$1 AND part=$2',[job.id,part]);
          let file;
          if (existing) {
            if (existing.row_hash!==rowHash||String(existing.opening_minor)!==opening||Number(existing.row_to)!==rendered+rows.length) fail('statement_integrity_failed');
            await verifyObject(existing,signal);file=existing;
          } else {
            const document=exportsRenderer.pdfVolumeDocument(header,rows,{jobId:job.id,part,parts,openingMinor:opening});
            const buffer=await renderPdf(document,{language:job.language,signal});
            if (!Buffer.isBuffer(buffer)||buffer.length>exportsRenderer.MAX_PDF_BYTES||buffer.subarray(0,5).toString()!=='%PDF-') fail('statement_export_failed');
            if (bytesUsed+buffer.length>BUDGET.maxBytes) fail('statement_export_budget_exceeded');
            const local=path.join(directory,`volume-${part}.pdf`);
            await fs.promises.writeFile(local,buffer,{flag:'wx',mode:0o600});
            file=await publish(job,local,{part,kind:'volume',row_from:rows[0]?.ordinal||0,row_to:rows.at(-1)?.ordinal||0,
              opening_minor:opening,closing_minor:String(document.closingBalanceCents),credits_minor:String(document.totalCreditsCents),
              debits_minor:String(document.totalDebitsCents),row_hash:rowHash,sha256:hash(buffer),byte_length:buffer.length,media_type:'application/pdf'},signal);
            await fs.promises.unlink(local);
          }
          files.push(file);bytesUsed+=Number(file.byte_length);
          if (bytesUsed>BUDGET.maxBytes) fail('statement_export_budget_exceeded');
          rendered+=rows.length;opening=String(file.closing_minor);
          await checkpoint(job,signal,{rowsRendered:rendered});
        }
      }
      const result=evidence.finish();
      const manifest={contract:'statement-export-manifest-v1',id:job.id,complete:true,product:job.product,
        currencyCode:job.currency_code,period:header.period,cutoffAt:header.generatedAt,rowCount:result.rowCount,
        openingMinor:String(header.openingBalanceCents),closingMinor:result.closingMinor,creditsMinor:result.creditsMinor,
        debitsMinor:result.debitsMinor,sourceHash:result.sourceHash,byteLength:bytesUsed,
        fileCount:files.length,format:job.format,language:job.language,holdsUnavailable:true,files:files.map(shapeFile)};
      await checkpoint(job,signal);
      const {rows:[completed]}=await db.query(
        `UPDATE statement_export_jobs SET state='complete',manifest=$4,source_hash=$5,rows_rendered=row_count,
         lease_owner=NULL,lease_until=NULL,error_code=NULL,completed_at=now(),updated_at=now()
         WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND lease_until>now() AND state='rendering'
         AND NOT EXISTS (SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=$1) RETURNING id`,
        [job.id,job.lease_owner,job.fence,JSON.stringify(manifest),result.sourceHash]);
      if (!completed) fail('statement_export_lease_lost');
      return manifest;
    } catch(error) {
      const code=heartbeatError?.code||(/^statement_[a-z_]+$/.test(error.code||'')?error.code:'statement_export_failed');
      await db.query(`UPDATE statement_export_jobs SET state=CASE WHEN EXISTS
        (SELECT 1 FROM statement_export_cancellations c WHERE c.job_id=$1) THEN 'cancelled' ELSE 'failed' END,
        error_code=$4,lease_owner=NULL,lease_until=NULL,updated_at=now()
        WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND state IN ('freezing','rendering')`,
      [job.id,job.lease_owner,job.fence,code]);
      throw error;
    } finally {
      clearInterval(heartbeat);clearTimeout(deadline);controllers.delete(controller);
      if (directory) await fs.promises.rm(directory,{recursive:true,force:true});
    }
  }
  async function manifest(id,userId) {
    const job=await requireJob(id,userId);
    if (job.state!=='complete'||!job.manifest?.complete) fail('statement_export_not_ready');
    return job.manifest;
  }
  async function download(id,fileId,userId) {
    await manifest(id,userId);
    if (!UUID.test(String(fileId))) missing();
    const {rows:[file]}=await db.query('SELECT * FROM statement_export_files WHERE job_id=$1 AND id=$2',[id,fileId]);
    if (!file) missing();
    await storage?.assertPrivate();
    if (!storage) fail('statement_storage_unconfigured',503);
    // Re-verify before exposing an object. Verification streams and never loads
    // a full CSV; the separately opened download also enforces size/checksum.
    await verifyObject(file);
    const source=await storage.getObjectStream(file.object_key);
    if (!source) fail('statement_export_object_missing',503);
    let bytes=0;const digest=crypto.createHash('sha256');
    const guard=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;digest.update(chunk);
      if(bytes>Number(file.byte_length))return done(new AppError('Corrupt export',502,'statement_export_object_corrupt'));
      done(null,chunk);},flush(done){done(bytes===Number(file.byte_length)&&digest.digest('hex')===file.sha256?null:
        new AppError('Corrupt export',502,'statement_export_object_corrupt'));}});
    source.on('error',error=>guard.destroy(error));
    guard.on('close',()=>source.destroy?.());source.pipe(guard);
    return {stream:guard,file:shapeFile(file)};
  }
  async function deliverNotifications() {
    if (!notify) return;
    const {rows}=await db.query(`SELECT * FROM statement_export_jobs WHERE state='complete' AND notification_state='pending'
      ORDER BY completed_at,id LIMIT 20`);
    for (const job of rows) {
      const {labels}=require('./creditStatementPdf').languageCopy(job.language);
      const delivered=await notify({userId:job.requested_by,type:'statement_ready',title:labels.title,body:'',
        action_url:`/statements/exports/${job.id}`,data:{exportJobId:job.id},idempotencyKey:`statement-export:${job.id}`});
      if (delivered?.success) await db.query(`UPDATE statement_export_jobs SET notification_state='sent' WHERE id=$1 AND state='complete'`,[job.id]);
    }
  }
  async function runOnce() {
    const job=await claim();
    if (job) await processExportJob(job);
    await deliverNotifications();return !!job;
  }
  function start() {
    if (timer) return;
    stopping=false;
    const tick=()=>{if(stopping||running)return;running=runOnce().catch(error=>{
      require('../utils/logger').warn('statement_export_worker_failed',{code:/^statement_[a-z_]+$/.test(error.code||'')?error.code:'statement_export_failed'});
    }).finally(()=>{running=null;});};
    timer=setInterval(tick,1000);timer.unref?.();tick();
  }
  async function stop() {
    stopping=true;clearInterval(timer);timer=null;
    controllers.forEach(controller=>controller.abort());
    if(running)await running;
  }
  return {request,status,cancel,retry,manifest,download,claim,process:processExportJob,runOnce,start,stop,requireJob,deliverNotifications};
}

let defaultService;
function configure(options) {if(defaultService)throw new Error('Statement export service already configured');defaultService=createService(options);return defaultService;}
function service() {return defaultService||(defaultService=createService());}
module.exports={createService,configure,BUDGET,parseRequest,authorizeScope,shapeJob,
  ...Object.fromEntries(['request','status','cancel','retry','manifest','download','claim','process','runOnce','start','stop'].map(name=>[name,(...args)=>service()[name](...args)]))};
