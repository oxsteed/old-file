'use strict';

/**
 * Super-Admin User Management Controller
 *
 * Implements full user-account create/edit endpoints used by the super-admin
 * (and regional admins, scoped to their region). Every change is recorded
 * to `admin_user_action_log` (per-field) plus the legacy `admin_audit_log`
 * (free-form) so existing dashboards keep working.
 *
 * Endpoints:
 *   POST  /admin/super/users/create-full
 *   PUT   /admin/super/users/:userId/edit-full
 *   GET   /admin/super/users/in-region
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db     = require('../db');
const logger = require('../utils/logger');
const countriesUtil = require('../utils/countries');
const {
  logAdminAction,
  logUserAction,
  markUserActionsNotified,
} = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');
const { withTransaction }  = require('../utils/transaction');
const { userMatchesAnyRegion } = require('../middleware/regionAuth');

// ── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['customer', 'helper', 'helper_pro', 'broker'];
const SENSITIVE_FIELDS = new Set(['password', 'password_hash']);

// Editable fields with simple metadata. Boolean fields are coerced; password
// is handled separately. `column` is the actual DB column name.
const EDITABLE_FIELDS = [
  { key: 'email',                   column: 'email',                   type: 'email' },
  { key: 'first_name',              column: 'first_name',              type: 'string' },
  { key: 'last_name',               column: 'last_name',               type: 'string' },
  { key: 'phone',                   column: 'phone',                   type: 'string' },
  { key: 'city',                    column: 'city',                    type: 'string' },
  { key: 'state',                   column: 'state',                   type: 'string' },
  { key: 'zip_code',                column: 'zip_code',                type: 'string' },
  { key: 'country',                 column: 'country',                 type: 'country' },
  { key: 'membership_tier',         column: 'membership_tier',         type: 'string' },
  { key: 'subscription_status',     column: 'subscription_status',     type: 'string' },
  { key: 'role',                    column: 'role',                    type: 'enum', enumValues: ALLOWED_ROLES.concat(['admin']) },
  { key: 'email_verified',          column: 'email_verified',          type: 'boolean' },
  { key: 'is_verified',             column: 'is_verified',             type: 'boolean' },
  { key: 'background_check_passed', column: 'background_check_passed', type: 'boolean' },
  { key: 'is_active',               column: 'is_active',               type: 'boolean' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function coerceBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return Boolean(v);
}

function normalizeValue(field, raw) {
  if (raw === null || raw === undefined) return null;
  switch (field.type) {
    case 'email':   return String(raw).trim().toLowerCase();
    case 'string':  return String(raw).trim() === '' ? null : String(raw).trim();
    case 'boolean': return coerceBoolean(raw);
    case 'enum':    return String(raw).trim();
    case 'country': return countriesUtil.normalizeCountry(raw);
    default:        return raw;
  }
}

function safeDisplay(field, value) {
  if (SENSITIVE_FIELDS.has(field)) return '[REDACTED]';
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

async function getUserSnapshot(client, userId) {
  const { rows } = await client.query(
    `SELECT id, email, first_name, last_name, phone, role,
            city, state, zip_code, country, latitude, longitude,
            membership_tier, subscription_status,
            email_verified, is_verified, background_check_passed,
            is_active
       FROM users
      WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function regionAccessOrFail(req, targetUser) {
  if (req.isSuper) return null;
  const regions = req.assigned_regions;
  if (regions === null || regions === undefined) return null;
  if (!Array.isArray(regions) || regions.length === 0) return null;
  if (!userMatchesAnyRegion(targetUser, regions)) {
    return { status: 403, error: 'Access denied: user is outside your assigned region.' };
  }
  // Tag the matched region (first match) for audit logging
  const matched = regions.find(r => userMatchesAnyRegion(targetUser, [r]));
  return { matchedRegionId: matched?.id || null };
}

// ── POST /admin/super/users/create-full ─────────────────────────────────────

exports.createUserFull = async (req, res) => {
  try {
    const adminId = req.user.id;
    const body    = req.body || {};

    const {
      email, password,
      first_name, last_name,
      phone, city, state, zip_code,
      country: rawCountry = 'US',
      role = 'customer',
      membership_tier = null,
      subscription_status = 'none',
      email_verified = false,
      is_verified = false,
      background_check_passed = false,
      business_name = null,
      notes = null,
    } = body;

    const country = countriesUtil.normalizeCountry(rawCountry);

    // ── Validation ────────────────────────────────────────────────────────
    const errors = {};
    if (!isValidEmail(email))                errors.email     = 'Valid email is required.';
    if (!password || password.length < 8)    errors.password  = 'Password must be at least 8 characters.';
    if (!first_name?.toString().trim())      errors.first_name = 'first_name is required.';
    if (!last_name?.toString().trim())       errors.last_name  = 'last_name is required.';
    if (!ALLOWED_ROLES.includes(role))       errors.role       = `role must be one of: ${ALLOWED_ROLES.join(', ')}.`;
    if (!countriesUtil.isValidCountry(country)) errors.country  = 'Invalid country code.';
    if (state && !countriesUtil.isValidRegion(country, state)) {
      errors.state = `Invalid state/region for ${country}.`;
    }
    if (zip_code && !countriesUtil.isValidPostal(country, zip_code)) {
      errors.zip_code = `Invalid postal code for ${country}.`;
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Email uniqueness
    const { rows: dup } = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const referralCode = crypto.randomBytes(6).toString('hex');
    const isHelper = role === 'helper' || role === 'helper_pro';
    const tier     = membership_tier || (role === 'helper_pro' ? 'tier2' : (isHelper ? 'tier1' : null));

    const preferredCurrency = countriesUtil.getDefaultCurrency(country) || 'USD';

    // Normalize state casing for fixed-list countries (US, CA, AU, IN, GB, DE, FR).
    const normalizedState = state
      ? (countriesUtil.hasRegions(country) ? String(state).toUpperCase().trim() : String(state).trim())
      : null;

    const result = await withTransaction(db, async (client) => {
      const { rows } = await client.query(`
        INSERT INTO users (
          first_name, last_name, email, password_hash,
          phone, city, state, zip_code, country, preferred_currency,
          role, membership_tier, subscription_status,
          email_verified, is_verified, background_check_passed,
          is_active,
          onboarding_completed, onboarding_status,
          contact_completed, profile_completed, terms_accepted,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10,
          $11, $12, $13,
          $14, $15, $16,
          TRUE,
          TRUE, 'onboarding_complete',
          TRUE, TRUE, TRUE,
          NOW(), NOW()
        )
        RETURNING id, first_name, last_name, email, role,
                  membership_tier, subscription_status, is_active,
                  country, preferred_currency,
                  created_at
      `, [
        first_name.trim(), last_name.trim(), normalizedEmail, passwordHash,
        phone || null, city || null, normalizedState, zip_code || null, country, preferredCurrency,
        role, tier, subscription_status,
        coerceBoolean(email_verified), coerceBoolean(is_verified), coerceBoolean(background_check_passed),
      ]);

      const newUser = rows[0];

      // Helper-profiles row so downstream queries don't 404
      if (isHelper) {
        await client.query(`
          INSERT INTO helper_profiles (user_id, tier, is_listed, created_at, updated_at)
          VALUES ($1, $2, FALSE, NOW(), NOW())
          ON CONFLICT (user_id) DO NOTHING
        `, [newUser.id, tier || 'tier1']);
      }

      // Audit log (per-field log)
      await logUserAction({
        client,
        adminId,
        targetUserId: newUser.id,
        actionType:   'create_user',
        notes:        notes || `Admin-created ${role} account for ${normalizedEmail}`,
        ipAddress:    req.ip || null,
      });

      return newUser;
    }, 'super_admin_create_user_full');

    // Legacy free-form audit log (non-blocking)
    logAdminAction({
      adminId,
      action: 'user_created_full',
      targetType: 'user',
      targetId: result.id,
      description: `Created ${role} account for ${normalizedEmail}`,
      after: { role, email: normalizedEmail, membership_tier: tier },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: result,
    });
  } catch (err) {
    logger.error('createUserFull error', { err: err.message });
    // Surface the underlying error detail so super-admins can debug
    // schema mismatches (e.g. invalid enum values) instead of seeing a
    // generic message. This route is requireSuperAdmin-gated so the
    // exposure is limited to trusted users.
    return res.status(500).json({
      error:  'Failed to create user.',
      detail: err.message,
    });
  }
};

// ── PUT /admin/super/users/:userId/edit-full ────────────────────────────────

exports.editUserFull = async (req, res) => {
  const { userId } = req.params;
  const adminId    = req.user.id;
  const body       = req.body || {};

  try {
    // Region scope check (uses pre-loaded assigned_regions)
    const current = await getUserSnapshot(db, userId);
    if (!current) return res.status(404).json({ error: 'User not found.' });

    const region = await regionAccessOrFail(req, current);
    if (region && region.error) {
      return res.status(region.status).json({ error: region.error });
    }
    const regionId = region?.matchedRegionId || null;

    const notify_user            = !!body.notify_user;
    const notification_message   = body.notification_message || null;
    const newPassword            = typeof body.password === 'string' && body.password.length > 0
      ? body.password
      : null;

    const result = await withTransaction(db, async (client) => {
      const updates = [];
      const values  = [];
      const changes = [];
      let p = 1;

      // Re-fetch inside transaction for consistency
      const fresh = await getUserSnapshot(client, userId);
      if (!fresh) throw new Error('User disappeared mid-edit');

      // ── Country / state / zip cross-validation ──────────────────────────
      // Country defaults to the user's current value when not in the body.
      const effectiveCountry = Object.prototype.hasOwnProperty.call(body, 'country')
        ? countriesUtil.normalizeCountry(body.country)
        : (fresh.country || 'US');
      if (Object.prototype.hasOwnProperty.call(body, 'country') &&
          !countriesUtil.isValidCountry(effectiveCountry)) {
        throw Object.assign(new Error('Invalid country code'), { httpStatus: 400 });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'state') && body.state
          && !countriesUtil.isValidRegion(effectiveCountry, body.state)) {
        throw Object.assign(
          new Error(`Invalid state/region for ${effectiveCountry}`),
          { httpStatus: 400 }
        );
      }
      if (Object.prototype.hasOwnProperty.call(body, 'zip_code') && body.zip_code
          && !countriesUtil.isValidPostal(effectiveCountry, body.zip_code)) {
        throw Object.assign(
          new Error(`Invalid postal code for ${effectiveCountry}`),
          { httpStatus: 400 }
        );
      }

      // ── Standard editable fields ────────────────────────────────────────
      for (const f of EDITABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(body, f.key)) continue;
        const newVal = normalizeValue(f, body[f.key]);
        const oldVal = fresh[f.column];

        // Email uniqueness check
        if (f.key === 'email' && newVal && newVal !== (oldVal || '').toLowerCase()) {
          const { rows: dup } = await client.query(
            `SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2`,
            [newVal, userId]
          );
          if (dup.length) throw Object.assign(new Error('Email already in use'), { httpStatus: 409 });
        }

        if (f.key === 'role' && newVal && !ALLOWED_ROLES.concat(['admin']).includes(newVal)) {
          throw Object.assign(new Error(`Invalid role: ${newVal}`), { httpStatus: 400 });
        }

        // Re-uppercase state for fixed-list countries before storing.
        let writeVal = newVal;
        if (f.key === 'state' && newVal && countriesUtil.hasRegions(effectiveCountry)) {
          writeVal = String(newVal).toUpperCase();
        }

        // Compare with appropriate normalization
        const oldNorm = f.type === 'boolean' ? !!oldVal
                      : f.type === 'email'   ? (oldVal || '').toLowerCase()
                      :                        (oldVal == null ? null : String(oldVal));
        const newNorm = f.type === 'boolean' ? !!writeVal
                      : f.type === 'email'   ? (writeVal || '').toLowerCase()
                      :                        (writeVal == null ? null : String(writeVal));

        if (oldNorm === newNorm) continue;

        updates.push(`${f.column} = $${p++}`);
        values.push(writeVal);
        changes.push({
          field:     f.key,
          oldValue:  oldVal,
          newValue:  writeVal,
          actionType: `edit_${f.key}`,
        });

        // Auto-update preferred_currency when country changes (only if the
        // admin didn't explicitly set it in the same request).
        if (f.key === 'country' && writeVal
            && !Object.prototype.hasOwnProperty.call(body, 'preferred_currency')) {
          const newCcy = countriesUtil.getDefaultCurrency(writeVal) || 'USD';
          updates.push(`preferred_currency = $${p++}`);
          values.push(newCcy);
        }
      }

      // ── Password (always treated specially) ─────────────────────────────
      if (newPassword) {
        if (newPassword.length < 8) {
          throw Object.assign(new Error('Password must be at least 8 characters'), { httpStatus: 400 });
        }
        const hash = await bcrypt.hash(newPassword, 12);
        updates.push(`password_hash = $${p++}`);
        values.push(hash);
        changes.push({
          field: 'password',
          oldValue: '[REDACTED]',
          newValue: '[HASHED]',
          actionType: 'edit_password',
        });
      }

      if (updates.length === 0) {
        return { changesCount: 0, notificationSent: false };
      }

      // ── Apply update ────────────────────────────────────────────────────
      updates.push(`updated_at = NOW()`);
      values.push(userId);
      await client.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${p}`,
        values
      );

      // ── Per-field audit rows ────────────────────────────────────────────
      for (const c of changes) {
        await logUserAction({
          client,
          adminId,
          targetUserId: userId,
          actionType:   c.actionType,
          fieldName:    c.field,
          oldValue:     safeDisplay(c.field, c.oldValue),
          newValue:     safeDisplay(c.field, c.newValue),
          ipAddress:    req.ip || null,
          regionId,
        });
      }

      // ── Notification (optional) ─────────────────────────────────────────
      let notificationSent = false;
      if (notify_user && changes.length > 0) {
        const adminName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Administrator';
        const summary   = changes
          .map(c => `${c.field}: ${safeDisplay(c.field, c.oldValue)} → ${safeDisplay(c.field, c.newValue)}`)
          .join('; ');

        try {
          await sendNotification({
            userId,
            type:  'admin:account_change',
            title: 'Your Account Was Modified',
            body:  notification_message
              || `Your account was updated by ${adminName} (admin ID: ${adminId}). Changes: ${summary}`,
            data: {
              admin_id:   adminId,
              admin_name: adminName,
              changes:    changes.map(c => ({
                field: c.field,
                old:   safeDisplay(c.field, c.oldValue),
                new:   safeDisplay(c.field, c.newValue),
              })),
            },
            action_url: '/settings/security',
          });
          notificationSent = true;
          // Best-effort: mark recent log rows as notified
          await markUserActionsNotified({
            client, adminId, targetUserId: userId, notificationId: 0, withinSeconds: 30,
          });
        } catch (e) {
          logger.warn('admin notification dispatch failed', { error: e.message });
        }
      }

      return { changesCount: changes.length, notificationSent, changes };
    }, 'super_admin_edit_user_full');

    // Legacy free-form log
    logAdminAction({
      adminId,
      action: 'user_edited_full',
      targetType: 'user',
      targetId: userId,
      description: `Edited ${result.changesCount} field(s).`,
      after: { fields: (result.changes || []).map(c => c.field) },
      req,
    }).catch(() => {});

    return res.json({
      success: true,
      message: result.changesCount === 0 ? 'No changes detected' : 'User updated successfully',
      changes_count: result.changesCount,
      notification_sent: result.notificationSent,
    });
  } catch (err) {
    if (err.httpStatus) {
      return res.status(err.httpStatus).json({ error: err.message });
    }
    logger.error('editUserFull error', { err: err.message });
    return res.status(500).json({
      error:  'Failed to update user.',
      detail: err.message,
    });
  }
};

// ── GET /admin/super/users/in-region ────────────────────────────────────────
//
// Returns users that fall inside any of the requesting admin's assigned
// regions. Super-admins receive all users (paginated). Regional admins with
// no region assignments receive an empty list.

exports.getUsersInRegion = async (req, res) => {
  try {
    const limitN  = Math.min(Math.max(1, parseInt(req.query.limit, 10)  || 50), 200);
    const offsetN = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const search  = (req.query.search || '').toString().trim();

    const conditions = [];
    const values = [];
    let p = 1;

    if (search) {
      conditions.push(`(u.email ILIKE $${p} OR u.first_name ILIKE $${p} OR u.last_name ILIKE $${p})`);
      values.push(`%${search}%`);
      p++;
    }

    // Super-admin: no region restriction
    if (req.isSuper) {
      const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
                u.city, u.state, u.zip_code, u.country, u.is_active,
                u.created_at
           FROM users u
           ${whereSql}
           ORDER BY u.created_at DESC
           LIMIT $${p} OFFSET $${p + 1}`,
        [...values, limitN, offsetN]
      );
      return res.json({ users: rows, scoped: false });
    }

    // Regional admin: filter by assigned regions
    const regions = req.assigned_regions || [];
    if (!regions.length) {
      return res.json({ users: [], scoped: true, regions: [] });
    }

    // Build SQL fragments per region — keeps the query in one DB roundtrip.
    const orFragments = [];
    for (const r of regions) {
      const def = typeof r.boundary_definition === 'string'
        ? JSON.parse(r.boundary_definition)
        : r.boundary_definition;
      if (def.type === 'zip_range' && Array.isArray(def.ranges)) {
        for (const rng of def.ranges) {
          if (Number.isFinite(rng.start) && Number.isFinite(rng.end)) {
            orFragments.push(
              `(LEFT(u.zip_code, 5) ~ '^[0-9]+$' AND CAST(LEFT(u.zip_code, 5) AS INTEGER) BETWEEN $${p} AND $${p + 1})`
            );
            values.push(rng.start, rng.end);
            p += 2;
          }
        }
      } else if (def.type === 'city_state' && Array.isArray(def.entries)) {
        for (const e of def.entries) {
          orFragments.push(`(LOWER(u.city) = LOWER($${p}) AND UPPER(u.state) = UPPER($${p + 1}))`);
          values.push(e.city || '', e.state || '');
          p += 2;
        }
      } else if (def.type === 'country_region' && Array.isArray(def.entries)) {
        // Country + region (state/province) match. State casing is normalized
        // to uppercase here — matches the regionAuth fixed-list rule.
        for (const e of def.entries) {
          if (!e || !e.country || !e.region) continue;
          orFragments.push(
            `(UPPER(u.country) = UPPER($${p}) AND UPPER(u.state) = UPPER($${p + 1}))`
          );
          values.push(e.country, e.region);
          p += 2;
        }
      } else if (def.type === 'country_only' && Array.isArray(def.countries)) {
        for (const c of def.countries) {
          if (!c) continue;
          orFragments.push(`(UPPER(u.country) = UPPER($${p}))`);
          values.push(c);
          p += 1;
        }
      }
      // geo_radius is filtered in JS post-query (rare path; keeps SQL simple)
    }

    if (orFragments.length === 0 && regions.every(r => {
      const def = typeof r.boundary_definition === 'string' ? JSON.parse(r.boundary_definition) : r.boundary_definition;
      return def.type === 'geo_radius';
    })) {
      // Pure geo_radius — fetch a wider set then filter in JS
      const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
                u.city, u.state, u.zip_code, u.country, u.latitude, u.longitude,
                u.is_active, u.created_at
           FROM users u
           ${whereSql}
           ORDER BY u.created_at DESC
           LIMIT 1000`,
        values
      );
      const filtered = rows.filter(u => userMatchesAnyRegion(u, regions));
      return res.json({
        users: filtered.slice(offsetN, offsetN + limitN),
        scoped: true,
        regions: regions.map(r => ({ id: r.id, name: r.name })),
      });
    }

    if (orFragments.length) {
      conditions.push(`(${orFragments.join(' OR ')})`);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
              u.city, u.state, u.zip_code, u.country, u.is_active,
              u.created_at
         FROM users u
         ${whereSql}
         ORDER BY u.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
      [...values, limitN, offsetN]
    );

    return res.json({
      users: rows,
      scoped: true,
      regions: regions.map(r => ({ id: r.id, name: r.name })),
    });
  } catch (err) {
    logger.error('getUsersInRegion error', { err: err.message });
    return res.status(500).json({ error: 'Failed to list users in region.' });
  }
};
