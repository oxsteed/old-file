'use strict';

// Explicit opt-in; these fixtures live in a NEW disposable schema, never in
// migrated customer/financial tables. The URL guard rejects production targets.
jest.unmock('pg');
jest.mock('../middleware/auth',()=>({authenticate:(req,_res,next)=>{req.user={id:req.headers['x-test-actor']||'b279247f-65d1-4c3c-8ae7-a4cb5d951849'};next();}}));
jest.mock('../middleware/rateLimiter',()=>({creditExportLimiter:(_req,_res,next)=>next()}));
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {Readable}=require('node:stream');
const {createService}=require('../services/statementExportJobService');
const {materializeExportSource}=require('../services/creditStatementService');
const supertest=require('supertest');
const express=require('express');
const {createRouter}=require('../routes/statementExports');

const url=process.env.STATEMENT_TEST_DATABASE_URL;
if(url){const parsed=new URL(url);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/credit_statement_test')throw new Error('Only an explicitly isolated statement test database is allowed');}
const describeDb=url?describe:describe.skip;
const user='b279247f-65d1-4c3c-8ae7-a4cb5d951849',stranger='5f0d0562-3cba-4632-8609-1d9daf43930e';
const request={product:'restaurant',restaurantId:1,currencyCode:'USD',from:'2026-08-01',to:'2026-08-31',format:'csv',language:'en'};

describeDb('R05 isolated durable SQL export pipeline',()=>{
  let root,db,service,schema,objects,pdfCalls,storage,copyHook;
  beforeAll(async()=>{
    root=new Pool({connectionString:url,max:2});
    schema=`statement_export_test_${crypto.randomBytes(6).toString('hex')}`;
    await root.query(`CREATE SCHEMA ${schema}`);
    db=new Pool({connectionString:url,max:4,options:`-c search_path=${schema},public`});
    await db.query(`CREATE TABLE users(id uuid PRIMARY KEY,first_name text);
      CREATE TABLE food_restaurants(id bigint PRIMARY KEY,display_name text);
      CREATE TABLE statement_snapshots(id uuid PRIMARY KEY,frozen_document jsonb);
      CREATE TABLE food_customer_wallet_accounts(id bigint PRIMARY KEY,customer_id uuid,restaurant_id bigint,currency_code text,created_at timestamptz);
      CREATE TABLE food_customer_wallet_ledger(id bigint PRIMARY KEY,account_id bigint,currency_code text,created_at timestamptz,
        entry_sequence bigint,entry_type text,description text,amount_cents bigint,balance_after_cents bigint);
      CREATE INDEX synthetic_ledger_scope ON food_customer_wallet_ledger(account_id,created_at,entry_sequence,id);
      INSERT INTO users VALUES ('${user}','Synthetic'),('${stranger}','Stranger');
      INSERT INTO food_restaurants VALUES(1,'Synthetic restaurant');
      INSERT INTO food_customer_wallet_accounts VALUES(1,'${user}',1,'USD','2020-01-01');`);
    await db.query(fs.readFileSync(path.join(__dirname,'../migrations/693_statement_export_jobs.sql'),'utf8'));
  },30000);
  afterAll(async()=>{
    await db?.end();
    if(schema)await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root?.end();
  },30000);
  beforeEach(async()=>{
    objects=new Map();pdfCalls=[];copyHook=null;
    storage={assertPrivate:jest.fn().mockReturnValue({bucket:'synthetic-private'}),uploadFile:jest.fn(async({filePath,objectKey})=>objects.set(objectKey,fs.readFileSync(filePath))),
      getObjectStream:jest.fn(async key=>objects.has(key)?Readable.from(objects.get(key)):null)};
    service=createService({db,storage,materialize:async(...args)=>{
      if(copyHook)await copyHook();return materializeExportSource(...args);
    },diskCheck:async()=>2**40,renderPdf:async document=>{
      pdfCalls.push(document);return Buffer.from(`%PDF-synthetic-${document.volume.part}-${document.transactionCount}`);
    }});
    // Only the test schema's synthetic live-source table is replaceable.
    await db.query('TRUNCATE food_customer_wallet_ledger');
    await db.query(`UPDATE statement_export_jobs SET state='cancelled',lease_owner=NULL,lease_until=NULL
      WHERE state IN ('pending','freezing','rendering')`);
  });
  async function seed(count){await db.query(`INSERT INTO food_customer_wallet_ledger
    SELECT g,1,'USD','2026-08-15'::timestamptz,g,'credit','Synthetic =1+1',1,g FROM generate_series(1,$1::int) g`,[count]);}
  async function queue(input={}){return service.request(user,{...request,...input},crypto.randomUUID());}
  test.each([0,1,5000,5001,100000])('complete %i-row frozen CSV and manifest',async count=>{
    await seed(count);const job=await queue();const claimed=await service.claim();
    expect(claimed.id).toBe(job.id);
    const manifest=await service.process(claimed);
    expect(manifest).toMatchObject({complete:true,rowCount:count,creditsMinor:String(count),closingMinor:String(count),fileCount:1});
    const response=await service.download(job.id,manifest.files[0].id,user);
    let csv='';for await(const chunk of response.stream)csv+=chunk;
    expect(csv.split('\r\n').filter(line=>line.includes('"2026-08-15'))).toHaveLength(count);
    expect((await service.status(job.id,user)).state).toBe('complete');
  },60000);
  test('representative 1,000,000-row SQL freeze, streamed private publication and complete manifest',async()=>{
    await seed(1000000);const job=await queue();const claimed=await service.claim();
    const started=Date.now(),manifest=await service.process(claimed);
    expect(manifest).toMatchObject({complete:true,rowCount:1000000,creditsMinor:'1000000',closingMinor:'1000000'});
    expect(manifest.files[0].rowTo).toBe(1000000);
    expect(manifest.byteLength).toBeLessThan(512*1024*1024);
    expect((await service.status(job.id,user)).rowsRendered).toBe(1000000);
    const hardware={platform:require('os').platform(),arch:require('os').arch(),cpu:require('os').cpus()[0].model,
      cpuCount:require('os').cpus().length,elapsedMs:Date.now()-started,outputBytes:manifest.byteLength,memory:process.memoryUsage(),dbPoolMax:4};
    process.stdout.write(`R05_SYNTHETIC_CAPACITY ${JSON.stringify(hardware)}\n`);
  },600000);
  test('actual HTTP router reaches SQL worker, private manifest/download and rejects a stranger',async()=>{
    await seed(5001);const app=express();app.use(express.json());app.use('/api/statements/exports',createRouter(service));
    app.use((error,_req,res,_next)=>res.status(error.statusCode||error.status||500).json({code:error.code}));
    const response=await supertest(app).post('/api/statements/exports').set('Idempotency-Key',crypto.randomUUID()).send(request).expect(202);
    const id=response.body.data.id;
    await supertest(app).get(`/api/statements/exports/${id}`).expect(200);
    await service.process(await service.claim());
    const manifest=(await supertest(app).get(`/api/statements/exports/${id}/manifest`).expect(200)).body.data;
    const download=await supertest(app).get(`/api/statements/exports/${id}/files/${manifest.files[0].id}`).expect(200);
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(Number(download.headers['content-length'])).toBe(manifest.files[0].byteLength);
    await supertest(app).get(`/api/statements/exports/${id}/manifest`).set('x-test-actor',stranger).expect(404);
    const saved=(await db.query('SELECT object_key,storage_bucket FROM statement_export_files WHERE job_id=$1',[id])).rows[0];
    expect(saved.object_key).toMatch(/\/stmt\/exports\//);expect(saved.storage_bucket).toBe('synthetic-private');
    storage.assertPrivate.mockReturnValue({bucket:'changed-bucket'});
    await supertest(app).get(`/api/statements/exports/${id}/files/${manifest.files[0].id}`).expect(503);
  },30000);
  test('real bounded PDF worker publishes verified bytes and a complete manifest',async()=>{
    await seed(3);const real=createService({db,storage,diskCheck:async()=>2**40});
    const job=await queue({format:'pdf'});const manifest=await real.process(await real.claim());
    expect(manifest.rowCount).toBe(3);
    const file=(await db.query('SELECT * FROM statement_export_files WHERE job_id=$1',[job.id])).rows[0];
    expect(objects.get(file.object_key).subarray(0,5).toString()).toBe('%PDF-');
    expect(file.sha256).toBe(crypto.createHash('sha256').update(objects.get(file.object_key)).digest('hex'));
  },60000);
  test('new postings after transaction snapshot are excluded and frozen evidence is immutable',async()=>{
    await seed(5001);const job=await queue();const claimed=await service.claim();
    copyHook=()=>db.query(`INSERT INTO food_customer_wallet_ledger VALUES(5002,1,'USD','2026-08-15',5002,'credit','Late posting',1,5002)`);
    const manifest=await service.process(claimed);
    expect(manifest.rowCount).toBe(5001);
    expect((await db.query('SELECT count(*) FROM food_customer_wallet_ledger')).rows[0].count).toBe('5002');
    await expect(db.query('UPDATE statement_export_rows SET credit_minor=9 WHERE job_id=$1',[job.id])).rejects.toThrow('immutable');
  },60000);
  test('idempotent requests conflict if the accounting scope changes',async()=>{
    const key=crypto.randomUUID();const first=await service.request(user,request,key);
    expect((await service.request(user,request,key)).id).toBe(first.id);
    await expect(service.request(user,{...request,format:'pdf'},key)).rejects.toMatchObject({code:'statement_export_idempotency_conflict'});
    await expect(service.status(first.id,stranger)).rejects.toMatchObject({code:'statement_export_not_found'});
  });
  test('5,001-entry PDF produces all three explicitly numbered bounded volumes',async()=>{
    await seed(5001);const job=await queue({format:'pdf'});const manifest=await service.process(await service.claim());
    expect(manifest.files.map(f=>[f.rowFrom,f.rowTo])).toEqual([[1,2000],[2001,4000],[4001,5001]]);
    expect(pdfCalls.map(d=>d.transactionCount)).toEqual([2000,2000,1001]);
    expect(manifest.files[1].openingMinor).toBe(manifest.files[0].closingMinor);
    expect((await service.manifest(job.id,user)).files).toHaveLength(3);
  },30000);
  test('provider failure retries the identical freeze despite subsequent postings',async()=>{
    await seed(5001);const job=await queue({format:'pdf'});
    storage.uploadFile.mockImplementationOnce(async()=>{throw new Error('Synthetic provider outage');});
    await expect(service.process(await service.claim())).rejects.toHaveProperty('code');
    const frozen=(await db.query('SELECT frozen_header FROM statement_export_jobs WHERE id=$1',[job.id])).rows[0].frozen_header;
    await db.query(`INSERT INTO food_customer_wallet_ledger VALUES(5002,1,'USD','2026-08-15',5002,'credit','After failure',1,5002)`);
    await service.retry(job.id,user);
    const manifest=await service.process(await service.claim());
    expect(manifest.rowCount).toBe(5001);expect(manifest.cutoffAt).toBe(frozen.generatedAt);
  },30000);
  test('cancel retains frozen/verified evidence and retry can finish remaining volumes',async()=>{
    await seed(5001);const job=await queue({format:'pdf'});
    storage.uploadFile.mockImplementationOnce(async({filePath,objectKey})=>{
      objects.set(objectKey,fs.readFileSync(filePath));await service.cancel(job.id,user);
    });
    await expect(service.process(await service.claim())).rejects.toMatchObject({code:'statement_export_lease_lost'});
    expect((await service.status(job.id,user)).state).toBe('cancelled');
    expect((await service.status(job.id,user)).sourceFrozen).toBe(true);
    await service.retry(job.id,user);expect((await service.process(await service.claim())).rowCount).toBe(5001);
  },30000);
  test('account fairness and overlapping workers cannot double claim a job',async()=>{
    const first=await queue(),second=await queue({format:'pdf'});
    const [left,right]=await Promise.all([service.claim(),service.claim()]);
    expect([left,right].filter(Boolean)).toHaveLength(1);
    expect((left||right).id).toBe(first.id);
    await service.cancel(first.id,user);
    // Cancellation is acknowledged by the active worker under its fence.
    await expect(service.process(left||right)).rejects.toMatchObject({code:'statement_export_lease_lost'});
    expect((await service.claim()).id).toBe(second.id);
  });
  test('expired lease fences the old worker and new owner can complete',async()=>{
    await seed(1);const job=await queue();const old=await service.claim();
    await db.query(`UPDATE statement_export_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,[job.id]);
    const current=await service.claim();expect(Number(current.fence)).toBe(Number(old.fence)+1);
    await expect(service.process(old)).rejects.toMatchObject({code:'statement_export_lease_lost'});
    expect((await service.process(current)).rowCount).toBe(1);
  });
  test('disk pressure fails before freezing and never marks partial output complete',async()=>{
    const limited=createService({db,storage,diskCheck:async()=>0});const job=await queue();
    await expect(limited.process(await limited.claim())).rejects.toMatchObject({code:'statement_export_disk_budget'});
    const status=await limited.status(job.id,user);expect(status.state).toBe('failed');expect(status.sourceFrozen).toBe(false);
  });
});
