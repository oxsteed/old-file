'use strict';

// Runs on the store appliance, never inside the public API process.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const express = require('express');
const { normalizeOfflineSale } = require('./storeHubService');
const { computeOrderTax, orderTotalWithTax } = require('./restaurantOrderTaxService');

function failure(code, status = 409) { return Object.assign(new Error(code), { code, status }); }
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function integer(value, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure('invalid_integer', 400);
  return value;
}

function createHub({ filename, restaurantId, locationId, hubId, cloud, origin,
  maxSaleCents = 100000, maxPendingCents = 1000000, now = Date.now }) {
  [restaurantId, locationId, hubId, maxSaleCents, maxPendingCents].forEach(n => integer(n));
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS peers(id INTEGER PRIMARY KEY,hash TEXT NOT NULL,claims TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sales(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
      request_hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'received',
      revision INTEGER NOT NULL DEFAULT 1,uploaded INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS actions(key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS prints(id INTEGER PRIMARY KEY AUTOINCREMENT,sale_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',claim TEXT,device_id INTEGER);`);
  db.exec(`CREATE TABLE IF NOT EXISTS pending_balance(id INTEGER PRIMARY KEY CHECK(id=1), cents INTEGER NOT NULL);
    INSERT OR IGNORE INTO pending_balance SELECT 1,COALESCE(SUM(CAST(json_extract(payload,'$.totalCents') AS INTEGER)),0) FROM sales WHERE uploaded=0;
    CREATE TRIGGER IF NOT EXISTS pending_sale_insert AFTER INSERT ON sales WHEN NEW.uploaded=0 BEGIN
      UPDATE pending_balance SET cents=cents+CAST(json_extract(NEW.payload,'$.totalCents') AS INTEGER) WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS pending_sale_upload AFTER UPDATE OF uploaded ON sales WHEN OLD.uploaded=0 AND NEW.uploaded=1 BEGIN
      UPDATE pending_balance SET cents=cents-CAST(json_extract(NEW.payload,'$.totalCents') AS INTEGER) WHERE id=1; END;`);
  const scope = JSON.stringify({ restaurantId, locationId, hubId });
  const prior = db.prepare('SELECT value FROM settings WHERE key=?').get('scope');
  if (prior && prior.value !== scope) { db.close(); throw failure('hub_store_mismatch'); }
  db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('scope', scope);
  let syncing = false;
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function snapshot() {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('snapshot');
    const value = row && JSON.parse(row.value);
    if (!value || Date.parse(value.expiresAt) <= now()) throw failure('hub_snapshot_expired');
    return value;
  }
  function setSnapshot(value) {
    if (value.restaurantId !== restaurantId || value.locationId !== locationId
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) > now()+3600000)
      throw failure('hub_snapshot_invalid');
    db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('snapshot', JSON.stringify(value));
  }
  function invalidate() {
    db.prepare('DELETE FROM peers').run();
    db.prepare('DELETE FROM settings WHERE key=?').run('snapshot');
  }
  async function authorize(id, token) {
    integer(id);
    if (typeof token !== 'string' || token.length < 16 || token.length > 200) throw failure('invalid_device_credential', 401);
    const hash = digest(token);
    let claims;
    try {
      claims = await cloud('POST', 'authorize-peer', { deviceId: id, token });
      if (claims.deviceId !== id || claims.restaurantId !== restaurantId || claims.locationId !== locationId
        || !['pos','kitchen','display','printer'].includes(claims.role)
        || !Number.isFinite(Date.parse(claims.expiresAt)) || Date.parse(claims.expiresAt)>now()+3600000)
        throw failure('hub_peer_forbidden', 403);
      if(claims.role==='pos'&&(!Array.isArray(claims.shiftIds)||claims.shiftIds.length!==1||!Number.isSafeInteger(claims.shiftIds[0])))throw failure('hub_drawer_assignment_required',403);
      db.prepare('INSERT OR REPLACE INTO peers VALUES(?,?,?)').run(id, hash, JSON.stringify(claims));
    } catch (error) {
      // An explicit cloud denial revokes immediately. Only transport outages
      // may use a previously authorized, bounded offline lease.
      if (error.status) { db.prepare('DELETE FROM peers WHERE id=?').run(id); throw error; }
      const cached = db.prepare('SELECT * FROM peers WHERE id=? AND hash=?').get(id, hash);
      claims = cached && JSON.parse(cached.claims);
      if (!claims) throw failure('device_requires_online_pairing', 401);
    }
    if (Date.parse(claims.expiresAt) <= now()) throw failure('device_lease_expired', 401);
    return claims;
  }
  function sell(input) {
    const allowed = new Set(['idempotencyKey','shiftId','items','cashTenderedCents','tipCents']);
    if (!input || Object.keys(input).some(k => !allowed.has(k))) throw failure('unsupported_sale_fields', 400);
    const key = input.idempotencyKey;
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(key)) throw failure('idempotency_required', 400);
    const hash = digest(JSON.stringify(stable(input)));
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM sales WHERE id=?').get(key);
      if (existing) {
        if (existing.request_hash !== hash) throw failure('idempotency_conflict');
        return { ...JSON.parse(existing.payload), queueNumber: existing.seq, replayed: true };
      }
      const cached = snapshot();
      if (!cached.shifts.some(s => Number(s.id) === input.shiftId)) throw failure('open_store_shift_required');
      if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw failure('invalid_items', 400);
      const items = input.items.map(line => {
        if (!line || typeof line !== 'object' || Array.isArray(line)) throw failure('invalid_line',400);
        if (Object.keys(line).some(k => !['menuItemId','quantity'].includes(k))) throw failure('unsupported_line_fields', 400);
        const item = cached.items.find(i => Number(i.id) === line.menuItemId);
        if (!item) throw failure('offline_item_unavailable');
        return { menuItemId: Number(item.id), name: item.name, quantity: integer(line.quantity,1,99),
          unitPriceCents: integer(Number(item.price_cents),0),
          taxRateBps: item.tax_rate_bps, taxExempt: item.tax_exempt, taxCategory: item.tax_category };
      });
      const subtotalCents = items.reduce((s,i) => s+i.quantity*i.unitPriceCents,0);
      integer(subtotalCents,0,maxSaleCents);
      const tipCents = integer(input.tipCents || 0,0,Math.min(subtotalCents,50000));
      const tax = computeOrderTax({ lines: items.map(i=>({...i,lineTotalCents:i.quantity*i.unitPriceCents})), policy: cached.taxPolicy });
      const totalCents = orderTotalWithTax({ taxableSubtotalCents: subtotalCents, tipCents, tax });
      integer(totalCents,1,maxSaleCents);
      const pending = db.prepare('SELECT cents FROM pending_balance WHERE id=1').get().cents;
      if (pending+totalCents > maxPendingCents) throw failure('hub_pending_limit');
      const sale = { hubSaleUuid: crypto.randomUUID(), idempotencyKey: `lan:${hubId}:${key}`,
        shiftId: input.shiftId, items, subtotalCents, taxCents: tax.totalTaxCents,
        taxIncluded: tax.snapshot.mode === 'inclusive', tipCents, discountCents: 0,
        totalCents, cashTenderedCents: integer(input.cashTenderedCents,totalCents), currencyCode: cached.currencyCode };
      normalizeOfflineSale(sale);
      const inserted = db.prepare('INSERT INTO sales(id,request_hash,payload) VALUES(?,?,?)').run(key,hash,JSON.stringify(sale));
      const queueNumber = Number(inserted.lastInsertRowid);
      const payload = { stationName: 'KITCHEN', order: { id: key, queueNumber: `LAN-${queueNumber}`, locationId },
        items: items.map(i=>({name:i.name,quantity:i.quantity})) };
      db.prepare('INSERT INTO prints(sale_id,payload) VALUES(?,?)').run(key,JSON.stringify(payload));
      return { ...sale, queueNumber, replayed: false };
    });
  }
  function transition(input) {
    const { id, action, expectedRevision, operationId } = input;
    if(typeof id!=='string'||id.length>120)throw failure('invalid_ticket',400);
    integer(expectedRevision);
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(operationId || '')) throw failure('idempotency_required',400);
    const hash = digest(JSON.stringify(stable(input)));
    return transaction(() => {
      const old = db.prepare('SELECT * FROM actions WHERE key=?').get(operationId);
      if (old) { if(old.request_hash!==hash) throw failure('idempotency_conflict'); return JSON.parse(old.result); }
      const row = db.prepare('SELECT * FROM sales WHERE id=?').get(id);
      if (!row) throw failure('ticket_not_found',404);
      if (row.revision !== expectedRevision) throw failure('ticket_revision_conflict');
      const next = { received: ['start','preparing'], preparing: ['ready','ready'], ready: ['pickup','completed'] }[row.state];
      if (!next || action !== next[0]) throw failure('illegal_ticket_transition');
      db.prepare('UPDATE sales SET state=?,revision=revision+1 WHERE id=?').run(next[1],id);
      const result = { id, state: next[1], revision: row.revision+1 };
      db.prepare('INSERT INTO actions VALUES(?,?,?)').run(operationId,hash,JSON.stringify(result));
      return result;
    });
  }
  async function sync() {
    if (syncing) return { skipped: true };
    syncing = true;
    try {
      setSnapshot(await cloud('GET','bootstrap'));
      let uploaded = 0;
      const rows = db.prepare("SELECT * FROM sales WHERE uploaded=0 AND state='completed' ORDER BY seq LIMIT 100").all();
      if (rows.length) {
        const sales = rows.map(row => JSON.parse(row.payload));
        const result = await cloud('POST','offline-sales',{sales});
        const acknowledged = new Set((result.queued || []).map(s => s.idempotencyKey));
        if (sales.some(s => !acknowledged.has(s.idempotencyKey))) throw failure('hub_ack_invalid');
        transaction(() => {
          for (const row of rows) db.prepare('UPDATE sales SET uploaded=1 WHERE id=?').run(row.id);
        });
        uploaded = rows.length;
      }
      return { uploaded };
    } catch (error) { if ([401,403].includes(error.status)) invalidate(); throw error; }
    finally { syncing = false; }
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.set('Cache-Control','no-store');
    if ((req.headers.origin && req.headers.origin !== origin) || req.headers.host !== new URL(origin).host)
      return res.status(403).json({code:'hub_origin_forbidden'});
    next();
  });
  app.use(express.json({limit:'64kb',strict:true}));
  const page=require('./storeHubPage');
  app.get('/',(_req,res)=>res.set('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'").type('html').send(page.page));
  app.get('/hub.js',(_req,res)=>res.type('js').send(page.script));
  app.get('/hub.css',(_req,res)=>res.type('css').send(page.css));
  app.get('/health',(_req,res)=>res.json({ready:true,restaurantId,locationId,hubId}));
  app.use('/v1',async(req,res,next)=>{
    try { req.peer=await authorize(Number(req.get('X-Device-Id')),req.get('Authorization')?.replace(/^Bearer /,'')); next(); }
    catch(error){next(error);}
  });
  app.get('/v1/snapshot',(req,res,next)=>{try{const value=snapshot();res.json(req.peer.role==='display'?
    {currencyCode:value.currencyCode,peerRole:'display'}:{...value,shifts:req.peer.role==='pos'?value.shifts.filter(s=>req.peer.shiftIds.includes(Number(s.id))):[],peerRole:req.peer.role});}catch(e){next(e);}});
  app.get('/v1/orders',(req,res)=>{
    if(req.peer.role==='printer')return res.status(403).json({code:'role_forbidden'});
    const rows=db.prepare("SELECT seq,id,payload,state,revision,uploaded FROM sales WHERE state<>'completed' ORDER BY seq LIMIT 200").all();
    res.json({orders: rows.map(r=>({queueNumber:r.seq,id:r.id,state:r.state,revision:r.revision,
      ...(req.peer.role==='display'?{}:{sale:JSON.parse(r.payload)})}))});
  });
  app.post('/v1/orders',(req,res,next)=>{try{
    if(req.peer.role!=='pos')throw failure('pos_device_required',403);
    if(!req.peer.shiftIds?.includes(req.body.shiftId))throw failure('hub_drawer_forbidden',403);
    const result=sell(req.body); res.status(result.replayed?200:201).json(result);
  }catch(e){next(e);}});
  app.post('/v1/actions',(req,res,next)=>{try{
    if(!['pos','kitchen'].includes(req.peer.role)|| (req.body.action==='pickup'&&req.peer.role!=='pos'))throw failure('role_forbidden',403);
    res.json(transition(req.body));
  }catch(e){next(e);}});
  app.post('/v1/prints/claim',(req,res,next)=>{try{
    if(req.peer.role!=='printer')throw failure('printer_device_required',403);
    const result=transaction(()=>{
      const row=db.prepare("SELECT * FROM prints WHERE state='queued' ORDER BY id LIMIT 1").get();
      if(!row)return null;
      const claim=crypto.randomUUID();
      // Claimed jobs are never automatically recycled: power loss after TCP
      // delivery is uncertain and must not silently print a second ticket.
      db.prepare("UPDATE prints SET state='claimed',claim=?,device_id=? WHERE id=?").run(claim,req.peer.deviceId,row.id);
      return {id:row.id,claim,payload:JSON.parse(row.payload)};
    }); res.json({job:result});
  }catch(e){next(e);}});
  app.post('/v1/prints/:id/ack',(req,res,next)=>{try{
    if(req.peer.role!=='printer')throw failure('printer_device_required',403);
    const result=db.prepare("UPDATE prints SET state='printed' WHERE id=? AND claim=? AND device_id=? AND state IN ('claimed','printed')")
      .run(Number(req.params.id),req.body.claim,req.peer.deviceId);
    if(!result.changes)throw failure('print_claim_conflict'); res.json({printed:true});
  }catch(e){next(e);}});
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code||'hub_error'}));
  return {app,sync,setSnapshot,close:()=>db.close()};
}
module.exports = { createHub };
