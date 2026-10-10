'use strict';

// Million-row capacity case, split from statementExportJobs.db.test.js so CI
// can run it in parallel instead of serially under --runInBand. The suite
// creates a per-file random schema, so this file is parallel-safe.
// This test is load-bearing: it proves the 1M-row freeze/stream/manifest
// pipeline works. Do not shrink it.

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

const url=process.env.STATEMENT_TEST_DATABASE_URL;
if(url){const parsed=new URL(url);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/credit_statement_test')throw new Error('Only an explicitly isolated statement test database is allowed');}
const describeDb=url?describe:describe.skip;
const user='b279247f-65d1-4c3c-8ae7-a4cb5d951849';
const request={product:'restaurant',restaurantId:1,currencyCode:'USD',from:'2026-08-01',to:'2026-08-31',format:'csv',language:'en'};

describeDb('R05 million-row frozen export capacity',()=>{
  let root,db,service,schema,objects,pdfCalls,storage,copyHook;
  beforeAll(async()=>{
    root=new Pool({connectionString:url,max:2});
    schema=`statement_export_million_${crypto.randomBytes(6).toString('hex')}`;
    await root.query(`CREATE SCHEMA ${schema}`);
    db=new Pool({connectionString:url,max:4,options:`-c search_path=${schema},public`});
    await db.query(`CREATE TABLE users(id uuid PRIMARY KEY,first_name text);
      CREATE TABLE food_restaurants(id bigint PRIMARY KEY,display_name text);
      CREATE TABLE statement_snapshots(id uuid PRIMARY KEY,frozen_document jsonb);
      CREATE TABLE food_customer_wallet_accounts(id bigint PRIMARY KEY,customer_id uuid,restaurant_id bigint,currency_code text,created_at timestamptz);
      CREATE TABLE food_customer_wallet_ledger(id bigint PRIMARY KEY,account_id bigint,currency_code text,created_at timestamptz,
        entry_sequence bigint,entry_type text,description text,amount_cents bigint,balance_after_cents bigint);
      CREATE INDEX synthetic_ledger_scope ON food_customer_wallet_ledger(account_id,created_at,entry_sequence,id);
      INSERT INTO users VALUES ('${user}','Synthetic');
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
    await db.query('TRUNCATE food_customer_wallet_ledger');
    await db.query(`UPDATE statement_export_jobs SET state='cancelled',lease_owner=NULL,lease_until=NULL
      WHERE state IN ('pending','freezing','rendering')`);
  });
  async function seed(count){await db.query(`INSERT INTO food_customer_wallet_ledger
    SELECT g,1,'USD','2026-08-15'::timestamptz,g,'credit','Synthetic =1+1',1,g FROM generate_series(1,$1::int) g`,[count]);}
  async function queue(input={}){return service.request(user,{...request,...input},crypto.randomUUID());}
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
});
