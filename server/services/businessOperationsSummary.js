'use strict';

const { loadBusinessSetupReadiness, isBusinessPublished } = require('./businessSetupReadiness');
const AppError = require('../utils/appError');

function businessTimezone(value) {
  try {
    if (typeof value === 'string' && value.trim()) {
      new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format();
      return value.trim();
    }
  } catch { /* Older profiles can contain an invalid or empty zone. */ }
  return 'UTC';
}

function count(row, key) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0 || row?.[key] == null) throw new Error('Activity count unavailable');
  return value;
}

async function collectBusinessOperations({ db, businessId, userId, role, permissions, now = new Date(), log }) {
  if (!permissions?.has('business.view')) throw new AppError('Business workspace access required', 403, 'business_permission_required');
  const generatedAt = new Date(now).toISOString();
  const { rows: [business] } = await db.query(
    'SELECT timezone, business_kind, business_mode FROM businesses WHERE id = $1', [businessId]);
  if (!business) throw new AppError('Business not found', 404, 'business_not_found');
  const timezone = businessTimezone(business.timezone);
  const businessKind = business.business_kind || (business.business_mode === 'food' ? 'restaurant' : 'service');
  const serviceBusiness = businessKind !== 'restaurant';
  const financeRole = ['owner', 'manager'].includes(role);
  const calendarScope = permissions.has('calendar.view_all') ? 'all' : permissions.has('calendar.view_self') ? 'self' : null;
  const messageScope = permissions.has('messages.view_all') ? 'all' : permissions.has('messages.view_assigned') ? 'assigned' : null;
  const sections = {
    bookings: { available: serviceBusiness && !!calendarScope, scope: calendarScope, status: 'not_available' },
    messages: { available: !!messageScope, scope: messageScope, status: 'not_available' },
    invoices: { available: serviceBusiness && financeRole && permissions.has('invoices.view'), status: 'not_available' },
    setup: { available: financeRole && permissions.has('business.edit_profile'), status: 'not_available' },
  };
  const tasks = [];
  async function source(name, read) {
    if (!sections[name].available) return;
    try {
      Object.assign(sections[name], await read(), { status: 'ready' });
    } catch {
      sections[name].status = 'unavailable';
      // Do not return SQL, customer details or reassuring invented zeroes.
      log?.warn('Business activity source unavailable', { businessId, source: name });
    }
  }

  await Promise.all([
    source('bookings', async () => {
      const { rows: [row] } = await db.query(
        `WITH day AS (SELECT ($4::timestamptz AT TIME ZONE $5)::date AS date),
              bounds AS (SELECT date::timestamp AT TIME ZONE $5 AS starts,
                                (date + 1)::timestamp AT TIME ZONE $5 AS ends FROM day)
         SELECT COUNT(*) FILTER (WHERE status IN ('pending','confirmed','in_progress','completed')
                   AND start_time < bounds.ends AND end_time > bounds.starts)::int AS today_count,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
                COUNT(*) FILTER (WHERE status = 'pending' AND staff_id = $2::uuid)::int AS pending_self_count
           FROM business_appointments CROSS JOIN bounds
          WHERE business_id = $1 AND ($3::boolean OR staff_id = $2::uuid)`,
        [businessId, userId, calendarScope === 'all', generatedAt, timezone]);
      const today = count(row, 'today_count'), pending = count(row, 'pending_count');
      const actionable = permissions.has('calendar.manage_all') ? pending
        : permissions.has('calendar.manage_self') ? count(row, 'pending_self_count') : 0;
      if (actionable) tasks.push({ type: 'confirmBookings', count: actionable, panel: 'calendar' });
      return { today, pending };
    }),
    source('messages', async () => {
      const { rows: [row] } = await db.query(
        `SELECT COUNT(*)::int AS unanswered_count
           FROM business_conversations c
           JOIN LATERAL (
             SELECT m.sender_type FROM business_messages m
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.message_type <> 'system'
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1
           ) latest ON latest.sender_type = 'customer'
          WHERE c.business_id = $1 AND c.conversation_type = 'customer' AND c.status = 'active'
            AND ($3::boolean OR c.assigned_to_user_id = $2::uuid)`,
        [businessId, userId, messageScope === 'all']);
      const unanswered = count(row, 'unanswered_count');
      if (unanswered && permissions.has('messages.reply')) tasks.push({ type: 'replyToMessages', count: unanswered, panel: 'messages' });
      return { unanswered };
    }),
    source('invoices', async () => {
      const { rows: [row] } = await db.query(
        `SELECT COUNT(*)::int AS overdue_count FROM business_invoices
          WHERE business_id = $1 AND status IN ('sent','overdue','partial') AND total > COALESCE(amount_paid, 0)
            AND (status = 'overdue' OR due_date < ($2::timestamptz AT TIME ZONE $3)::date)`,
        [businessId, generatedAt, timezone]);
      const overdue = count(row, 'overdue_count');
      if (overdue) tasks.push({ type: 'followUpInvoices', count: overdue, panel: 'invoices' });
      // Counts only: never sum different accounts or currencies.
      return { overdue };
    }),
    source('setup', async () => {
      const readiness = await loadBusinessSetupReadiness(db, businessId);
      if (!readiness) throw new Error('Business readiness unavailable');
      const pending = !isBusinessPublished(readiness.business) && (!readiness.readyToPublish || role === 'owner');
      if (pending) tasks.push({ type: 'reviewSetup', count: 1, panel: 'profile' });
      return { pending: pending ? 1 : 0 };
    }),
  ]);
  // Parallel source completion must not shuffle operational priorities.
  const priority = ['confirmBookings', 'replyToMessages', 'followUpInvoices', 'reviewSetup'];
  tasks.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
  return {
    businessId, businessKind, generatedAt, timezone, sections, tasks,
    partial: Object.values(sections).some(section => section.status === 'unavailable'),
    canViewAnalytics: financeRole && permissions.has('analytics.view_financial'),
  };
}

module.exports = { collectBusinessOperations, businessTimezone };
