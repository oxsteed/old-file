// server/controllers/businessMembersController.js
// Manage representatives and managers for a helper's businesses.

const pool   = require('../db');
const logger = require('../utils/logger');
const { ownedBusiness, canAccessBusinessTeam } = require('../utils/businessOwnership');
const { enrichBusinessesWithRestaurantFields } = require('../utils/businessListRestaurantEnrichment');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const { applyStaffOffboarding } = require('../services/staffOffboarding');
const { canActOnRole, resolveActorRole } = require('../utils/teamRanks');
const emailUtils = require('../utils/email');

// Roles that can be assigned through the email invite flow (S-03). The
// catalog can also express owner, but ownership is never invitable.
const INVITABLE_ROLES = ['manager', 'representative', 'employee', 'support_agent'];
const PAY_RATE_PERIODS = ['hour', 'week', 'month', 'year'];
const INVITE_TTL_DAYS = 14;

/**
 * Resolve the target business for the legacy team-member routes.
 *
 * The routes run behind bizIdAccess('manager'), which attaches req.business
 * ({ id, business_name, owner_id, ... }) for owners AND active managers.
 * Fall back to the owner-only lookup when the controller is invoked without
 * the middleware (e.g. unit tests). Returns null when the caller may not
 * manage this business's team.
 *
 * Also resolves the caller's own role on the business (actor_role) for the
 * S-09 rank guardrails: owners outrank everyone; managers may only act on
 * roles below their own.
 */
async function managedBusiness(req) {
  const paramId = String(req.params.id || '');
  if (req.business && String(req.business.id) === paramId) {
    const ownerId = req.business.owner_id || req.user.id;
    return {
      id: req.business.id,
      business_name: req.business.business_name,
      owner_id: ownerId,
      actor_role: resolveActorRole(req, ownerId),
    };
  }
  const biz = await ownedBusiness(req.user.id, req.params.id);
  if (!biz) return null;
  return { id: biz.id, business_name: biz.business_name, owner_id: req.user.id, actor_role: 'owner' };
}

// Notifications DDL (migration 001): the columns are `body` and `data`.
// The old `message`/`metadata` insert threw on every existing-user invite
// (S-01). Always insert through this helper, inside the caller's
// transaction, so the membership change and its notification commit or
// roll back together.
async function insertNotification(client, { userId, type, title, body, data }) {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body, JSON.stringify(data || {})]
  );
}

// ── GET /api/businesses/:id/members ──────────────────────────────────────────
// Owner lists all members (active + pending) for their business.
async function listMembers(req, res) {
  try {
    const access = await canAccessBusinessTeam(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT
         bm.id,
         bm.role,
         bm.status,
         bm.invite_email,
         bm.invited_at,
         bm.accepted_at,
         bm.job_role,
         bm.pay_rate_cents,
         bm.pay_rate_period,
         bm.expires_at,
         u.id          AS user_id,
         u.first_name,
         u.last_name,
         u.email       AS member_email,
         u.profile_photo_url
       FROM business_members bm
       LEFT JOIN users u ON u.id = bm.member_id
       WHERE bm.business_id = $1
         AND bm.owner_id    = $2
         AND bm.status != 'revoked'
       ORDER BY bm.status, bm.invited_at`,
      [access.id, access.owner_id]
    );

    return res.json({ members: rows });
  } catch (err) {
    logger.error('listMembers error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load members' });
  }
}

// ── POST /api/businesses/:id/members ─────────────────────────────────────────
// Owner or manager invites a user by email + role. Managers may only invite
// roles below their own (S-09). Job role presets and pay rate are captured
// at invite time (S-03).
async function inviteMember(req, res) {
  try {
    // Review P2-3-F02: ownedBusiness() is owner-only, so managers who passed
    // the route's bizIdAccess('manager') gate got a 404 here. Resolve via the
    // middleware-attached business instead.
    const biz = await managedBusiness(req);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { role } = req.body;
    const email = req.body.email || req.body.invite_email;
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });
    if (!INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${INVITABLE_ROLES.join(', ')}` });
    }
    // S-09: nobody may create a peer or superior through an invite. This
    // also makes changes involving a manager owner-only in practice.
    if (!canActOnRole(biz.actor_role, role)) {
      return res.status(403).json({ error: 'You can only invite members to roles below your own' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Can't invite yourself
    if (normalizedEmail === req.user.email?.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot invite yourself' });
    }

    // S-03: optional job-role preset (Cashier, Server, Cook, Shift lead).
    const jobRoleCode = req.body.job_role || req.body.jobRole || null;
    let jobRolePreset = null;
    if (jobRoleCode) {
      const { rows } = await pool.query(
        `SELECT code, name, base_role, permission_codes
           FROM team_job_roles WHERE code = $1`,
        [String(jobRoleCode)]
      );
      if (!rows.length) return res.status(400).json({ error: 'Unknown job role' });
      jobRolePreset = rows[0];
    }

    // S-03: optional pay rate captured at invite time (consumed by payroll
    // reporting; nothing here moves money).
    let payRateCents = null;
    const rawPayRate = req.body.pay_rate_cents ?? req.body.payRateCents;
    if (rawPayRate !== undefined && rawPayRate !== null && rawPayRate !== '') {
      payRateCents = Number(rawPayRate);
      if (!Number.isInteger(payRateCents) || payRateCents < 0) {
        return res.status(400).json({ error: 'Pay rate must be a non-negative amount in cents' });
      }
    }
    let payRatePeriod = null;
    const rawPeriod = req.body.pay_rate_period || req.body.payRatePeriod || null;
    if (rawPeriod) {
      if (!PAY_RATE_PERIODS.includes(rawPeriod)) {
        return res.status(400).json({ error: `Pay rate period must be one of: ${PAY_RATE_PERIODS.join(', ')}` });
      }
      payRatePeriod = rawPeriod;
    }
    if (payRateCents !== null && !payRatePeriod) payRatePeriod = 'hour';

    const { record, invitee } = await withTransaction(pool, async (client) => {
      // Look up the invitee
      const userRes = await client.query(
        `SELECT id, first_name, last_name, email
           FROM users WHERE LOWER(email) = $1 AND is_active = TRUE`,
        [normalizedEmail]
      );
      const found = userRes.rows[0] || null;

      // Insert - partial unique index prevents duplicate pending invites.
      // owner_id is the BUSINESS owner's id (not the inviter's): listMembers
      // and the invite lifecycle scope rows by the business owner.
      // S-10: the invite expires after INVITE_TTL_DAYS unless accepted.
      const { rows: [created] } = await client.query(
        `INSERT INTO business_members
           (business_id, owner_id, member_id, role, invite_email, status,
            job_role, pay_rate_cents, pay_rate_period, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, NOW() + INTERVAL '${INVITE_TTL_DAYS} days')
         RETURNING *`,
        [biz.id, biz.owner_id, found?.id || null, role, normalizedEmail,
         jobRolePreset ? jobRolePreset.code : null, payRateCents, payRatePeriod]
      );

      // S-03: a job-role preset applies its permission codes as allow
      // overrides on the new membership, on top of the base role defaults.
      if (jobRolePreset && Array.isArray(jobRolePreset.permission_codes) && jobRolePreset.permission_codes.length) {
        await client.query(
          `INSERT INTO membership_permission_overrides
             (membership_id, permission_id, effect, granted_by_user_id)
           SELECT $1, p.id, 'allow', $2
             FROM team_permissions p
            WHERE p.code = ANY($3)
           ON CONFLICT (membership_id, permission_id) DO NOTHING`,
          [created.id, req.user.id, jobRolePreset.permission_codes]
        );
      }

      // Send an in-app notification if the invitee already has an account.
      // S-01: same transaction as the invite insert, correct columns — a
      // notification failure can no longer strand a pending invite behind
      // a 500 the owner cannot retry.
      if (found) {
        await insertNotification(client, {
          userId: found.id,
          type: 'business_invite',
          title: `Business invitation from ${req.user.first_name || 'someone'}`,
          body: `You have been invited to join "${biz.business_name}" as a ${role}.`,
          data: { invite_id: created.id, business_id: biz.id, business_name: biz.business_name, role, job_role: created.job_role },
        });
      }
      // S-16: the invite itself is an auditable team event (the Team
      // activity view reads business_audit_log).
      await logBusinessAction(req, {
        action: 'business.member.invited',
        target_type: 'business_member',
        target_id: created.id,
        after_state: { status: 'pending', role, invite_email: normalizedEmail },
        metadata: { job_role: created.job_role, user_found: !!found },
        business_id: biz.id,
        actor_role: biz.actor_role,
        client,
      });
      return { record: created, invitee: found };
    });

    if (!invitee) {
      // Review P2-3-F11: invites to an email with no OxSteed account were
      // silent. Email the invitation so the recipient can sign up and accept.
      // Fire-and-forget: a provider failure must not fail the invite itself.
      // (Lazy require: the email util is mocked without this export in some
      // test setups, and destructuring at load time would freeze undefined.)
      emailUtils.sendBusinessInviteEmail(normalizedEmail, {
        businessName: biz.business_name,
        inviterName: req.user.first_name,
        role,
        language: req.user.preferred_language,
        inviteId: record.id,
        jobRole: jobRolePreset ? jobRolePreset.name : null,
      }).catch((err) => logger.warn('inviteMember email failed', {
        err: err?.message, inviteId: record.id, email: normalizedEmail,
      }));
    }

    return res.status(201).json({ member: record, user_found: !!invitee });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An invite for this email is already pending' });
    }
    logger.error('inviteMember error', { err: err.message });
    return res.status(500).json({ error: 'Failed to send invite' });
  }
}

// ── DELETE /api/businesses/:id/members/:memberId ──────────────────────────────
// Owner or manager revokes a member's access (sets status = 'revoked').
// Cancelling a pending invite goes through here too (S-10): it must not
// depend on the Vortex-gated deny endpoint.
async function revokeMember(req, res) {
  try {
    // Review P2-3-F02: see inviteMember — managers passed the route gate but
    // 404'd on the owner-only lookup.
    const biz = await managedBusiness(req);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    // Fetch member info before revoking so we can notify them and run the
    // offboarding side effects for active members.
    const memberRes = await pool.query(
      `SELECT member_id, role, status FROM business_members
       WHERE id = $1 AND business_id = $2 AND owner_id = $3 AND status != 'revoked'`,
      [req.params.memberId, biz.id, biz.owner_id]
    );

    if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = memberRes.rows[0];

    // S-09: removing or cancelling still respects rank — a manager cannot
    // revoke a peer manager's membership or invite.
    if (!canActOnRole(biz.actor_role, member.role)) {
      return res.status(403).json({ error: 'You can only manage members with roles below your own' });
    }

    const outcome = await withTransaction(pool, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE business_members
         SET status = 'revoked'
         WHERE id          = $1
           AND business_id = $2
           AND owner_id    = $3
           AND status != 'revoked'`,
        [req.params.memberId, biz.id, biz.owner_id]
      );
      if (!rowCount) return null;

      // S-11: an active member losing access also loses their restaurant
      // PINs, and any cash drawer they left open is flagged for a manager
      // close — atomically with the revoke.
      let offboarding = { pinsDeactivated: 0, drawersFlagged: 0 };
      if (member.member_id && member.status === 'active') {
        offboarding = await applyStaffOffboarding(client, {
          businessId: biz.id,
          userId: member.member_id,
          reason: 'Membership revoked',
        });
      }

      // Notify the revoked user (S-01: body/data columns, same transaction)
      if (member.member_id) {
        await insertNotification(client, {
          userId: member.member_id,
          type: 'rep_revoked',
          title: `Removed from "${biz.business_name}"`,
          body: `You have been removed as a ${member.role} from "${biz.business_name}".`,
          data: { business_id: biz.id, business_name: biz.business_name, role: member.role },
        });
      }

      await logBusinessAction(req, {
        action: 'business.member.revoked',
        target_type: 'business_member',
        target_id: req.params.memberId,
        before_state: { status: member.status, role: member.role },
        after_state: { status: 'revoked' },
        metadata: { offboarding },
        business_id: biz.id,
        actor_role: biz.actor_role,
        client,
      });
      return offboarding;
    });

    if (!outcome) return res.status(404).json({ error: 'Member not found' });

    return res.json({ ok: true, offboarding: outcome });
  } catch (err) {
    logger.error('revokeMember error', { err: err.message });
    return res.status(500).json({ error: 'Failed to revoke member' });
  }
}

// ── POST /api/businesses/:id/members/:memberId/resend ─────────────────────────
// Re-send a pending invite and restart its expiry window (S-10).
async function resendMemberInvite(req, res) {
  try {
    const biz = await managedBusiness(req);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const memberRes = await pool.query(
      `SELECT id, member_id, role, status, invite_email FROM business_members
       WHERE id = $1 AND business_id = $2 AND owner_id = $3`,
      [req.params.memberId, biz.id, biz.owner_id]
    );
    if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = memberRes.rows[0];
    if (member.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending invites can be resent' });
    }
    if (!canActOnRole(biz.actor_role, member.role)) {
      return res.status(403).json({ error: 'You can only manage members with roles below your own' });
    }

    const updated = await withTransaction(pool, async (client) => {
      const { rows: [row] } = await client.query(
        `UPDATE business_members
            SET invited_at = NOW(),
                expires_at = NOW() + INTERVAL '${INVITE_TTL_DAYS} days'
          WHERE id = $1 AND status = 'pending'
          RETURNING *`,
        [member.id]
      );
      if (!row) return null;
      if (member.member_id) {
        await insertNotification(client, {
          userId: member.member_id,
          type: 'business_invite',
          title: `Business invitation from ${req.user.first_name || 'someone'}`,
          body: `Your invitation to join "${biz.business_name}" as a ${member.role} has been resent.`,
          data: { invite_id: row.id, business_id: biz.id, business_name: biz.business_name, role: member.role, job_role: row.job_role, resent: true },
        });
      }
      return row;
    });

    if (!updated) return res.status(409).json({ error: 'Only pending invites can be resent' });

    if (!member.member_id) {
      emailUtils.sendBusinessInviteEmail(member.invite_email, {
        businessName: biz.business_name,
        inviterName: req.user.first_name,
        role: member.role,
        language: req.user.preferred_language,
        inviteId: updated.id,
      }).catch((err) => logger.warn('resendMemberInvite email failed', {
        err: err?.message, inviteId: updated.id, email: member.invite_email,
      }));
    }

    return res.json({ member: updated });
  } catch (err) {
    logger.error('resendMemberInvite error', { err: err.message });
    return res.status(500).json({ error: 'Failed to resend invite' });
  }
}

// ── POST /api/businesses/:id/members/:memberId/expire ─────────────────────────
// S-10: manually expire a pending invite right now (no waiting for the
// nightly sweep). The invite becomes inert: it can no longer be accepted
// and drops out of the invitee's pending list. A resend restarts it.
async function expireMemberInvite(req, res) {
  try {
    const biz = await managedBusiness(req);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const memberRes = await pool.query(
      `SELECT id, member_id, role, status, invite_email FROM business_members
       WHERE id = $1 AND business_id = $2 AND owner_id = $3`,
      [req.params.memberId, biz.id, biz.owner_id]
    );
    if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = memberRes.rows[0];
    if (member.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending invites can be expired' });
    }
    if (!canActOnRole(biz.actor_role, member.role)) {
      return res.status(403).json({ error: 'You can only manage members with roles below your own' });
    }

    const updated = await withTransaction(pool, async (client) => {
      const { rows: [row] } = await client.query(
        `UPDATE business_members
            SET status = 'expired', expires_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING *`,
        [member.id]
      );
      if (!row) return null;
      if (member.member_id) {
        await insertNotification(client, {
          userId: member.member_id,
          type: 'business_invite_expired',
          title: `Invitation to "${biz.business_name}" expired`,
          body: `Your invitation to join "${biz.business_name}" as a ${member.role} was withdrawn before you accepted it.`,
          data: { invite_id: row.id, business_id: biz.id, business_name: biz.business_name, role: member.role },
        });
      }
      await logBusinessAction(req, {
        action: 'business.member.invite_expired',
        target_type: 'business_member',
        target_id: row.id,
        before_state: { status: 'pending' },
        after_state: { status: 'expired' },
        business_id: biz.id,
        actor_role: biz.actor_role,
        client,
      });
      return row;
    });

    if (!updated) return res.status(409).json({ error: 'Only pending invites can be expired' });
    return res.json({ member: updated });
  } catch (err) {
    logger.error('expireMemberInvite error', { err: err.message });
    return res.status(500).json({ error: 'Failed to expire invite' });
  }
}

// ── GET /api/businesses/:id/team/job-roles ────────────────────────────────────
// Job-role presets (S-03) the invite form offers.
async function listJobRoles(req, res) {
  try {
    const biz = await managedBusiness(req);
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT code, name, description, base_role, permission_codes, sort_order
         FROM team_job_roles
        ORDER BY sort_order, code`
    );
    return res.json({ job_roles: rows });
  } catch (err) {
    logger.error('listJobRoles error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load job roles' });
  }
}

// ── GET /api/businesses/invitations ──────────────────────────────────────────
// Returns pending invitations addressed to the logged-in user.
async function listMyInvitations(req, res) {
  try {
    const normalizedEmail = req.user.email?.toLowerCase() || '';
    const { rows } = await pool.query(
      `SELECT
         bm.id,
         bm.role,
         bm.status,
         bm.invited_at,
         bm.expires_at,
         bm.job_role,
         b.id            AS business_id,
         b.business_name,
         b.description   AS business_description,
         b.logo_url,
         u.first_name    AS owner_first_name,
         u.last_name     AS owner_last_name,
         u.profile_photo_url AS owner_photo
       FROM business_members bm
       JOIN businesses b ON b.id = bm.business_id
       JOIN users u      ON u.id = bm.owner_id
       WHERE (bm.member_id = $1 OR LOWER(bm.invite_email) = LOWER($2))
         AND bm.status    = 'pending'
         AND (bm.expires_at IS NULL OR bm.expires_at > NOW())
       ORDER BY bm.invited_at DESC`,
      [req.user.id, normalizedEmail]
    );

    return res.json({ invitations: rows });
  } catch (err) {
    logger.error('listMyInvitations error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load invitations' });
  }
}

// ── POST /api/businesses/invitations/:id/accept ───────────────────────────────
async function acceptInvitation(req, res) {
  try {
    const { rows: [record] } = await pool.query(
      `UPDATE business_members
       SET status      = 'active',
           member_id   = $1,
           accepted_at = NOW()
       WHERE id        = $2
         AND (member_id = $1 OR invite_email = $3)
         AND status    = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING *`,
      [req.user.id, req.params.id, req.user.email?.toLowerCase()]
    );

    if (!record) {
      // Distinguish an expired invite (S-10) from one that never existed or
      // was already handled.
      const { rows: [expired] } = await pool.query(
        `SELECT id FROM business_members
          WHERE id = $1
            AND (member_id = $2 OR invite_email = $3)
            AND status = 'pending'
            AND expires_at IS NOT NULL AND expires_at <= NOW()`,
        [req.params.id, req.user.id, req.user.email?.toLowerCase()]
      );
      if (expired) {
        return res.status(410).json({ error: 'This invitation has expired. Ask the business to send a new one.' });
      }
      return res.status(404).json({ error: 'Invitation not found or already handled' });
    }
    // S-16: accepting an invite is an auditable team event.
    await logBusinessAction(req, {
      action: 'business.member.invite_accepted',
      target_type: 'business_member',
      target_id: record.id,
      before_state: { status: 'pending' },
      after_state: { status: 'active', role: record.role },
      business_id: record.business_id,
    });
    return res.json({ ok: true, member: record });
  } catch (err) {
    logger.error('acceptInvitation error', { err: err.message });
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
}

// ── POST /api/businesses/invitations/:id/decline ──────────────────────────────
async function declineInvitation(req, res) {
  try {
    const { rows: [record] } = await pool.query(
      `UPDATE business_members
       SET status = 'revoked'
       WHERE id       = $1
         AND (member_id = $2 OR invite_email = $3)
         AND status   = 'pending'
       RETURNING id`,
      [req.params.id, req.user.id, req.user.email?.toLowerCase()]
    );

    if (!record) return res.status(404).json({ error: 'Invitation not found or already handled' });
    // S-16: declining an invite is an auditable team event. The update
    // only returns the id, so fetch the business for the audit row.
    const { rows: [declined] } = await pool.query(
      'SELECT business_id, role, invite_email FROM business_members WHERE id = $1',
      [record.id]
    );
    if (declined) {
      await logBusinessAction(req, {
        action: 'business.member.invite_declined',
        target_type: 'business_member',
        target_id: record.id,
        before_state: { status: 'pending' },
        after_state: { status: 'revoked' },
        metadata: { role: declined.role, invite_email: declined.invite_email },
        business_id: declined.business_id,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error('declineInvitation error', { err: err.message });
    return res.status(500).json({ error: 'Failed to decline invitation' });
  }
}

// ── GET /api/businesses/managed ──────────────────────────────────────────────
// Returns businesses the logged-in user is an active member of (but does NOT own).
// Used in the Business Hub so representatives see businesses they manage.
async function listManagedBusinesses(req, res) {
  try {
    // Same hardening as listBusinesses: core query never depends on food_restaurants.
    const { rows } = await pool.query(
      `SELECT
         b.id, b.business_name, b.business_type, b.description,
         b.website, b.phone, b.logo_url, b.is_active, b.is_listed,
         b.business_kind, b.business_mode, b.setup_status,
         b.currency_code, b.address_country,
         bm.role,
         bm.accepted_at,
         u.first_name AS owner_first_name,
         u.last_name  AS owner_last_name
       FROM business_members bm
       JOIN businesses b ON b.id = bm.business_id
       JOIN users u      ON u.id = bm.owner_id
       WHERE bm.member_id = $1
         AND bm.status    = 'active'
         AND b.deleted_at IS NULL
       ORDER BY bm.accepted_at DESC`,
      [req.user.id]
    );

    const businesses = await enrichBusinessesWithRestaurantFields(pool, rows, {
      logLabel: 'listManagedBusinesses',
    });
    return res.json({ businesses });
  } catch (err) {
    logger.error('listManagedBusinesses error', {
      err: err && err.message,
      code: err && err.code,
      detail: err && err.detail,
    });
    return res.status(500).json({ error: 'Failed to load managed businesses' });
  }
}

module.exports = {
  listMembers,
  inviteMember,
  revokeMember,
  resendMemberInvite,
  expireMemberInvite,
  listJobRoles,
  listMyInvitations,
  acceptInvitation,
  declineInvitation,
  listManagedBusinesses,
};
