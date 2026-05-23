const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const logger = require('../utils/logger');
const { generateTokens } = require('../middleware/auth');
const { formatAuthUser } = require('./authController');
const rateLimit = require('../services/accessGateRateLimitService');
const {
  LOGISTICS_INTERNAL_ROUTE_COLUMNS,
  normalizeInternalAccessRoute,
  canUseInternalAccessRoute,
  canHoldAnyInternalAccess,
} = require('../utils/internalWorkspaces');

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const INTERNAL_ACCESS_USER_ROLES = Object.freeze(['employee', 'admin', 'super_admin']);

function normalizeInternalName(value) {
  return String(value || '').trim();
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const safeLocal = local.length <= 2
    ? `${local[0] || ''}*`
    : `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}`;
  return `${safeLocal}@${domain}`;
}

async function loadAccessRecordByName(internalName) {
  const sql = `
    SELECT
      liac.*,
      u.id AS linked_user_id,
      u.email,
      u.role,
      u.logistics_role,
      u.is_active AS user_is_active
    FROM logistics_internal_access_credentials liac
    JOIN users u ON u.id = liac.user_id
    WHERE LOWER(liac.internal_name) = LOWER($1)
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [internalName]);
  return rows[0] || null;
}

async function loadAccessRecordByUserId(userId) {
  const sql = `
    SELECT
      liac.id,
      liac.user_id,
      liac.internal_name,
      liac.security_key_hash,
      liac.operations_enabled,
      liac.compliance_enabled,
      liac.admin_portal_enabled,
      liac.is_active,
      liac.updated_at,
      u.email
    FROM logistics_internal_access_credentials liac
    JOIN users u ON u.id = liac.user_id
    WHERE liac.user_id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [userId]);
  return rows[0] || null;
}

async function loadInternalAccessUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, email, role, logistics_role, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function saveAccessRecord({
  actorUserId,
  targetUserId,
  internalName,
  securityKey,
  operationsEnabled,
  complianceEnabled,
  adminPortalEnabled,
  isActive,
}) {
  const targetUser = await loadInternalAccessUser(targetUserId);
  if (
    !targetUser
    || !INTERNAL_ACCESS_USER_ROLES.includes(targetUser.role)
    || !(await canHoldAnyInternalAccess(targetUser))
  ) {
    return { error: { status: 404, message: 'Eligible internal staff account not found.' } };
  }
  if (!targetUser.is_active) {
    return { error: { status: 400, message: 'The linked internal staff account is inactive.' } };
  }

  const normalizedName = normalizeInternalName(internalName);
  const normalizedSecurityKey = String(securityKey || '');
  if (!normalizedName || normalizedName.length < 3) {
    return { error: { status: 400, message: 'Internal name must be at least 3 characters.' } };
  }

  const existing = await loadAccessRecordByUserId(targetUserId);
  if (!existing && normalizedSecurityKey.trim().length < 8) {
    return { error: { status: 400, message: 'Security key must be at least 8 characters when creating access.' } };
  }
  if (normalizedSecurityKey && normalizedSecurityKey.trim().length > 0 && normalizedSecurityKey.trim().length < 8) {
    return { error: { status: 400, message: 'Security key must be at least 8 characters.' } };
  }

  const duplicate = await pool.query(
    `SELECT id, user_id
     FROM logistics_internal_access_credentials
     WHERE LOWER(internal_name) = LOWER($1)
       AND user_id <> $2
     LIMIT 1`,
    [normalizedName, targetUserId]
  );
  if (duplicate.rows.length > 0) {
    return { error: { status: 409, message: 'That internal name is already in use.' } };
  }

  const hash = normalizedSecurityKey.trim().length > 0
    ? await bcrypt.hash(normalizedSecurityKey.trim(), SALT_ROUNDS)
    : existing?.security_key_hash || null;
  if (!hash) {
    return { error: { status: 400, message: 'Security key is required.' } };
  }

  const normalizedOperationsEnabled = !!operationsEnabled && await canUseInternalAccessRoute(targetUser, 'operations');
  const normalizedComplianceEnabled = !!complianceEnabled && await canUseInternalAccessRoute(targetUser, 'compliance');
  const normalizedAdminPortalEnabled = !!adminPortalEnabled && ['admin', 'super_admin'].includes(targetUser.role);

  const sql = existing
    ? `
      UPDATE logistics_internal_access_credentials
      SET
        internal_name = $2,
        security_key_hash = $3,
        operations_enabled = $4,
        compliance_enabled = $5,
        admin_portal_enabled = $6,
        is_active = $7,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING id, user_id, internal_name, operations_enabled, compliance_enabled, admin_portal_enabled, is_active, updated_at
    `
    : `
      INSERT INTO logistics_internal_access_credentials (
        user_id, internal_name, security_key_hash, operations_enabled, compliance_enabled, admin_portal_enabled, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, internal_name, operations_enabled, compliance_enabled, admin_portal_enabled, is_active, updated_at
    `;

  const { rows } = await pool.query(sql, [
    targetUserId,
    normalizedName,
    hash,
    normalizedOperationsEnabled,
    normalizedComplianceEnabled,
    normalizedAdminPortalEnabled,
    typeof isActive === 'boolean' ? isActive : true,
  ]);

  return {
    record: {
      ...rows[0],
      email: targetUser.email,
      role: targetUser.role,
      logistics_role: targetUser.logistics_role || null,
      first_name: targetUser.first_name,
      last_name: targetUser.last_name,
      updated_by_user_id: actorUserId,
    },
  };
}

function signInternalAccessToken(payload) {
  return jwt.sign(
    { ...payload, isInternalAccessToken: true },
    JWT_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' }
  );
}

function verifyInternalAccessToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (!decoded.isInternalAccessToken) {
    throw new Error('invalid_token_type');
  }
  return decoded;
}

async function issueSessionForUser(req, user, rememberMe = false, extraClaims = {}) {
  const tokens = generateTokens(user, extraClaims);
  const hashedRefresh = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
  const sessionSql = rememberMe
    ? "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '30 days')"
    : "INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, NOW() + interval '7 days')";
  await pool.query(sessionSql, [user.id, hashedRefresh]);

  try {
    const loginIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || req.ip || null;
    const loginUa = req.headers['user-agent'] || null;
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    await pool.query(`UPDATE users SET last_login_ip = $1 WHERE id = $2`, [loginIp, user.id]).catch(() => {});
    await pool.query(
      `INSERT INTO user_login_history (user_id, ip_address, user_agent, success) VALUES ($1, $2, $3, TRUE)`,
      [user.id, loginIp, loginUa]
    ).catch(() => {});
  } catch (_) {
    // non-fatal
  }

  return tokens;
}

exports.getMyInternalAccess = async (req, res) => {
  try {
    const record = await loadAccessRecordByUserId(req.user.id);
    return res.json({
      success: true,
      record: record
        ? {
            id: record.id,
            user_id: record.user_id,
            email: record.email,
            internal_name: record.internal_name,
            operations_enabled: !!record.operations_enabled,
            compliance_enabled: !!record.compliance_enabled,
            admin_portal_enabled: !!record.admin_portal_enabled,
            is_active: !!record.is_active,
            updated_at: record.updated_at,
          }
        : null,
    });
  } catch (error) {
    logger.error('Failed to load logistics internal access record', { userId: req.user?.id, error: error.message });
    return res.status(500).json({ error: 'Failed to load internal access settings' });
  }
};

exports.upsertMyInternalAccess = async (req, res) => {
  try {
    const result = await saveAccessRecord({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      internalName: req.body.internal_name,
      securityKey: req.body.security_key,
      operationsEnabled: !!req.body.operations_enabled,
      complianceEnabled: !!req.body.compliance_enabled,
      adminPortalEnabled: !!req.body.admin_portal_enabled,
      isActive: true,
    });

    if (result.error) {
      return res.status(result.error.status).json({ error: result.error.message });
    }

    return res.json({
      success: true,
      record: result.record,
    });
  } catch (error) {
    logger.error('Failed to save logistics internal access record', { userId: req.user?.id, error: error.message });
    return res.status(500).json({ error: 'Failed to save internal access settings' });
  }
};

exports.listInternalAccessRecords = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id AS user_id,
         u.first_name,
         u.last_name,
         u.email,
         u.role,
         u.logistics_role,
         u.is_active AS user_is_active,
         liac.id,
         liac.internal_name,
         liac.operations_enabled,
         liac.compliance_enabled,
         liac.admin_portal_enabled,
         liac.is_active,
         liac.last_verified_at,
         liac.last_verified_route,
         liac.updated_at,
         COALESCE(corp.department_codes, ARRAY[]::text[]) AS department_codes,
         COALESCE(corp.department_names, ARRAY[]::text[]) AS department_names
       FROM users u
       LEFT JOIN logistics_internal_access_credentials liac ON liac.user_id = u.id
       LEFT JOIN (
         SELECT
           ca.user_id,
           ARRAY_AGG(DISTINCT d.code ORDER BY d.code) AS department_codes,
           ARRAY_AGG(DISTINCT d.name ORDER BY d.name) AS department_names
         FROM corporate_assignments ca
         JOIN corporate_departments d ON d.id = ca.department_id
         WHERE ca.is_active = TRUE
         GROUP BY ca.user_id
       ) corp ON corp.user_id = u.id
       WHERE u.role IN ('admin', 'super_admin')
          OR (
            u.role = 'employee'
            AND (
              u.logistics_role IN ('sourcing_operator', 'logistics_coordinator', 'warehouse_operator', 'compliance_reviewer')
              OR EXISTS (
                SELECT 1
                  FROM corporate_assignments ca
                 WHERE ca.user_id = u.id
                   AND ca.is_active = TRUE
              )
            )
          )
       ORDER BY
         CASE
           WHEN u.role = 'super_admin' THEN 0
           WHEN u.role = 'admin' THEN 1
           ELSE 2
         END,
         LOWER(u.first_name),
         LOWER(u.last_name),
         LOWER(u.email)`
    );

    return res.json({
      success: true,
      records: rows.map((row) => {
        const departmentCodes = Array.isArray(row.department_codes) ? row.department_codes.filter(Boolean) : [];
        const eligibleRoutes = [];
        if (row.role === 'admin' || row.role === 'super_admin') {
          eligibleRoutes.push('admin_portal');
        }
        if (['admin', 'super_admin'].includes(row.role) || ['sourcing_operator', 'logistics_coordinator', 'warehouse_operator'].includes(row.logistics_role)) {
          eligibleRoutes.push('operations');
        }
        if (['admin', 'super_admin'].includes(row.role) || row.logistics_role === 'compliance_reviewer') {
          eligibleRoutes.push('compliance');
        }
        for (const code of departmentCodes) {
          if (!eligibleRoutes.includes(code)) eligibleRoutes.push(code);
        }

        return {
          ...row,
          operations_enabled: !!row.operations_enabled,
          compliance_enabled: !!row.compliance_enabled,
          admin_portal_enabled: !!row.admin_portal_enabled,
          is_active: row.id ? !!row.is_active : false,
          has_record: !!row.id,
          logistics_role: row.logistics_role || null,
          department_codes: departmentCodes,
          department_names: Array.isArray(row.department_names) ? row.department_names.filter(Boolean) : [],
          eligible_routes: eligibleRoutes,
        };
      }),
    });
  } catch (error) {
    logger.error('Failed to list internal access records', { error: error.message });
    return res.status(500).json({ error: 'Failed to load internal access records.' });
  }
};

exports.upsertInternalAccessForUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ error: 'Valid target user is required.' });
    }

    const result = await saveAccessRecord({
      actorUserId: req.user.id,
      targetUserId,
      internalName: req.body.internal_name,
      securityKey: req.body.security_key,
      operationsEnabled: !!req.body.operations_enabled,
      complianceEnabled: !!req.body.compliance_enabled,
      adminPortalEnabled: !!req.body.admin_portal_enabled,
      isActive: typeof req.body.is_active === 'boolean' ? req.body.is_active : true,
    });

    if (result.error) {
      return res.status(result.error.status).json({ error: result.error.message });
    }

    return res.json({
      success: true,
      record: result.record,
    });
  } catch (error) {
    logger.error('Failed to upsert internal access record for user', {
      actorUserId: req.user?.id,
      targetUserId: req.params.userId,
      error: error.message,
    });
    return res.status(500).json({ error: 'Failed to save internal access settings.' });
  }
};

exports.getRouteConfig = async (req, res) => {
  try {
    const route = normalizeInternalAccessRoute(req.query.route);
    if (!route) {
      return res.status(400).json({ error: 'Valid route is required.' });
    }

    let enforced = true;
    if (route === 'admin_portal') {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM logistics_internal_access_credentials
         WHERE is_active = TRUE
           AND admin_portal_enabled = TRUE`
      );
      enforced = (rows[0]?.count || 0) > 0;
    }

    return res.json({
      success: true,
      route,
      enforced,
    });
  } catch (error) {
    logger.error('Failed to load internal access route config', { error: error.message });
    return res.status(500).json({ error: 'Failed to load route config.' });
  }
};

// Helper — pull the requesting IP + UA out of req. Mirrors issueSessionForUser
// so that audit rows line up with login_history rows.
function reqMeta(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || null;
  return { ip, userAgent };
}

exports.verifyInternalAccess = async (req, res) => {
  const { ip, userAgent } = reqMeta(req);
  const route = normalizeInternalAccessRoute(req.body.route);
  const internalName = normalizeInternalName(req.body.internal_name);
  const securityKey = String(req.body.security_key || '').trim();

  // 0. Shape check — never increment the lockout counter on a malformed
  //    request body. An attacker who sends garbage doesn't get to consume
  //    legitimate users' attempts.
  if (!route || !internalName || !securityKey) {
    return res.status(400).json({ error: 'Route, name, and security key are required.' });
  }

  try {
    // 1. Lockout check BEFORE any DB lookup. Reject early so the bcrypt cost
    //    is not paid by attackers spamming a locked (ip, name) pair.
    const gate = await rateLimit.checkLockout({ ip, claimedName: internalName });
    if (gate.locked) {
      return res.status(423).json({
        error: 'ACCOUNT_LOCKED',
        message:
          'Too many failed attempts. This name is locked from your IP. Contact a super-admin or request a recovery email.',
        lockedUntil: gate.lockedUntil,
        attemptsLeft: 0,
      });
    }

    // 2. Credential check.
    const record = await loadAccessRecordByName(internalName);
    const baseInvalid =
      !record ||
      !record.is_active ||
      !record.user_is_active ||
      !(await canUseInternalAccessRoute(record, route)) ||
      (LOGISTICS_INTERNAL_ROUTE_COLUMNS[route] ? !record[LOGISTICS_INTERNAL_ROUTE_COLUMNS[route]] : false);

    if (baseInvalid) {
      const result = await rateLimit.recordFailure({
        ip,
        claimedName: internalName,
        scope: route,
        errorCode: !record ? 'name_unknown' : 'scope_not_enabled',
        userAgent,
      });
      return res.status(401).json({
        error: 'Invalid internal access credentials.',
        attemptsLeft: result.attemptsLeft,
        lockedUntil: result.lockedUntil,
      });
    }

    const valid = await bcrypt.compare(securityKey, record.security_key_hash);
    if (!valid) {
      const result = await rateLimit.recordFailure({
        ip,
        claimedName: internalName,
        scope: route,
        errorCode: 'bad_key',
        userAgent,
      });
      return res.status(401).json({
        error: 'Invalid internal access credentials.',
        attemptsLeft: result.attemptsLeft,
        lockedUntil: result.lockedUntil,
      });
    }

    // 3. Success — clear lockout state for (ip, name) and append audit row.
    await rateLimit.recordSuccess({
      ip,
      claimedName: internalName,
      scope: route,
      matchedUserId: record.linked_user_id,
      userAgent,
    });

    await pool.query(
      `UPDATE logistics_internal_access_credentials
       SET last_verified_at = NOW(), last_verified_route = $2
       WHERE id = $1`,
      [record.id, route]
    ).catch(() => {});

    const token = signInternalAccessToken({
      internalAccessId: record.id,
      userId: record.linked_user_id,
      route,
    });

    return res.json({
      success: true,
      internalAccessToken: token,
      user: {
        id: record.linked_user_id,
        email: record.email,
        email_masked: maskEmail(record.email),
        internal_name: record.internal_name,
        role: record.role,
        logistics_role: record.logistics_role || null,
      },
    });
  } catch (error) {
    logger.error('Failed to verify logistics internal access', { error: error.message });
    return res.status(500).json({ error: 'Failed to verify internal access.' });
  }
};

exports.loginWithInternalAccess = async (req, res, next) => {
  try {
    const { internalAccessToken, password, rememberMe } = req.body;
    if (!internalAccessToken || !password) {
      return res.status(400).json({ error: 'Internal access token and password are required.' });
    }

    let decoded;
    try {
      decoded = verifyInternalAccessToken(internalAccessToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired internal access session.' });
    }

    const route = normalizeInternalAccessRoute(decoded.route);
    if (!route) {
      return res.status(401).json({ error: 'Invalid internal access session.' });
    }

    const { rows } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.email, u.phone, u.password_hash, u.role, u.is_active,
         u.email_verified, u.is_verified,
         u.onboarding_status, u.onboarding_completed,
         u.contact_completed, u.profile_completed,
         u.tier_selected, u.w9_completed, u.terms_accepted,
         u.membership_tier, u.id_verified, u.background_check_passed,
         u.city, u.state, u.zip_code, u.totp_enabled,
         u.trial_started_at, u.trial_ends_at, u.didit_status, u.didit_verified_at,
         u.default_mode, u.logistics_role,
         COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required,
         liac.id AS internal_access_id,
         liac.operations_enabled,
         liac.compliance_enabled,
         liac.admin_portal_enabled,
         liac.is_active AS internal_access_active
       FROM users u
       JOIN logistics_internal_access_credentials liac ON liac.user_id = u.id
       WHERE u.id = $1
         AND liac.id = $2
       LIMIT 1`,
      [decoded.userId, decoded.internalAccessId]
    );

    const user = rows[0];
    if (
      !user ||
      !user.is_active ||
      !user.internal_access_active ||
      !(await canUseInternalAccessRoute(user, route)) ||
      (route === 'operations' && !user.operations_enabled) ||
      (route === 'compliance' && !user.compliance_enabled) ||
      (route === 'admin_portal' && !user.admin_portal_enabled)
    ) {
      return res.status(401).json({ error: 'Internal access session is no longer valid.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password.' });
    }

    if (user.totp_enabled) {
      const mfaToken = jwt.sign(
        {
          id: user.id,
          isMfaToken: true,
          internalAccessId: decoded.internalAccessId,
          internalAccessRoute: route,
        },
        JWT_SECRET,
        { expiresIn: '15m' }
      );
      return res.status(200).json({
        requiresTwoFactor: true,
        mfaToken,
        user: {
          id: user.id,
          email: user.email,
          email_masked: maskEmail(user.email),
        },
        message: 'Please provide your 2FA code to complete login.',
      });
    }

    user.internal_access_route = route;
    const tokens = await issueSessionForUser(req, user, !!rememberMe, {
      internalAccessId: decoded.internalAccessId,
      internalAccessRoute: route,
    });
    return res.json({
      success: true,
      message: 'Login successful',
      user: formatAuthUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (error) {
    logger.error('Internal access login failed', { error: error.message });
    return next(error);
  }
};

// ─── Lockout admin (super-admin only) ───────────────────────────────────

exports.listLockouts = async (_req, res) => {
  try {
    const items = await rateLimit.listActiveLockouts({ limit: 200 });
    return res.json({ success: true, items, maxFails: rateLimit.MAX_FAILS, lockoutHours: rateLimit.LOCKOUT_HOURS });
  } catch (error) {
    logger.error('Failed to list access gate lockouts', { error: error.message });
    return res.status(500).json({ error: 'Failed to load lockouts.' });
  }
};

exports.liftLockoutById = async (req, res) => {
  try {
    const lockoutId = Number(req.params.id);
    if (!Number.isInteger(lockoutId) || lockoutId <= 0) {
      return res.status(400).json({ error: 'Invalid lockout id.' });
    }
    const reason = String(req.body?.reason || '').trim();
    const lifted = await rateLimit.liftLockout({
      lockoutId,
      byUserId: req.user.id,
      reason: reason || null,
      source: 'super_admin_ui',
    });
    if (!lifted) {
      return res.status(404).json({ error: 'Lockout not found or already lifted.' });
    }
    logger.info('Access gate lockout lifted by super-admin', {
      lockoutId,
      byUserId: req.user.id,
      ip: lifted.ip,
      normalizedName: lifted.normalizedName,
    });
    return res.json({ success: true, lifted });
  } catch (error) {
    logger.error('Failed to lift access gate lockout', { error: error.message });
    return res.status(500).json({ error: 'Failed to lift lockout.' });
  }
};

exports.listAttempts = async (req, res) => {
  try {
    const items = await rateLimit.listRecentAttempts({
      limit: req.query.limit,
      offset: req.query.offset,
      success: req.query.success === '1' ? true : req.query.success === '0' ? false : null,
      ip: req.query.ip || null,
      name: req.query.name || null,
    });
    return res.json({ success: true, items });
  } catch (error) {
    logger.error('Failed to list access gate attempts', { error: error.message });
    return res.status(500).json({ error: 'Failed to load attempts.' });
  }
};

// ─── Email recovery (public, allowlist-gated) ───────────────────────────
//
// If ACCESS_GATE_RECOVERY_EMAILS env contains the submitted email, send a
// one-time link. The link lands at /access-gate/recovery/use which POSTs to
// /api/auth/internal-access/recovery/use with the token — that endpoint
// lifts every active lockout for that user (matched by their access record)
// from any IP, and also any active lockout for the requesting IP.

const recoveryEmail = require('../utils/email');
const { v4: uuidv4 } = require('uuid');

function recoveryEmailAllowlist() {
  return String(process.env.ACCESS_GATE_RECOVERY_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function recoveryLinkBase() {
  const root = process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:5173';
  return `${root.replace(/\/$/, '')}/access-gate/recovery`;
}

exports.requestRecovery = async (req, res) => {
  try {
    const submittedEmail = String(req.body?.email || '').trim().toLowerCase();
    const claimedName = normalizeInternalName(req.body?.internal_name || '');
    const { ip, userAgent } = reqMeta(req);

    // Always return 200 to avoid leaking whether an email is on the allowlist.
    const acknowledge = () =>
      res.json({
        success: true,
        message: 'If that email is authorised for recovery, a one-time link has been sent.',
      });

    if (!submittedEmail) return acknowledge();
    const allowed = recoveryEmailAllowlist();
    if (!allowed.includes(submittedEmail)) {
      logger.warn('Access gate recovery rejected — email not on allowlist', { submittedEmail, ip });
      return acknowledge();
    }

    const id = uuidv4();
    const rawToken = `${id}.${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await pool.query(
      `INSERT INTO access_gate_recovery_tokens (
         id, token_hash, recovery_email, scope_ip, scope_normalized_name, requested_ip, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        tokenHash,
        submittedEmail,
        rateLimit.normalizeIp(ip),
        claimedName ? rateLimit.normalizeName(claimedName) : null,
        rateLimit.normalizeIp(ip),
        expiresAt,
      ]
    );

    const link = `${recoveryLinkBase()}?token=${encodeURIComponent(rawToken)}`;
    await recoveryEmail.sendEmail({
      to: submittedEmail,
      subject: 'OxSteed access gate recovery',
      text: [
        'A request was made to lift an access-gate lockout from the following IP:',
        `  IP: ${ip}`,
        `  User-Agent: ${userAgent || 'unknown'}`,
        '',
        'If this was you, click the one-time link below within 30 minutes:',
        link,
        '',
        'If this was not you, you can safely ignore this email.',
      ].join('\n'),
      html: `
        <p>A request was made to lift an access-gate lockout from the following IP:</p>
        <p><strong>IP:</strong> ${ip}<br/>
           <strong>User-Agent:</strong> ${(userAgent || 'unknown').replace(/[<>&]/g, '')}</p>
        <p>If this was you, click the one-time link below within 30 minutes:</p>
        <p><a href="${link}">${link}</a></p>
        <p>If this was not you, you can safely ignore this email.</p>
      `,
    }).catch((err) => logger.warn('Failed to send recovery email', { error: err.message }));

    logger.info('Access gate recovery link issued', { submittedEmail, ip });
    return acknowledge();
  } catch (error) {
    logger.error('Access gate recovery request failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to request recovery.' });
  }
};

exports.useRecovery = async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Recovery token is required.' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { ip } = reqMeta(req);

    // Atomic: SELECT FOR UPDATE so a token can only be consumed once even
    // under concurrent clicks.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, recovery_email, scope_ip, scope_normalized_name, expires_at, used_at
           FROM access_gate_recovery_tokens
          WHERE token_hash = $1
          LIMIT 1
          FOR UPDATE`,
        [tokenHash]
      );
      const record = rows[0];
      if (!record) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Invalid recovery token.' });
      }
      if (record.used_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Recovery token has already been used.' });
      }
      if (new Date(record.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return res.status(410).json({ error: 'Recovery token has expired.' });
      }
      await client.query(
        `UPDATE access_gate_recovery_tokens
            SET used_at = NOW(), used_ip = $2
          WHERE id = $1`,
        [record.id, rateLimit.normalizeIp(ip)]
      );
      await client.query('COMMIT');

      // Lift lockouts. If the recovery token carried a (scope_ip, scope_name)
      // pair, target that pair. Otherwise lift any lockouts originating from
      // the requesting IP for any name (acceptable since the requester proved
      // possession of an allowlisted email).
      let liftedCount = 0;
      if (record.scope_ip && record.scope_normalized_name) {
        liftedCount = await rateLimit.liftLockoutsByKey({
          ip: record.scope_ip,
          normalizedName: record.scope_normalized_name,
          reason: `recovery email ${record.recovery_email}`,
          source: 'recovery_email',
        });
      } else {
        const { rowCount } = await pool.query(
          `UPDATE access_gate_lockouts
              SET lifted_at = NOW(),
                  lift_source = 'recovery_email',
                  lift_reason = $2,
                  updated_at = NOW()
            WHERE lifted_at IS NULL
              AND ip = $1`,
          [rateLimit.normalizeIp(ip), `recovery email ${record.recovery_email}`]
        );
        liftedCount = rowCount;
      }

      logger.info('Access gate recovery token consumed', {
        recoveryEmail: record.recovery_email,
        ip,
        liftedCount,
      });

      return res.json({ success: true, liftedCount });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Access gate recovery use failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to use recovery token.' });
  }
};
