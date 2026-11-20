'use strict';
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const url = new URL(raw);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/credit_statement_test') throw new Error('Disposable helper database required');
  process.env.DATABASE_URL = raw;
}
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
jest.mock('../middleware/auth', () => ({authenticate:(req,res,next) => {const id=req.get('x-discovery-user');if(!id)return res.sendStatus(401);req.user={id};next();}}));
jest.mock('../utils/storage', () => {
  const objects = new Map();
  return {
    uploadFile: async(buffer,folder) => {const key=`${folder}/${require('crypto').randomUUID()}.jpg`;objects.set(key,buffer);return key;},
    getSignedDownloadUrl: async(key) => objects.has(key) ? `http://storage.test/private/${key}?expires=300` : null,
    getObjectStream: async(key) => objects.has(key) ? require('stream').Readable.from(objects.get(key)) : null,
  };
});
const crypto=require('crypto'),db=require('../db'),discovery=require('../services/helperDiscoveryService'),portfolio=require('../services/helperPortfolioService');
const helper=crypto.randomUUID(),customer=crypto.randomUUID(),other=crypto.randomUUID(),jobs=[];
const describeDb=raw?describe:describe.skip;
async function job(status='completed') {
  const {rows:[row]}=await db.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,requirements,required_skills,private_notes) VALUES($1,$2,'Portfolio job','Fixture',$3,'["Bring ladder"]','["Painting"]','Never expose') RETURNING *`,[customer,helper,status]);jobs.push(row.id);return row;
}
async function upload(target) {
  const buffer=await require('sharp')({create:{width:2,height:2,channels:3,background:'#ff8800'}}).png().toBuffer();
  return portfolio.upload(target.id,helper,{buffer,mimetype:'image/png'});
}
async function request(target) {
  const {key}=await upload(target);
  const input={storage_key:key,caption:'Painted wall with no private details',requestId:crypto.randomUUID()};
  return {input,row:await portfolio.create(target.id,helper,input)};
}
function app() {
  const express=require('express'),instance=express();instance.use(express.json());
  instance.use('/api/helpers/me',require('../routes/helperWork'));
  instance.get('/api/helpers/portfolio/:requestId/image',require('../controllers/helperPortfolioImage'));
  instance.use(require('../middleware/errorHandler').errorHandler);return instance;
}
describeDb('helper discovery, suitability and portfolio consent',()=>{
  beforeAll(async()=>{
    for(const id of [helper,customer,other])await db.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,id_verified,terms_accepted,terms_accepted_at,terms_version,timezone) VALUES($1,$2,'x','Discovery','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'discovery-test','UTC')`,[id,`discovery-${id}@example.invalid`]);
    for(const id of [helper,other])await db.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`,[id]);
    for(let day=0;day<7;day++)await db.query("INSERT INTO helper_availability(helper_id,day_of_week,start_time,end_time,is_active) VALUES($1,$2,'08:00','18:00',TRUE)",[helper,day]);
  });
  afterAll(async()=>{
    await db.query('DELETE FROM helper_gallery WHERE user_id=$1',[helper]);
    await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);
    await db.query('DELETE FROM appointments WHERE helper_id=$1',[helper]);
    await db.query('DELETE FROM helper_availability WHERE helper_id=$1',[helper]);
    await db.query('DELETE FROM helper_profiles WHERE user_id=$1',[helper]);
    await db.query('DELETE FROM access_grants WHERE user_id=ANY($1::uuid[])',[[helper,other]]);await db.end();
  });
  test('radius defaults, cross-device persistence, bounds, stale versions and account isolation',async()=>{
    expect(await discovery.preferences(helper)).toMatchObject({opportunity_radius_miles:25,discovery_version:1});
    const first=await discovery.save(helper,{opportunity_radius_miles:60,expectedVersion:1});expect(first.discovery_version).toBe(2);
    expect((await discovery.preferences(helper)).opportunity_radius_miles).toBe(60);
    expect((await discovery.preferences(other)).opportunity_radius_miles).toBe(25);
    await expect(discovery.save(helper,{opportunity_radius_miles:35,expectedVersion:1})).rejects.toMatchObject({statusCode:409});
    for(const radius of [0,251,5.1,'25'])await expect(discovery.save(helper,{opportunity_radius_miles:radius,expectedVersion:2})).rejects.toMatchObject({statusCode:400});
    await expect(discovery.preferences(customer)).rejects.toMatchObject({statusCode:403});
  });
  test('suitability is advisory, scope-safe and reflects real calendar conflicts',async()=>{
    const target=await job('published');
    await db.query("UPDATE jobs SET assigned_helper_id=NULL,scheduled_start_at='2030-06-17T09:00:00Z',scheduled_end_at='2030-06-17T10:00:00Z' WHERE id=$1",[target.id]);
    const preview=await discovery.preview(helper,target.id);
    expect(preview).toMatchObject({advisory:true,can_bid_now:true,schedule:'available',requirements:['Bring ladder'],required_skills:['Painting']});
    expect(preview).not.toHaveProperty('private_notes');expect(preview).not.toHaveProperty('client_id');
    await db.query(`INSERT INTO appointments(customer_id,helper_id,service_description,scheduled_start_time,scheduled_end_time,status,created_by_user_id) VALUES($1,$2,'Busy','2030-06-17T09:00:00Z','2030-06-17T10:00:00Z','confirmed',$1)`,[customer,helper]);
    expect((await discovery.preview(helper,target.id)).schedule).toBe('conflict');
    const privateJob=await job();await expect(discovery.preview(other,privateJob.id)).rejects.toMatchObject({statusCode:404});
    await expect(discovery.preview(customer,target.id)).rejects.toMatchObject({statusCode:403});
  });
  test('request remains private until the customer approves, then revocation removes public access',async()=>{
    const target=await job(),{input,row}=await request(target);
    expect((await portfolio.create(target.id,helper,input)).id).toBe(row.id);
    await expect(portfolio.create(target.id,helper,{...input,caption:'Changed'})).rejects.toMatchObject({code:'idempotency_conflict'});
    expect((await db.query('SELECT * FROM helper_gallery WHERE permission_request_id=$1',[row.id])).rows).toHaveLength(0);
    await expect(portfolio.image(row.id)).rejects.toMatchObject({statusCode:404});
    await expect(portfolio.list(target.id,other)).rejects.toMatchObject({statusCode:404});
    await expect(portfolio.decide(target.id,row.id,helper,{status:'approved',expectedVersion:1})).rejects.toMatchObject({statusCode:403});
    const approved=await portfolio.decide(target.id,row.id,customer,{status:'approved',expectedVersion:1});expect(approved.version).toBe(2);
    expect((await db.query('SELECT url FROM helper_gallery WHERE permission_request_id=$1',[row.id])).rows[0].url).toBe(`/api/helpers/portfolio/${row.id}/image`);
    const http=require('supertest');const image=await http(app()).get(`/api/helpers/portfolio/${row.id}/image`).expect(200);
    expect(image.headers['cache-control']).toBe('no-store');expect(image.headers['content-type']).toMatch(/image\/jpeg/);
    await expect(portfolio.decide(target.id,row.id,customer,{status:'revoked',expectedVersion:1})).rejects.toMatchObject({statusCode:409});
    await portfolio.decide(target.id,row.id,customer,{status:'revoked',expectedVersion:2});
    await http(app()).get(`/api/helpers/portfolio/${row.id}/image`).expect(404);
    expect((await db.query('SELECT id FROM helper_gallery WHERE permission_request_id=$1',[row.id])).rows).toHaveLength(0);
    const history=(await portfolio.list(target.id,customer)).requests[0];expect(history.events.map(e=>e.status)).toEqual(['pending','approved','revoked']);expect(history).not.toHaveProperty('storage_key');
    expect(history.media_url).toContain('expires=300');
  });
  test('concurrent decisions commit once, decline is final and helpers can withdraw',async()=>{
    const target=await job(),{row}=await request(target);
    const results=await Promise.allSettled(['approved','declined'].map(status=>portfolio.decide(target.id,row.id,customer,{status,expectedVersion:1})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected').reason.statusCode).toBe(409);
    const second=await request(target);await portfolio.decide(target.id,second.row.id,helper,{status:'withdrawn',expectedVersion:1});
    await expect(portfolio.decide(target.id,second.row.id,customer,{status:'approved',expectedVersion:2})).rejects.toMatchObject({statusCode:409});
    const third=await request(target);await portfolio.decide(target.id,third.row.id,customer,{status:'declined',expectedVersion:1});
    await expect(portfolio.decide(target.id,third.row.id,customer,{status:'approved',expectedVersion:2})).rejects.toMatchObject({statusCode:409});
  });
  test('upload is bound to assigned helper and job; no arbitrary public URLs or missing storage',async()=>{
    const target=await job('in_progress');await expect(upload(target)).rejects.toMatchObject({statusCode:403});
    await db.query("UPDATE jobs SET status='completed' WHERE id=$1",[target.id]);
    await expect(portfolio.upload(target.id,other,{buffer:Buffer.from('bad'),mimetype:'image/jpeg'})).rejects.toMatchObject({statusCode:404});
    await expect(portfolio.upload(target.id,helper,{buffer:Buffer.from('not an image'),mimetype:'image/jpeg'})).rejects.toMatchObject({statusCode:400});
    await expect(portfolio.create(target.id,helper,{caption:'X',media_url:'https://oxsteed.com/private.jpg',requestId:crypto.randomUUID()})).rejects.toMatchObject({statusCode:400});
    await expect(portfolio.create(target.id,helper,{caption:'X',storage_key:`portfolio-private/${other}/${target.id}/fake.jpg`,requestId:crypto.randomUUID()})).rejects.toMatchObject({statusCode:400});
    await expect(portfolio.create(target.id,helper,{caption:'X',storage_key:`portfolio-private/${helper}/${target.id}/fake.jpg`,requestId:crypto.randomUUID()})).rejects.toMatchObject({statusCode:400});
  });
  test('authenticated endpoints refuse anonymous access and keep access responses uncached',async()=>{
    const http=require('supertest');await http(app()).get('/api/helpers/me/discovery').expect(401);
    const result=await http(app()).get('/api/helpers/me/discovery').set('x-discovery-user',helper).expect(200);expect(result.headers['cache-control']).toBe('no-store');
  });
  test('revocation denies helper old links and further approval, but permits customer removal',async()=>{
    const target=await job(),approved=await request(target),pending=await request(target);
    await portfolio.decide(target.id,approved.row.id,customer,{status:'approved',expectedVersion:1});
    await db.query("UPDATE access_grants SET status='revoked' WHERE user_id=$1",[helper]);
    await expect(discovery.preferences(helper)).rejects.toMatchObject({statusCode:403});
    await expect(discovery.preview(helper,target.id)).rejects.toMatchObject({statusCode:403});
    await expect(portfolio.list(target.id,helper)).rejects.toMatchObject({statusCode:403});
    await expect(portfolio.image(approved.row.id)).rejects.toMatchObject({statusCode:404});
    await expect(portfolio.decide(target.id,pending.row.id,customer,{status:'approved',expectedVersion:1})).rejects.toMatchObject({statusCode:403});
    await portfolio.decide(target.id,approved.row.id,customer,{status:'revoked',expectedVersion:2});
    await db.query("UPDATE access_grants SET status='active' WHERE user_id=$1",[helper]);
  });
});
