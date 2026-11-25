'use strict';
// Group 7 items 314 (duplicates), 316-320 (approvals, quotes, vendors, work
// orders), 321-325 (entry), 341-345 (incidents).
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, isoDate, notify, ownerOf } = require('../businessOwner/common');
const { cents, day, oneOf, property, propertyAccess, requestAccess, propertyPeople } = require('./access');

const OPEN = `status NOT IN ('completed','cancelled','rejected')`;
const TRADES = ['general', 'plumbing', 'electrical', 'hvac', 'appliance', 'roofing', 'pest', 'cleaning', 'landscaping', 'locksmith', 'painting', 'other'];
const reqUrl = (b, r) => `/business/${b}/hub?tab=properties&request=${r}`;
const event = (db, requestId, actor, type, note, metadata) => db.query('INSERT INTO property_maintenance_request_events(request_id, actor_id, event_type, note, metadata) VALUES($1,$2,$3,$4,$5)', [requestId, actor, type, note || null, metadata || {}]);

// 314 duplicate candidates: same property (or unit label) + category, open, within 30 days
async function duplicates(businessId, requestId, user, role) {
  const { request: r } = await requestAccess(pool, businessId, requestId, user, role);
  const { rows } = await pool.query(`SELECT id, title, status, urgency, issue_category, unit_label, created_at FROM property_maintenance_requests
    WHERE business_id=$1 AND id<>$2 AND ${OPEN} AND duplicate_of_id IS NULL AND created_at > $3::timestamptz - INTERVAL '30 days'
      AND (($4::uuid IS NOT NULL AND property_id=$4) OR (COALESCE(property_label,'')=COALESCE($5,'') AND COALESCE(unit_label,'')=COALESCE($6,'')))
      AND ($7::text IS NULL OR issue_category IS NULL OR issue_category=$7)
    ORDER BY (COALESCE(unit_label,'')=COALESCE($6,'')) DESC, created_at DESC LIMIT 20`, [businessId, r.id, r.created_at, r.property_id, r.property_label, r.unit_label, r.issue_category]);
  return { request_id: r.id, duplicate_of_id: r.duplicate_of_id, candidates: rows };
}
async function linkDuplicate(businessId, requestId, user, role, body) {
  return withTransaction(pool, async db => {
    const { request: r } = await requestAccess(db, businessId, requestId, user, role, { lock: true });
    if (body?.duplicate_of_id == null) {
      await db.query('UPDATE property_maintenance_requests SET duplicate_of_id=NULL, updated_at=NOW() WHERE id=$1', [r.id]);
      await event(db, r.id, user, 'duplicate_unlinked');
      return { id: r.id, duplicate_of_id: null };
    }
    const target = uuid(body.duplicate_of_id, 'duplicate_of_id');
    if (target === r.id) invalid('duplicate_of_id');
    const { rows: [t] } = await db.query('SELECT id, duplicate_of_id FROM property_maintenance_requests WHERE id=$1 AND business_id=$2', [target, businessId]);
    if (!t) fail(404, 'not_found');
    const primary = t.duplicate_of_id || t.id; // keep one level: link to the primary
    if (primary === r.id) fail(409, 'duplicate_cycle');
    await db.query('UPDATE property_maintenance_requests SET duplicate_of_id=$2, updated_at=NOW() WHERE id=$1', [r.id, primary]);
    await db.query('UPDATE property_maintenance_requests SET duplicate_of_id=$2 WHERE duplicate_of_id=$1', [r.id, primary]);
    await event(db, r.id, user, 'duplicate_linked', null, { primary });
    return { id: r.id, duplicate_of_id: primary };
  });
}
// 316-317 spending approvals. Threshold null = no owner approval required.
async function requestApproval(businessId, requestId, user, role, body) {
  const amount = cents(body?.amount_cents, 'amount_cents', { required: true });
  const note = text(body?.note, 1000, { required: false });
  const out = await withTransaction(pool, async db => {
    const { request: r } = await requestAccess(db, businessId, requestId, user, role, { lock: true, adminOnly: true });
    if (!r.property_id) fail(409, 'request_needs_property');
    if (r.approval_status === 'pending') fail(409, 'approval_pending');
    const p = await property(db, businessId, r.property_id);
    const needs = p.approval_threshold_cents != null && amount > p.approval_threshold_cents;
    const status = needs ? 'pending' : 'approved';
    await db.query(`UPDATE property_maintenance_requests SET approval_status=$2::varchar, approval_amount_cents=$3, approval_requested_at=NOW(), approval_note=$4,
      approval_decided_by=CASE WHEN $2::varchar='approved' THEN $5::uuid END, approval_decided_at=CASE WHEN $2::varchar='approved' THEN NOW() END, updated_at=NOW() WHERE id=$1`, [r.id, status, amount, note, user]);
    await event(db, r.id, user, needs ? 'approval_requested' : 'approval_within_threshold', note, { amount_cents: amount, threshold_cents: p.approval_threshold_cents });
    const approver = p.owner_user_id || (await ownerOf(db, businessId)).user_id;
    return { id: r.id, approval_status: status, threshold_cents: p.approval_threshold_cents, approver: needs ? approver : null, label: p.label, title: r.title };
  });
  if (out.approver) await notify(out.approver, 'property_approval_requested', { property: out.label, title: out.title }, `property_approval_requested:${out.id}:${Date.now()}`, '/property-approvals');
  return { id: out.id, approval_status: out.approval_status, threshold_cents: out.threshold_cents };
}
const APPROVER_SQL = `(p.owner_user_id=$1 OR (p.owner_user_id IS NULL AND b.user_id=$1))`;
async function approvalInbox(user) {
  const { rows } = await pool.query(`SELECT r.id, r.title, r.description, r.urgency, r.unit_label, r.approval_amount_cents, r.approval_note, r.approval_requested_at, p.label AS property, b.business_name,
      (SELECT json_agg(json_build_object('vendor', v.name, 'amount_cents', q.amount_cents, 'status', q.status) ORDER BY q.amount_cents) FROM property_work_quotes q JOIN property_vendors v ON v.id=q.vendor_id WHERE q.request_id=r.id) AS quotes
    FROM property_maintenance_requests r JOIN properties p ON p.id=r.property_id JOIN businesses b ON b.id=r.business_id
    WHERE r.approval_status='pending' AND ${APPROVER_SQL} ORDER BY r.approval_requested_at`, [user]);
  return { approvals: rows };
}
async function decideApproval(user, requestId, body) {
  const decision = oneOf(body?.decision, ['approved', 'declined'], 'decision');
  const note = text(body?.note, 1000, { required: false });
  const out = await withTransaction(pool, async db => {
    const { rows: [r] } = await db.query(`SELECT r.id, r.business_id, r.title, e.approval_requested_by, p.label FROM property_maintenance_requests r JOIN properties p ON p.id=r.property_id JOIN businesses b ON b.id=r.business_id
      LEFT JOIN LATERAL (SELECT e.actor_id AS approval_requested_by FROM property_maintenance_request_events e WHERE e.request_id=r.id AND e.event_type='approval_requested' ORDER BY e.id DESC LIMIT 1) e ON TRUE
      WHERE r.id::text=$2 AND r.approval_status='pending' AND ${APPROVER_SQL} FOR UPDATE OF r`, [user, String(requestId)]);
    if (!r) fail(404, 'not_found');
    await db.query('UPDATE property_maintenance_requests SET approval_status=$2, approval_decided_by=$3, approval_decided_at=NOW(), updated_at=NOW() WHERE id=$1', [r.id, decision, user]);
    await event(db, r.id, user, `approval_${decision}`, note);
    return r;
  });
  if (out.approval_requested_by) await notify(out.approval_requested_by, 'property_approval_decided', { property: out.label, title: out.title, decision }, `property_approval_decided:${out.id}:${decision}`, reqUrl(out.business_id, out.id));
  return { id: out.id, approval_status: decision };
}
// 319 vendor directory
function vendorFields(b, partial) {
  const f = {};
  if (!partial || b.name !== undefined) f.name = text(b.name, 160);
  if (b.trade !== undefined || !partial) f.trade = oneOf(b.trade, TRADES, 'trade', 'general');
  for (const [k, m] of [['contact_name', 160], ['email', 255], ['phone', 40], ['license_number', 80], ['notes', 2000]]) if (b[k] !== undefined) f[k] = text(b[k], m, { required: false });
  if (b.insurance_expires_on !== undefined) f.insurance_expires_on = day(b.insurance_expires_on, 'insurance_expires_on');
  if (b.status !== undefined) f.status = oneOf(b.status, ['approved', 'pending', 'inactive'], 'status');
  return f;
}
async function vendors(businessId, { trade } = {}) {
  const { rows } = await pool.query(`SELECT v.*, (v.insurance_expires_on IS NOT NULL AND v.insurance_expires_on < CURRENT_DATE) AS insurance_expired,
      (SELECT COUNT(*)::int FROM property_work_orders o WHERE o.vendor_id=v.id) AS work_orders
    FROM property_vendors v WHERE v.business_id=$1 AND ($2::text IS NULL OR v.trade=$2) ORDER BY v.status='approved' DESC, v.name`, [businessId, trade && TRADES.includes(trade) ? trade : null]);
  return { vendors: rows, trades: TRADES };
}
async function createVendor(businessId, user, body) {
  const f = vendorFields(body || {}, false); const k = Object.keys(f);
  const { rows: [v] } = await pool.query(`INSERT INTO property_vendors(business_id, created_by, ${k.join(',')}) VALUES($1,$2,${k.map((_, i) => `$${i + 3}`).join(',')}) RETURNING *`, [businessId, user, ...k.map(x => f[x])]);
  return v;
}
async function updateVendor(businessId, vendorId, body) {
  const f = vendorFields(body || {}, true); const k = Object.keys(f);
  if (!k.length) invalid();
  const { rows: [v] } = await pool.query(`UPDATE property_vendors SET ${k.map((x, i) => `${x}=$${i + 3}`).join(',')}, updated_at=NOW() WHERE id::text=$1 AND business_id=$2 RETURNING *`, [String(vendorId), businessId, ...k.map(x => f[x])]);
  if (!v) fail(404, 'not_found');
  return v;
}
async function usableVendor(db, businessId, vendorId) {
  const { rows: [v] } = await db.query('SELECT * FROM property_vendors WHERE id::text=$1 AND business_id=$2', [String(vendorId), businessId]);
  if (!v) fail(404, 'not_found');
  if (v.status !== 'approved') fail(409, 'vendor_not_approved');
  if (v.insurance_expires_on && new Date(v.insurance_expires_on) < new Date(new Date().toISOString().slice(0, 10))) fail(409, 'vendor_insurance_expired');
  return v;
}
// 318 multi-quote comparison
async function addQuote(businessId, requestId, user, role, body) {
  const { request: r } = await requestAccess(pool, businessId, requestId, user, role, { adminOnly: true });
  const v = await usableVendor(pool, businessId, body?.vendor_id);
  const { rows: [q] } = await pool.query(`INSERT INTO property_work_quotes(business_id, request_id, vendor_id, amount_cents, scope, available_on, created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [businessId, r.id, v.id, cents(body.amount_cents, 'amount_cents', { required: true }), text(body.scope, 2000, { required: false }), day(body.available_on, 'available_on'), user]);
  return q;
}
async function quotes(businessId, requestId, user, role) {
  const { request: r } = await requestAccess(pool, businessId, requestId, user, role, { adminOnly: true });
  const { rows } = await pool.query(`SELECT q.*, v.name AS vendor, v.trade, v.insurance_expires_on FROM property_work_quotes q JOIN property_vendors v ON v.id=q.vendor_id WHERE q.request_id=$1 ORDER BY q.amount_cents, q.created_at`, [r.id]);
  const live = rows.filter(q => q.status !== 'rejected');
  const low = live.length ? live[0].amount_cents : null;
  const p = r.property_id ? await property(pool, businessId, r.property_id) : null;
  return { request_id: r.id, threshold_cents: p?.approval_threshold_cents ?? null, approval_status: r.approval_status,
    quotes: rows.map(q => ({ ...q, lowest: q.status !== 'rejected' && q.amount_cents === low, over_lowest_cents: low == null ? null : q.amount_cents - low, needs_approval: p?.approval_threshold_cents != null && q.amount_cents > p.approval_threshold_cents })) };
}
async function selectQuote(businessId, quoteId, user) {
  return withTransaction(pool, async db => {
    const { rows: [q] } = await db.query('SELECT * FROM property_work_quotes WHERE id::text=$1 AND business_id=$2 FOR UPDATE', [String(quoteId), businessId]);
    if (!q) fail(404, 'not_found');
    await db.query(`UPDATE property_work_quotes SET status=CASE WHEN id=$2 THEN 'selected' ELSE 'rejected' END WHERE request_id=$1`, [q.request_id, q.id]);
    await db.query('UPDATE property_maintenance_requests SET estimated_cost=$2::numeric/100, updated_at=NOW() WHERE id=$1', [q.request_id, q.amount_cents]);
    await event(db, q.request_id, user, 'quote_selected', null, { quote_id: q.id, amount_cents: q.amount_cents });
    return { ...q, status: 'selected' };
  });
}
// 320 work order issuance: approved vendor, approval satisfied
async function issueWorkOrder(businessId, requestId, user, role, body) {
  return withTransaction(pool, async db => {
    const { request: r } = await requestAccess(db, businessId, requestId, user, role, { lock: true, adminOnly: true });
    if (['completed', 'cancelled', 'rejected'].includes(r.status)) fail(409, 'request_closed');
    let quote = null;
    if (body?.quote_id) {
      ({ rows: [quote] } = await db.query('SELECT * FROM property_work_quotes WHERE id::text=$1 AND request_id=$2', [String(body.quote_id), r.id]));
      if (!quote) fail(404, 'not_found');
    }
    const v = await usableVendor(db, businessId, quote ? quote.vendor_id : body?.vendor_id);
    const nte = cents(body?.not_to_exceed_cents ?? quote?.amount_cents, 'not_to_exceed_cents', { required: true });
    if (r.property_id) {
      const p = await property(db, businessId, r.property_id);
      if (p.approval_threshold_cents != null && nte > p.approval_threshold_cents && !(r.approval_status === 'approved' && (r.approval_amount_cents ?? 0) >= nte)) fail(409, 'owner_approval_required');
    }
    if (r.approval_status === 'declined') fail(409, 'owner_approval_declined');
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int + 1 AS n FROM property_work_orders WHERE business_id=$1', [businessId]);
    const { rows: [wo] } = await db.query(`INSERT INTO property_work_orders(business_id, request_id, vendor_id, quote_id, number, scope, not_to_exceed_cents, issued_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`, [businessId, r.id, v.id, quote?.id || null, `WO-${String(n).padStart(5, '0')}`, text(body?.scope ?? quote?.scope ?? r.title, 4000), nte, user]);
    if (!wo) fail(409, 'work_order_open');
    await db.query(`UPDATE property_maintenance_requests SET vendor_name=$2, estimated_cost=$3::numeric/100, status=CASE WHEN status IN ('reported','accepted') THEN 'assigned' ELSE status END, status_updated_at=NOW(), updated_at=NOW() WHERE id=$1`, [r.id, v.name, nte]);
    await event(db, r.id, user, 'work_order_issued', null, { work_order: wo.number, vendor: v.name, not_to_exceed_cents: nte });
    return { ...wo, vendor: v.name, vendor_contact: { name: v.contact_name, phone: v.phone, email: v.email } };
  });
}
async function closeWorkOrder(businessId, workOrderId, user, body) {
  const status = oneOf(body?.status, ['completed', 'cancelled'], 'status');
  const { rows: [wo] } = await pool.query(`UPDATE property_work_orders SET status=$3, completed_at=CASE WHEN $3='completed' THEN NOW() END WHERE id::text=$1 AND business_id=$2 AND status='issued' RETURNING *`, [String(workOrderId), businessId, status]);
  if (!wo) fail(404, 'not_found');
  await event(pool, wo.request_id, user, `work_order_${status}`, null, { work_order: wo.number });
  return wo;
}
async function workOrders(businessId, { status } = {}) {
  const { rows } = await pool.query(`SELECT o.*, v.name AS vendor, r.title, r.unit_label, p.label AS property,
      (SELECT COALESCE(SUM(i.amount_cents),0)::int FROM property_vendor_invoices i WHERE i.work_order_id=o.id AND i.match_status<>'rejected') AS invoiced_cents
    FROM property_work_orders o JOIN property_vendors v ON v.id=o.vendor_id JOIN property_maintenance_requests r ON r.id=o.request_id LEFT JOIN properties p ON p.id=r.property_id
    WHERE o.business_id=$1 AND ($2::text IS NULL OR o.status=$2) ORDER BY o.issued_at DESC LIMIT 200`, [businessId, ['issued', 'completed', 'cancelled'].includes(status) ? status : null]);
  return { work_orders: rows };
}
// 321-325 entry consent, notification, window selection, expiring instructions
function windowsOf(list) {
  if (list == null) return null;
  if (!Array.isArray(list) || list.length > 6) invalid('offered_windows');
  return list.map(w => { const s = isoDate(w?.start, 'start'); const e = isoDate(w?.end, 'end'); if (e <= s) invalid('end'); return { start: s, end: e }; });
}
const visibleEntry = (e) => e && ({ ...e, instructions: e.instructions_expire_at && new Date(e.instructions_expire_at) <= new Date() ? null : e.instructions, instructions_expired: Boolean(e.instructions_expire_at && new Date(e.instructions_expire_at) <= new Date()) });
async function getEntry(businessId, requestId, user, role) {
  const { request: r } = await requestAccess(pool, businessId, requestId, user, role);
  const { rows: [e] } = await pool.query('SELECT * FROM property_entry_records WHERE request_id=$1', [r.id]);
  return { request_id: r.id, permission_to_enter: r.permission_to_enter, entry: visibleEntry(e) || null };
}
async function saveEntry(businessId, requestId, user, role, body) {
  const b = body || {};
  const consent = b.consent === undefined ? undefined : oneOf(b.consent, ['granted', 'denied'], 'consent');
  const method = consent ? oneOf(b.consent_method, ['portal', 'phone', 'email', 'in_person', 'written'], 'consent_method') : null;
  const windows = windowsOf(b.offered_windows);
  const expires = b.instructions_expire_at ? isoDate(b.instructions_expire_at, 'instructions_expire_at') : null;
  return withTransaction(pool, async db => {
    const { request: r } = await requestAccess(db, businessId, requestId, user, role, { lock: true });
    const { rows: [e] } = await db.query(`INSERT INTO property_entry_records(business_id, request_id, consent, consent_method, consent_given_by, consent_recorded_by, consent_recorded_at, offered_windows, instructions, instructions_expire_at)
      VALUES($1,$2,$3::varchar,$4,$5,CASE WHEN $3::varchar IS NOT NULL THEN $6::uuid END,CASE WHEN $3::varchar IS NOT NULL THEN NOW() END,COALESCE($7::jsonb,'[]'::jsonb),$8,$9)
      ON CONFLICT (request_id) DO UPDATE SET
        consent=COALESCE(EXCLUDED.consent, property_entry_records.consent), consent_method=COALESCE(EXCLUDED.consent_method, property_entry_records.consent_method),
        consent_given_by=COALESCE(EXCLUDED.consent_given_by, property_entry_records.consent_given_by),
        consent_recorded_by=COALESCE(EXCLUDED.consent_recorded_by, property_entry_records.consent_recorded_by), consent_recorded_at=COALESCE(EXCLUDED.consent_recorded_at, property_entry_records.consent_recorded_at),
        offered_windows=CASE WHEN $7::jsonb IS NULL THEN property_entry_records.offered_windows ELSE EXCLUDED.offered_windows END,
        selected_start=CASE WHEN $7::jsonb IS NULL THEN property_entry_records.selected_start END, selected_end=CASE WHEN $7::jsonb IS NULL THEN property_entry_records.selected_end END,
        instructions=COALESCE(EXCLUDED.instructions, property_entry_records.instructions), instructions_expire_at=COALESCE(EXCLUDED.instructions_expire_at, property_entry_records.instructions_expire_at), updated_at=NOW()
      RETURNING *`, [businessId, r.id, consent ?? null, method, text(b.consent_given_by, 160, { required: false }), user, windows ? JSON.stringify(windows) : null, text(b.instructions, 2000, { required: false }), expires]);
    if (consent) await db.query('UPDATE property_maintenance_requests SET permission_to_enter=$2, updated_at=NOW() WHERE id=$1', [r.id, consent === 'granted']);
    if (consent) await event(db, r.id, user, `entry_consent_${consent}`, null, { method });
    return visibleEntry(e);
  });
}
async function notifyOccupant(businessId, requestId, user, role) {
  const { request: r } = await requestAccess(pool, businessId, requestId, user, role);
  const { rows: [e] } = await pool.query('SELECT * FROM property_entry_records WHERE request_id=$1', [r.id]);
  if (!e || !e.offered_windows.length) fail(409, 'no_entry_windows');
  if (!r.requester_id) fail(409, 'occupant_has_no_account');
  await pool.query('UPDATE property_entry_records SET occupant_notified_at=NOW() WHERE id=$1', [e.id]);
  await notify(r.requester_id, 'property_entry_scheduled', { title: r.title }, `property_entry_scheduled:${e.id}:${e.updated_at.getTime?.() || Date.now()}`, `/maintenance-requests/${r.id}`);
  return { notified: true };
}
// Occupant (requester) side
async function occupantEntry(user, requestId) {
  const { rows: [r] } = await pool.query('SELECT id, title, business_id FROM property_maintenance_requests WHERE id::text=$1 AND requester_id=$2', [String(requestId), user]);
  if (!r) fail(404, 'not_found');
  const { rows: [e] } = await pool.query('SELECT offered_windows, selected_start, selected_end, consent, occupant_notified_at FROM property_entry_records WHERE request_id=$1', [r.id]);
  return { request_id: r.id, title: r.title, entry: e || null };
}
async function selectWindow(user, requestId, body) {
  const start = isoDate(body?.start, 'start');
  const out = await withTransaction(pool, async db => {
    const { rows: [r] } = await db.query('SELECT id, title, business_id, property_id FROM property_maintenance_requests WHERE id::text=$1 AND requester_id=$2', [String(requestId), user]);
    if (!r) fail(404, 'not_found');
    const { rows: [e] } = await db.query('SELECT * FROM property_entry_records WHERE request_id=$1 FOR UPDATE', [r.id]);
    const w = e?.offered_windows.find(x => new Date(x.start).getTime() === new Date(start).getTime());
    if (!w) fail(409, 'window_not_offered');
    await db.query(`UPDATE property_entry_records SET selected_start=$2, selected_end=$3, selected_by=$4, consent=COALESCE(consent,'granted'), consent_method=COALESCE(consent_method,'portal'),
      consent_recorded_at=COALESCE(consent_recorded_at,NOW()), updated_at=NOW() WHERE id=$1`, [e.id, w.start, w.end, user]);
    await db.query(`UPDATE property_maintenance_requests SET scheduled_start_at=$2, scheduled_end_at=$3, permission_to_enter=TRUE, updated_at=NOW() WHERE id=$1`, [r.id, w.start, w.end]);
    await event(db, r.id, user, 'entry_window_selected', null, w);
    return { r, w };
  });
  const people = out.r.property_id ? await propertyPeople(pool, out.r.property_id, ['manager', 'coverage']) : [];
  const targets = people.length ? people : [(await ownerOf(pool, out.r.business_id)).user_id];
  for (const t of targets) await notify(t, 'property_entry_window_selected', { title: out.r.title }, `property_entry_window_selected:${out.r.id}:${out.w.start}`, reqUrl(out.r.business_id, out.r.id));
  return { selected: out.w };
}
// 324 key handover tracking
async function keys(businessId, propertyId, user, role) {
  const { property: p } = await propertyAccess(pool, businessId, propertyId, user, role);
  const { rows } = await pool.query(`SELECT k.*, u.unit_label, (k.status='out' AND k.due_back_at < NOW()) AS overdue,
      (SELECT json_agg(json_build_object('action', e.action, 'holder_name', e.holder_name, 'at', e.created_at) ORDER BY e.id DESC) FROM (SELECT * FROM property_key_events WHERE key_id=k.id ORDER BY id DESC LIMIT 10) e) AS events
    FROM property_keys k LEFT JOIN property_portfolio_units u ON u.id=k.unit_id WHERE k.property_id=$1 ORDER BY k.label`, [p.id]);
  return { keys: rows };
}
async function addKey(businessId, propertyId, body) {
  const p = await property(pool, businessId, propertyId);
  const unit = body?.unit_id ? uuid(body.unit_id, 'unit_id') : null;
  if (unit) { const { rows } = await pool.query('SELECT 1 FROM property_portfolio_units WHERE id=$1 AND property_id=$2', [unit, p.id]); if (!rows.length) fail(404, 'not_found'); }
  const { rows: [k] } = await pool.query('INSERT INTO property_keys(business_id, property_id, unit_id, label) VALUES($1,$2,$3,$4) RETURNING *', [businessId, p.id, unit, text(body?.label, 80)]);
  return k;
}
async function keyAction(businessId, keyId, user, role, action, body) {
  return withTransaction(pool, async db => {
    const { rows: [k] } = await db.query('SELECT * FROM property_keys WHERE id::text=$1 AND business_id=$2 FOR UPDATE', [String(keyId), businessId]);
    if (!k) fail(404, 'not_found');
    await propertyAccess(db, businessId, k.property_id, user, role);
    let holderUser = null; let holderName = null;
    if (action === 'check_out') {
      if (k.status !== 'in') fail(409, 'key_not_available');
      if (body?.holder_user_id) {
        holderUser = uuid(body.holder_user_id, 'holder_user_id');
        const { rows: [u] } = await db.query(`SELECT NULLIF(TRIM(CONCAT(first_name,' ',last_name)),'') AS n FROM users WHERE id=$1`, [holderUser]);
        if (!u) invalid('holder_user_id');
        holderName = u.n || '?';
      } else holderName = text(body?.holder_name, 160);
      const due = body?.due_back_at ? isoDate(body.due_back_at, 'due_back_at') : null;
      await db.query(`UPDATE property_keys SET status='out', holder_user_id=$2, holder_name=$3, checked_out_at=NOW(), due_back_at=$4 WHERE id=$1`, [k.id, holderUser, holderName, due]);
    } else if (action === 'return') {
      if (k.status === 'in') fail(409, 'key_not_out');
      holderName = k.holder_name;
      await db.query(`UPDATE property_keys SET status='in', holder_user_id=NULL, holder_name=NULL, checked_out_at=NULL, due_back_at=NULL WHERE id=$1`, [k.id]);
    } else {
      holderName = k.holder_name;
      await db.query(`UPDATE property_keys SET status='lost' WHERE id=$1`, [k.id]);
    }
    const reqId = body?.request_id ? uuid(body.request_id, 'request_id') : null;
    await db.query('INSERT INTO property_key_events(key_id, action, holder_name, request_id, actor_id) VALUES($1,$2,$3,$4,$5)', [k.id, action, holderName, reqId, user]);
    const { rows: [out] } = await db.query('SELECT * FROM property_keys WHERE id=$1', [k.id]);
    return out;
  });
}
// 341 emergency routing
async function routeEmergency(businessId, requestId, user, role) {
  const { request: r } = await requestAccess(pool, businessId, requestId, user, role);
  if (r.urgency !== 'emergency') fail(409, 'not_an_emergency');
  const owner = (await ownerOf(pool, businessId)).user_id;
  const people = r.property_id ? await propertyPeople(pool, r.property_id) : [];
  const targets = [...new Set([...people, owner].map(String))].filter(id => id !== String(user));
  const { rows: [s] } = await pool.query('SELECT emergency_phone, emergency_instructions FROM property_operation_settings WHERE business_id=$1', [businessId]).catch(() => ({ rows: [] }));
  for (const t of targets) await notify(t, 'property_emergency', { title: r.title }, `property_emergency:${r.id}`, reqUrl(businessId, r.id));
  await event(pool, r.id, user, 'emergency_routed', null, { notified: targets.length });
  const { rows: contacts } = await pool.query(`SELECT a.role, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS name, u.phone FROM property_staff_assignments a JOIN users u ON u.id=a.user_id
    WHERE a.property_id=$1 AND a.user_id = ANY($2::uuid[])`, [r.property_id, people]).catch(() => ({ rows: [] }));
  return { notified: targets.length, contacts, emergency_phone: s?.emergency_phone || null, emergency_instructions: s?.emergency_instructions || null };
}
// 342-345 incidents
async function incidents(businessId, propertyId, user, role) {
  const { property: p } = await propertyAccess(pool, businessId, propertyId, user, role);
  const { rows } = await pool.query(`SELECT i.*, u.unit_label, (i.follow_up_on IS NOT NULL AND i.follow_up_done_at IS NULL AND i.follow_up_on < CURRENT_DATE) AS follow_up_overdue
    FROM property_incidents i LEFT JOIN property_portfolio_units u ON u.id=i.unit_id WHERE i.property_id=$1 ORDER BY i.status, i.created_at DESC`, [p.id]);
  return { incidents: rows };
}
async function createIncident(businessId, propertyId, user, role, body) {
  const { property: p } = await propertyAccess(pool, businessId, propertyId, user, role);
  const unit = body?.unit_id ? uuid(body.unit_id, 'unit_id') : null;
  const reqId = body?.request_id ? uuid(body.request_id, 'request_id') : null;
  if (reqId) { const { rows } = await pool.query('SELECT 1 FROM property_maintenance_requests WHERE id=$1 AND business_id=$2', [reqId, businessId]); if (!rows.length) fail(404, 'not_found'); }
  const severity = oneOf(body?.severity, ['minor', 'major', 'critical'], 'severity', 'major');
  const { rows: [i] } = await pool.query(`INSERT INTO property_incidents(business_id, property_id, unit_id, request_id, title, severity, relocation_note, relocation_until, follow_up_on, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [businessId, p.id, unit, reqId, text(body?.title, 160), severity, text(body?.relocation_note, 2000, { required: false }), day(body?.relocation_until, 'relocation_until'), day(body?.follow_up_on, 'follow_up_on'), user]);
  if (severity === 'critical') {
    const owner = (await ownerOf(pool, businessId)).user_id;
    for (const t of [...new Set([...(await propertyPeople(pool, p.id)), owner].map(String))].filter(x => x !== String(user))) await notify(t, 'property_emergency', { title: i.title }, `property_incident:${i.id}`, `/business/${businessId}/hub?tab=properties&property=${p.id}`);
  }
  return i;
}
async function incidentFor(db, businessId, incidentId, user, role) {
  const { rows: [i] } = await db.query('SELECT * FROM property_incidents WHERE id::text=$1 AND business_id=$2', [String(incidentId), businessId]);
  if (!i) fail(404, 'not_found');
  await propertyAccess(db, businessId, i.property_id, user, role);
  return i;
}
async function updateIncident(businessId, incidentId, user, role, body) {
  const i = await incidentFor(pool, businessId, incidentId, user, role);
  const b = body || {}; const f = {};
  if (b.relocation_note !== undefined) f.relocation_note = text(b.relocation_note, 2000, { required: false });
  if (b.relocation_until !== undefined) f.relocation_until = day(b.relocation_until, 'relocation_until');
  if (b.follow_up_on !== undefined) { f.follow_up_on = day(b.follow_up_on, 'follow_up_on'); f.follow_up_done_at = null; }
  if (b.owner_summary !== undefined) f.owner_summary = text(b.owner_summary, 4000, { required: false });
  if (b.follow_up_done) f.follow_up_done_at = new Date().toISOString();
  if (b.status !== undefined) { f.status = oneOf(b.status, ['open', 'resolved'], 'status'); f.resolved_at = f.status === 'resolved' ? new Date().toISOString() : null; }
  const k = Object.keys(f); if (!k.length) invalid();
  const { rows: [out] } = await pool.query(`UPDATE property_incidents SET ${k.map((x, n) => `${x}=$${n + 2}`).join(',')} WHERE id=$1 RETURNING *`, [i.id, ...k.map(x => f[x])]);
  return out;
}
async function addEvidence(businessId, incidentId, user, role, body) {
  const i = await incidentFor(pool, businessId, incidentId, user, role);
  const link = text(body?.url, 1000);
  if (!/^https:\/\//i.test(link)) invalid('url');
  if (i.evidence.length >= 50) fail(409, 'evidence_limit');
  const item = { url: link, label: text(body?.label, 160, { required: false }), kind: oneOf(body?.kind, ['photo', 'document', 'video', 'other'], 'kind', 'photo'), added_by: user, added_at: new Date().toISOString() };
  const { rows: [out] } = await pool.query(`UPDATE property_incidents SET evidence = evidence || $2::jsonb WHERE id=$1 RETURNING *`, [i.id, JSON.stringify([item])]);
  return out;
}
async function shareWithOwner(businessId, incidentId, user, role) {
  const i = await incidentFor(pool, businessId, incidentId, user, role);
  if (!i.owner_summary) fail(409, 'owner_summary_required');
  const p = await property(pool, businessId, i.property_id);
  if (!p.owner_user_id) fail(409, 'property_owner_not_linked');
  const { rows: [out] } = await pool.query('UPDATE property_incidents SET owner_shared_at=NOW() WHERE id=$1 RETURNING *', [i.id]);
  await notify(p.owner_user_id, 'property_incident_summary', { property: p.label, title: i.title }, `property_incident_summary:${i.id}:${out.owner_shared_at.getTime?.() || Date.now()}`, '/property-approvals');
  return out;
}
async function ownerIncidents(user) {
  const { rows } = await pool.query(`SELECT i.id, i.title, i.severity, i.status, i.owner_summary, i.owner_shared_at, i.relocation_until, i.follow_up_on, i.resolved_at, p.label AS property, b.business_name,
      jsonb_array_length(i.evidence) AS evidence_count
    FROM property_incidents i JOIN properties p ON p.id=i.property_id JOIN businesses b ON b.id=i.business_id WHERE p.owner_user_id=$1 AND i.owner_shared_at IS NOT NULL ORDER BY i.owner_shared_at DESC LIMIT 100`, [user]);
  return { incidents: rows };
}
module.exports = { TRADES, duplicates, linkDuplicate, requestApproval, approvalInbox, decideApproval, vendors, createVendor, updateVendor, addQuote, quotes, selectQuote, issueWorkOrder, closeWorkOrder, workOrders,
  getEntry, saveEntry, notifyOccupant, occupantEntry, selectWindow, keys, addKey, keyAction, routeEmergency, incidents, createIncident, updateIncident, addEvidence, shareWithOwner, ownerIncidents };
