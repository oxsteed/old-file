'use strict';
// Group 7 items 326-330 (prevention), 331-335 (turnover), 336-340 (costs).
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, notify, ownerOf } = require('../businessOwner/common');
const { cents, day, oneOf, property, propertyAccess, propertyPeople } = require('./access');

const KINDS = ['inspection', 'equipment', 'seasonal', 'vendor'];
// AppFolio-style make-ready sequence. `after` = steps that must be done first.
const STEPS = [
  { key: 'move_out_inspection', after: [] },
  { key: 'keys_returned', after: [] },
  { key: 'repairs', after: ['move_out_inspection'] },
  { key: 'cleaning', after: ['repairs'] },
  { key: 'final_walkthrough', after: ['cleaning', 'keys_returned'] },
];
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
function nextSeasonal(fromDay, months) {
  const f = new Date(`${fromDay}T00:00:00Z`);
  for (let i = 1; i <= 24; i++) { const d = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + i, 1)); if (months.includes(d.getUTCMonth() + 1)) return d.toISOString().slice(0, 10); }
  return addDays(fromDay, 365);
}
// 326-329 schedules
async function createSchedule(businessId, propertyId, user, body) {
  const p = await property(pool, businessId, propertyId);
  const b = body || {};
  const kind = oneOf(b.kind, KINDS, 'kind');
  const months = b.months == null ? null : (Array.isArray(b.months) && b.months.length && b.months.length <= 12 && b.months.every(m => Number.isInteger(m) && m >= 1 && m <= 12) ? [...new Set(b.months)] : invalid('months'));
  const interval = b.interval_days == null ? null : Number(b.interval_days);
  if (interval != null && !(Number.isInteger(interval) && interval >= 1 && interval <= 3660)) invalid('interval_days');
  if (!months && !interval) invalid('interval_days');
  if (kind === 'seasonal' && !months) invalid('months');
  const unit = b.unit_id ? uuid(b.unit_id, 'unit_id') : null;
  if (unit) { const { rows } = await pool.query('SELECT 1 FROM property_portfolio_units WHERE id=$1 AND property_id=$2', [unit, p.id]); if (!rows.length) fail(404, 'not_found'); }
  let vendor = null;
  if (b.vendor_id) { vendor = uuid(b.vendor_id, 'vendor_id'); const { rows } = await pool.query('SELECT 1 FROM property_vendors WHERE id=$1 AND business_id=$2', [vendor, businessId]); if (!rows.length) fail(404, 'not_found'); }
  if (kind === 'vendor' && !vendor) invalid('vendor_id');
  const { rows: [s] } = await pool.query(`INSERT INTO property_maintenance_schedules(business_id, property_id, unit_id, kind, title, equipment_name, vendor_id, interval_days, months, next_due_on, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [businessId, p.id, unit, kind, text(b.title, 160), text(b.equipment_name, 160, { required: false }), vendor, interval, months, day(b.next_due_on, 'next_due_on', { required: true }), user]);
  return s;
}
async function scheduleFor(db, businessId, id, user, role, lock) {
  const { rows: [s] } = await db.query(`SELECT * FROM property_maintenance_schedules WHERE id::text=$1 AND business_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [String(id), businessId]);
  if (!s) fail(404, 'not_found');
  await propertyAccess(db, businessId, s.property_id, user, role);
  return s;
}
async function completeSchedule(businessId, id, user, role, body) {
  return withTransaction(pool, async db => {
    const s = await scheduleFor(db, businessId, id, user, role, true);
    const done = day(body?.done_on, 'done_on') || today();
    const next = s.months?.length ? nextSeasonal(done, s.months) : addDays(done, s.interval_days);
    const { rows: [out] } = await db.query('UPDATE property_maintenance_schedules SET last_done_on=$2, next_due_on=$3, alerted_for=NULL WHERE id=$1 RETURNING *', [s.id, done, next]);
    return out;
  });
}
async function updateSchedule(businessId, id, user, role, body) {
  const s = await scheduleFor(pool, businessId, id, user, role);
  const f = {};
  if (body?.active !== undefined) f.active = Boolean(body.active);
  if (body?.next_due_on !== undefined) f.next_due_on = day(body.next_due_on, 'next_due_on', { required: true });
  if (body?.title !== undefined) f.title = text(body.title, 160);
  const k = Object.keys(f); if (!k.length) invalid();
  const { rows: [out] } = await pool.query(`UPDATE property_maintenance_schedules SET ${k.map((x, i) => `${x}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [s.id, ...k.map(x => f[x])]);
  return out;
}
// 329 recurring vendor booking -> a maintenance request for this occurrence
async function bookOccurrence(businessId, id, user, role) {
  return withTransaction(pool, async db => {
    const s = await scheduleFor(db, businessId, id, user, role, true);
    const p = await property(db, businessId, s.property_id);
    const { rows: [v] } = s.vendor_id ? await db.query('SELECT name FROM property_vendors WHERE id=$1', [s.vendor_id]) : { rows: [] };
    const { rows: [u] } = s.unit_id ? await db.query('SELECT unit_label FROM property_portfolio_units WHERE id=$1', [s.unit_id]) : { rows: [] };
    const { rows: dup } = await db.query(`SELECT id FROM property_maintenance_requests WHERE business_id=$1 AND template_intake->>'schedule_id'=$2 AND template_intake->>'due_on'=$3`, [businessId, s.id, String(s.next_due_on.toISOString?.().slice(0, 10) || s.next_due_on)]);
    if (dup.length) return { request_id: dup[0].id, created: false };
    const due = s.next_due_on.toISOString?.().slice(0, 10) || String(s.next_due_on);
    const { rows: [r] } = await db.query(`INSERT INTO property_maintenance_requests(business_id, owner_id, requester_id, status, urgency, issue_category, title, description, property_label, unit_label, vendor_name, intake_channel, property_id, unit_id, template_intake, scheduled_start_at)
      VALUES($1,$2,NULL,'scheduled','normal',$3,$4::text,$4::text,$5,$6,$7,'internal',$8,$9,$10,$11::date) RETURNING id`,
    [businessId, (await ownerOf(db, businessId)).user_id, s.kind === 'inspection' ? 'inspection' : 'preventive', s.title, p.label, u?.unit_label || null, v?.name || null, p.id, s.unit_id, JSON.stringify({ schedule_id: s.id, due_on: due }), due]);
    return { request_id: r.id, created: true };
  });
}
// 326 calendar across schedules, compliance records and turnovers
async function calendar(businessId, user, role, { from, to, property_id: propertyId } = {}) {
  const f = day(from, 'from') || today(); const t = day(to, 'to') || addDays(f, 90);
  const admin = ['owner', 'manager'].includes(role);
  if (propertyId) await propertyAccess(pool, businessId, propertyId, user, role);
  const scope = `($3::uuid IS NULL OR p.id=$3) AND ($4::boolean OR EXISTS (SELECT 1 FROM property_staff_assignments a WHERE a.property_id=p.id AND a.user_id=$5 AND a.status='active' AND (a.ends_at IS NULL OR a.ends_at > NOW())))`;
  const args = [f, t, propertyId || null, admin, user, businessId];
  const { rows } = await pool.query(`
    SELECT 'schedule' AS source, s.id, s.kind, s.title, s.next_due_on AS due_on, p.id AS property_id, p.label AS property, (s.next_due_on < CURRENT_DATE) AS overdue
      FROM property_maintenance_schedules s JOIN properties p ON p.id=s.property_id WHERE s.business_id=$6 AND s.active AND s.next_due_on <= $2 AND ${scope}
    UNION ALL
    SELECT 'compliance', c.id, c.record_type, c.title, c.due_date, p.id, p.label, (c.due_date < CURRENT_DATE)
      FROM property_compliance_records c JOIN property_portfolio_units u ON u.id=c.unit_id JOIN properties p ON p.id=u.property_id
      WHERE c.business_id=$6 AND c.status<>'complete' AND c.due_date IS NOT NULL AND c.due_date <= $2 AND ${scope}
    UNION ALL
    SELECT 'move_in', tv.id, 'turnover', u.unit_label, tv.move_in_on, p.id, p.label, (tv.move_in_on < CURRENT_DATE AND tv.status='open')
      FROM property_turnovers tv JOIN property_portfolio_units u ON u.id=tv.unit_id JOIN properties p ON p.id=tv.property_id
      WHERE tv.business_id=$6 AND tv.status IN ('open','ready') AND tv.move_in_on BETWEEN $1 AND $2 AND ${scope}
    ORDER BY due_on`, args);
  return { from: f, to: t, items: rows.filter(r => r.overdue || (r.due_on && new Date(r.due_on) >= new Date(`${f}T00:00:00Z`))) };
}
// 341 emergency triage: open emergency/urgent requests first, then SLA.
// Same assignment scope as slaBreaches (admins see all, other members only
// their assigned properties). `breached` is derived from sla_target_at;
// the SLA-breach escalation job (server/jobs/propertySlaBreachEscalation.js)
// is what notifies on it.
async function emergencies(businessId, user, role) {
  const admin = ['owner', 'manager'].includes(role);
  const { rows } = await pool.query(`SELECT r.id, r.title, r.status, r.urgency, r.unit_label, r.sla_target_at, r.sla_alerted_at, p.id AS property_id, p.label AS property,
      EXTRACT(EPOCH FROM (NOW() - r.sla_target_at))/3600 AS hours_overdue
    FROM property_maintenance_requests r LEFT JOIN properties p ON p.id=r.property_id
    WHERE r.business_id=$1 AND r.urgency IN ('emergency','urgent') AND r.status NOT IN ('completed','cancelled','rejected')
      AND ($2::boolean OR EXISTS (SELECT 1 FROM property_staff_assignments a WHERE a.property_id=r.property_id AND a.user_id=$3 AND a.status='active' AND (a.ends_at IS NULL OR a.ends_at > NOW())))
    ORDER BY CASE r.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, r.sla_target_at ASC NULLS LAST, r.created_at DESC`,
  [businessId, admin, user]);
  return { emergencies: rows.map(r => ({ ...r, breached: r.sla_target_at ? new Date(r.sla_target_at) < new Date() : false })) };
}
// 330 missed maintenance alerts (notify once per due date)
async function alerts(businessId, user, role, { notifyNow = false } = {}) {
  const cal = await calendar(businessId, user, role, { from: addDays(today(), -365), to: today() });
  const overdue = cal.items.filter(i => i.overdue);
  const sla_breaches = await slaBreaches(businessId, user, role);
  let notified = 0;
  if (notifyNow) {
    const { rows } = await pool.query(`UPDATE property_maintenance_schedules SET alerted_for=next_due_on WHERE business_id=$1 AND active AND next_due_on < CURRENT_DATE AND alerted_for IS DISTINCT FROM next_due_on RETURNING id, property_id, title, next_due_on`, [businessId]);
    const owner = (await ownerOf(pool, businessId)).user_id;
    for (const s of rows) {
      const people = await propertyPeople(pool, s.property_id, ['manager', 'coverage']);
      for (const t of people.length ? people : [owner]) { await notify(t, 'property_maintenance_due', { title: s.title }, `property_maintenance_due:${s.id}:${String(s.next_due_on)}`, `/business/${businessId}/workspace?tab=properties&property=${s.property_id}`); notified++; }
    }
    notified += (await sendSlaBreachAlerts(businessId)).notified;
  }
  return { overdue, sla_breaches, notified };
}
// 330 missed-maintenance SLA breaches: open requests past their SLA target.
// sla_target_at is set once at intake and never recomputed, so a request has
// one breach episode; sla_alerted_at stamps it once alerted.
async function slaBreachRows(businessId) {
  const { rows } = await pool.query(`SELECT r.id, r.title, r.status, r.urgency, r.unit_label, r.sla_target_at, r.sla_alerted_at, p.id AS property_id, p.label AS property,
      EXTRACT(EPOCH FROM (NOW() - r.sla_target_at))/3600 AS hours_overdue
    FROM property_maintenance_requests r LEFT JOIN properties p ON p.id=r.property_id
    WHERE r.business_id=$1 AND r.sla_target_at IS NOT NULL AND r.sla_target_at < NOW() AND r.status NOT IN ('completed','cancelled','rejected')
    ORDER BY r.sla_target_at`, [businessId]);
  return rows;
}
// Endpoint read: same assignment scope as the calendar (admins see all,
// other members only their assigned properties).
async function slaBreaches(businessId, user, role) {
  const admin = ['owner', 'manager'].includes(role);
  if (admin) return slaBreachRows(businessId);
  const { rows } = await pool.query(`SELECT r.id, r.title, r.status, r.urgency, r.unit_label, r.sla_target_at, r.sla_alerted_at, p.id AS property_id, p.label AS property,
      EXTRACT(EPOCH FROM (NOW() - r.sla_target_at))/3600 AS hours_overdue
    FROM property_maintenance_requests r LEFT JOIN properties p ON p.id=r.property_id
    WHERE r.business_id=$1 AND r.sla_target_at IS NOT NULL AND r.sla_target_at < NOW() AND r.status NOT IN ('completed','cancelled','rejected')
      AND EXISTS (SELECT 1 FROM property_staff_assignments a WHERE a.property_id=r.property_id AND a.user_id=$2 AND a.status='active' AND (a.ends_at IS NULL OR a.ends_at > NOW()))
    ORDER BY r.sla_target_at`, [businessId, user]);
  return rows;
}
// 330 alert leg, shared with Batch J's breach escalation job (341): notify
// once per breach and stamp the row. Job context (no caller user/role), so
// it alerts every un-alerted breach in the business; the delivery key also
// dedupes on (request, sla_target_at) if two runs race.
async function sendSlaBreachAlerts(businessId) {
  const breaches = (await slaBreachRows(businessId)).filter(b => !b.sla_alerted_at);
  const owner = (await ownerOf(pool, businessId)).user_id;
  let notified = 0;
  for (const b of breaches) {
    const people = b.property_id ? await propertyPeople(pool, b.property_id, ['manager', 'coverage']) : [];
    for (const t of people.length ? people : [owner]) {
      await notify(t, 'property_sla_breach', { title: b.title }, `property_sla_breach:${b.id}:${new Date(b.sla_target_at).getTime()}`, `/business/${businessId}/workspace?tab=properties&request=${b.id}`);
      notified++;
    }
    await pool.query('UPDATE property_maintenance_requests SET sla_alerted_at=NOW() WHERE id=$1', [b.id]);
  }
  return { breaches: breaches.length, notified };
}
// 331-335 turnover
const stepState = steps => Object.fromEntries(steps.map(s => [s.key, s]));
async function startTurnover(businessId, propertyId, user, body) {
  const p = await property(pool, businessId, propertyId);
  const unit = uuid(body?.unit_id, 'unit_id');
  const { rows: [u] } = await pool.query('SELECT id FROM property_portfolio_units WHERE id=$1 AND property_id=$2', [unit, p.id]);
  if (!u) fail(404, 'not_found');
  const moveOut = day(body?.move_out_on, 'move_out_on'); const moveIn = day(body?.move_in_on, 'move_in_on');
  if (moveOut && moveIn && moveIn < moveOut) invalid('move_in_on');
  const steps = STEPS.map(s => ({ key: s.key, status: 'pending', request_ids: [] }));
  return withTransaction(pool, async db => {
    const { rows: [tv] } = await db.query(`INSERT INTO property_turnovers(business_id, property_id, unit_id, move_out_on, move_in_on, steps, created_by) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING RETURNING *`, [businessId, p.id, unit, moveOut, moveIn, JSON.stringify(steps), user]);
    if (!tv) fail(409, 'turnover_open');
    await db.query(`UPDATE property_portfolio_units SET occupancy_status='turnover', updated_at=NOW() WHERE id=$1`, [unit]);
    return tv;
  });
}
async function turnoverFor(db, businessId, id, user, role) {
  const { rows: [tv] } = await db.query('SELECT * FROM property_turnovers WHERE id::text=$1 AND business_id=$2 FOR UPDATE', [String(id), businessId]);
  if (!tv) fail(404, 'not_found');
  await propertyAccess(db, businessId, tv.property_id, user, role);
  return tv;
}
async function updateStep(businessId, id, stepKey, user, role, body) {
  const def = STEPS.find(s => s.key === stepKey); if (!def) fail(404, 'not_found');
  const status = oneOf(body?.status, ['pending', 'done', 'blocked'], 'status');
  return withTransaction(pool, async db => {
    const tv = await turnoverFor(db, businessId, id, user, role);
    if (!['open', 'ready'].includes(tv.status)) fail(409, 'turnover_closed');
    const state = stepState(tv.steps);
    const step = { ...(state[stepKey] || { key: stepKey, request_ids: [] }) };
    if (Array.isArray(body?.request_ids)) {
      const ids = body.request_ids.map(x => uuid(x, 'request_ids'));
      if (ids.length) { const { rows } = await db.query('SELECT id FROM property_maintenance_requests WHERE id = ANY($1::uuid[]) AND business_id=$2', [ids, businessId]); if (rows.length !== new Set(ids).size) fail(404, 'not_found'); }
      step.request_ids = [...new Set(ids)];
    }
    if (status === 'done') {
      const blockedBy = def.after.filter(k => state[k]?.status !== 'done');
      if (blockedBy.length) fail(409, 'turnover_step_out_of_order', `Finish ${blockedBy.join(', ')} first`);
      if (stepKey === 'keys_returned') { // 334 every unit key back in
        const { rows: [k] } = await db.query(`SELECT COUNT(*)::int n FROM property_keys WHERE unit_id=$1 AND status='out'`, [tv.unit_id]);
        if (k.n) fail(409, 'keys_outstanding');
      }
      if (stepKey === 'repairs' && step.request_ids.length) { // 333 linked repairs finished
        const { rows: [o] } = await db.query(`SELECT COUNT(*)::int n FROM property_maintenance_requests WHERE id = ANY($1::uuid[]) AND status NOT IN ('completed','rejected','cancelled')`, [step.request_ids]);
        if (o.n) fail(409, 'repairs_open');
      }
      step.done_at = new Date().toISOString(); step.done_by = user;
    } else { step.done_at = null; step.done_by = null; }
    step.status = status;
    if (body?.note !== undefined) step.note = text(body.note, 1000, { required: false });
    state[stepKey] = step;
    const steps = STEPS.map(s => state[s.key] || { key: s.key, status: 'pending', request_ids: [] });
    const ready = steps.every(s => s.status === 'done');
    const { rows: [out] } = await db.query(`UPDATE property_turnovers SET steps=$2, status=$3, updated_at=NOW() WHERE id=$1 RETURNING *`, [tv.id, JSON.stringify(steps), ready ? 'ready' : 'open']);
    return out;
  });
}
async function closeTurnover(businessId, id, user, role, body) {
  const status = oneOf(body?.status, ['completed', 'cancelled'], 'status');
  return withTransaction(pool, async db => {
    const tv = await turnoverFor(db, businessId, id, user, role);
    if (status === 'completed' && tv.status !== 'ready') fail(409, 'turnover_not_ready');
    if (!['open', 'ready'].includes(tv.status)) fail(409, 'turnover_closed');
    await db.query(`UPDATE property_portfolio_units SET occupancy_status=$2, updated_at=NOW() WHERE id=$1`, [tv.unit_id, status === 'completed' ? 'occupied' : 'vacant']);
    const { rows: [out] } = await db.query('UPDATE property_turnovers SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING *', [tv.id, status]);
    return out;
  });
}
// 335 move-in readiness board
async function turnoverBoard(businessId, user, role) {
  const admin = ['owner', 'manager'].includes(role);
  const { rows } = await pool.query(`SELECT tv.*, u.unit_label, p.label AS property,
      (SELECT COUNT(*)::int FROM property_keys k WHERE k.unit_id=tv.unit_id AND k.status='out') AS keys_out
    FROM property_turnovers tv JOIN property_portfolio_units u ON u.id=tv.unit_id JOIN properties p ON p.id=tv.property_id
    WHERE tv.business_id=$1 AND tv.status IN ('open','ready')
      AND ($2::boolean OR EXISTS (SELECT 1 FROM property_staff_assignments a WHERE a.property_id=p.id AND a.user_id=$3 AND a.status='active' AND (a.ends_at IS NULL OR a.ends_at > NOW())))
    ORDER BY tv.move_in_on NULLS LAST, tv.created_at`, [businessId, admin, user]);
  return { turnovers: rows.map(r => {
    const done = r.steps.filter(s => s.status === 'done').length;
    const daysLeft = r.move_in_on ? Math.round((new Date(r.move_in_on) - new Date(`${today()}T00:00:00Z`)) / 864e5) : null;
    return { ...r, done_steps: done, total_steps: STEPS.length, days_to_move_in: daysLeft, at_risk: r.status !== 'ready' && daysLeft != null && daysLeft <= 2, blocked: r.steps.some(s => s.status === 'blocked') };
  }), steps: STEPS.map(s => s.key) };
}
// 336-340 costs. Spend = matched/approved invoices + completed request actual_cost with no invoiced work order.
const SPEND = `(
  SELECT i.property_id, i.unit_id, i.amount_cents, i.invoice_date AS on_date FROM property_vendor_invoices i WHERE i.business_id=$1 AND i.match_status IN ('matched','approved')
  UNION ALL
  SELECT r.property_id, r.unit_id, ROUND(r.actual_cost*100)::int, COALESCE(r.status_updated_at, r.updated_at)::date FROM property_maintenance_requests r
   WHERE r.business_id=$1 AND r.actual_cost IS NOT NULL AND NOT EXISTS (SELECT 1 FROM property_work_orders o JOIN property_vendor_invoices i ON i.work_order_id=o.id WHERE o.request_id=r.id AND i.match_status IN ('matched','approved'))
) sp`;
function monthOf(m) { if (m == null) return today().slice(0, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) invalid('month'); return m; }
async function costs(businessId, { month } = {}) {
  const m = monthOf(month);
  const { rows } = await pool.query(`SELECT p.id, p.label, p.monthly_budget_cents, p.reserve_target_cents, p.reserve_balance_cents,
      COALESCE(SUM(sp.amount_cents) FILTER (WHERE to_char(sp.on_date,'YYYY-MM')=$2),0)::int AS month_spend_cents,
      COALESCE(SUM(sp.amount_cents) FILTER (WHERE sp.on_date >= date_trunc('year', to_date($2,'YYYY-MM'))),0)::int AS ytd_spend_cents
    FROM properties p LEFT JOIN ${SPEND} ON sp.property_id=p.id WHERE p.business_id=$1 AND p.status='active' GROUP BY p.id ORDER BY p.label`, [businessId, m]);
  const out = rows.map(r => ({ ...r, variance_cents: r.monthly_budget_cents == null ? null : r.monthly_budget_cents - r.month_spend_cents,
    over_budget: r.monthly_budget_cents != null && r.month_spend_cents > r.monthly_budget_cents,
    reserve_funded_pct: r.reserve_target_cents ? Math.round(100 * (r.reserve_balance_cents || 0) / r.reserve_target_cents) : null,
    reserve_short_cents: r.reserve_target_cents ? Math.max(0, r.reserve_target_cents - (r.reserve_balance_cents || 0)) : null }));
  return { month: m, properties: out, total_spend_cents: out.reduce((t, r) => t + r.month_spend_cents, 0), over_budget: out.filter(r => r.over_budget).length };
}
async function unitSpend(businessId, propertyId, user, role, { months = 12 } = {}) {
  const { property: p } = await propertyAccess(pool, businessId, propertyId, user, role);
  const n = Math.min(Math.max(Number(months) || 12, 1), 36);
  const { rows } = await pool.query(`SELECT u.id, u.unit_label, COALESCE(SUM(sp.amount_cents),0)::int AS spend_cents, COUNT(sp.*)::int AS items
    FROM property_portfolio_units u LEFT JOIN ${SPEND} ON sp.unit_id=u.id AND sp.on_date >= CURRENT_DATE - ($3 || ' months')::interval
    WHERE u.property_id=$2 GROUP BY u.id ORDER BY spend_cents DESC, u.unit_label`, [businessId, p.id, String(n)]);
  const { rows: [common] } = await pool.query(`SELECT COALESCE(SUM(sp.amount_cents),0)::int AS c FROM ${SPEND} WHERE sp.property_id=$2 AND sp.unit_id IS NULL AND sp.on_date >= CURRENT_DATE - ($3 || ' months')::interval`, [businessId, p.id, String(n)]);
  return { months: n, units: rows, building_wide_cents: common.c };
}
// 338 budget variance alert -> notify property managers (once per property per month)
async function budgetAlerts(businessId, { month } = {}) {
  const c = await costs(businessId, { month });
  const owner = (await ownerOf(pool, businessId)).user_id;
  let notified = 0;
  for (const p of c.properties.filter(x => x.over_budget)) {
    const people = await propertyPeople(pool, p.id, ['manager']);
    for (const t of [...new Set([...people, owner].map(String))]) { await notify(t, 'property_budget_over', { property: p.label }, `property_budget_over:${p.id}:${c.month}:${t}`, `/business/${businessId}/workspace?tab=properties`); notified++; }
  }
  return { over_budget: c.over_budget, notified };
}
// 339 vendor invoice matching (3-way-lite: invoice vs work order NTE)
async function addInvoice(businessId, user, body) {
  const b = body || {};
  const vendor = uuid(b.vendor_id, 'vendor_id');
  const { rows: [v] } = await pool.query('SELECT id FROM property_vendors WHERE id=$1 AND business_id=$2', [vendor, businessId]);
  if (!v) fail(404, 'not_found');
  const amount = cents(b.amount_cents, 'amount_cents', { required: true });
  let wo = null; let status = 'unmatched'; let note = null; let propertyId = null; let unitId = null;
  if (b.work_order_id) {
    ({ rows: [wo] } = await pool.query(`SELECT o.*, r.property_id, r.unit_id, (SELECT COALESCE(SUM(i.amount_cents),0)::int FROM property_vendor_invoices i WHERE i.work_order_id=o.id AND i.match_status<>'rejected') AS billed
      FROM property_work_orders o JOIN property_maintenance_requests r ON r.id=o.request_id WHERE o.id::text=$1 AND o.business_id=$2`, [String(b.work_order_id), businessId]));
    if (!wo) fail(404, 'not_found');
    if (wo.vendor_id !== vendor) fail(409, 'invoice_vendor_mismatch');
    propertyId = wo.property_id; unitId = wo.unit_id;
    status = wo.billed + amount <= wo.not_to_exceed_cents ? 'matched' : 'over';
    if (status === 'over') note = `over_nte:${wo.billed + amount - wo.not_to_exceed_cents}`;
  } else if (b.property_id) { propertyId = (await property(pool, businessId, b.property_id)).id; }
  const { rows: [inv] } = await pool.query(`INSERT INTO property_vendor_invoices(business_id, vendor_id, work_order_id, property_id, unit_id, invoice_number, amount_cents, invoice_date, match_status, match_note, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,CURRENT_DATE),$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`, [businessId, vendor, wo?.id || null, propertyId, unitId, text(b.invoice_number, 60), amount, day(b.invoice_date, 'invoice_date'), status, note, user]);
  if (!inv) fail(409, 'duplicate_invoice');
  return inv;
}
async function decideInvoice(businessId, id, user, body) {
  const decision = oneOf(body?.decision, ['approved', 'rejected'], 'decision');
  const { rows: [inv] } = await pool.query(`UPDATE property_vendor_invoices SET match_status=$3, decided_by=$4, decided_at=NOW(), match_note=COALESCE($5, match_note)
    WHERE id::text=$1 AND business_id=$2 AND match_status IN ('unmatched','matched','over') RETURNING *`, [String(id), businessId, decision, user, text(body?.note, 500, { required: false })]);
  if (!inv) fail(404, 'not_found');
  return inv;
}
async function invoices(businessId, { status } = {}) {
  const { rows } = await pool.query(`SELECT i.*, v.name AS vendor, o.number AS work_order, o.not_to_exceed_cents, p.label AS property FROM property_vendor_invoices i JOIN property_vendors v ON v.id=i.vendor_id
    LEFT JOIN property_work_orders o ON o.id=i.work_order_id LEFT JOIN properties p ON p.id=i.property_id WHERE i.business_id=$1 AND ($2::text IS NULL OR i.match_status=$2) ORDER BY i.created_at DESC LIMIT 200`,
  [businessId, ['unmatched', 'matched', 'over', 'approved', 'rejected'].includes(status) ? status : null]);
  return { invoices: rows };
}
module.exports = { STEPS, createSchedule, completeSchedule, updateSchedule, bookOccurrence, calendar, alerts, slaBreaches, sendSlaBreachAlerts, emergencies, startTurnover, updateStep, closeTurnover, turnoverBoard, costs, unitSpend, budgetAlerts, addInvoice, decideInvoice, invoices, nextSeasonal };
