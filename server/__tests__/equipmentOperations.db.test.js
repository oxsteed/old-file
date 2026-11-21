'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable equipment database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
jest.mock('../middleware/auth',()=>({authenticate:(req,res,next)=>{const id=req.get('x-equipment-user');if(!id)return res.sendStatus(401);req.user={id};next();}}));
jest.mock('../services/bookingEmailService',()=>({sendBookingConfirmation:jest.fn()}));
jest.mock('../growth/emit',()=>({emitDomainEvent:jest.fn(),commerceEventProps:value=>value}));
const crypto=require('crypto'),db=require('../db'),service=require('../services/equipmentOperations');
const owner=crypto.randomUUID(),renter=crypto.randomUUID(),other=crypto.randomUUID(),tools=[];
const describeDb=raw?describe:describe.skip;
const policy=version=>({accessories:[{name:'Battery',quantity:2}],checklist:['Housing intact'],rules:'Dry indoor use only',expectedVersion:version});
async function listing(){const {rows:[row]}=await db.query("INSERT INTO tool_rentals(user_id,name,condition,daily_rate) VALUES($1,'Drill','good',10) RETURNING *",[owner]);tools.push(row.id);return row;}
async function booked(toolId,start='2030-06-01',end='2030-06-03'){return (await db.query("INSERT INTO tool_rentals_bookings(tool_id,customer_id,owner_id,start_date,end_date,status,total_price) VALUES($1,$2,$3,$4,$5,'payment_confirmed',30) RETURNING *",[toolId,renter,owner,start,end])).rows[0];}
function app(){const express=require('express'),a=express();a.use(express.json());a.use('/api/tool-rentals/operations',require('../routes/equipmentOperations'));a.post('/api/tool-rentals/bookings',require('../middleware/auth').authenticate,require('../controllers/toolBookingsController').createBooking);a.use(require('../middleware/errorHandler').errorHandler);return a;}
describeDb('equipment inventory, conditions, extensions and repair workflows',()=>{
 beforeAll(async()=>{
  for(const id of [owner,renter,other])await db.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Equipment','Fixture','customer',TRUE,TRUE)",[id,`equipment-${id}@example.invalid`]);
  await db.query("INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'tool_owner.list_equipment','self','self','active','legacy_backfill','tool-owner-policy-1')",[owner]);
 });
 afterAll(async()=>{await db.query('DELETE FROM tool_rentals WHERE id=ANY($1::int[])',[tools]);await db.query('DELETE FROM access_grants WHERE user_id=$1',[owner]);await db.end();});
 test('owner inventory saves with versions, rejects foreign access, and snapshots rules at booking',async()=>{
  const tool=await listing();await service.saveTool(tool.id,owner,policy(1));
  await expect(service.saveTool(tool.id,other,policy(2))).rejects.toMatchObject({statusCode:404});
  await expect(service.saveTool(tool.id,owner,policy(1))).rejects.toMatchObject({statusCode:409});
  const booking=await booked(tool.id);await service.saveTool(tool.id,owner,{...policy(2),accessories:[],rules:'New rules'});
  const record=await service.readBooking(booking.id,renter);expect(record.booking.equipment).toMatchObject({accessories:[{name:'Battery',quantity:2}],rules:'Dry indoor use only'});
  await expect(service.readBooking(booking.id,other)).rejects.toMatchObject({statusCode:404});
 });
 test('condition reports are party-scoped, versioned and preserve missing accessory evidence',async()=>{
  const tool=await listing();await service.saveTool(tool.id,owner,policy(1));const booking=await booked(tool.id);
  const input={phase:'pickup',counts:[2],checklist:[true],notes:'Two batteries handed over',expectedVersion:0};
  await service.report(booking.id,owner,input);await expect(service.report(booking.id,owner,input)).rejects.toMatchObject({statusCode:409});
  const returned=await service.report(booking.id,renter,{...input,phase:'return',counts:[1],checklist:[false],notes:'One battery returned'});
  let state=await service.readBooking(booking.id,owner);expect(state.reports.find(row=>row.id===returned.id).missing_items).toEqual([{name:'Battery',quantity:1}]);
  await expect(service.resolveMissing(booking.id,renter,returned.id,{expectedVersion:1,notes:'Self resolve'})).rejects.toMatchObject({statusCode:403});
  await service.resolveMissing(booking.id,owner,returned.id,{expectedVersion:1,notes:'Second battery recovered next day'});
  await expect(service.resolveMissing(booking.id,owner,returned.id,{expectedVersion:1,notes:'Duplicate'})).rejects.toMatchObject({statusCode:409});
  state=await service.readBooking(booking.id,renter);expect(state.reports.find(row=>row.id===returned.id).resolution).toBe('Second battery recovered next day');
  expect((await db.query('SELECT total_price,deposit_status FROM tool_rentals_bookings WHERE id=$1',[booking.id])).rows[0].total_price).toBe('30.00');
 });
 test('free extensions require both parties, use retry keys and reject live calendar conflicts',async()=>{
  const tool=await listing(),booking=await booked(tool.id);const input={end_date:'2030-06-05',requestId:crypto.randomUUID(),no_additional_charge:true};
  const extension=await service.extend(booking.id,renter,input);expect((await service.extend(booking.id,renter,input)).id).toBe(extension.id);
  await expect(service.decideExtension(booking.id,renter,extension.id,{status:'approved',no_additional_charge:true})).rejects.toMatchObject({statusCode:403});
  await booked(tool.id,'2030-06-05','2030-06-07');
  const response=await require('supertest')(app()).post(`/api/tool-rentals/operations/bookings/${booking.id}/extensions/${extension.id}`).set('x-equipment-user',owner).send({status:'approved',no_additional_charge:true});expect(response.status).toBe(409);expect(response.body.code).toBe('equipment_calendar_conflict');
  expect((await service.readBooking(booking.id,renter)).extensions[0].status).toBe('pending');
  await service.decideExtension(booking.id,renter,extension.id,{status:'cancelled'});
  const next=await service.extend(booking.id,renter,{...input,end_date:'2030-06-04',requestId:crypto.randomUUID()});
  await expect(service.decideExtension(booking.id,owner,next.id,{status:'approved'})).rejects.toMatchObject({statusCode:409});
  await service.decideExtension(booking.id,owner,next.id,{status:'approved',no_additional_charge:true});
  expect((await db.query('SELECT end_date::text,total_price FROM tool_rentals_bookings WHERE id=$1',[booking.id])).rows[0]).toMatchObject({end_date:'2030-06-04',total_price:'30.00'});
 });
 test('calendar writes serialize even through older booking APIs',async()=>{
  const tool=await listing();const results=await Promise.allSettled([booked(tool.id),booked(tool.id)]);expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);expect(results.find(row=>row.status==='rejected').reason.constraint).toBe('equipment_calendar_conflict');
 });
 test('repairs and late-return follow-ups are scoped; renters see follow-up without private repair records',async()=>{
  const tool=await listing(),booking=await booked(tool.id,'2020-06-01','2020-06-03');
  await service.record(tool.id,owner,{kind:'repair',occurred_on:'2020-05-01',notes:'Replaced drive bearing'});
  await service.record(tool.id,owner,{kind:'late_return_followup',booking_id:booking.id,occurred_on:'2020-06-04',notes:'Please confirm the return appointment'});
  expect((await service.readTool(tool.id,owner)).overdue).toHaveLength(1);expect((await service.readBooking(booking.id,renter)).followups[0].notes).toContain('return appointment');
  await expect(service.readTool(tool.id,renter)).rejects.toMatchObject({statusCode:404});
  await expect(service.record(tool.id,other,{kind:'repair',occurred_on:'2020-01-01',notes:'Unauthorized'})).rejects.toMatchObject({statusCode:404});
 });
 test('real booking creation requires agreement on the current configured inventory',async()=>{
  const tool=await listing();await service.saveTool(tool.id,owner,policy(1));const http=require('supertest')(app()),body={toolId:tool.id,startDate:'2030-07-01',endDate:'2030-07-03',renterAgreementAccepted:true};
  await http.post('/api/tool-rentals/bookings').set('x-equipment-user',renter).send(body).expect(409);
  const response=await http.post('/api/tool-rentals/bookings').set('x-equipment-user',renter).send({...body,equipmentVersion:2}).expect(201);
  expect(response.body.equipment_snapshot.accessories).toEqual([{name:'Battery',quantity:2}]);expect(response.body.agreement_snapshot.tool.accessories).toEqual([{name:'Battery',quantity:2}]);
 });
 test('revoked owner access denies old links while unrelated customer rental records remain available',async()=>{
  const tool=await listing(),booking=await booked(tool.id);await db.query("UPDATE access_grants SET status='revoked' WHERE user_id=$1",[owner]);
  await expect(service.readTool(tool.id,owner)).rejects.toMatchObject({statusCode:403});await expect(service.readBooking(booking.id,owner)).rejects.toMatchObject({statusCode:403});
  expect((await service.readBooking(booking.id,renter)).owner).toBe(false);
  await require('supertest')(app()).get(`/api/tool-rentals/operations/bookings/${booking.id}`).expect(401);
  await db.query("UPDATE access_grants SET status='active' WHERE user_id=$1",[owner]);
 });
});
