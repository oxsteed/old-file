'use strict';

// Household delegate (Group 2, items 51-100): the owner invites delegates
// who act inside a granted scope. Every endpoint re-reads the live
// delegation row, so revocation and expiry close access immediately.
// Delegates never pay and never see payment internals: no household read
// carries amounts, deposit state, or payout data.
const pool = require('../db');
const logger = require('../utils/logger');
const { sendValidationError, sendError } = require('../utils/apiError');
const { sendEmail } = require('../utils/email');
const svc = require('../services/householdDelegationService');

const {
  DELEGATION_TTL_MS,
  SCOPES,
  SCOPE_DESCRIPTIONS,
  cleanScopes,
  serializeDelegation,
  logActivity,
  findActiveDelegation,
  hasScope,
  resolveHouseholdAccess,
  resolveUserByEmail,
  newInviteToken,
  notifyHousehold,
  householdBookingAccess,
  markExpiredDelegations,
} = svc;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function loadDelegation(id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query('SELECT * FROM household_delegations WHERE id = $1', [id]);
  return rows[0] || null;
}

// The caller is the owner of this delegation, or the delegate themselves.
function canSeeDelegation(row, userId) {
  return String(row.owner_id) === String(userId)
    || (row.delegate_user_id && String(row.delegate_user_id) === String(userId));
}

// Email invite links use the same public base as the other invite flows.
function safeBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/$/, '');
}

// Compare calendar dates as YYYY-MM-DD strings, never as Date objects:
// a local-midnight date and a UTC-midnight date disagree near midnight
// (R59). pg returns DATE columns as Date objects; normalize both shapes.
function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// D-586: reminders of the same kind wait 24 hours between sends. The
// stamp column is read before sending; a repeat inside the window sends
// nothing and reports tooSoon instead of a fresh notification.
function reminderTooSoon(lastSentAt) {
  if (!lastSentAt) return false;
  return new Date(lastSentAt).getTime() > Date.now() - 24 * 60 * 60 * 1000;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Read the visit-prep row without creating one (R63): a read by a site
// contact or a recipient just viewing must not INSERT a prep row.
async function loadPrep(booking) {
  const { rows } = await pool.query(
    'SELECT * FROM household_visit_preps WHERE booking_id = $1', [booking.id],
  );
  return rows[0] || null;
}

// D-579: the visit-action endpoints (readiness, summaries, replacements,
// follow-ups, emergency fallback, reminders) need prepare or schedule
// scope for delegates. Book-only delegates keep booking, calendar reads,
// and availability; owners, recipients, and site contacts keep the
// access their role already grants on each endpoint.
function delegateMayDoVisitAction(access) {
  if (!access) return false;
  if (access.role !== 'delegate') return true;
  return hasScope(access.delegation, 'prepare') || hasScope(access.delegation, 'schedule');
}

async function loadBooking(id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

// Get-or-create the visit-prep row for a booking the caller may access.
async function ensurePrep(booking) {
  const { rows } = await pool.query(
    `INSERT INTO household_visit_preps (booking_id, owner_id)
     VALUES ($1, $2)
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING *`,
    [booking.id, booking.customer_id],
  );
  if (rows.length) return rows[0];
  const existing = await pool.query(
    'SELECT * FROM household_visit_preps WHERE booking_id = $1', [booking.id],
  );
  return existing.rows[0];
}

function cleanChecklist(input) {
  if (!Array.isArray(input)) return null;
  return input.slice(0, 50).map((item, i) => ({
    id: String(item.id || `item-${i + 1}`).slice(0, 80),
    label: String(item.label || '').trim().slice(0, 200),
    done: item.done === true,
  })).filter((item) => item.label);
}

function cleanSupplies(input) {
  if (!Array.isArray(input)) return null;
  return input.slice(0, 50).map((item) => ({
    item: String(item.item || '').trim().slice(0, 200),
    quantity: String(item.quantity || '').trim().slice(0, 40),
    note: String(item.note || '').trim().slice(0, 500),
  })).filter((item) => item.item);
}

function cleanAvailability(input) {
  if (!Array.isArray(input)) return null;
  return input.slice(0, 30).map((slot) => ({
    date: String(slot.date || '').slice(0, 10),
    start: String(slot.start || '').slice(0, 5),
    end: String(slot.end || '').slice(0, 5),
    note: String(slot.note || '').trim().slice(0, 300),
  })).filter((slot) => /^\d{4}-\d{2}-\d{2}$/.test(slot.date));
}

// ═══════════════════════════════════════════════════════════════════════════
// DELEGATIONS — invite / consent / scope / expiry / revocation (52, 53, 55,
// 71, 72, 73, 74, 75, 81, 83, 84, 85, 99, 100)
// ═══════════════════════════════════════════════════════════════════════════

// Item 52: the owner invites a delegate by email (resolved to an account
// when one matches) or by user id. The invite carries the granted scope
// and a 90-day expiry; the invitee accepts the scope as shown (81).
exports.inviteDelegation = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { delegateEmail, delegateUserId, delegateName, scopes, isCoordinator } = req.body || {};
    const cleanScopesList = cleanScopes(scopes);
    if (!cleanScopesList.length) {
      return sendValidationError(res, { scopes: 'Grant at least one scope.' });
    }
    let delegateUser = null;
    if (delegateUserId) {
      if (!isUuid(delegateUserId)) {
        return sendValidationError(res, { delegateUserId: 'Unknown delegate.' });
      }
      const { rows } = await pool.query(
        'SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE',
        [delegateUserId],
      );
      delegateUser = rows[0] || null;
      if (!delegateUser) return sendError(res, 404, 'Delegate not found', 'DELEGATE_NOT_FOUND');
    } else if (delegateEmail) {
      delegateUser = await resolveUserByEmail(pool, delegateEmail);
    } else {
      return sendValidationError(res, { delegateEmail: 'An email or a delegate account is required.' });
    }
    const email = String((delegateUser && delegateUser.email) || delegateEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendValidationError(res, { delegateEmail: 'A valid email is required.' });
    }
    if (delegateUser && String(delegateUser.id) === String(ownerId)) {
      return sendValidationError(res, { delegateUserId: 'You cannot delegate to yourself.' });
    }
    // One live invite per person: a second invite replaces nothing, it
    // 409s so the owner revokes or waits instead of stacking tokens.
    const existing = await pool.query(
      `SELECT id, status FROM household_delegations
        WHERE owner_id = $1 AND (delegate_user_id = $2 OR lower(delegate_email) = $3)
          AND status IN ('invited', 'accepted')`,
      [ownerId, delegateUser ? delegateUser.id : null, email],
    );
    if (existing.rows.length) {
      return sendError(res, 409, 'This person already has a live invitation or delegation', 'DELEGATION_EXISTS');
    }
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + DELEGATION_TTL_MS);
    const { rows } = await pool.query(
      `INSERT INTO household_delegations
         (owner_id, delegate_user_id, delegate_email, delegate_name, scopes,
          status, invite_token, expires_at, is_coordinator)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7, $8)
       RETURNING *`,
      [
        ownerId,
        delegateUser ? delegateUser.id : null,
        email,
        delegateName ? String(delegateName).trim().slice(0, 200) : null,
        JSON.stringify(cleanScopesList),
        token,
        expiresAt,
        isCoordinator === true,
      ],
    );
    const row = rows[0];
    await logActivity(pool, row.id, ownerId, 'invited', { scopes: cleanScopesList });
    if (delegateUser) {
      await notifyHousehold({
        userId: delegateUser.id,
        type: 'household_delegate_invite',
        body: 'You were invited to help manage a household.',
        data: { delegationId: row.id },
        actionUrl: '/household',
        idempotencyKey: `household-delegate-invite:${row.id}`,
      });
    }
    // Item 52 (R28): the invite is emailed with an accept link carrying
    // the token, so an invitee with no OxSteed account can learn about
    // the invite at all. The link lands on /household with the token;
    // acceptance still requires signing in as the invited email
    // (acceptDelegationByToken), so the email is delivery, not access.
    try {
      await sendEmail({
        to: email,
        subject: 'You were invited to help manage a household on OxSteed',
        text: `You were invited to help manage a household on OxSteed. Sign in with this email and open ${safeBaseUrl()}/household?invite=${token} to accept the invitation. The invitation expires in 90 days.`,
      });
    } catch (err) {
      logger.warn('Failed to email household invite', { delegationId: row.id, error: err.message });
    }
    res.status(201).json({ delegation: serializeDelegation(row, { forOwner: true }) });
  } catch (err) {
    logger.error('inviteDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to invite delegate.' });
  }
};

// Item 74: the role summary card — every delegation for this household
// with who holds which scope, who coordinates, and what expires soon.
exports.listDelegations = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const userId = req.user.id;
    const role = String(req.query.role || 'owner');
    let rows;
    if (role === 'delegate') {
      const result = await pool.query(
        `SELECT * FROM household_delegations
          WHERE delegate_user_id = $1 OR lower(delegate_email) = (
            SELECT lower(email) FROM users WHERE id = $1)
          ORDER BY created_at DESC`,
        [userId],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT * FROM household_delegations WHERE owner_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      rows = result.rows;
    }
    res.json({
      delegations: rows.map((row) => serializeDelegation(row, {
        forOwner: String(row.owner_id) === String(userId),
      })),
    });
  } catch (err) {
    logger.error('listDelegations error', { message: err.message });
    res.status(500).json({ error: 'Failed to list delegations.' });
  }
};

// Pending invites addressed to the signed-in delegate (by account or email).
exports.listInvitations = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT d.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name
         FROM household_delegations d
         JOIN users u ON u.id = d.owner_id
        WHERE d.status = 'invited'
          AND (d.delegate_user_id = $1 OR lower(d.delegate_email) = (
            SELECT lower(email) FROM users WHERE id = $1))
        ORDER BY d.created_at DESC`,
      [userId],
    );
    res.json({
      invitations: rows.map((row) => ({
        ...serializeDelegation(row),
        ownerName: [row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ') || null,
        scopePreview: (Array.isArray(row.scopes) ? row.scopes : []).map((scope) => ({
          scope,
          grants: SCOPE_DESCRIPTIONS[scope] || '',
        })),
      })),
    });
  } catch (err) {
    logger.error('listInvitations error', { message: err.message });
    res.status(500).json({ error: 'Failed to list invitations.' });
  }
};

exports.getDelegation = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const row = await loadDelegation(req.params.id);
    if (!row || !canSeeDelegation(row, req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    res.json({
      delegation: serializeDelegation(row, { forOwner: String(row.owner_id) === String(req.user.id) }),
    });
  } catch (err) {
    logger.error('getDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to load delegation.' });
  }
};

// Shared accept write for acceptDelegation (by id) and
// acceptDelegationByToken (by invite token): the atomic invited -> accepted
// transition, activity, and owner notice. Returns the updated row or null
// when the invite already closed (the caller maps that to a 409).
async function acceptDelegationRow(row, userId) {
  const updated = await pool.query(
    `UPDATE household_delegations
        SET status = 'accepted', accepted_at = NOW(),
            delegate_user_id = COALESCE(delegate_user_id, $2), updated_at = NOW()
      WHERE id = $1 AND status = 'invited'
      RETURNING *`,
    [row.id, userId],
  );
  if (!updated.rows.length) return null;
  await logActivity(pool, row.id, userId, 'accepted', { scopes: updated.rows[0].scopes });
  await notifyHousehold({
    userId: row.owner_id,
    type: 'household_delegation_update',
    body: 'A household delegate accepted your invitation.',
    data: { delegationId: row.id },
    actionUrl: '/household',
    idempotencyKey: `household-delegation-accepted:${row.id}`,
  });
  return updated.rows[0];
}

async function callerEmail(userId) {
  const { rows: me } = await pool.query('SELECT lower(email) AS email FROM users WHERE id = $1', [userId]);
  return me[0] ? me[0].email : null;
}

function isInvitee(row, userId, myEmail) {
  return (row.delegate_user_id && String(row.delegate_user_id) === String(userId))
    || (myEmail && String(row.delegate_email).toLowerCase() === myEmail);
}

// Item 53: consent review — the delegate accepts the invite only after
// seeing the scope preview (81); acceptance records when and how. A
// second response is a 409, exactly like the recipient consent flow.
exports.acceptDelegation = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const row = await loadDelegation(req.params.id);
    if (!row) return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    const userId = req.user.id;
    const myEmail = await callerEmail(userId);
    if (!isInvitee(row, userId, myEmail)) return sendError(res, 403, 'Only the invited delegate can accept', 'NOT_INVITEE');
    if (row.status === 'accepted') return sendError(res, 409, 'Already accepted', 'ALREADY_ACCEPTED');
    if (row.status !== 'invited') {
      return sendError(res, 409, `This invitation is ${row.status}`, 'INVITATION_CLOSED');
    }
    const updated = await acceptDelegationRow(row, userId);
    if (!updated) return sendError(res, 409, 'This invitation is no longer open', 'INVITATION_CLOSED');
    res.json({ delegation: serializeDelegation(updated) });
  } catch (err) {
    logger.error('acceptDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to accept invitation.' });
  }
};

// Item 52 (R28): accept from the emailed invite link. The token is the
// delivery credential; the caller must still sign in as the invited
// email (or the bound account), exactly like acceptDelegation — the
// token alone never grants access to a stranger's account.
exports.acceptDelegationByToken = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const token = String(req.body && req.body.token ? req.body.token : '').trim();
    if (!token) return sendValidationError(res, { token: 'An invite token is required.' });
    const { rows } = await pool.query(
      'SELECT * FROM household_delegations WHERE invite_token = $1', [token],
    );
    const row = rows[0];
    if (!row) return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    const userId = req.user.id;
    const myEmail = await callerEmail(userId);
    if (!isInvitee(row, userId, myEmail)) return sendError(res, 403, 'Only the invited delegate can accept', 'NOT_INVITEE');
    if (row.status === 'accepted') return sendError(res, 409, 'Already accepted', 'ALREADY_ACCEPTED');
    if (row.status !== 'invited') {
      return sendError(res, 409, `This invitation is ${row.status}`, 'INVITATION_CLOSED');
    }
    const updated = await acceptDelegationRow(row, userId);
    if (!updated) return sendError(res, 409, 'This invitation is no longer open', 'INVITATION_CLOSED');
    res.json({ delegation: serializeDelegation(updated) });
  } catch (err) {
    logger.error('acceptDelegationByToken error', { message: err.message });
    res.status(500).json({ error: 'Failed to accept invitation.' });
  }
};

exports.declineDelegation = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row) return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    const userId = req.user.id;
    const { rows: me } = await pool.query('SELECT lower(email) AS email FROM users WHERE id = $1', [userId]);
    const myEmail = me[0] ? me[0].email : null;
    const isInvitee = (row.delegate_user_id && String(row.delegate_user_id) === String(userId))
      || (myEmail && String(row.delegate_email).toLowerCase() === myEmail);
    if (!isInvitee) return sendError(res, 403, 'Only the invited delegate can decline', 'NOT_INVITEE');
    if (row.status !== 'invited') {
      return sendError(res, 409, `This invitation is ${row.status}`, 'INVITATION_CLOSED');
    }
    const updated = await pool.query(
      `UPDATE household_delegations
          SET status = 'declined', declined_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'invited' RETURNING *`,
      [row.id],
    );
    await logActivity(pool, row.id, userId, 'declined', {});
    res.json({ delegation: serializeDelegation(updated.rows[0]) });
  } catch (err) {
    logger.error('declineDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to decline invitation.' });
  }
};

// Item 85: revocation is immediate and total. The row flips to revoked
// in the same write that stamps the closure receipt (99); every scoped
// read re-checks the live row, so nothing granted by the delegation
// works after this call returns.
exports.revokeDelegation = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || String(row.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (row.status === 'revoked' || row.status === 'closed') {
      return sendError(res, 409, `This delegation is already ${row.status}`, 'ALREADY_CLOSED');
    }
    const reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 500) : null;
    // D-589: revocation reassigns the delegate's upcoming visit preps to
    // the owner, and the receipt records what moved, as D-39 promises.
    const moved = await pool.query(
      `UPDATE household_visit_preps p
          SET assigned_delegate_user_id = NULL, updated_at = NOW()
        WHERE p.owner_id = $1 AND p.assigned_delegate_user_id = $2
          AND p.booking_id IN (SELECT id FROM booking_requests WHERE requested_date >= CURRENT_DATE)`,
      [row.owner_id, row.delegate_user_id],
    );
    const receipt = {
      closedBy: req.user.id,
      closedAt: new Date().toISOString(),
      reason: reason || 'Revoked by the owner',
      scopesHeld: Array.isArray(row.scopes) ? row.scopes : [],
      wasCoordinator: Boolean(row.is_coordinator),
      upcomingVisitsReassigned: { count: moved.rowCount || 0, reassignedTo: 'owner' },
    };
    const updated = await pool.query(
      `UPDATE household_delegations
          SET status = 'revoked', revoked_at = NOW(), revoked_reason = $2,
              closed_at = NOW(), closure_receipt = $3, is_coordinator = FALSE,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id, reason, JSON.stringify(receipt)],
    );
    await logActivity(pool, row.id, req.user.id, 'revoked', { reason });
    if (row.delegate_user_id) {
      await notifyHousehold({
        userId: row.delegate_user_id,
        type: 'household_delegation_update',
        body: 'Your household delegation was revoked.',
        data: { delegationId: row.id },
        actionUrl: '/household',
        idempotencyKey: `household-delegation-revoked:${row.id}`,
      });
    }
    res.json({ delegation: serializeDelegation(updated.rows[0], { forOwner: true }) });
  } catch (err) {
    logger.error('revokeDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to revoke delegation.' });
  }
};

// Item 83: consent renewal — a fresh 90 days from the renewal date, for a
// live accepted delegation. Renewing a closed row is refused: a returning
// delegate is re-invited (100), never silently restored (D-39).
exports.renewDelegation = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const row = await loadDelegation(req.params.id);
    if (!row || String(row.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (row.status !== 'accepted') {
      return sendError(res, 409, `Only an accepted delegation can be renewed (this one is ${row.status})`, 'NOT_RENEWABLE');
    }
    const expiresAt = new Date(Date.now() + DELEGATION_TTL_MS);
    const updated = await pool.query(
      `UPDATE household_delegations
          SET expires_at = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [row.id, expiresAt],
    );
    await logActivity(pool, row.id, req.user.id, 'renewed', { expiresAt: expiresAt.toISOString() });
    // Item 83 (R61/F20): the delegate learns the new expiry, not just
    // the owner who renewed it.
    if (row.delegate_user_id) {
      await notifyHousehold({
        userId: row.delegate_user_id,
        type: 'household_delegation_update',
        body: 'Your household delegation was renewed for another 90 days.',
        data: { delegationId: row.id },
        actionUrl: '/household',
        idempotencyKey: `household-delegation-renewed:${row.id}:${expiresAt.toISOString().slice(0, 10)}`,
      });
    }
    res.json({ delegation: serializeDelegation(updated.rows[0], { forOwner: true }) });
  } catch (err) {
    logger.error('renewDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to renew delegation.' });
  }
};

// Item 84: either side can trigger the expiration reminder; it notifies
// the other side and stamps the row so reminders do not spam.
exports.remindDelegation = async (req, res) => {
  try {
    await markExpiredDelegations(pool);
    const row = await loadDelegation(req.params.id);
    if (!row || !canSeeDelegation(row, req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (row.status !== 'accepted' && row.status !== 'invited') {
      return sendError(res, 409, `This delegation is ${row.status}`, 'NOT_REMINDABLE');
    }
    // D-586: at most one reminder per 24 hours; a repeat inside the
    // window sends nothing.
    if (reminderTooSoon(row.last_reminder_sent_at)) {
      return res.json({ reminded: false, tooSoon: true });
    }
    const targetId = String(req.user.id) === String(row.owner_id) ? row.delegate_user_id : row.owner_id;
    await pool.query(
      'UPDATE household_delegations SET last_reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
      [row.id],
    );
    await logActivity(pool, row.id, req.user.id, 'reminder_sent', {});
    await notifyHousehold({
      userId: targetId,
      type: 'household_delegation_update',
      body: 'A household delegation is nearing expiry.',
      data: { delegationId: row.id },
      actionUrl: '/household',
      idempotencyKey: `household-delegation-reminder:${row.id}:${dayKey()}`,
    });
    res.json({ reminded: true });
  } catch (err) {
    logger.error('remindDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to send reminder.' });
  }
};

// Item 71: one coordinator per household. Setting a coordinator clears
// the flag from the owner's other delegations in the same write.
exports.setCoordinator = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || String(row.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (row.status !== 'accepted') {
      return sendError(res, 409, 'Only an accepted delegate can coordinate', 'NOT_COORDINATOR');
    }
    const isCoordinator = req.body && req.body.isCoordinator === true;
    const until = req.body && req.body.until ? new Date(req.body.until) : null;
    if (until && Number.isNaN(until.getTime())) {
      return sendValidationError(res, { until: 'Invalid date.' });
    }
    await pool.query(
      `UPDATE household_delegations SET is_coordinator = FALSE, coordinator_until = NULL, updated_at = NOW()
        WHERE owner_id = $1 AND id <> $2`,
      [row.owner_id, row.id],
    );
    const updated = await pool.query(
      `UPDATE household_delegations
          SET is_coordinator = $2, coordinator_until = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id, isCoordinator, isCoordinator ? until : null],
    );
    await logActivity(pool, row.id, req.user.id, isCoordinator ? 'coordinator_assigned' : 'coordinator_removed', {
      until: until ? until.toISOString() : null,
    });
    res.json({ delegation: serializeDelegation(updated.rows[0], { forOwner: true }) });
  } catch (err) {
    logger.error('setCoordinator error', { message: err.message });
    res.status(500).json({ error: 'Failed to set coordinator.' });
  }
};

// Item 72: a temporary substitute coordinator holds the role until a
// date; when it lapses the standing coordinator is not auto-restored,
// the owner re-assigns (the handoff is explicit, never silent).
exports.setSubstituteCoordinator = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || String(row.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (row.status !== 'accepted') {
      return sendError(res, 409, 'Only an accepted delegate can substitute', 'NOT_SUBSTITUTE');
    }
    const until = req.body && req.body.until ? new Date(req.body.until) : null;
    if (!until || Number.isNaN(until.getTime()) || until <= new Date()) {
      return sendValidationError(res, { until: 'A future end date is required.' });
    }
    const note = req.body && req.body.note ? String(req.body.note).trim().slice(0, 1000) : null;
    await pool.query(
      `UPDATE household_delegations SET is_coordinator = FALSE, coordinator_until = NULL, updated_at = NOW()
        WHERE owner_id = $1 AND id <> $2`,
      [row.owner_id, row.id],
    );
    const updated = await pool.query(
      `UPDATE household_delegations
          SET is_coordinator = TRUE, coordinator_until = $2, handoff_note = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id, until, note],
    );
    await logActivity(pool, row.id, req.user.id, 'substitute_coordinator_assigned', {
      until: until.toISOString(),
    });
    res.json({ delegation: serializeDelegation(updated.rows[0], { forOwner: true }) });
  } catch (err) {
    logger.error('setSubstituteCoordinator error', { message: err.message });
    res.status(500).json({ error: 'Failed to set substitute coordinator.' });
  }
};

// Item 73: the coordinator hands the role to another delegate with a
// note; item 75 is the acknowledgment below. The handoff is pending
// until the receiving delegate acknowledges it.
exports.handoffDelegation = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || String(row.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    const { toDelegationId, note } = req.body || {};
    const target = await loadDelegation(toDelegationId);
    if (!target || String(target.owner_id) !== String(row.owner_id) || target.status !== 'accepted') {
      return sendValidationError(res, { toDelegationId: 'Choose an accepted delegate in this household.' });
    }
    if (String(target.id) === String(row.id)) {
      return sendValidationError(res, { toDelegationId: 'Choose a different delegate.' });
    }
    const cleanNote = note ? String(note).trim().slice(0, 1000) : '';
    await pool.query(
      `UPDATE household_delegations
          SET is_coordinator = FALSE, coordinator_until = NULL, updated_at = NOW()
        WHERE owner_id = $1`,
      [row.owner_id],
    );
    const updated = await pool.query(
      `UPDATE household_delegations
          SET is_coordinator = TRUE, coordinator_until = NULL,
              handoff_note = $2, handoff_from_delegation_id = $3,
              handoff_acknowledged_at = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [target.id, cleanNote || null, row.id],
    );
    await logActivity(pool, target.id, req.user.id, 'handoff_received', { fromDelegationId: row.id, note: cleanNote });
    await logActivity(pool, row.id, req.user.id, 'handoff_given', { toDelegationId: target.id, note: cleanNote });
    res.json({ delegation: serializeDelegation(updated.rows[0], { forOwner: true }) });
  } catch (err) {
    logger.error('handoffDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to hand off coordination.' });
  }
};

// Item 75: the receiving delegate acknowledges the handoff.
exports.acknowledgeHandoff = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || !row.delegate_user_id || String(row.delegate_user_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (!row.handoff_note && !row.handoff_from_delegation_id) {
      return sendError(res, 409, 'There is no handoff to acknowledge', 'NO_HANDOFF');
    }
    // R62/F21: an acknowledgment is recorded once; a repeat call returns
    // the existing acknowledgment instead of re-stamping the time.
    if (row.handoff_acknowledged_at) {
      return res.json({ delegation: serializeDelegation(row) });
    }
    const updated = await pool.query(
      `UPDATE household_delegations
          SET handoff_acknowledged_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id],
    );
    await logActivity(pool, row.id, req.user.id, 'handoff_acknowledged', {});
    res.json({ delegation: serializeDelegation(updated.rows[0]) });
  } catch (err) {
    logger.error('acknowledgeHandoff error', { message: err.message });
    res.status(500).json({ error: 'Failed to acknowledge handoff.' });
  }
};

// Item 55: the activity log for one delegation, readable by the owner
// and by the delegate it belongs to.
exports.getDelegationActivity = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || !canSeeDelegation(row, req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    const { rows } = await pool.query(
      `SELECT id, actor_id, action, detail, created_at
         FROM household_delegation_activity
        WHERE delegation_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [row.id],
    );
    res.json({ activity: rows });
  } catch (err) {
    logger.error('getDelegationActivity error', { message: err.message });
    res.status(500).json({ error: 'Failed to load activity.' });
  }
};

// Item 81: what this delegation is allowed to do, in plain language,
// before the delegate accepts (or at any time after).
exports.getScopePreview = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || !canSeeDelegation(row, req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    const scopes = Array.isArray(row.scopes) ? row.scopes : [];
    res.json({
      delegationId: row.id,
      status: row.status,
      scopes: scopes.map((scope) => ({ scope, grants: SCOPE_DESCRIPTIONS[scope] || '' })),
      neverGranted: [
        'Paying for anything (the owner always pays).',
        'Changing the owner account.',
        'Seeing payment details, deposits, or payouts.',
        'Acting outside the scopes above.',
      ],
    });
  } catch (err) {
    logger.error('getScopePreview error', { message: err.message });
    res.status(500).json({ error: 'Failed to load scope preview.' });
  }
};

// Item 99: the closure receipt survives revocation/expiry so both sides
// can see what the delegation covered and how it ended.
exports.getClosureReceipt = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || !canSeeDelegation(row, req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (!row.closure_receipt && row.status !== 'revoked' && row.status !== 'expired' && row.status !== 'closed') {
      return sendError(res, 409, 'This delegation has not closed', 'NOT_CLOSED');
    }
    const { rows: activity } = await pool.query(
      `SELECT action, created_at FROM household_delegation_activity
        WHERE delegation_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [row.id],
    );
    res.json({
      receipt: row.closure_receipt || {
        closedBy: null,
        closedAt: row.closed_at,
        reason: `Delegation ${row.status}`,
        scopesHeld: Array.isArray(row.scopes) ? row.scopes : [],
        wasCoordinator: Boolean(row.is_coordinator),
      },
      status: row.status,
      activity,
    });
  } catch (err) {
    logger.error('getClosureReceipt error', { message: err.message });
    res.status(500).json({ error: 'Failed to load closure receipt.' });
  }
};

// Item 100: a returning delegate gets a fresh invitation with a fresh
// token and fresh consent; the closed row is never flipped back (D-39).
exports.reinviteDelegation = async (req, res) => {
  try {
    const row = await loadDelegation(req.params.id);
    if (!row || String(row.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Delegation not found', 'DELEGATION_NOT_FOUND');
    }
    if (row.status === 'invited' || row.status === 'accepted') {
      return sendError(res, 409, `This delegation is still ${row.status}`, 'DELEGATION_LIVE');
    }
    const { scopes } = req.body || {};
    const cleanScopesList = cleanScopes(scopes);
    const finalScopes = cleanScopesList.length ? cleanScopesList
      : (Array.isArray(row.scopes) ? row.scopes : []);
    if (!finalScopes.length) {
      return sendValidationError(res, { scopes: 'Grant at least one scope.' });
    }
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + DELEGATION_TTL_MS);
    const created = await pool.query(
      `INSERT INTO household_delegations
         (owner_id, delegate_user_id, delegate_email, delegate_name, scopes,
          status, invite_token, expires_at, is_coordinator)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7, FALSE)
       RETURNING *`,
      [
        row.owner_id,
        row.delegate_user_id,
        row.delegate_email,
        row.delegate_name,
        JSON.stringify(finalScopes),
        token,
        expiresAt,
      ],
    );
    await logActivity(pool, created.rows[0].id, req.user.id, 'reinvited', { fromDelegationId: row.id });
    // Item 100 (R30/F7): the re-invited delegate is told, in-app when
    // they hold an account and by email in every case, exactly like a
    // fresh invite — a re-invite nobody hears about is a dead invite.
    if (created.rows[0].delegate_user_id) {
      await notifyHousehold({
        userId: created.rows[0].delegate_user_id,
        type: 'household_delegate_invite',
        body: 'You were invited again to help manage a household.',
        data: { delegationId: created.rows[0].id },
        actionUrl: '/household',
        idempotencyKey: `household-delegate-invite:${created.rows[0].id}`,
      });
    }
    try {
      await sendEmail({
        to: created.rows[0].delegate_email,
        subject: 'You were invited again to help manage a household on OxSteed',
        text: `You were invited again to help manage a household on OxSteed. Sign in with this email and open ${safeBaseUrl()}/household?invite=${token} to accept the invitation. The invitation expires in 90 days.`,
      });
    } catch (err) {
      logger.warn('Failed to email household re-invite', { delegationId: created.rows[0].id, error: err.message });
    }
    res.status(201).json({ delegation: serializeDelegation(created.rows[0], { forOwner: true }) });
  } catch (err) {
    logger.error('reinviteDelegation error', { message: err.message });
    res.status(500).json({ error: 'Failed to re-invite delegate.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SHARED CALENDAR + VISIT PREPARATION (61-70, 86-90, 96, 97)
// ═══════════════════════════════════════════════════════════════════════════

function serializePrepRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bookingId: row.booking_id,
    ownerId: row.owner_id,
    assignedDelegateUserId: row.assigned_delegate_user_id,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    supplies: Array.isArray(row.supplies) ? row.supplies : [],
    accessibilityNeeds: row.accessibility_needs,
    arrivalInstructions: row.arrival_instructions,
    readinessConfirmedAt: row.readiness_confirmed_at,
    readinessConfirmedBy: row.readiness_confirmed_by,
    availability: Array.isArray(row.availability) ? row.availability : [],
    summary: row.summary,
    followUp: row.follow_up || null,
    disruption: row.disruption || null,
    handoffNote: row.handoff_note,
    handoffAcknowledgedAt: row.handoff_acknowledged_at,
    reminderSentAt: row.reminder_sent_at,
    suppliesReminderSentAt: row.supplies_reminder_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Item 61: the shared appointment calendar — the owner's upcoming
// bookings with their prep state and ownership label. A delegate with
// view_calendar (or book/schedule/prepare) reads it; nobody else does.
// No payment fields are ever returned.
exports.getCalendar = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate') {
      const ok = ['view_calendar', 'book', 'schedule', 'prepare'].some((s) => hasScope(access.delegation, s));
      if (!ok) return sendError(res, 403, 'This delegation cannot view the calendar', 'SCOPE_DENIED');
    }
    const { rows } = await pool.query(
      `SELECT b.id, b.service_name, b.status, b.requested_date,
              b.requested_start_time, b.requested_end_time, b.service_location,
              b.helper_id, b.recipient_user_id, b.recipient_name,
              b.booked_by_user_id, b.customer_id,
              p.id AS prep_id, p.checklist, p.readiness_confirmed_at,
              p.assigned_delegate_user_id
         FROM booking_requests b
         LEFT JOIN household_visit_preps p ON p.booking_id = b.id
        WHERE b.customer_id = $1
          AND b.requested_date >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY b.requested_date ASC, b.requested_start_time ASC
        LIMIT 200`,
      [ownerId],
    );
    res.json({
      ownerId,
      visits: rows.map((row) => ({
        bookingId: row.id,
        serviceName: row.service_name,
        status: row.status,
        requestedDate: row.requested_date,
        requestedStartTime: row.requested_start_time,
        requestedEndTime: row.requested_end_time,
        serviceLocation: row.service_location,
        helperId: row.helper_id,
        recipientName: row.recipient_name,
        // Item 54: the visit ownership label — who the visit is for and
        // who booked it. A delegate booking always shows both.
        ownershipLabel: row.recipient_name
          ? `Visit for ${row.recipient_name}${row.booked_by_user_id && String(row.booked_by_user_id) !== String(row.customer_id) ? ' · booked by a household delegate' : ''}`
          : (row.booked_by_user_id && String(row.booked_by_user_id) !== String(row.customer_id)
            ? 'Booked by a household delegate' : null),
        bookedByDelegate: Boolean(row.booked_by_user_id && String(row.booked_by_user_id) !== String(row.customer_id)),
        prepId: row.prep_id,
        checklistDone: Array.isArray(row.checklist) ? row.checklist.filter((c) => c.done).length : 0,
        checklistTotal: Array.isArray(row.checklist) ? row.checklist.length : 0,
        readinessConfirmedAt: row.readiness_confirmed_at,
        assignedDelegateUserId: row.assigned_delegate_user_id,
      })),
    });
  } catch (err) {
    logger.error('getCalendar error', { message: err.message });
    res.status(500).json({ error: 'Failed to load calendar.' });
  }
};

// Item 62: a visit confirmation reminder to the recipient, the assigned
// delegate, and the owner — through the channel confirmations use.
exports.remindVisit = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || !delegateMayDoVisitAction(access)) return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    const prep = await ensurePrep(booking);
    // D-586: at most one visit reminder per 24 hours, and the count
    // reports only the parties actually notified (never the caller).
    if (reminderTooSoon(prep.reminder_sent_at)) {
      return res.json({ reminded: 0, tooSoon: true, reminderSentAt: prep.reminder_sent_at });
    }
    const targets = new Set();
    if (booking.recipient_user_id) targets.add(String(booking.recipient_user_id));
    if (prep.assigned_delegate_user_id) targets.add(String(prep.assigned_delegate_user_id));
    targets.add(String(booking.customer_id));
    let notified = 0;
    for (const userId of targets) {
      if (userId === String(req.user.id)) continue;
      await notifyHousehold({
        userId,
        type: 'household_visit_update',
        body: `Reminder: ${booking.service_name} on ${booking.requested_date}. Please confirm the visit.`,
        data: { bookingId: booking.id },
        actionUrl: '/household',
        idempotencyKey: `household-visit-reminder:${booking.id}:${userId}:${dayKey()}`,
      });
      notified += 1;
    }
    await pool.query(
      'UPDATE household_visit_preps SET reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
      [prep.id],
    );
    res.json({ reminded: notified, reminderSentAt: new Date().toISOString() });
  } catch (err) {
    logger.error('remindVisit error', { message: err.message });
    res.status(500).json({ error: 'Failed to send reminder.' });
  }
};

// Item 63: availability collection — the delegate (or recipient side)
// records the windows the recipient is actually free.
exports.submitAvailability = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role === 'site_contact')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    const windows = cleanAvailability(req.body && req.body.windows);
    if (!windows || !windows.length) {
      return sendValidationError(res, { windows: 'At least one availability window is required.' });
    }
    const prep = await ensurePrep(booking);
    const updated = await pool.query(
      `UPDATE household_visit_preps SET availability = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id, JSON.stringify(windows)],
    );
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('submitAvailability error', { message: err.message });
    res.status(500).json({ error: 'Failed to save availability.' });
  }
};

exports.getAvailability = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access) return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    // R63: reading availability must not create a prep row.
    const prep = await loadPrep(booking);
    res.json({ availability: prep && Array.isArray(prep.availability) ? prep.availability : [] });
  } catch (err) {
    logger.error('getAvailability error', { message: err.message });
    res.status(500).json({ error: 'Failed to load availability.' });
  }
};

// Item 65: calendar handoff — the coordinator role moves to another
// delegate and every upcoming visit prep assigned to the old coordinator
// moves with it, with a note. The new coordinator acknowledges (75).
exports.handoffCalendar = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { fromDelegationId, toDelegationId, note } = req.body || {};
    const from = await loadDelegation(fromDelegationId);
    const to = await loadDelegation(toDelegationId);
    if (!from || String(from.owner_id) !== String(ownerId)
      || !to || String(to.owner_id) !== String(ownerId) || to.status !== 'accepted') {
      return sendValidationError(res, { toDelegationId: 'Choose two delegations in this household, with an accepted recipient.' });
    }
    const cleanNote = note ? String(note).trim().slice(0, 1000) : '';
    await pool.query(
      `UPDATE household_delegations SET is_coordinator = FALSE, coordinator_until = NULL, updated_at = NOW()
        WHERE owner_id = $1`,
      [ownerId],
    );
    const updated = await pool.query(
      `UPDATE household_delegations
          SET is_coordinator = TRUE, coordinator_until = NULL,
              handoff_note = $2, handoff_from_delegation_id = $3,
              handoff_acknowledged_at = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [to.id, cleanNote || null, from.id],
    );
    let reassigned = 0;
    if (from.delegate_user_id) {
      const moved = await pool.query(
        `UPDATE household_visit_preps
            SET assigned_delegate_user_id = $2, updated_at = NOW()
          WHERE owner_id = $1 AND assigned_delegate_user_id = $3
            AND booking_id IN (SELECT id FROM booking_requests WHERE requested_date >= CURRENT_DATE)`,
        [ownerId, to.delegate_user_id, from.delegate_user_id],
      );
      reassigned = moved.rowCount;
    }
    await logActivity(pool, to.id, ownerId, 'calendar_handoff_received', { fromDelegationId: from.id, reassigned });
    await logActivity(pool, from.id, ownerId, 'calendar_handoff_given', { toDelegationId: to.id, reassigned });
    res.json({
      delegation: serializeDelegation(updated.rows[0], { forOwner: true }),
      reassignedVisits: reassigned,
    });
  } catch (err) {
    logger.error('handoffCalendar error', { message: err.message });
    res.status(500).json({ error: 'Failed to hand off calendar.' });
  }
};

// Items 66-69: the preparation checklist, supply reminders, accessibility
// needs, and provider arrival instructions for one visit.
exports.getPrep = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access) return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    // R63: reading a prep must not create one.
    const prep = await loadPrep(booking);
    res.json({ prep: prep ? serializePrepRow(prep) : null });
  } catch (err) {
    logger.error('getPrep error', { message: err.message });
    res.status(500).json({ error: 'Failed to load visit preparation.' });
  }
};

exports.updatePrep = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    if (access.role === 'delegate' && !hasScope(access.delegation, 'prepare') && !hasScope(access.delegation, 'schedule')) {
      return sendError(res, 403, 'This delegation cannot prepare visits', 'SCOPE_DENIED');
    }
    const prep = await ensurePrep(booking);
    const checklist = cleanChecklist(req.body && req.body.checklist);
    const supplies = cleanSupplies(req.body && req.body.supplies);
    const accessibilityNeeds = req.body && req.body.accessibilityNeeds !== undefined
      ? String(req.body.accessibilityNeeds).trim().slice(0, 2000) || null : undefined;
    const arrivalInstructions = req.body && req.body.arrivalInstructions !== undefined
      ? String(req.body.arrivalInstructions).trim().slice(0, 2000) || null : undefined;
    const assigned = req.body && req.body.assignedDelegateUserId !== undefined
      ? (isUuid(req.body.assignedDelegateUserId) ? req.body.assignedDelegateUserId : null) : undefined;
    // R56/F15: the assignee must be a live delegate of this household,
    // not any UUID the caller invents.
    if (assigned) {
      const delegation = await findActiveDelegation(pool, booking.customer_id, assigned);
      if (!delegation) {
        return sendError(res, 404, 'That person is not an active delegate', 'DELEGATION_NOT_FOUND');
      }
    }
    const updated = await pool.query(
      `UPDATE household_visit_preps
          SET checklist = COALESCE($2, checklist),
              supplies = COALESCE($3, supplies),
              accessibility_needs = COALESCE($4, accessibility_needs),
              arrival_instructions = COALESCE($5, arrival_instructions),
              assigned_delegate_user_id = COALESCE($6, assigned_delegate_user_id),
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        prep.id,
        checklist ? JSON.stringify(checklist) : null,
        supplies ? JSON.stringify(supplies) : null,
        accessibilityNeeds,
        arrivalInstructions,
        assigned,
      ],
    );
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('updatePrep error', { message: err.message });
    res.status(500).json({ error: 'Failed to save visit preparation.' });
  }
};

// Item 70: visit readiness confirmation — a named person confirms the
// visit is ready (checklist done, supplies in, access arranged).
exports.confirmReadiness = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    // D-579: a book-only delegate cannot confirm readiness; prepare or
    // schedule scope is required.
    if (!delegateMayDoVisitAction(access)) {
      return sendError(res, 403, 'This delegation cannot confirm readiness', 'SCOPE_DENIED');
    }
    const prep = await ensurePrep(booking);
    const updated = await pool.query(
      `UPDATE household_visit_preps
          SET readiness_confirmed_at = NOW(), readiness_confirmed_by = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id, req.user.id],
    );
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('confirmReadiness error', { message: err.message });
    res.status(500).json({ error: 'Failed to confirm readiness.' });
  }
};

// Item 67: supply reminders — nudge the assigned delegate (and owner)
// about what the visit still needs.
exports.remindSupplies = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || !delegateMayDoVisitAction(access)) return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    const prep = await ensurePrep(booking);
    const supplies = Array.isArray(prep.supplies) ? prep.supplies : [];
    if (!supplies.length) {
      return sendError(res, 409, 'No supplies are listed for this visit', 'NO_SUPPLIES');
    }
    // D-586: at most one supplies reminder per 24 hours; the count
    // reports only the parties actually notified.
    if (reminderTooSoon(prep.supplies_reminder_sent_at)) {
      return res.json({ reminded: 0, tooSoon: true, supplies: supplies.length });
    }
    const targets = new Set([String(booking.customer_id)]);
    if (prep.assigned_delegate_user_id) targets.add(String(prep.assigned_delegate_user_id));
    let notified = 0;
    for (const userId of targets) {
      if (userId === String(req.user.id)) continue;
      await notifyHousehold({
        userId,
        type: 'household_visit_update',
        body: `Supplies needed for ${booking.service_name}: ${supplies.map((s) => s.item).join(', ')}.`,
        data: { bookingId: booking.id },
        actionUrl: '/household',
        idempotencyKey: `household-supplies:${booking.id}:${userId}:${dayKey()}`,
      });
      notified += 1;
    }
    await pool.query(
      'UPDATE household_visit_preps SET supplies_reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
      [prep.id],
    );
    res.json({ reminded: notified, supplies: supplies.length });
  } catch (err) {
    logger.error('remindSupplies error', { message: err.message });
    res.status(500).json({ error: 'Failed to send supply reminder.' });
  }
};

// Item 91: the visit summary is written to the prep and shared with the
// household as a document, so the record survives the visit.
exports.shareVisitSummary = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    // D-579: sharing a visit summary is a prepare/schedule action.
    if (!delegateMayDoVisitAction(access)) {
      return sendError(res, 403, 'This delegation cannot share visit summaries', 'SCOPE_DENIED');
    }
    const summary = req.body && req.body.summary ? String(req.body.summary).trim().slice(0, 4000) : '';
    if (!summary) return sendValidationError(res, { summary: 'A summary is required.' });
    const prep = await ensurePrep(booking);
    await pool.query(
      'UPDATE household_visit_preps SET summary = $2, updated_at = NOW() WHERE id = $1',
      [prep.id, summary],
    );
    const { rows: delegations } = await pool.query(
      `SELECT id FROM household_delegations
        WHERE owner_id = $1 AND status = 'accepted' AND expires_at > NOW()`,
      [booking.customer_id],
    );
    const sharedIds = delegations.map((d) => d.id);
    const { rows: docs } = await pool.query(
      `INSERT INTO household_documents
         (owner_id, created_by, booking_id, kind, title, body, shared_with_delegation_ids)
       VALUES ($1, $2, $3, 'visit_summary', $4, $5, $6) RETURNING *`,
      [
        booking.customer_id,
        req.user.id,
        booking.id,
        `Visit summary: ${booking.service_name}`,
        summary,
        JSON.stringify(sharedIds),
      ],
    );
    res.status(201).json({ document: serializeDocument(docs[0]) });
  } catch (err) {
    logger.error('shareVisitSummary error', { message: err.message });
    res.status(500).json({ error: 'Failed to share visit summary.' });
  }
};

// Item 86: replacement provider request — recorded on the visit with the
// reason; the owner and the helper are notified. It requests, it never
// reassigns by itself.
exports.requestReplacement = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    // D-579: requesting a replacement is a prepare/schedule action.
    if (!delegateMayDoVisitAction(access)) {
      return sendError(res, 403, 'This delegation cannot request a replacement', 'SCOPE_DENIED');
    }
    const reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 1000) : '';
    if (!reason) return sendValidationError(res, { reason: 'A reason is required.' });
    const prep = await ensurePrep(booking);
    const disruption = {
      type: 'replacement_request',
      reason,
      status: 'requested',
      requestedBy: req.user.id,
      requestedAt: new Date().toISOString(),
    };
    const updated = await pool.query(
      `UPDATE household_visit_preps SET disruption = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id, JSON.stringify(disruption)],
    );
    await notifyHousehold({
      userId: booking.customer_id,
      type: 'household_visit_update',
      body: `A replacement provider was requested for ${booking.service_name}: ${reason}`,
      data: { bookingId: booking.id },
      actionUrl: '/household',
      idempotencyKey: `household-replacement:${booking.id}:${dayKey()}`,
    });
    // Item 86 (R34/F11): the assigned helper is notified too, as the
    // comment on this endpoint always promised.
    if (booking.helper_id) {
      await notifyHousehold({
        userId: booking.helper_id,
        type: 'household_visit_update',
        body: `A replacement provider was requested for ${booking.service_name}: ${reason}`,
        data: { bookingId: booking.id },
        actionUrl: '/my-bookings',
        idempotencyKey: `household-replacement-helper:${booking.id}:${dayKey()}`,
      });
    }
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('requestReplacement error', { message: err.message });
    res.status(500).json({ error: 'Failed to request a replacement provider.' });
  }
};

// Item 87: missed visit follow-up — what happens next, recorded on the
// visit (reschedule, replacement, or a note) so a missed visit is never
// silently dropped.
exports.missedFollowup = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    // D-579: filing a missed-visit follow-up is a prepare/schedule action.
    if (!delegateMayDoVisitAction(access)) {
      return sendError(res, 403, 'This delegation cannot file a missed-visit follow-up', 'SCOPE_DENIED');
    }
    const action = req.body && req.body.action ? String(req.body.action).trim() : '';
    if (!['reschedule', 'replacement', 'note'].includes(action)) {
      return sendValidationError(res, { action: 'Action must be reschedule, replacement, or note.' });
    }
    const note = req.body && req.body.note ? String(req.body.note).trim().slice(0, 2000) : '';
    const prep = await ensurePrep(booking);
    const followUp = {
      action,
      note,
      by: req.user.id,
      at: new Date().toISOString(),
      bookingStatusAtFollowup: booking.status,
    };
    const updated = await pool.query(
      `UPDATE household_visit_preps SET follow_up = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id, JSON.stringify(followUp)],
    );
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('missedFollowup error', { message: err.message });
    res.status(500).json({ error: 'Failed to record follow-up.' });
  }
};

// Item 88: the recipient (or their delegate) marks themselves
// unavailable; the provider side is notified through the household
// channel and the visit prep carries the notice.
exports.markUnavailable = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate' && access.role !== 'recipient')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    const reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 1000) : '';
    if (!reason) return sendValidationError(res, { reason: 'A reason is required.' });
    const prep = await ensurePrep(booking);
    const disruption = {
      type: 'recipient_unavailable',
      reason,
      status: 'noted',
      notedBy: req.user.id,
      notedAt: new Date().toISOString(),
    };
    const updated = await pool.query(
      `UPDATE household_visit_preps SET disruption = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id, JSON.stringify(disruption)],
    );
    if (booking.helper_id) {
      await notifyHousehold({
        userId: booking.helper_id,
        type: 'household_visit_update',
        body: `The recipient is unavailable for ${booking.service_name} on ${booking.requested_date}: ${reason}`,
        data: { bookingId: booking.id },
        actionUrl: '/household',
        idempotencyKey: `household-unavailable:${booking.id}:${Date.now()}`,
      });
    }
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('markUnavailable error', { message: err.message });
    res.status(500).json({ error: 'Failed to record unavailability.' });
  }
};

// Item 89: emergency contact fallback — when the recipient cannot be
// reached, the household's emergency contact is the next step. The
// contact is returned (so the delegate can call) and notified when they
// hold an account; the attempt is logged on the visit.
exports.emergencyFallback = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    // D-579: triggering emergency fallback is a prepare/schedule action.
    if (!delegateMayDoVisitAction(access)) {
      return sendError(res, 403, 'This delegation cannot trigger emergency fallback', 'SCOPE_DENIED');
    }
    const { rows } = await pool.query(
      `SELECT * FROM household_contacts
        WHERE owner_id = $1 AND is_emergency = TRUE AND is_archived = FALSE
        ORDER BY created_at ASC LIMIT 1`,
      [booking.customer_id],
    );
    if (!rows.length) {
      return sendError(res, 409, 'No emergency contact is set for this household', 'NO_EMERGENCY_CONTACT');
    }
    const contact = rows[0];
    const prep = await ensurePrep(booking);
    const disruption = {
      type: 'emergency_fallback',
      contactId: contact.id,
      contactName: contact.name,
      usedBy: req.user.id,
      usedAt: new Date().toISOString(),
      status: 'contacted',
    };
    await pool.query(
      `UPDATE household_visit_preps SET disruption = $2, updated_at = NOW() WHERE id = $1`,
      [prep.id, JSON.stringify(disruption)],
    );
    let notifiedAccount = false;
    if (contact.email) {
      const account = await resolveUserByEmail(pool, contact.email);
      if (account) {
        notifiedAccount = true;
        await notifyHousehold({
          userId: account.id,
          type: 'household_visit_update',
          body: `Emergency contact for ${booking.service_name} on ${booking.requested_date}: the recipient could not be reached.`,
          data: { bookingId: booking.id },
          actionUrl: '/household',
          idempotencyKey: `household-emergency:${booking.id}:${Date.now()}`,
        });
      }
    }
    res.json({
      contact: {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        relationship: contact.relationship,
      },
      notifiedAccount,
    });
  } catch (err) {
    logger.error('emergencyFallback error', { message: err.message });
    res.status(500).json({ error: 'Failed to reach the emergency contact.' });
  }
};

// Item 90: cancellation impact preview — what cancelling this visit
// touches, before anyone cancels. Money is deliberately absent: the
// preview lists linked work (prep state, template, same-day visits,
// recurring booking), never amounts or deposit state.
exports.cancellationPreview = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access) return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    const prep = await ensurePrep(booking);
    const checklist = Array.isArray(prep.checklist) ? prep.checklist : [];
    const { rows: sameDay } = await pool.query(
      `SELECT id, service_name, requested_start_time, status FROM booking_requests
        WHERE customer_id = $1 AND requested_date = $2 AND id <> $3
          AND status IN ('pending', 'accepted', 'confirmed')
        ORDER BY requested_start_time ASC`,
      [booking.customer_id, booking.requested_date, booking.id],
    );
    const { rows: templates } = await pool.query(
      `SELECT id, name, frequency FROM household_templates
        WHERE owner_id = $1 AND is_active = TRUE
          AND service_name = $2 LIMIT 5`,
      [booking.customer_id, booking.service_name],
    );
    const { rows: recurring } = await pool.query(
      `SELECT id, frequency, status FROM recurring_bookings
        WHERE customer_id = $1 AND status = 'active' LIMIT 5`,
      [booking.customer_id],
    ).catch(() => ({ rows: [] }));
    res.json({
      bookingId: booking.id,
      serviceName: booking.service_name,
      status: booking.status,
      requestedDate: booking.requested_date,
      impacts: {
        checklistItems: checklist.length,
        checklistDone: checklist.filter((c) => c.done).length,
        readinessConfirmed: Boolean(prep.readiness_confirmed_at),
        hasSummary: Boolean(prep.summary),
        sameDayVisits: sameDay.map((v) => ({
          bookingId: v.id, serviceName: v.service_name,
          requestedStartTime: v.requested_start_time, status: v.status,
        })),
        matchingTemplates: templates.map((t) => ({ id: t.id, name: t.name, frequency: t.frequency })),
        activeRecurringBookings: recurring.length,
      },
      note: 'Cancelling follows the normal booking cancellation rules; this preview lists linked household work only.',
    });
  } catch (err) {
    logger.error('cancellationPreview error', { message: err.message });
    res.status(500).json({ error: 'Failed to preview cancellation impact.' });
  }
};

// Item 96: upcoming visit reassignment — move the prep (and its
// checklist, supplies, and readiness state) to another delegate.
exports.reassignVisits = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { bookingIds, toDelegateUserId } = req.body || {};
    if (!Array.isArray(bookingIds) || !bookingIds.length || !isUuid(toDelegateUserId)) {
      return sendValidationError(res, { bookingIds: 'Choose visits and a delegate.' });
    }
    const delegation = await findActiveDelegation(pool, ownerId, toDelegateUserId);
    if (!delegation) {
      return sendError(res, 404, 'That person is not an active delegate', 'DELEGATION_NOT_FOUND');
    }
    const moved = [];
    for (const bookingId of bookingIds.slice(0, 50)) {
      const booking = await loadBooking(bookingId);
      if (!booking || String(booking.customer_id) !== String(ownerId)) continue;
      // R59/F18: compare YYYY-MM-DD strings, never Date objects, so a
      // same-day visit is never wrongly included or excluded near
      // midnight by a local-vs-UTC midnight mismatch.
      if (dateOnly(booking.requested_date) < todayString()) continue;
      const prep = await ensurePrep(booking);
      await pool.query(
        `UPDATE household_visit_preps
            SET assigned_delegate_user_id = $2, updated_at = NOW() WHERE id = $1`,
        [prep.id, toDelegateUserId],
      );
      moved.push(bookingId);
    }
    await logActivity(pool, delegation.id, ownerId, 'visits_reassigned', { bookingIds: moved });
    res.json({ reassigned: moved });
  } catch (err) {
    logger.error('reassignVisits error', { message: err.message });
    res.status(500).json({ error: 'Failed to reassign visits.' });
  }
};

// Item 97: draft handoff — hand an unconfirmed visit prep to another
// delegate with a note; the new assignee acknowledges it.
exports.handoffPrep = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    const access = await householdBookingAccess(pool, booking, req.user.id);
    if (!access || (access.role !== 'owner' && access.role !== 'delegate')) {
      return sendError(res, 403, 'Not authorized for this visit', 'NOT_HOUSEHOLD');
    }
    const { toDelegateUserId, note } = req.body || {};
    if (!isUuid(toDelegateUserId)) {
      return sendValidationError(res, { toDelegateUserId: 'Choose a delegate.' });
    }
    const delegation = await findActiveDelegation(pool, booking.customer_id, toDelegateUserId);
    if (!delegation) {
      return sendError(res, 404, 'That person is not an active delegate', 'DELEGATION_NOT_FOUND');
    }
    const prep = await ensurePrep(booking);
    const updated = await pool.query(
      `UPDATE household_visit_preps
          SET assigned_delegate_user_id = $2, handoff_note = $3,
              handoff_acknowledged_at = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id, toDelegateUserId, note ? String(note).trim().slice(0, 1000) : null],
    );
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('handoffPrep error', { message: err.message });
    res.status(500).json({ error: 'Failed to hand off visit preparation.' });
  }
};

exports.acknowledgePrepHandoff = async (req, res) => {
  try {
    const booking = await loadBooking(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
    // R63: acknowledging a handoff must not create a prep row for a
    // booking that has none (no prep, no handoff).
    const prep = await loadPrep(booking);
    if (!prep) {
      return sendError(res, 409, 'There is no handoff to acknowledge', 'NO_HANDOFF');
    }
    if (!prep.assigned_delegate_user_id || String(prep.assigned_delegate_user_id) !== String(req.user.id)) {
      return sendError(res, 403, 'Only the assigned delegate can acknowledge', 'NOT_ASSIGNEE');
    }
    if (!prep.handoff_note) {
      return sendError(res, 409, 'There is no handoff to acknowledge', 'NO_HANDOFF');
    }
    // R62/F21: an acknowledgment is recorded once.
    if (prep.handoff_acknowledged_at) {
      return res.json({ prep: serializePrepRow(prep) });
    }
    const updated = await pool.query(
      `UPDATE household_visit_preps
          SET handoff_acknowledged_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [prep.id],
    );
    res.json({ prep: serializePrepRow(updated.rows[0]) });
  } catch (err) {
    logger.error('acknowledgePrepHandoff error', { message: err.message });
    res.status(500).json({ error: 'Failed to acknowledge handoff.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES / SPENDING / TASKS / DOCUMENTS / CONTACTS / EXPORT
// (64, 76-80, 82, 92, 93, 95, 59, 89, 98)
// ═══════════════════════════════════════════════════════════════════════════

function serializeDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    bookingId: row.booking_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    sharedWithDelegationIds: Array.isArray(row.shared_with_delegation_ids) ? row.shared_with_delegation_ids : [],
    forwardedFrom: row.forwarded_from,
    createdAt: row.created_at,
  };
}

function serializeTask(row) {
  if (!row) return null;
  // pg returns DATE columns as Date objects, not 'YYYY-MM-DD' strings.
  const due = row.due_date instanceof Date
    ? row.due_date
    : (row.due_date ? new Date(`${row.due_date}T12:00:00`) : null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = due && !Number.isNaN(due.getTime())
    ? Math.ceil((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)) : null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    kind: row.kind,
    title: row.title,
    vehicleId: row.vehicle_id,
    dueDate: row.due_date,
    daysUntilDue,
    overdue: daysUntilDue !== null && daysUntilDue < 0 && row.status === 'open',
    dueSoon: daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7 && row.status === 'open',
    recurrenceDays: row.recurrence_days,
    status: row.status,
    notes: row.notes,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    createdAt: row.created_at,
  };
}

// Item 64: recurring appointment templates — the household's standing
// rhythm (weekly, biweekly, monthly, quarterly). Prefill returns the
// booking fields so the owner or a delegate with book scope can book
// from the template through the normal booking flow.
const TEMPLATE_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly'];

exports.listTemplates = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate'
      && !['schedule', 'book', 'coordinate'].some((s) => hasScope(access.delegation, s))) {
      return sendError(res, 403, 'This delegation cannot use templates', 'SCOPE_DENIED');
    }
    const { rows } = await pool.query(
      `SELECT * FROM household_templates WHERE owner_id = $1 AND is_active = TRUE ORDER BY created_at ASC`,
      [ownerId],
    );
    res.json({ templates: rows });
  } catch (err) {
    logger.error('listTemplates error', { message: err.message });
    res.status(500).json({ error: 'Failed to list templates.' });
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const ownerId = req.body && req.body.ownerId ? String(req.body.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate'
      && !['schedule', 'book'].some((s) => hasScope(access.delegation, s))) {
      return sendError(res, 403, 'This delegation cannot create templates', 'SCOPE_DENIED');
    }
    const { name, serviceName, frequency, preferredDay, preferredTime, serviceLocation, recipientName, recipientPhone, description } = req.body || {};
    if (!name || !String(name).trim() || !serviceName || !String(serviceName).trim()) {
      return sendValidationError(res, { name: 'A template name and service are required.' });
    }
    if (frequency && !TEMPLATE_FREQUENCIES.includes(String(frequency))) {
      return sendValidationError(res, { frequency: 'Frequency must be weekly, biweekly, monthly, or quarterly.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO household_templates
         (owner_id, created_by, name, service_name, frequency, preferred_day,
          preferred_time, service_location, recipient_name, recipient_phone, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        ownerId, req.user.id,
        String(name).trim().slice(0, 120),
        String(serviceName).trim().slice(0, 200),
        frequency || 'weekly',
        preferredDay ? String(preferredDay).trim().slice(0, 20) : null,
        preferredTime ? String(preferredTime).trim().slice(0, 10) : null,
        serviceLocation ? String(serviceLocation).trim().slice(0, 500) : null,
        recipientName ? String(recipientName).trim().slice(0, 200) : null,
        recipientPhone ? String(recipientPhone).trim().slice(0, 40) : null,
        description ? String(description).trim().slice(0, 2000) : null,
      ],
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    logger.error('createTemplate error', { message: err.message });
    res.status(500).json({ error: 'Failed to create template.' });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_templates WHERE id = $1', [req.params.id]);
    const template = rows[0];
    if (!template) return sendError(res, 404, 'Template not found', 'TEMPLATE_NOT_FOUND');
    const access = await resolveHouseholdAccess(pool, template.owner_id, req.user.id, null);
    if (!access || (access.role === 'delegate'
      && !['schedule', 'book'].some((s) => hasScope(access.delegation, s)))) {
      return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    }
    const { name, serviceName, frequency, preferredDay, preferredTime, serviceLocation, recipientName, recipientPhone, description } = req.body || {};
    if (frequency && !TEMPLATE_FREQUENCIES.includes(String(frequency))) {
      return sendValidationError(res, { frequency: 'Frequency must be weekly, biweekly, monthly, or quarterly.' });
    }
    const updated = await pool.query(
      `UPDATE household_templates
          SET name = COALESCE($2, name), service_name = COALESCE($3, service_name),
              frequency = COALESCE($4, frequency), preferred_day = COALESCE($5, preferred_day),
              preferred_time = COALESCE($6, preferred_time),
              service_location = COALESCE($7, service_location),
              recipient_name = COALESCE($8, recipient_name),
              recipient_phone = COALESCE($9, recipient_phone),
              description = COALESCE($10, description), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        template.id,
        name ? String(name).trim().slice(0, 120) : null,
        serviceName ? String(serviceName).trim().slice(0, 200) : null,
        frequency || null,
        preferredDay ? String(preferredDay).trim().slice(0, 20) : null,
        preferredTime ? String(preferredTime).trim().slice(0, 10) : null,
        serviceLocation ? String(serviceLocation).trim().slice(0, 500) : null,
        recipientName ? String(recipientName).trim().slice(0, 200) : null,
        recipientPhone ? String(recipientPhone).trim().slice(0, 40) : null,
        description !== undefined ? String(description).trim().slice(0, 2000) : null,
      ],
    );
    res.json({ template: updated.rows[0] });
  } catch (err) {
    logger.error('updateTemplate error', { message: err.message });
    res.status(500).json({ error: 'Failed to update template.' });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_templates WHERE id = $1', [req.params.id]);
    const template = rows[0];
    if (!template) return sendError(res, 404, 'Template not found', 'TEMPLATE_NOT_FOUND');
    const access = await resolveHouseholdAccess(pool, template.owner_id, req.user.id, null);
    if (!access || (access.role === 'delegate'
      && !['schedule', 'book'].some((s) => hasScope(access.delegation, s)))) {
      return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    }
    await pool.query('UPDATE household_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [template.id]);
    res.json({ deleted: true });
  } catch (err) {
    logger.error('deleteTemplate error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete template.' });
  }
};

exports.prefillTemplate = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_templates WHERE id = $1', [req.params.id]);
    const template = rows[0];
    if (!template || !template.is_active) return sendError(res, 404, 'Template not found', 'TEMPLATE_NOT_FOUND');
    const access = await resolveHouseholdAccess(pool, template.owner_id, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    res.json({
      prefill: {
        serviceName: template.service_name,
        preferredDay: template.preferred_day,
        preferredTime: template.preferred_time,
        serviceLocation: template.service_location,
        recipientName: template.recipient_name,
        recipientPhone: template.recipient_phone,
        description: template.description,
        frequency: template.frequency,
        ownerId: template.owner_id,
      },
    });
  } catch (err) {
    logger.error('prefillTemplate error', { message: err.message });
    res.status(500).json({ error: 'Failed to load template.' });
  }
};

// Item 82: spending approval request — a delegate asks, the owner
// decides. D-36: the request is a record only; it never charges, never
// moves Credit, never changes a price, and the requester can never
// approve their own request.
exports.createSpendingApproval = async (req, res) => {
  try {
    const ownerId = req.body && req.body.ownerId ? String(req.body.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access || access.role !== 'delegate' || !hasScope(access.delegation, 'book')) {
      return sendError(res, 403, 'Only a delegate with booking scope can request spending approval', 'SCOPE_DENIED');
    }
    const { bookingId, amountCents, currency, reason } = req.body || {};
    const amount = parseInt(amountCents, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendValidationError(res, { amountCents: 'A positive amount in cents is required.' });
    }
    if (!reason || !String(reason).trim()) {
      return sendValidationError(res, { reason: 'A reason is required.' });
    }
    if (bookingId) {
      const booking = await loadBooking(bookingId);
      if (!booking || String(booking.customer_id) !== String(ownerId)) {
        return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO household_spending_approvals
         (owner_id, delegation_id, requested_by, booking_id, amount_cents, currency, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        ownerId, access.delegation.id, req.user.id,
        bookingId || null, amount,
        currency ? String(currency).trim().slice(0, 10).toUpperCase() : 'USD',
        String(reason).trim().slice(0, 2000),
      ],
    );
    await notifyHousehold({
      userId: ownerId,
      type: 'household_spending_request',
      body: `A delegate requested spending approval for ${(amount / 100).toFixed(2)} ${rows[0].currency}.`,
      data: { approvalId: rows[0].id },
      actionUrl: '/household',
      idempotencyKey: `household-spending:${rows[0].id}`,
    });
    res.status(201).json({ approval: rows[0] });
  } catch (err) {
    logger.error('createSpendingApproval error', { message: err.message });
    res.status(500).json({ error: 'Failed to request spending approval.' });
  }
};

exports.listSpendingApprovals = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    let rows;
    if (access.role === 'owner') {
      const result = await pool.query(
        `SELECT * FROM household_spending_approvals WHERE owner_id = $1 ORDER BY created_at DESC`,
        [ownerId],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT * FROM household_spending_approvals WHERE owner_id = $1 AND requested_by = $2 ORDER BY created_at DESC`,
        [ownerId, req.user.id],
      );
      rows = result.rows;
    }
    res.json({ approvals: rows });
  } catch (err) {
    logger.error('listSpendingApprovals error', { message: err.message });
    res.status(500).json({ error: 'Failed to list spending approvals.' });
  }
};

exports.decideSpendingApproval = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_spending_approvals WHERE id = $1', [req.params.id]);
    const approval = rows[0];
    if (!approval) return sendError(res, 404, 'Approval request not found', 'APPROVAL_NOT_FOUND');
    if (String(approval.owner_id) !== String(req.user.id)) {
      return sendError(res, 403, 'Only the owner can decide a spending request', 'NOT_OWNER');
    }
    if (approval.status !== 'pending') {
      return sendError(res, 409, `This request was already ${approval.status}`, 'ALREADY_DECIDED');
    }
    const decision = req.body && req.body.decision ? String(req.body.decision).trim().toLowerCase() : '';
    if (decision !== 'approved' && decision !== 'denied') {
      return sendValidationError(res, { decision: 'Decision must be approved or denied.' });
    }
    const updated = await pool.query(
      `UPDATE household_spending_approvals
          SET status = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [approval.id, decision, req.user.id],
    );
    if (!updated.rows.length) {
      return sendError(res, 409, `This request was already ${approval.status}`, 'ALREADY_DECIDED');
    }
    await notifyHousehold({
      userId: approval.requested_by,
      type: 'household_spending_request',
      body: `Your spending request was ${decision}.`,
      data: { approvalId: approval.id },
      actionUrl: '/household',
      idempotencyKey: `household-spending-decided:${approval.id}`,
    });
    res.json({ approval: updated.rows[0] });
  } catch (err) {
    logger.error('decideSpendingApproval error', { message: err.message });
    res.status(500).json({ error: 'Failed to decide spending request.' });
  }
};

// Items 76-78: maintenance plans — vehicle, household, and personal care
// plans live in one table so the household sees them together. The Group 1
// vehicle reminders (item 27) and home tasks (item 26) stay the owner's
// own records; these plans are the household-shared layer on top.
const TASK_KINDS = ['vehicle', 'household', 'personal_care'];

exports.listTasks = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate' && !hasScope(access.delegation, 'manage_tasks')) {
      return sendError(res, 403, 'This delegation cannot view maintenance plans', 'SCOPE_DENIED');
    }
    const kind = req.query.kind ? String(req.query.kind) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const conditions = ['owner_id = $1'];
    const params = [ownerId];
    if (kind && TASK_KINDS.includes(kind)) {
      params.push(kind);
      conditions.push(`kind = $${params.length}`);
    }
    if (status && ['open', 'done'].includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT * FROM household_tasks WHERE ${conditions.join(' AND ')}
        ORDER BY due_date ASC NULLS LAST, created_at ASC LIMIT 200`,
      params,
    );
    res.json({ tasks: rows.map(serializeTask) });
  } catch (err) {
    logger.error('listTasks error', { message: err.message });
    res.status(500).json({ error: 'Failed to list maintenance plans.' });
  }
};

exports.createTask = async (req, res) => {
  try {
    const ownerId = req.body && req.body.ownerId ? String(req.body.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate' && !hasScope(access.delegation, 'manage_tasks')) {
      return sendError(res, 403, 'This delegation cannot manage maintenance plans', 'SCOPE_DENIED');
    }
    const { kind, title, vehicleId, dueDate, recurrenceDays, notes } = req.body || {};
    if (!kind || !TASK_KINDS.includes(String(kind))) {
      return sendValidationError(res, { kind: 'Kind must be vehicle, household, or personal_care.' });
    }
    if (!title || !String(title).trim()) {
      return sendValidationError(res, { title: 'A title is required.' });
    }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate))) {
      return sendValidationError(res, { dueDate: 'Due date must be YYYY-MM-DD.' });
    }
    const recurrence = recurrenceDays === undefined || recurrenceDays === null
      ? null : parseInt(recurrenceDays, 10);
    if (recurrence !== null && (!Number.isFinite(recurrence) || recurrence <= 0)) {
      return sendValidationError(res, { recurrenceDays: 'Recurrence must be a positive number of days.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO household_tasks
         (owner_id, created_by, kind, title, vehicle_id, due_date, recurrence_days, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        ownerId, req.user.id, kind,
        String(title).trim().slice(0, 200),
        vehicleId && isUuid(vehicleId) ? vehicleId : null,
        dueDate || null, recurrence,
        notes ? String(notes).trim().slice(0, 2000) : null,
      ],
    );
    res.status(201).json({ task: serializeTask(rows[0]) });
  } catch (err) {
    logger.error('createTask error', { message: err.message });
    res.status(500).json({ error: 'Failed to create maintenance plan.' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_tasks WHERE id = $1', [req.params.id]);
    const task = rows[0];
    if (!task) return sendError(res, 404, 'Task not found', 'TASK_NOT_FOUND');
    const access = await resolveHouseholdAccess(pool, task.owner_id, req.user.id, null);
    if (!access || (access.role === 'delegate' && !hasScope(access.delegation, 'manage_tasks'))) {
      return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    }
    const { title, dueDate, recurrenceDays, notes } = req.body || {};
    const updated = await pool.query(
      `UPDATE household_tasks
          SET title = COALESCE($2, title), due_date = COALESCE($3, due_date),
              recurrence_days = COALESCE($4, recurrence_days),
              notes = COALESCE($5, notes), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        task.id,
        title ? String(title).trim().slice(0, 200) : null,
        dueDate || null,
        recurrenceDays === undefined ? null : parseInt(recurrenceDays, 10) || null,
        notes !== undefined ? String(notes).trim().slice(0, 2000) : null,
      ],
    );
    res.json({ task: serializeTask(updated.rows[0]) });
  } catch (err) {
    logger.error('updateTask error', { message: err.message });
    res.status(500).json({ error: 'Failed to update maintenance plan.' });
  }
};

// Completing a recurring plan closes this occurrence and opens the next
// one, so the history (80) keeps every completed occurrence.
exports.completeTask = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_tasks WHERE id = $1', [req.params.id]);
    const task = rows[0];
    if (!task) return sendError(res, 404, 'Task not found', 'TASK_NOT_FOUND');
    const access = await resolveHouseholdAccess(pool, task.owner_id, req.user.id, null);
    if (!access || (access.role === 'delegate' && !hasScope(access.delegation, 'manage_tasks'))) {
      return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    }
    if (task.status === 'done') {
      return sendError(res, 409, 'This task is already done', 'ALREADY_DONE');
    }
    const updated = await pool.query(
      `UPDATE household_tasks
          SET status = 'done', completed_at = NOW(), completed_by = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [task.id, req.user.id],
    );
    let nextTask = null;
    if (task.recurrence_days && task.due_date) {
      // pg returns DATE as a Date at midnight UTC; advance in UTC so the
      // next occurrence lands on the same calendar date.
      const base = task.due_date instanceof Date
        ? task.due_date
        : new Date(`${task.due_date}T12:00:00Z`);
      const nextDue = new Date(base.getTime() + task.recurrence_days * 24 * 60 * 60 * 1000);
      const created = await pool.query(
        `INSERT INTO household_tasks
           (owner_id, created_by, kind, title, vehicle_id, due_date, recurrence_days, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          task.owner_id, req.user.id, task.kind, task.title, task.vehicle_id,
          nextDue.toISOString().slice(0, 10), task.recurrence_days, task.notes,
        ],
      );
      nextTask = serializeTask(created.rows[0]);
    }
    res.json({ task: serializeTask(updated.rows[0]), nextTask });
  } catch (err) {
    logger.error('completeTask error', { message: err.message });
    res.status(500).json({ error: 'Failed to complete task.' });
  }
};

// Item 79: due-task triage — overdue first, then due within 7 days, then
// the rest, with counts so the household sees what needs attention now.
exports.triageTasks = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    // R6/F3 (D-38): triage is a maintenance-plan read; a calendar-only
    // delegate reads no tasks at all.
    if (access.role === 'delegate' && !hasScope(access.delegation, 'manage_tasks')) {
      return sendError(res, 403, 'This delegation cannot view maintenance plans', 'SCOPE_DENIED');
    }
    const { rows } = await pool.query(
      `SELECT * FROM household_tasks WHERE owner_id = $1 AND status = 'open'
        ORDER BY due_date ASC NULLS LAST`,
      [ownerId],
    );
    const tasks = rows.map(serializeTask);
    res.json({
      overdue: tasks.filter((t) => t.overdue),
      dueSoon: tasks.filter((t) => t.dueSoon),
      upcoming: tasks.filter((t) => !t.overdue && !t.dueSoon),
      counts: {
        overdue: tasks.filter((t) => t.overdue).length,
        dueSoon: tasks.filter((t) => t.dueSoon).length,
        upcoming: tasks.filter((t) => !t.overdue && !t.dueSoon).length,
      },
    });
  } catch (err) {
    logger.error('triageTasks error', { message: err.message });
    res.status(500).json({ error: 'Failed to triage tasks.' });
  }
};

// Item 80: maintenance history — every completed plan, newest first.
exports.taskHistory = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    // R6/F3 (D-38): task history is a maintenance-plan read; a
    // calendar-only delegate reads no tasks at all.
    if (access.role === 'delegate' && !hasScope(access.delegation, 'manage_tasks')) {
      return sendError(res, 403, 'This delegation cannot view maintenance plans', 'SCOPE_DENIED');
    }
    const { rows } = await pool.query(
      `SELECT * FROM household_tasks WHERE owner_id = $1 AND status = 'done'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 200`,
      [ownerId],
    );
    res.json({ history: rows.map(serializeTask) });
  } catch (err) {
    logger.error('taskHistory error', { message: err.message });
    res.status(500).json({ error: 'Failed to load maintenance history.' });
  }
};

// Item 92: the recipient-owned document vault — documents the owner
// creates and shares with named delegations. A delegate reads only the
// documents shared with their delegation (or that they created).
exports.listDocuments = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) {
      // D-584: a recipient or site contact is not a household member, but
      // they own the visit: they read the documents linked to a booking
      // owned by the queried household where they are the recipient or
      // site contact, and nothing else.
      const { rows: linked } = await pool.query(
        `SELECT d.* FROM household_documents d
          WHERE d.booking_id IN (
            SELECT id FROM booking_requests
             WHERE customer_id = $2
               AND (recipient_user_id = $1 OR site_contact_user_id = $1)
          )
            AND d.kind IN ('visit_summary', 'receipt')
          ORDER BY d.created_at DESC`,
        [req.user.id, ownerId],
      );
      if (!linked.length) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
      return res.json({ documents: linked.map(serializeDocument) });
    }
    let rows;
    if (access.role === 'owner') {
      const result = await pool.query(
        `SELECT * FROM household_documents WHERE owner_id = $1 ORDER BY created_at DESC`,
        [ownerId],
      );
      rows = result.rows;
    } else {
      if (!hasScope(access.delegation, 'view_records')) {
        return sendError(res, 403, 'This delegation cannot read household documents', 'SCOPE_DENIED');
      }
      const result = await pool.query(
        `SELECT * FROM household_documents
          WHERE owner_id = $1
            AND (created_by = $2 OR shared_with_delegation_ids @> $3::jsonb)
          ORDER BY created_at DESC`,
        [ownerId, req.user.id, JSON.stringify([access.delegation.id])],
      );
      rows = result.rows;
    }
    res.json({ documents: rows.map(serializeDocument) });
  } catch (err) {
    logger.error('listDocuments error', { message: err.message });
    res.status(500).json({ error: 'Failed to list documents.' });
  }
};

exports.createDocument = async (req, res) => {
  try {
    const ownerId = req.body && req.body.ownerId ? String(req.body.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate' && !hasScope(access.delegation, 'view_records')) {
      return sendError(res, 403, 'This delegation cannot add documents', 'SCOPE_DENIED');
    }
    const { kind, title, body, bookingId, sharedWithDelegationIds } = req.body || {};
    if (!['visit_summary', 'receipt', 'document'].includes(String(kind))) {
      return sendValidationError(res, { kind: 'Kind must be visit_summary, receipt, or document.' });
    }
    if (!title || !String(title).trim()) {
      return sendValidationError(res, { title: 'A title is required.' });
    }
    let sharedIds = [];
    if (Array.isArray(sharedWithDelegationIds)) {
      const { rows } = await pool.query(
        `SELECT id FROM household_delegations
          WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND status = 'accepted'`,
        [ownerId, sharedWithDelegationIds.filter(isUuid)],
      );
      sharedIds = rows.map((r) => r.id);
    }
    if (bookingId) {
      const booking = await loadBooking(bookingId);
      if (!booking || String(booking.customer_id) !== String(ownerId)) {
        return sendError(res, 404, 'Booking not found', 'BOOKING_NOT_FOUND');
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO household_documents
         (owner_id, created_by, booking_id, kind, title, body, shared_with_delegation_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        ownerId, req.user.id, bookingId || null, kind,
        String(title).trim().slice(0, 200),
        body ? String(body).trim().slice(0, 10000) : null,
        JSON.stringify(sharedIds),
      ],
    );
    res.status(201).json({ document: serializeDocument(rows[0]) });
  } catch (err) {
    logger.error('createDocument error', { message: err.message });
    res.status(500).json({ error: 'Failed to create document.' });
  }
};

// Item 93: delegated receipt forwarding — a receipt shared onward to
// named delegations (and, when they hold accounts, notified).
exports.forwardDocument = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_documents WHERE id = $1', [req.params.id]);
    const doc = rows[0];
    if (!doc) return sendError(res, 404, 'Document not found', 'DOCUMENT_NOT_FOUND');
    const access = await resolveHouseholdAccess(pool, doc.owner_id, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    // R6/F3 (D-38): forwarding needs view_records, and a delegate may
    // forward only a document they can already read — never one that was
    // never shared with them.
    if (access.role === 'delegate') {
      if (!hasScope(access.delegation, 'view_records')) {
        return sendError(res, 403, 'This delegation cannot forward documents', 'SCOPE_DENIED');
      }
      const canRead = String(doc.created_by) === String(req.user.id)
        || (Array.isArray(doc.shared_with_delegation_ids)
          && doc.shared_with_delegation_ids.includes(access.delegation.id));
      if (!canRead) {
        return sendError(res, 403, 'This document was not shared with you', 'SCOPE_DENIED');
      }
    }
    const { toDelegationIds } = req.body || {};
    if (!Array.isArray(toDelegationIds) || !toDelegationIds.length) {
      return sendValidationError(res, { toDelegationIds: 'Choose at least one delegation.' });
    }
    const found = await pool.query(
      `SELECT id, delegate_user_id FROM household_delegations
        WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND status = 'accepted'`,
      [doc.owner_id, toDelegationIds.filter(isUuid)],
    );
    if (!found.rows.length) {
      return sendError(res, 404, 'No live delegation matches', 'DELEGATION_NOT_FOUND');
    }
    // D-590: forwarding creates a forwarded copy (forwarded_from = the
    // original) shared with the targets; the original's sharing is
    // untouched, so forwarding never silently widens the original
    // document's audience.
    const { rows: copies } = await pool.query(
      `INSERT INTO household_documents
         (owner_id, created_by, booking_id, kind, title, body,
          shared_with_delegation_ids, forwarded_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        doc.owner_id,
        req.user.id,
        doc.booking_id,
        doc.kind,
        doc.title,
        doc.body,
        JSON.stringify(found.rows.map((r) => r.id)),
        doc.id,
      ],
    );
    const forwarded = copies[0];
    for (const row of found.rows) {
      if (row.delegate_user_id) {
        await notifyHousehold({
          userId: row.delegate_user_id,
          type: 'household_visit_update',
          body: `A household document was shared with you: ${doc.title}`,
          data: { documentId: forwarded.id },
          actionUrl: '/household',
          idempotencyKey: `household-doc-forward:${forwarded.id}:${row.id}:${dayKey()}`,
        });
      }
    }
    res.json({ document: serializeDocument(forwarded) });
  } catch (err) {
    logger.error('forwardDocument error', { message: err.message });
    res.status(500).json({ error: 'Failed to forward document.' });
  }
};

// Item 95: permission-aware history export — the caller sees only what
// their role allows. The owner sees everything; a delegate sees activity
// and visits inside their scopes and documents shared with them; payment
// internals are never in the export for anyone but the owner, and the
// owner export carries no amounts either (amounts live in the finance
// surfaces, not in household history).
exports.historyExport = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    const isOwner = access.role === 'owner';
    const scopes = access.delegation && Array.isArray(access.delegation.scopes) ? access.delegation.scopes : [];
    const canSee = (scope) => isOwner || scopes.includes(scope);
    const out = { ownerId, exportedAs: access.role, exportedAt: new Date().toISOString() };
    if (canSee('book') || canSee('schedule') || canSee('prepare') || canSee('view_calendar')) {
      const { rows: visits } = await pool.query(
        `SELECT id, service_name, status, requested_date, requested_start_time,
                requested_end_time, service_location, recipient_name
           FROM booking_requests WHERE customer_id = $1 ORDER BY requested_date DESC LIMIT 200`,
        [ownerId],
      );
      out.visits = visits;
    }
    if (canSee('coordinate') || isOwner) {
      const { rows: activity } = await pool.query(
        `SELECT a.id, a.action, a.created_at, a.delegation_id
           FROM household_delegation_activity a
           JOIN household_delegations d ON d.id = a.delegation_id
          WHERE d.owner_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
        [ownerId],
      );
      out.activity = activity;
    }
    if (canSee('view_records')) {
      const docs = await pool.query(
        isOwner
          ? `SELECT id, kind, title, created_at FROM household_documents WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 200`
          : `SELECT id, kind, title, created_at FROM household_documents
              WHERE owner_id = $1 AND (created_by = $2 OR shared_with_delegation_ids @> $3::jsonb)
              ORDER BY created_at DESC LIMIT 200`,
        isOwner ? [ownerId] : [ownerId, req.user.id, JSON.stringify([access.delegation.id])],
      );
      out.documents = docs.rows;
    }
    if (canSee('manage_tasks')) {
      const { rows: tasks } = await pool.query(
        `SELECT id, kind, title, due_date, status, completed_at
           FROM household_tasks WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [ownerId],
      );
      out.tasks = tasks;
    }
    res.json(out);
  } catch (err) {
    logger.error('historyExport error', { message: err.message });
    res.status(500).json({ error: 'Failed to export history.' });
  }
};

// Items 59/89/98: the alternate contact roster. Delegates with
// coordinate scope read it; only the owner writes it. Archiving is the
// cleanup (98): archived contacts leave the active roster but stay for
// history.
exports.listContacts = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate' && !hasScope(access.delegation, 'coordinate')
      && !hasScope(access.delegation, 'prepare')) {
      return sendError(res, 403, 'This delegation cannot view contacts', 'SCOPE_DENIED');
    }
    const includeArchived = req.query.includeArchived === 'true';
    const { rows } = await pool.query(
      `SELECT * FROM household_contacts
        WHERE owner_id = $1 ${includeArchived ? '' : 'AND is_archived = FALSE'}
        ORDER BY is_emergency DESC, created_at ASC`,
      [ownerId],
    );
    res.json({ contacts: rows });
  } catch (err) {
    logger.error('listContacts error', { message: err.message });
    res.status(500).json({ error: 'Failed to list contacts.' });
  }
};

exports.createContact = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { name, phone, email, relationship, role, isEmergency } = req.body || {};
    if (!name || !String(name).trim()) {
      return sendValidationError(res, { name: 'A name is required.' });
    }
    if (role && !['alternate', 'emergency', 'family', 'neighbor', 'other'].includes(String(role))) {
      return sendValidationError(res, { role: 'Unknown role.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return sendValidationError(res, { email: 'A valid email is required.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO household_contacts
         (owner_id, name, phone, email, relationship, role, is_emergency)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        ownerId,
        String(name).trim().slice(0, 200),
        phone ? String(phone).trim().slice(0, 40) : null,
        email ? String(email).trim().toLowerCase().slice(0, 255) : null,
        relationship ? String(relationship).trim().slice(0, 100) : null,
        role || 'alternate',
        isEmergency === true,
      ],
    );
    res.status(201).json({ contact: rows[0] });
  } catch (err) {
    logger.error('createContact error', { message: err.message });
    res.status(500).json({ error: 'Failed to create contact.' });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_contacts WHERE id = $1', [req.params.id]);
    const contact = rows[0];
    if (!contact || String(contact.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Contact not found', 'CONTACT_NOT_FOUND');
    }
    const { name, phone, email, relationship, role, isEmergency } = req.body || {};
    if (role && !['alternate', 'emergency', 'family', 'neighbor', 'other'].includes(String(role))) {
      return sendValidationError(res, { role: 'Unknown role.' });
    }
    const updated = await pool.query(
      `UPDATE household_contacts
          SET name = COALESCE($2, name), phone = COALESCE($3, phone),
              email = COALESCE($4, email), relationship = COALESCE($5, relationship),
              role = COALESCE($6, role),
              is_emergency = COALESCE($7, is_emergency), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        contact.id,
        name ? String(name).trim().slice(0, 200) : null,
        phone !== undefined ? (phone ? String(phone).trim().slice(0, 40) : null) : null,
        email !== undefined ? (email ? String(email).trim().toLowerCase().slice(0, 255) : null) : null,
        relationship !== undefined ? (relationship ? String(relationship).trim().slice(0, 100) : null) : null,
        role || null,
        isEmergency === undefined ? null : isEmergency === true,
      ],
    );
    res.json({ contact: updated.rows[0] });
  } catch (err) {
    logger.error('updateContact error', { message: err.message });
    res.status(500).json({ error: 'Failed to update contact.' });
  }
};

exports.archiveContact = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_contacts WHERE id = $1', [req.params.id]);
    const contact = rows[0];
    if (!contact || String(contact.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Contact not found', 'CONTACT_NOT_FOUND');
    }
    const updated = await pool.query(
      `UPDATE household_contacts SET is_archived = TRUE, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [contact.id],
    );
    res.json({ contact: updated.rows[0] });
  } catch (err) {
    logger.error('archiveContact error', { message: err.message });
    res.status(500).json({ error: 'Failed to archive contact.' });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM household_contacts WHERE id = $1', [req.params.id]);
    const contact = rows[0];
    if (!contact || String(contact.owner_id) !== String(req.user.id)) {
      return sendError(res, 404, 'Contact not found', 'CONTACT_NOT_FOUND');
    }
    await pool.query('DELETE FROM household_contacts WHERE id = $1', [contact.id]);
    res.json({ deleted: true });
  } catch (err) {
    logger.error('deleteContact error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete contact.' });
  }
};

// Item 56 (delegate leg): the shared household address book. The owner
// manages addresses in Settings; a delegate with manage_addresses (or
// book/schedule) reads the owner's shared, non-archived locations —
// without the owner's private notes (58, D-37).
exports.listSharedAddresses = async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : req.user.id;
    const access = await resolveHouseholdAccess(pool, ownerId, req.user.id, null);
    if (!access) return sendError(res, 403, 'Not part of this household', 'NOT_HOUSEHOLD');
    if (access.role === 'delegate'
      && !['manage_addresses', 'book', 'schedule', 'prepare'].some((s) => hasScope(access.delegation, s))) {
      return sendError(res, 403, 'This delegation cannot view household addresses', 'SCOPE_DENIED');
    }
    const { rows } = await pool.query(
      `SELECT id, label, address, entry_instructions, entry_preset, is_default, created_at
         FROM customer_saved_locations
        WHERE user_id = $1 AND shared_with_household = TRUE AND is_archived = FALSE
        ORDER BY is_default DESC, created_at ASC`,
      [ownerId],
    );
    res.json({ addresses: rows });
  } catch (err) {
    logger.error('listSharedAddresses error', { message: err.message });
    res.status(500).json({ error: 'Failed to list household addresses.' });
  }
};
