'use strict';

// Explicitly isolated PostgreSQL only. Never fall back to the application's DB.
const rawUrl = process.env.BUSINESS_OPERATIONS_TEST_DATABASE_URL || process.env.STATEMENT_TEST_DATABASE_URL;
function allowedDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && ['/oxsteed_operations_test', '/credit_statement_test'].includes(url.pathname)
      && [...url.searchParams.keys()].every(key => key === 'sslmode');
  } catch { return false; }
}
if (rawUrl && !allowedDatabase(rawUrl)) throw Error('Operations DB tests require an explicit disposable localhost database');
const run = rawUrl ? describe : describe.skip;
const { Pool } = jest.requireActual('pg');
const { randomUUID } = require('crypto');
const { collectBusinessOperations } = require('../services/businessOperationsSummary');

test('operations integration refuses production databases and connection overrides', () => {
  expect(allowedDatabase('postgresql://localhost/oxsteed_operations_test?sslmode=disable')).toBe(true);
  expect(allowedDatabase('postgresql://prod.example/credit_statement_test')).toBe(false);
  expect(allowedDatabase('postgresql://localhost/production')).toBe(false);
  expect(allowedDatabase('postgresql://localhost/credit_statement_test?host=prod.example')).toBe(false);
});

run('business-local operational counts on real PostgreSQL', () => {
  let pool, client, db;
  const schema = `operations_${randomUUID().replaceAll('-', '')}`;
  const self = randomUUID(), other = randomUUID();
  const permissions = new Set(['business.view', 'calendar.view_all', 'calendar.manage_all', 'messages.view_all', 'messages.reply', 'invoices.view']);
  const options = extra => ({ db, businessId: 1, userId: self, role: 'owner', permissions,
    now: new Date('2026-03-08T16:00:00Z'), ...extra });
  beforeAll(async () => {
    pool = new Pool({ connectionString: rawUrl, max: 1 });
    client = await pool.connect();
    let pending = Promise.resolve();
    db = { query: (...args) => {
      const result = pending.then(() => client.query(...args));
      pending = result.catch(() => {});
      return result;
    } };
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    // Same types and columns used by the canonical booking/messaging/invoice tables.
    await db.query(`CREATE TABLE businesses(id int PRIMARY KEY, timezone text, business_kind text, business_mode text);
      CREATE TABLE business_services(id int PRIMARY KEY,business_id int,name text,duration_minutes int);
      INSERT INTO business_services VALUES(1,1,'Synthetic service',30);
      CREATE TABLE business_appointments(id serial PRIMARY KEY,business_id int,staff_id uuid,status text,start_time timestamptz,end_time timestamptz,
        service_id int DEFAULT 1,customer_id uuid,customer_name text DEFAULT 'Synthetic customer',customer_email text,customer_phone text,customer_notes text,
        payment_status text DEFAULT 'pending',base_price_cents int DEFAULT 100,final_price_cents int DEFAULT 100,cancellation_fee_cents int DEFAULT 0,created_at timestamptz DEFAULT now());
      CREATE TABLE business_appointment_notes(id serial PRIMARY KEY,appointment_id int,created_by_id uuid,note_type text,content text,created_at timestamptz DEFAULT now());
      CREATE TABLE business_service_blocked_times(id int PRIMARY KEY,business_id int,service_id int,staff_id uuid,start_time timestamptz,end_time timestamptz,reason text);
      CREATE TABLE users(id uuid PRIMARY KEY,first_name text,last_name text,email text,deleted_at timestamptz);
      CREATE TABLE business_conversations(id int PRIMARY KEY,business_id int,assigned_to_user_id uuid,status text,conversation_type text,
        assigned_at timestamptz,customer_id uuid,customer_name text,customer_email text,subject text,legacy_conversation_id uuid,last_message_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE business_messages(id serial PRIMARY KEY,conversation_id int,sender_type text,message_type text,created_at timestamptz,deleted_at timestamptz,
        sender_id uuid,sender_name text,content text,client_message_id uuid);
      CREATE TABLE business_conversation_participants(conversation_id int,user_id uuid,last_read_message_id int,last_read_at timestamptz,PRIMARY KEY(conversation_id,user_id));
      CREATE TABLE business_message_attachments(id serial PRIMARY KEY,message_id int,file_name text,file_url text,file_size_bytes bigint,file_type text,created_at timestamptz DEFAULT now());
      CREATE TABLE business_invoices(id serial PRIMARY KEY,business_id int,status text,total numeric(12,2),amount_paid numeric(12,2),due_date date,currency_code text);
      INSERT INTO businesses VALUES(1,'America/New_York','service',NULL),(2,'UTC','service',NULL)`);
  });
  afterAll(async () => {
    if (db) { await db.query('ROLLBACK'); await db.query('SET search_path TO public'); await db.query(`DROP SCHEMA ${schema} CASCADE`); client.release(); }
    await pool?.end();
  });
  beforeEach(async () => { await db.query('TRUNCATE business_appointments,business_appointment_notes,business_service_blocked_times,business_messages,business_conversations,business_conversation_participants,business_message_attachments,users,business_invoices RESTART IDENTITY'); });
  async function read(extra) {
    // Prove the entire collector is compatible with a read-only transaction.
    await db.query('BEGIN READ ONLY');
    try { return await collectBusinessOperations(options(extra)); }
    finally { await db.query('ROLLBACK'); }
  }
  test.each([
    ['spring forward', '2026-03-08T16:00:00Z', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['fall back', '2026-11-01T16:00:00Z', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
  ])('%s respects both exact local-day boundaries, overlaps and assignment', async (_label, now, start, end) => {
    const startMs = Date.parse(start), endMs = Date.parse(end);
    const cases = [
      [1,self,'confirmed',startMs,startMs+3600000],
      [1,other,'pending',endMs-1800000,endMs],
      [1,self,'pending',startMs-3600000,startMs+60000],
      [1,self,'confirmed',endMs,endMs+3600000],
      [1,self,'confirmed',startMs-3600000,startMs],
      [1,self,'cancelled',startMs,startMs+3600000],
      [1,self,'no_show',startMs,startMs+3600000],
      [2,self,'pending',startMs,startMs+3600000],
    ];
    for (const [business, staff, status, from, to] of cases)
      await db.query('INSERT INTO business_appointments(business_id,staff_id,status,start_time,end_time) VALUES($1,$2,$3,$4,$5)', [business,staff,status,new Date(from),new Date(to)]);
    const all = await read({ now: new Date(now) });
    expect(all.sections.bookings).toMatchObject({ status: 'ready', today: 3, pending: 2 });
    const own = await read({ now: new Date(now), role: 'employee', permissions: new Set(['business.view','calendar.view_self','calendar.manage_self']) });
    expect(own.sections.bookings).toMatchObject({ status: 'ready', today: 2, pending: 1, scope: 'self' });
    expect(own.tasks).toEqual([{ type: 'confirmBookings', count: 1, panel: 'calendar' }]);
  });
  test('unanswered means the latest visible customer message, scoped to active customer threads and assignment', async () => {
    for (const [id,business,assigned,status,type] of [[1,1,self,'active','customer'],[2,1,other,'active','customer'],[3,1,self,'resolved','customer'],[4,1,self,'active','team'],[5,2,self,'active','customer'],[6,1,self,'active','customer']])
      await db.query('INSERT INTO business_conversations VALUES($1,$2,$3,$4,$5)',[id,business,assigned,status,type]);
    for (const id of [1,2,3,4,5,6]) await db.query("INSERT INTO business_messages(conversation_id,sender_type,message_type,created_at) VALUES($1,'customer','text','2026-03-08T10:00:00Z')",[id]);
    await db.query("INSERT INTO business_messages(conversation_id,sender_type,message_type,created_at,deleted_at) VALUES(1,'team_member','text','2026-03-08T11:00:00Z',now()),(1,'team_member','system','2026-03-08T12:00:00Z',NULL),(6,'team_member','text','2026-03-08T11:00:00Z',NULL)");
    expect((await read()).sections.messages).toMatchObject({ status: 'ready', unanswered: 2 });
    const assigned = await read({ role: 'representative', permissions: new Set(['business.view','messages.view_assigned','messages.reply']) });
    expect(assigned.sections.messages).toMatchObject({ status: 'ready', scope: 'assigned', unanswered: 1 });
    expect(assigned.tasks).toEqual([{ type: 'replyToMessages', count: 1, panel: 'messages' }]);
  });
  test('overdue invoices exclude paid, draft, future and other businesses, and count different currencies without summing them', async () => {
    await db.query(`INSERT INTO business_invoices(business_id,status,total,amount_paid,due_date,currency_code) VALUES
      (1,'sent',100,20,'2026-03-07','USD'),(1,'overdue',100,0,NULL,'EUR'),
      (1,'sent',100,0,'2026-03-08','USD'),(1,'sent',100,0,'2026-03-09','USD'),
      (1,'overdue',100,100,'2026-03-07','USD'),(1,'paid',100,0,'2026-03-07','USD'),
      (1,'draft',100,0,'2026-03-07','USD'),(1,'void',100,0,'2026-03-07','USD'),
      (1,'partial',100,30,'2026-03-07','USD'),(1,'cancelled',100,0,'2026-03-07','USD'),
      (2,'overdue',100,0,'2026-03-07','USD')`);
    const result = await read();
    expect(result.sections.invoices).toEqual({ available: true, status: 'ready', overdue: 3 });
    expect(result.tasks).toContainEqual({ type: 'followUpInvoices', count: 3, panel: 'invoices' });
  });
  test('calendar controllers execute scoped rows, totals, details and atomic note authorization on PostgreSQL', async () => {
    const { mockQuery } = require('./setup');
    const controller = require('../controllers/businessAppointmentsController');
    for (const [business, staff] of [[1,self],[1,other],[2,self]])
      await db.query("INSERT INTO business_appointments(business_id,staff_id,status,start_time,end_time) VALUES($1,$2,'pending','2026-03-08T10:00:00Z','2026-03-08T11:00:00Z')",[business,staff]);
    mockQuery.mockImplementation((sql, params) => db.query(sql, params));
    const request = id => ({ user: { id: self }, params: { businessId: '1', appointmentId: String(id) }, query: {},
      body: { content: 'Synthetic note' }, calendarAccess: { all: false, userId: self } });
    const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
    try {
      const list = response(), next = jest.fn();
      await controller.listAppointments(request(1), list, next);
      expect(next).not.toHaveBeenCalled();
      expect(list.json.mock.calls[0][0]).toMatchObject({ total: 1, appointments: [{ id: 1, staff_id: self }] });
      for (const [id,business,staff] of [[1,1,self],[2,1,other],[3,1,null],[4,2,self]])
        await db.query("INSERT INTO business_service_blocked_times VALUES($1,$2,1,$3,'2026-03-08T10:00:00Z','2026-03-08T11:00:00Z','Synthetic block')",[id,business,staff]);
      const calendar = response(), calendarRequest = request(1);
      calendarRequest.query = { from: '2026-03-08T00:00:00Z', to: '2026-03-09T00:00:00Z' };
      await require('../controllers/businessCalendarController').getBusinessAppointmentsCalendar(calendarRequest, calendar, next);
      expect(next).not.toHaveBeenCalled();
      expect(calendar.json.mock.calls[0][0]).toMatchObject({ appointments: [{ id: 1, staff_id: self }], permissions: { all: false, userId: self } });
      expect(calendar.json.mock.calls[0][0].blocks.map(block => block.id).sort()).toEqual([1,3]);
      const own = response();
      await controller.getAppointment(request(1), own, next);
      expect(next).not.toHaveBeenCalled();
      expect(own.json.mock.calls[0][0]).toMatchObject({ id: 1, staff_id: self, notes: null });
      for (const id of [2,3]) {
        const denied = jest.fn();
        await controller.getAppointment(request(id), response(), denied);
        expect(denied.mock.calls[0][0].statusCode).toBe(404);
        const noteDenied = jest.fn();
        await controller.addAppointmentNote(request(id), response(), noteDenied);
        expect(noteDenied.mock.calls[0][0].statusCode).toBe(404);
      }
      expect((await db.query('SELECT count(*)::int AS n FROM business_appointment_notes')).rows[0].n).toBe(0);
      const note = response();
      await controller.addAppointmentNote(request(1), note, next);
      expect(next).not.toHaveBeenCalled();
      expect(note.status).toHaveBeenCalledWith(201);
      expect(note.json.mock.calls[0][0]).toMatchObject({ appointment_id: 1, created_by_id: self, content: 'Synthetic note' });
    } finally { mockQuery.mockReset(); }
  });
  test('assigned inboxes expose shared team channels and own customer threads, with recent messages and scoped read receipts', async () => {
    const { mockQuery } = require('./setup');
    const controller = require('../controllers/businessMessagingController');
    for (const [id,name] of [[self,'Self'],[other,'Other']])
      await db.query("INSERT INTO users VALUES($1,$2,'Synthetic','synthetic@example.test',NULL)",[id,name]);
    for (const [id,business,assigned,type,name] of [[7,1,self,'customer','Own customer'],[8,1,other,'customer','Other private customer'],[9,1,null,'team','Shared team'],[10,2,self,'customer','Other business']])
      await db.query("INSERT INTO business_conversations(id,business_id,assigned_to_user_id,status,conversation_type,customer_name,legacy_conversation_id) VALUES($1,$2,$3,'active',$4,$5,$6)",[id,business,assigned,type,name,randomUUID()]);
    for (let index=1;index<=60;index++) await db.query(
      "INSERT INTO business_messages(conversation_id,sender_type,message_type,created_at,sender_id,content) VALUES(7,$1,'text',$2,$3,$4)",
      [index===60?'customer':'team_member',new Date(Date.parse('2026-03-08T10:00:00Z')+index*60000),other,`Synthetic message ${index}`]);
    for (const id of [8,9,10]) await db.query("INSERT INTO business_messages(conversation_id,sender_type,message_type,created_at,content) VALUES($1,'customer','text',now(),'Synthetic other message')",[id]);
    mockQuery.mockImplementation((sql,params)=>db.query(sql,params));
    const request = id => ({ user:{id:self},business:{id:1},params:{businessId:'1',conversationId:String(id)},query:{},body:{content:'Synthetic reply'},get:()=>undefined,
      messageAccess:{all:false,userId:self,canReply:true,canAssign:false} });
    const response = () => ({status:jest.fn().mockReturnThis(),json:jest.fn()});
    try {
      const list=response(),next=jest.fn();
      await controller.getConversations(request(7),list,next);
      expect(next).not.toHaveBeenCalled();
      const data=list.json.mock.calls[0][0];
      expect(data.total).toBe(2);
      expect(data.conversations.map(row=>row.id).sort()).toEqual([7,9]);
      expect(JSON.stringify(data)).not.toContain('Other private customer');
      const own=response();await controller.getConversation(request(7),own,next);
      expect(next).not.toHaveBeenCalled();
      const messages=own.json.mock.calls[0][0].messages;
      expect(messages).toHaveLength(50);
      expect(messages[0].id).toBe(11);expect(messages.at(-1).id).toBe(60);
      const receipts=await db.query('SELECT conversation_id,user_id,last_read_message_id FROM business_conversation_participants');
      expect(receipts.rows).toEqual([{conversation_id:7,user_id:self,last_read_message_id:60}]);
      const activity=await read({role:'employee',permissions:new Set(['business.view','messages.view_assigned','messages.reply'])});
      expect(activity.sections.messages).toMatchObject({status:'ready',unanswered:1});
      const before=(await db.query('SELECT count(*)::int AS n FROM business_messages')).rows[0].n;
      for(const id of [8,10])for(const method of ['getConversation','sendMessage','archiveConversation']){
        const denied=jest.fn();await controller[method](request(id),response(),denied);
        expect(denied.mock.calls[0][0].statusCode).toBe(404);
      }
      expect((await db.query('SELECT count(*)::int AS n FROM business_messages')).rows[0].n).toBe(before);
      expect((await db.query("SELECT status FROM business_conversations WHERE id=8")).rows[0].status).toBe('active');
    } finally { mockQuery.mockReset(); }
  });
});
