const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const logger = require('../utils/logger');
const { generateTokens } = require('../middleware/auth');
const { formatAuthUser } = require('./authController');

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const INTERNAL_ACCESS_ROUTES = Object.freeze({
  operations: 'operations_enabled',
  compliance: 'compliance_enabled',
});

function normalizeRoute(rawRoute) {
  if (!rawRoute) return null;
  const route = String(rawRoute).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(INTERNAL_ACCESS_ROUTES, route) ? route : null;
}

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

async function issueSessionForUser(req, user, rememberMe = false) {
  const tokens = generateTokens(user);
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
    const internalName = normalizeInternalName(req.body.internal_name);
    const securityKey = String(req.body.security_key || '');
    const operationsEnabled = !!req.body.operations_enabled;
    const complianceEnabled = !!req.body.compliance_enabled;

    if (!internalName || internalName.length < 3) {
      return res.status(400).json({ error: 'Internal name must be at least 3 characters.' });
    }

    const existing = await loadAccessRecordByUserId(req.user.id);
    if (!existing && securityKey.trim().length < 8) {
      return res.status(400).json({ error: 'Security key must be at least 8 characters when creating access.' });
    }
    if (securityKey && securityKey.trim().length > 0 && securityKey.trim().length < 8) {
      return res.status(400).json({ error: 'Security key must be at least 8 characters.' });
    }

    const duplicate = await pool.query(
      `SELECT id, user_id
       FROM logistics_internal_access_credentials
       WHERE LOWER(internal_name) = LOWER($1)
         AND user_id <> $2
       LIMIT 1`,
      [internalName, req.user.id]
    );
    if (duplicate.rows.length > 0) {
      return res.status(409).json({ error: 'That internal name is already in use.' });
    }

    const hash = securityKey.trim().length > 0
      ? await bcrypt.hash(securityKey.trim(), SALT_ROUNDS)
      : existing?.security_key_hash || null;

    if (!hash) {
      return res.status(400).json({ error: 'Security key is required.' });
    }

    const sql = existing
      ? `
        UPDATE logistics_internal_access_credentials
        SET
          internal_name = $2,
          security_key_hash = $3,
          operations_enabled = $4,
          compliance_enabled = $5,
          is_active = TRUE,
          updated_at = NOW()
        WHERE user_id = $1
        RETURNING id, user_id, internal_name, operations_enabled, compliance_enabled, is_active, updated_at
      `
      : `
        INSERT INTO logistics_internal_access_credentials (
          user_id, internal_name, security_key_hash, operations_enabled, compliance_enabled, is_active
        )
        VALUES ($1, $2, $3, $4, $5, TRUE)
        RETURNING id, user_id, internal_name, operations_enabled, compliance_enabled, is_active, updated_at
      `;

    const { rows } = await pool.query(sql, [
      req.user.id,
      internalName,
      hash,
      operationsEnabled,
      complianceEnabled,
    ]);

    return res.json({
      success: true,
      record: rows[0],
    });
  } catch (error) {
    logger.error('Failed to save logistics internal access record', { userId: req.user?.id, error: error.message });
    return res.status(500).json({ error: 'Failed to save internal access settings' });
  }
};

exports.verifyInternalAccess = async (req, res) => {
  try {
    const route = normalizeRoute(req.body.route);
    const internalName = normalizeInternalName(req.body.internal_name);
    const securityKey = String(req.body.security_key || '').trim();

    if (!route || !internalName || !securityKey) {
      return res.status(400).json({ error: 'Route, name, and security key are required.' });
    }

    const record = await loadAccessRecordByName(internalName);
    if (
      !record ||
      !record.is_active ||
      !record.user_is_active ||
      !['admin', 'super_admin'].includes(record.role) ||
      !record[INTERNAL_ACCESS_ROUTES[route]]
    ) {
      return res.status(401).json({ error: 'Invalid internal access credentials.' });
    }

    const valid = await bcrypt.compare(securityKey, record.security_key_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid internal access credentials.' });
    }

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

    const route = normalizeRoute(decoded.route);
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
         u.default_mode,
         COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required,
         liac.id AS internal_access_id,
         liac.operations_enabled,
         liac.compliance_enabled,
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
      !['admin', 'super_admin'].includes(user.role) ||
      (route === 'operations' && !user.operations_enabled) ||
      (route === 'compliance' && !user.compliance_enabled)
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

    const tokens = await issueSessionForUser(req, user, !!rememberMe);
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
