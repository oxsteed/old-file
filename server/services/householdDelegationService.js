'use strict';

// Household delegate model (Group 2, D-34/D-35): a household is the owning
// customer's account plus a delegates list. A delegate acts only inside
// the scope the owner grants; every scoped read re-checks the live row,
// so revocation and expiry close access immediately. A delegate never
// pays, never changes the owner's account, and never sees payment
// internals (no household read carries amounts or deposit state).
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const DELEGATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000;

const SCOPES = [
  'book',
  'schedule',
  'prepare',
  'coordinate',
  'view_records',
  'manage_addresses',
  'manage_tasks',
  'view_calendar',
];

// Item 81: the scope preview shows exactly what each scope grants before
// the delegate accepts. These strings are the contract, not marketing.
// D-579: book grants booking only; the visit actions (confirm readiness,
// share summaries, replacements, follow-ups, emergency fallback,
// reminders) need prepare or schedule, and the descriptions say so.
const SCOPE_DESCRIPTIONS = {
  book: 'Book visits for the owner. The owner always pays; the delegate never sees payment details. Booking only: visit actions need prepare or schedule scope.',
  schedule: 'Schedule and reschedule visits on the shared calendar, and record availability windows.',
  prepare: 'Prepare visits: checklists, supplies, accessibility needs, arrival instructions, confirm readiness, share visit summaries, request replacements, file missed-visit follow-ups, trigger emergency fallback, and send visit and supply reminders.',
  coordinate: 'Coordinate people: assign tasks, hand work to another delegate.',
  view_records: 'Read visit summaries and household documents shared with them.',
  manage_addresses: 'Use and edit the household address book (private owner notes stay hidden).',
  manage_tasks: 'Work the household maintenance plans and mark tasks done.',
  view_calendar: 'See the shared appointment calendar only. Nothing else.',
};

function cleanScopes(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((s) => String(s).trim()).filter((s) => SCOPES.includes(s)))];
}

function isExpiredRow(row) {
  if (!row) return true;
  if (row.status === 'revoked' || row.status === 'closed' || row.status === 'declined') return true;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return true;
  return false;
}

// Lazily close rows past expiry so a stale 'accepted' row never grants
// access (the same expire-if-stale pattern booking reads use). D-589: an
// expiring delegation gets a stored closure receipt (closedBy null, reason
// expired) and its upcoming visit preps are reassigned to the owner, so
// the receipt can record what the closure moved. D-591: a substitute
// coordinator whose `until` passed is cleared here too, and the owner is
// told once; the standing coordinator is NOT auto-restored.
async function markExpiredDelegations(pool) {
  try {
    const { rows: expiring } = await pool.query(
      `UPDATE household_delegations
          SET status = 'expired', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
        WHERE status IN ('invited', 'accepted')
          AND expires_at <= NOW()
        RETURNING *`,
    );
    for (const row of expiring) {
      try {
        const moved = await pool.query(
          `UPDATE household_visit_preps p
              SET assigned_delegate_user_id = NULL, updated_at = NOW()
            WHERE p.owner_id = $1 AND p.assigned_delegate_user_id = $2
              AND p.booking_id IN (SELECT id FROM booking_requests WHERE requested_date >= CURRENT_DATE)`,
          [row.owner_id, row.delegate_user_id],
        );
        const receipt = {
          closedBy: null,
          closedAt: row.closed_at || new Date().toISOString(),
          reason: 'Delegation expired',
          scopesHeld: Array.isArray(row.scopes) ? row.scopes : [],
          wasCoordinator: Boolean(row.is_coordinator),
          upcomingVisitsReassigned: { count: moved.rowCount || 0, reassignedTo: 'owner' },
        };
        await pool.query(
          `UPDATE household_delegations SET closure_receipt = $2 WHERE id = $1`,
          [row.id, JSON.stringify(receipt)],
        );
        await logActivity(pool, row.id, null, 'expired', { reassignedVisits: moved.rowCount || 0 });
      } catch (err) {
        logger.warn('Failed to write household expiry receipt', { delegationId: row.id, error: err.message });
      }
    }
    const { rows: lapsed } = await pool.query(
      `SELECT * FROM household_delegations
        WHERE is_coordinator = TRUE AND coordinator_until IS NOT NULL
          AND coordinator_until <= NOW() AND status = 'accepted'`,
    );
    if (lapsed.length) {
      await pool.query(
        `UPDATE household_delegations
            SET is_coordinator = FALSE, coordinator_until = NULL, updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [lapsed.map((r) => r.id)],
      );
    }
    for (const row of lapsed) {
      try {
        await logActivity(pool, row.id, null, 'substitute_coordinator_lapsed', {
          until: row.coordinator_until,
        });
        await notifyHousehold({
          userId: row.owner_id,
          type: 'household_delegation_update',
          body: 'A temporary substitute coordinator lapsed. Re-assign the coordinator role when ready.',
          data: { delegationId: row.id },
          actionUrl: '/household',
          idempotencyKey: `household-substitute-lapsed:${row.id}:${(row.coordinator_until instanceof Date ? row.coordinator_until.toISOString() : String(row.coordinator_until)).slice(0, 10)}`,
        });
      } catch (err) {
        logger.warn('Failed to notify lapsed substitute coordinator', { delegationId: row.id, error: err.message });
      }
    }
  } catch (err) {
    logger.warn('Failed to mark expired household delegations', { error: err.message });
  }
}

// D-585: automatic expiry reminders. A live delegation inside its final
// 7 days (EXPIRY_SOON_MS) gets one reminder to the owner and one to the
// delegate, recorded by last_reminder_sent_at so the sweep never
// re-sends inside the window; a manual reminder stamps the same column
// and suppresses the automatic one for the same window.
async function sendDelegationExpiryReminders(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM household_delegations
        WHERE status = 'accepted'
          AND expires_at > NOW()
          AND expires_at <= NOW() + INTERVAL '7 days'
          AND (last_reminder_sent_at IS NULL OR last_reminder_sent_at <= NOW() - INTERVAL '7 days')`,
    );
    let sent = 0;
    for (const row of rows) {
      try {
        await pool.query(
          'UPDATE household_delegations SET last_reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
          [row.id],
        );
        await logActivity(pool, row.id, null, 'expiry_reminder_sent', {});
        for (const userId of [row.owner_id, row.delegate_user_id]) {
          if (!userId) continue;
          await notifyHousehold({
            userId,
            type: 'household_delegation_update',
            body: 'A household delegation expires within 7 days.',
            data: { delegationId: row.id },
            actionUrl: '/household',
            idempotencyKey: `household-expiry-reminder:${row.id}:${(row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)).slice(0, 10)}`,
          });
        }
        sent += 1;
      } catch (err) {
        logger.warn('Failed to send household expiry reminder', { delegationId: row.id, error: err.message });
      }
    }
    return { sent, checked: rows.length };
  } catch (err) {
    logger.warn('Failed to send household expiry reminders', { error: err.message });
    return { sent: 0, checked: 0 };
  }
}

function daysToExpiry(row) {
  if (!row || !row.expires_at) return null;
  return Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function serializeDelegation(row, { forOwner = false } = {}) {
  if (!row) return null;
  const days = daysToExpiry(row);
  return {
    id: row.id,
    ownerId: row.owner_id,
    delegateUserId: row.delegate_user_id,
    delegateEmail: row.delegate_email,
    delegateName: row.delegate_name,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    status: row.status,
    invitedAt: row.invited_at,
    expiresAt: row.expires_at,
    daysToExpiry: days,
    expiresSoon: days !== null && days <= 7 && days >= 0,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    closedAt: row.closed_at,
    closureReceipt: row.closure_receipt || null,
    isCoordinator: Boolean(row.is_coordinator),
    coordinatorUntil: row.coordinator_until,
    handoffNote: row.handoff_note,
    handoffAcknowledgedAt: row.handoff_acknowledged_at,
    lastReminderSentAt: row.last_reminder_sent_at,
    // Only the owner ever sees the invite token (to share it); the
    // delegate accepts from their own invite list instead.
    inviteToken: forOwner ? row.invite_token || null : null,
  };
}

async function logActivity(client, delegationId, actorId, action, detail) {
  await client.query(
    `INSERT INTO household_delegation_activity (delegation_id, actor_id, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [delegationId, actorId || null, action, JSON.stringify(detail || {})],
  );
}

async function findActiveDelegation(pool, ownerId, delegateUserId) {
  await markExpiredDelegations(pool);
  const { rows } = await pool.query(
    `SELECT * FROM household_delegations
      WHERE owner_id = $1 AND delegate_user_id = $2 AND status = 'accepted'
        AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [ownerId, delegateUserId],
  );
  return rows[0] || null;
}

function hasScope(delegation, scope) {
  if (!delegation || isExpiredRow(delegation)) return false;
  const scopes = Array.isArray(delegation.scopes) ? delegation.scopes : [];
  return scopes.includes(scope);
}

// Returns { role: 'owner' | 'delegate', delegation } when userId may act
// for ownerId with the given scope, else null. Owners always pass; a
// delegate passes only with a live accepted delegation holding the scope.
async function resolveHouseholdAccess(pool, ownerId, userId, scope) {
  if (!ownerId || !userId) return null;
  if (String(ownerId) === String(userId)) return { role: 'owner', delegation: null };
  const delegation = await findActiveDelegation(pool, ownerId, userId);
  if (!delegation) return null;
  if (scope && !hasScope(delegation, scope)) return null;
  return { role: 'delegate', delegation };
}

async function resolveUserByEmail(pool, email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND is_active = TRUE LIMIT 1`,
    [clean],
  );
  return rows[0] || null;
}

function newInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Notifications never fail the request: a failed send is logged, exactly
// like the G-6/G-7 status-link delivery.
async function notifyHousehold({ userId, type, body, data, actionUrl, idempotencyKey }) {
  if (!userId) return;
  try {
    await sendNotification({
      userId,
      type,
      body,
      data: data || {},
      action_url: actionUrl || '/household',
      idempotencyKey: idempotencyKey || `household:${type}:${userId}:${Date.now()}`,
    });
  } catch (err) {
    logger.warn('Failed to send household notification', { type, error: err.message });
  }
}

// A booking is visible to the household when the caller is the owner, an
// accepted delegate of the owner (book/schedule/prepare scope), the
// recipient, the site contact, or the provider. The delegate view carries
// no payment internals (the booking read shape carries none).
async function householdBookingAccess(pool, booking, userId) {
  if (!booking || !userId) return null;
  const ownerId = booking.customer_id;
  if (String(userId) === String(ownerId)) return { role: 'owner', delegation: null };
  if (booking.recipient_user_id && String(userId) === String(booking.recipient_user_id)) {
    return { role: 'recipient', delegation: null };
  }
  if (booking.site_contact_user_id && String(userId) === String(booking.site_contact_user_id)) {
    return { role: 'site_contact', delegation: null };
  }
  for (const scope of ['book', 'schedule', 'prepare']) {
    const access = await resolveHouseholdAccess(pool, ownerId, userId, scope);
    if (access) return access;
  }
  return null;
}

module.exports = {
  DELEGATION_TTL_MS,
  EXPIRY_SOON_MS,
  SCOPES,
  SCOPE_DESCRIPTIONS,
  cleanScopes,
  isExpiredRow,
  markExpiredDelegations,
  daysToExpiry,
  serializeDelegation,
  logActivity,
  findActiveDelegation,
  hasScope,
  resolveHouseholdAccess,
  resolveUserByEmail,
  newInviteToken,
  notifyHousehold,
  householdBookingAccess,
  sendDelegationExpiryReminders,
};
