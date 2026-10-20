'use strict';

/**
 * supportAccountSnapshot.js
 *
 * Read-only account snapshot for the AI support chat (gap #1: no live data,
 * gap #9: money answers without verification).
 *
 * For a signed-in user, returns a small, cheap summary the model can cite
 * when answering account-specific questions ("where is my payout",
 * "what's the status of my dispute"). Every section is individually
 * guarded: a failed query omits that section instead of failing the chat.
 *
 * Privacy: only the caller's own rows, only coarse status/count fields and
 * record ids for links. No account numbers, no full transaction history, no
 * surname/email/phone. The first name is shared only for a natural greeting.
 * Business queue counts require the shared business access check.
 */

const { query } = require('../db');
const logger = require('../utils/logger');
const { resolveBusinessAccess } = require('./scopeModel');

async function safeSection(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('[supportSnapshot] section failed', { section: name, error: err.message });
    return null;
  }
}

// The widget's five locales map to full Intl locales; anything Intl cannot
// format falls back to English so a balance is never dropped.
const SNAPSHOT_LOCALES = { en: 'en-US', es: 'es', fr: 'fr', ht: 'fr-HT', ar: 'ar' };

function resolveSnapshotLocale(language) {
  const code = typeof language === 'string' ? language.trim() : '';
  const candidate = SNAPSHOT_LOCALES[code.toLowerCase()] || code || 'en-US';
  try {
    return Intl.NumberFormat.supportedLocalesOf([candidate]).length ? candidate : 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * Formats a minor-unit amount (cents for USD) in its own currency for the
 * user's locale, e.g. "$12.50", "12,50 €", "US$12.50". Uses the currency's
 * real minor-unit exponent (JPY has none). Never prefixes "$" onto a
 * non-dollar currency; an unknown code falls back to "<amount> <CODE>".
 */
function formatMinorAmount(minor, currencyCode, language) {
  const currency = String(currencyCode || 'USD').trim().toUpperCase() || 'USD';
  const locale = resolveSnapshotLocale(language);
  const value = Number(minor);
  if (!Number.isFinite(value)) return null;
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(value / 10 ** digits);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

// Customer jobs that are still live. jobs.status is the job_status enum
// (draft, published, matched, negotiating, accepted, in_progress, completed,
// cancelled, closed); the ::text cast keeps the filter valid if 'expired' is
// ever added. A published job past expires_at was never picked up: expired.
const ACTIVE_CUSTOMER_JOBS_SQL = `SELECT COUNT(*)::int AS n
         FROM jobs
        WHERE client_id = $1
          AND deleted_at IS NULL
          AND status::text NOT IN ('draft', 'expired', 'completed', 'cancelled', 'closed')
          AND NOT (status::text = 'published' AND expires_at IS NOT NULL AND expires_at <= NOW())`;

// Snapshot cache: each chat turn would otherwise run ~15 queries. A short
// TTL keeps answers fresh after the user acts on a page while absorbing
// rapid follow-up questions. In-process and bounded; per instance only.
const SNAPSHOT_CACHE_TTL_MS = 30 * 1000;
const SNAPSHOT_CACHE_MAX = 2000;
const snapshotCache = new Map();

function cacheKey(userId, language, businessId) {
  return `${userId}|${language || ''}|${businessId ?? ''}`;
}

function readCache(key, now = Date.now()) {
  const hit = snapshotCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) { snapshotCache.delete(key); return null; }
  return hit.value;
}

function writeCache(key, value, now = Date.now()) {
  if (snapshotCache.size >= SNAPSHOT_CACHE_MAX) {
    const oldest = snapshotCache.keys().next().value;
    snapshotCache.delete(oldest);
  }
  snapshotCache.set(key, { value, expiresAt: now + SNAPSHOT_CACHE_TTL_MS });
}

/** Drops cached snapshots for a user (e.g. after an in-chat action). */
function invalidateSupportSnapshot(userId) {
  const prefix = `${userId}|`;
  for (const key of snapshotCache.keys()) if (key.startsWith(prefix)) snapshotCache.delete(key);
}

function _resetSnapshotCacheForTests() { snapshotCache.clear(); }

/**
 * First name for a natural greeting only. Profile text is user-controlled
 * and lands in the system prompt, so only letters, marks, spaces, hyphens
 * and apostrophes survive, capped at 40 characters. Never the surname.
 */
function sanitizeFirstName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.normalize('NFC').replace(/[^\p{L}\p{M}' -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return cleaned.length ? cleaned : null;
}

const toInt = (v) => Number(v || 0);
const ACTIVE_FOOD_ORDER_STATUSES = "('received', 'accepted', 'preparing', 'ready')";

/**
 * @param {string} userId
 * @param {{ language?: string, businessId?: number|string|null }} [options]
 *   language selects number/currency formatting; businessId (from a
 *   /business/:id/workspace page) adds that business's queue counts when
 *   the caller passes the shared business access check.
 */
async function getSupportAccountSnapshot(userId, options = {}) {
  if (!userId) return null;
  const language = options.language;
  const businessId = /^\d+$/.test(String(options.businessId ?? '')) ? Number(options.businessId) : null;
  const key = cacheKey(userId, language, businessId);
  const cached = readCache(key);
  if (cached) return cached;

  // Every section is independent: run them in parallel; each fails open.
  const sections = {
    profile: async () => {
      const { rows } = await query('SELECT first_name FROM users WHERE id = $1', [userId]);
      return rows.length ? { firstName: sanitizeFirstName(rows[0].first_name) } : null;
    },

    // OxSteed Credit wallet balance and status (read-only).
    credit: async () => {
      const { rows } = await query(
        `SELECT balance_cents, currency_code, status
           FROM oxsteed_credit_accounts
          WHERE customer_id = $1 AND account_type = 'customer_wallet'
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (!rows.length) return null;
      const balance = formatMinorAmount(rows[0].balance_cents, rows[0].currency_code, language);
      if (!balance) return null;
      return {
        balance,
        currency: String(rows[0].currency_code || 'USD').toUpperCase(),
        status: rows[0].status || null,
      };
    },

    // Credit entitlement status only; no limits, no approval path.
    creditEntitlement: async () => {
      const { rows } = await query(
        `SELECT status FROM oxsteed_credit_customer_entitlements
          WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows.length ? { status: rows[0].status } : null;
    },

    // Latest payout request (the "where is my payout" question).
    latestPayout: async () => {
      const { rows } = await query(
        `SELECT amount_cents, currency_code, payout_method, status, requested_at, processed_at
           FROM main_app_payout_requests
          WHERE user_id = $1
          ORDER BY requested_at DESC LIMIT 1`,
        [userId]
      );
      if (!rows.length) return null;
      const p = rows[0];
      return {
        amount: formatMinorAmount(p.amount_cents, p.currency_code, language),
        currency: String(p.currency_code || 'USD').toUpperCase(),
        method: p.payout_method,
        status: p.status,
        requested: p.requested_at,
        processed: p.processed_at || null,
      };
    },

    // Open disputes the user opened, with the newest for a record link.
    disputes: async () => {
      const { rows } = await query(
        `SELECT id, status, COUNT(*) OVER ()::int AS n
           FROM disputes
          WHERE opened_by = $1 AND status NOT IN ('closed', 'resolved', 'cancelled')
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows.length ? { count: toInt(rows[0].n), latestId: rows[0].id, latestStatus: rows[0].status } : { count: 0 };
    },

    // Active jobs where the user is the customer (no drafts, expired or deleted).
    activeJobs: async () => {
      const { rows } = await query(ACTIVE_CUSTOMER_JOBS_SQL, [userId]);
      return Number(rows[0]?.n || 0);
    },

    latestCustomerJob: async () => {
      const { rows } = await query(
        `SELECT id, status::text AS status FROM jobs
          WHERE client_id = $1 AND deleted_at IS NULL
            AND status::text NOT IN ('draft', 'expired', 'completed', 'cancelled', 'closed')
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows.length ? { id: rows[0].id, status: rows[0].status } : null;
    },

    // Food orders placed by the user that are still in progress.
    foodOrders: async () => {
      const { rows } = await query(
        `SELECT id, status, payment_status, COUNT(*) OVER ()::int AS n
           FROM food_orders
          WHERE customer_id = $1 AND status IN ${ACTIVE_FOOD_ORDER_STATUSES}
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows.length
        ? { active: toInt(rows[0].n), latestId: rows[0].id, latestStatus: rows[0].status, latestPayment: rows[0].payment_status }
        : { active: 0 };
    },

    // Upcoming appointments as customer.
    appointments: async () => {
      const { rows } = await query(
        `SELECT status, scheduled_start_time, COUNT(*) OVER ()::int AS n
           FROM appointments
          WHERE customer_id = $1
            AND status IN ('requested', 'confirmed', 'rescheduled')
            AND scheduled_start_time >= NOW()
          ORDER BY scheduled_start_time ASC LIMIT 1`,
        [userId]
      );
      return rows.length
        ? { upcoming: toInt(rows[0].n), nextStatus: rows[0].status, nextStart: rows[0].scheduled_start_time }
        : { upcoming: 0 };
    },

    // Booking requests the user sent that await the helper.
    bookingRequestsSent: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM booking_requests WHERE customer_id = $1 AND status = 'pending'`,
        [userId]
      );
      return toInt(rows[0]?.n);
    },

    // Helper side: pending bids, assigned jobs, booking requests to answer.
    helperBids: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM bids WHERE helper_id = $1 AND status = 'pending'`,
        [userId]
      );
      return toInt(rows[0]?.n);
    },

    helperAssignedJobs: async () => {
      const { rows } = await query(
        `SELECT id, status::text AS status, COUNT(*) OVER ()::int AS n
           FROM jobs
          WHERE assigned_helper_id = $1 AND deleted_at IS NULL
            AND status::text IN ('accepted', 'in_progress')
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows.length ? { count: toInt(rows[0].n), latestId: rows[0].id, latestStatus: rows[0].status } : { count: 0 };
    },

    bookingRequestsReceived: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM booking_requests WHERE helper_id = $1 AND status = 'pending'`,
        [userId]
      );
      return toInt(rows[0]?.n);
    },

    // Identity verification: latest session status only (never documents).
    identity: async () => {
      const { rows } = await query(
        `SELECT status FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return { status: rows[0]?.status || 'not_started' };
    },

    // Open support tickets, with the newest for a record link.
    tickets: async () => {
      const { rows } = await query(
        `SELECT id, status, COUNT(*) OVER ()::int AS n
           FROM support_tickets
          WHERE user_id = $1 AND status NOT IN ('resolved', 'closed')
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows.length ? { open: toInt(rows[0].n), latestId: rows[0].id, latestStatus: rows[0].status } : { open: 0 };
    },

    // Business / restaurant queue counts for the workspace the user is on,
    // only when the shared business access check grants them access.
    businessQueue: async () => {
      if (businessId == null) return null;
      const access = await resolveBusinessAccess(userId, businessId);
      if (!access || !access.effective_role) return null;
      const [orders, conversations] = await Promise.all([
        query(
          `SELECT COUNT(*)::int AS n FROM food_orders
            WHERE business_id = $1 AND status IN ${ACTIVE_FOOD_ORDER_STATUSES}`,
          [businessId]
        ),
        query(
          `SELECT COUNT(*)::int AS n FROM support_conversations
            WHERE business_id = $1 AND COALESCE(status, 'open') NOT IN ('resolved', 'closed')`,
          [businessId]
        ),
      ]);
      return {
        businessId,
        role: access.effective_role,
        activeFoodOrders: toInt(orders.rows[0]?.n),
        openSupportConversations: toInt(conversations.rows[0]?.n),
      };
    },
  };

  const names = Object.keys(sections);
  const values = await Promise.all(names.map((name) => safeSection(name, sections[name])));
  const snapshot = {};
  names.forEach((name, i) => { snapshot[name] = values[i]; });
  // Back-compat aliases used by older callers/tests.
  snapshot.openDisputes = snapshot.disputes ? snapshot.disputes.count : null;
  snapshot.openTickets = snapshot.tickets ? snapshot.tickets.open : null;
  snapshot.blockers = accountBlockers(snapshot);

  writeCache(key, snapshot);
  return snapshot;
}

/**
 * Account states a human usually has to resolve. Used by the handoff
 * signal: when the user asks about one of these, suggest a person.
 */
function accountBlockers(snapshot) {
  const blockers = [];
  if (!snapshot) return blockers;
  if (snapshot.latestPayout?.status === 'failed') blockers.push('payout_failed');
  if ((snapshot.disputes?.count || 0) > 0) blockers.push('open_dispute');
  if (snapshot.foodOrders?.latestPayment === 'failed') blockers.push('payment_failed');
  if (snapshot.credit?.status && snapshot.credit.status !== 'active') blockers.push('credit_account_restricted');
  return blockers;
}

/**
 * Formats the snapshot as prompt context. Sections that came back null
 * are omitted so the model never invents values for them. Record links
 * are plain site paths; the widget renders them as clickable links.
 */
function formatSnapshotForAI(snapshot) {
  if (!snapshot) return '';
  const lines = [];
  if (snapshot.credit) {
    // The formatted amount already carries its currency symbol; the ISO
    // code is added in parentheses so "$" is never ambiguous.
    lines.push(`- OxSteed Credit balance: ${snapshot.credit.balance} (${snapshot.credit.currency})` +
      (snapshot.credit.status ? `, account ${snapshot.credit.status}` : '') + ' (link: /oxsteed-credit)');
  }
  if (snapshot.creditEntitlement?.status) {
    lines.push(`- OxSteed Credit access: ${snapshot.creditEntitlement.status} (read-only; approvals are made by OxSteed staff, never in this chat)`);
  }
  if (snapshot.latestPayout) {
    const p = snapshot.latestPayout;
    lines.push(
      `- Latest payout: ${p.amount}${p.currency ? ` (${p.currency})` : ''} via ${p.method}, status ${p.status}, requested ${p.requested}` +
      (p.processed ? `, processed ${p.processed}` : '') + ' (link: /wallet)'
    );
  }
  if (snapshot.disputes) {
    lines.push(`- Open disputes: ${snapshot.disputes.count}` +
      (snapshot.disputes.latestId ? ` (newest: status ${snapshot.disputes.latestStatus}, link: /disputes/${snapshot.disputes.latestId})` : ''));
  } else if (typeof snapshot.openDisputes === 'number') {
    lines.push(`- Open disputes: ${snapshot.openDisputes}`);
  }
  if (typeof snapshot.activeJobs === 'number') {
    lines.push(`- Active jobs as customer: ${snapshot.activeJobs}` +
      (snapshot.latestCustomerJob ? ` (newest: status ${snapshot.latestCustomerJob.status}, link: /jobs/${snapshot.latestCustomerJob.id})` : ''));
  }
  if (snapshot.foodOrders) {
    lines.push(`- Food orders in progress: ${snapshot.foodOrders.active}` +
      (snapshot.foodOrders.latestId
        ? ` (newest: status ${snapshot.foodOrders.latestStatus}, payment ${snapshot.foodOrders.latestPayment}, link: /orders/${snapshot.foodOrders.latestId})`
        : ' (history: /orders)'));
  }
  if (snapshot.appointments) {
    lines.push(`- Upcoming appointments: ${snapshot.appointments.upcoming}` +
      (snapshot.appointments.nextStart ? ` (next: ${snapshot.appointments.nextStatus}, starts ${new Date(snapshot.appointments.nextStart).toISOString()}, link: /my-bookings)` : ''));
  }
  if (typeof snapshot.bookingRequestsSent === 'number' && snapshot.bookingRequestsSent > 0) {
    lines.push(`- Booking requests awaiting a helper's answer: ${snapshot.bookingRequestsSent} (link: /my-bookings)`);
  }
  if (typeof snapshot.helperBids === 'number' && snapshot.helperBids > 0) {
    lines.push(`- Pending bids as helper: ${snapshot.helperBids} (link: /my-bids)`);
  }
  if (snapshot.helperAssignedJobs && snapshot.helperAssignedJobs.count > 0) {
    lines.push(`- Jobs assigned to you as helper: ${snapshot.helperAssignedJobs.count}` +
      ` (newest: status ${snapshot.helperAssignedJobs.latestStatus}, link: /jobs/${snapshot.helperAssignedJobs.latestId})`);
  }
  if (typeof snapshot.bookingRequestsReceived === 'number' && snapshot.bookingRequestsReceived > 0) {
    lines.push(`- Booking requests waiting for your answer as helper: ${snapshot.bookingRequestsReceived} (link: /helper-dashboard)`);
  }
  if (snapshot.identity?.status) {
    lines.push(`- Identity verification: ${snapshot.identity.status} (link: /verify-identity)`);
  }
  if (snapshot.tickets) {
    lines.push(`- Open support tickets: ${snapshot.tickets.open}` +
      (snapshot.tickets.latestId ? ` (newest: status ${snapshot.tickets.latestStatus}, link: /support/my-tickets/${snapshot.tickets.latestId})` : ''));
  } else if (typeof snapshot.openTickets === 'number') {
    lines.push(`- Open support tickets: ${snapshot.openTickets}`);
  }
  if (snapshot.businessQueue) {
    const b = snapshot.businessQueue;
    lines.push(`- This business workspace (your role: ${b.role}): ${b.activeFoodOrders} food orders in progress, ${b.openSupportConversations} open customer support conversations`);
  }
  if (!lines.length) return '';
  return (
    '## Account Snapshot (live, read-only data for this signed-in user; cite these values and links, never invent others)\n' +
    lines.join('\n')
  );
}

module.exports = {
  getSupportAccountSnapshot,
  formatSnapshotForAI,
  formatMinorAmount,
  resolveSnapshotLocale,
  sanitizeFirstName,
  accountBlockers,
  invalidateSupportSnapshot,
  _resetSnapshotCacheForTests,
  ACTIVE_CUSTOMER_JOBS_SQL,
  SNAPSHOT_CACHE_TTL_MS,
};
