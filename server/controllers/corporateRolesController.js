'use strict';

/**
 * corporateRolesController — admin-only CRUD over the OxSteed corporate
 * hierarchy (departments, titles, assignments, permission overrides).
 *
 * Auth model:
 *   All routes are mounted behind `requireAdmin`. The handlers below additionally
 *   enforce:
 *     * cannot_grant_above_level — admin cannot assign a title whose
 *       seniority_level exceeds the caller's own highest active seniority.
 *     * no_csuite_for_admins — admin cannot assign a title flagged
 *       `is_csuite=TRUE` (super-admin only).
 *     * super_admin_only for department/title/department-default mutations.
 *
 * super_admin bypasses every guard.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const corporateRolesService = require('../services/corporateRolesService');

function isSuper(req) {
  return Boolean(req.isSuper) || req.user?.role === 'super_admin';
}

function badRequest(res, message, code = 'bad_request', extra = {}) {
  return res.status(400).json({ error: message, code, ...extra });
}

function notFound(res, message = 'Not found.') {
  return res.status(404).json({ error: message, code: 'not_found' });
}

function forbidden(res, message, code = 'forbidden', extra = {}) {
  return res.status(403).json({ error: message, code, ...extra });
}

async function writeAuditLog(client, entry) {
  try {
    await client.query(
      `INSERT INTO corporate_assignment_audit_log
         (assignment_id, action, performed_by, target_user_id,
          before_state, after_state, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        entry.assignmentId || null,
        entry.action,
        entry.performedBy || null,
        entry.targetUserId || null,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after  ? JSON.stringify(entry.after)  : null,
        entry.notes || null,
      ]
    );
  } catch (err) {
    logger.warn('corporate audit log insert failed', { error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Catalog + "me"
// ─────────────────────────────────────────────────────────────────────────

exports.getCatalog = async (_req, res, next) => {
  try {
    const catalog = await corporateRolesService.getCatalog();
    res.json({ data: catalog });
  } catch (err) {
    next(err);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const country = req.query.country || null;
    const result = await corporateRolesService.getEffectiveCorporatePermissions({
      userId:  req.user.id,
      role:    req.user.role,
      country,
    });
    res.json({
      data: {
        user_id: req.user.id,
        role: req.user.role,
        is_super_admin: isSuper(req),
        country,
        permissions: Array.from(result.permissions),
        assignments: result.assignments,
        raw: result.raw,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Departments
// ─────────────────────────────────────────────────────────────────────────

exports.listDepartments = async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, description, icon, color, sort_order, is_active
         FROM corporate_departments
        ORDER BY sort_order, name`
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

exports.upsertDepartment = async (req, res, next) => {
  if (!isSuper(req)) return forbidden(res, 'Super-admin only.', 'super_admin_only');
  try {
    const { code, name, description, icon, color, sort_order, is_active } = req.body || {};
    if (!code || !name) return badRequest(res, 'code and name are required.', 'validation_failed');

    const id = Number(req.params.id) || null;
    let result;
    if (id) {
      const upd = await pool.query(
        `UPDATE corporate_departments
            SET code = COALESCE($1, code),
                name = COALESCE($2, name),
                description = $3,
                icon = $4,
                color = $5,
                sort_order = COALESCE($6, sort_order),
                is_active  = COALESCE($7, is_active),
                updated_at = NOW()
          WHERE id = $8
        RETURNING *`,
        [code, name, description || null, icon || null, color || null,
         sort_order ?? null, is_active ?? null, id]
      );
      if (!upd.rows.length) return notFound(res);
      result = upd.rows[0];
    } else {
      const ins = await pool.query(
        `INSERT INTO corporate_departments
           (code, name, description, icon, color, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6, 0), COALESCE($7, TRUE))
         RETURNING *`,
        [code, name, description || null, icon || null, color || null,
         sort_order ?? null, is_active ?? null]
      );
      result = ins.rows[0];
    }
    corporateRolesService.invalidateCatalog();
    res.json({ data: result });
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Department code already exists.', 'duplicate_code');
    next(err);
  }
};

exports.setDepartmentDefaults = async (req, res, next) => {
  if (!isSuper(req)) return forbidden(res, 'Super-admin only.', 'super_admin_only');
  const departmentId = Number(req.params.id);
  if (!departmentId) return badRequest(res, 'Department id required.', 'validation_failed');
  const incoming = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
  if (!incoming) return badRequest(res, 'permissions[] required.', 'validation_failed');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dept = await client.query(
      'SELECT id FROM corporate_departments WHERE id = $1',
      [departmentId]
    );
    if (!dept.rows.length) { await client.query('ROLLBACK'); return notFound(res); }

    // Map permission codes -> ids
    const codes = incoming.map((p) => p.code || p);
    const permsRes = await client.query(
      'SELECT id, code FROM corporate_permissions WHERE code = ANY ($1::text[])',
      [codes]
    );
    const byCode = new Map(permsRes.rows.map((r) => [r.code, r.id]));
    const unknownCodes = [...new Set(codes.filter((code) => !byCode.has(code)))];
    if (unknownCodes.length) {
      await client.query('ROLLBACK');
      return badRequest(
        res,
        `Unknown corporate permission code${unknownCodes.length === 1 ? '' : 's'}: ${unknownCodes.join(', ')}.`,
        'unknown_permission_codes',
        { unknown_codes: unknownCodes }
      );
    }

    await client.query(
      'DELETE FROM corporate_department_permissions WHERE department_id = $1',
      [departmentId]
    );
    for (const entry of incoming) {
      const code  = entry.code || entry;
      const allow = entry.allow !== false; // default allow=true if just code given
      const pid   = byCode.get(code);
      await client.query(
        `INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
         VALUES ($1,$2,$3)
         ON CONFLICT (department_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow`,
        [departmentId, pid, allow]
      );
    }
    await client.query('COMMIT');
    corporateRolesService.invalidateCatalog();
    corporateRolesService.invalidateCache();
    res.json({ data: { department_id: departmentId, permissions: incoming } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Titles
// ─────────────────────────────────────────────────────────────────────────

exports.listTitles = async (req, res, next) => {
  try {
    const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
    const params = [];
    let where = '';
    if (departmentId) {
      params.push(departmentId);
      where = `WHERE t.department_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.code, t.name, t.description,
              t.seniority_level, t.is_csuite, t.is_active, t.sort_order,
              t.department_id, d.code AS department_code, d.name AS department_name
         FROM corporate_titles t
         JOIN corporate_departments d ON d.id = t.department_id
         ${where}
        ORDER BY d.sort_order, t.sort_order, t.name`,
      params
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

exports.upsertTitle = async (req, res, next) => {
  if (!isSuper(req)) return forbidden(res, 'Super-admin only.', 'super_admin_only');
  try {
    const {
      department_id, code, name, description,
      seniority_level, is_csuite, is_active, sort_order,
    } = req.body || {};
    if (!department_id || !code || !name) {
      return badRequest(res, 'department_id, code, name are required.', 'validation_failed');
    }
    if (seniority_level != null && (seniority_level < 1 || seniority_level > 10)) {
      return badRequest(res, 'seniority_level must be between 1 and 10.', 'validation_failed');
    }

    const id = Number(req.params.id) || null;
    let result;
    if (id) {
      const upd = await pool.query(
        `UPDATE corporate_titles
            SET department_id   = COALESCE($1, department_id),
                code            = COALESCE($2, code),
                name            = COALESCE($3, name),
                description     = $4,
                seniority_level = COALESCE($5, seniority_level),
                is_csuite       = COALESCE($6, is_csuite),
                is_active       = COALESCE($7, is_active),
                sort_order      = COALESCE($8, sort_order),
                updated_at      = NOW()
          WHERE id = $9
        RETURNING *`,
        [department_id, code, name, description || null,
         seniority_level ?? null, is_csuite ?? null, is_active ?? null,
         sort_order ?? null, id]
      );
      if (!upd.rows.length) return notFound(res);
      result = upd.rows[0];
    } else {
      const ins = await pool.query(
        `INSERT INTO corporate_titles
           (department_id, code, name, description, seniority_level,
            is_csuite, is_active, sort_order, is_system)
         VALUES ($1,$2,$3,$4,COALESCE($5, 4),COALESCE($6, FALSE),
                 COALESCE($7, TRUE),COALESCE($8, 0), FALSE)
         RETURNING *`,
        [department_id, code, name, description || null,
         seniority_level ?? null, is_csuite ?? null, is_active ?? null,
         sort_order ?? null]
      );
      result = ins.rows[0];
    }
    corporateRolesService.invalidateCatalog();
    res.json({ data: result });
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Title code already exists.', 'duplicate_code');
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────────────────────────────────

const ASSIGNMENT_SELECT = `
  SELECT ca.id, ca.user_id, ca.title_id, ca.department_id,
         ca.country_code, ca.region_id, ca.reports_to_user_id,
         ca.started_at, ca.ended_at, ca.is_active,
         ca.assigned_by_user_id, ca.notes,
         ca.created_at, ca.updated_at,
         t.code AS title_code, t.name AS title_name,
         t.seniority_level, t.is_csuite,
         d.code AS department_code, d.name AS department_name,
         u.email      AS user_email,
         u.first_name AS user_first_name,
         u.last_name  AS user_last_name,
         u.role       AS user_role,
         rt.email     AS reports_to_email,
         rt.first_name AS reports_to_first_name,
         rt.last_name  AS reports_to_last_name,
         ab.email      AS assigned_by_email,
         ab.first_name AS assigned_by_first_name,
         ab.last_name  AS assigned_by_last_name,
         ar.name AS region_name
    FROM corporate_assignments ca
    JOIN corporate_titles      t ON t.id = ca.title_id
    JOIN corporate_departments d ON d.id = ca.department_id
    JOIN users u  ON u.id = ca.user_id
    LEFT JOIN users rt  ON rt.id = ca.reports_to_user_id
    LEFT JOIN users ab  ON ab.id = ca.assigned_by_user_id
    LEFT JOIN admin_regions ar ON ar.id = ca.region_id`;

exports.listAssignments = async (req, res, next) => {
  try {
    const {
      department_id, title_id, country, active,
      user_id, region_id,
    } = req.query;

    const params = [];
    const where = [];
    if (department_id) { params.push(Number(department_id)); where.push(`ca.department_id = $${params.length}`); }
    if (title_id)      { params.push(Number(title_id));      where.push(`ca.title_id = $${params.length}`); }
    if (country)       { params.push(String(country).toUpperCase()); where.push(`ca.country_code = $${params.length}`); }
    if (region_id)     { params.push(Number(region_id));     where.push(`ca.region_id = $${params.length}`); }
    if (user_id)       { params.push(String(user_id));       where.push(`ca.user_id = $${params.length}`); }
    if (active === 'true' || active === '1' || active === undefined) {
      where.push('ca.is_active = TRUE');
    } else if (active === 'false' || active === '0') {
      where.push('ca.is_active = FALSE');
    }

    const sql = `${ASSIGNMENT_SELECT}
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.seniority_level DESC, ca.started_at DESC
       LIMIT 500`;

    const { rows } = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getAssignment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return badRequest(res, 'Assignment id required.', 'validation_failed');

    const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE ca.id = $1`, [id]);
    if (!rows.length) return notFound(res);

    const overrides = await pool.query(
      `SELECT o.id, o.permission_id, o.effect, o.reason, o.expires_at, o.created_at,
              p.code AS permission_code
         FROM corporate_assignment_permission_overrides o
         JOIN corporate_permissions p ON p.id = o.permission_id
        WHERE o.assignment_id = $1
        ORDER BY p.group_key, p.code`,
      [id]
    );

    res.json({ data: { ...rows[0], overrides: overrides.rows } });
  } catch (err) {
    next(err);
  }
};

exports.createAssignment = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      user_id, title_id, country_code, region_id,
      reports_to_user_id, started_at, notes,
    } = req.body || {};

    if (!user_id || !title_id) {
      return badRequest(res, 'user_id and title_id are required.', 'validation_failed');
    }

    await client.query('BEGIN');

    // Verify target user exists AND is internal staff (corporate titles are
    // for internal staff only).
    const userRes = await client.query(
      'SELECT id, role, is_active FROM users WHERE id = $1',
      [user_id]
    );
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return notFound(res, 'Target user not found.');
    }
    const target = userRes.rows[0];
    if (!target.is_active) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Target user is inactive.', 'user_inactive');
    }
    if (!['employee', 'admin', 'super_admin'].includes(target.role)) {
      await client.query('ROLLBACK');
      return badRequest(
        res,
        'Corporate titles can only be assigned to employee, admin, or super_admin users.',
        'target_not_staff',
      );
    }

    // Load title (need seniority + is_csuite for guard checks)
    const titleRes = await client.query(
      `SELECT id, department_id, code, name, seniority_level, is_csuite, is_active
         FROM corporate_titles WHERE id = $1`,
      [title_id]
    );
    if (!titleRes.rows.length || !titleRes.rows[0].is_active) {
      await client.query('ROLLBACK');
      return notFound(res, 'Title not found or inactive.');
    }
    const title = titleRes.rows[0];

    // cannot_grant_above_level + no_csuite_for_admins
    if (!isSuper(req)) {
      if (title.is_csuite) {
        await client.query('ROLLBACK');
        return forbidden(
          res,
          'Only super-admins may assign C-suite titles.',
          'no_csuite_for_admins',
        );
      }
      const callerMax = await corporateRolesService.getMaxActiveSeniority(req.user.id, req.user.role);
      if (Number(title.seniority_level) > callerMax) {
        await client.query('ROLLBACK');
        return forbidden(
          res,
          'Cannot assign a title above your own seniority level.',
          'cannot_grant_above_level',
          { caller_max_seniority: callerMax, requested_seniority: title.seniority_level },
        );
      }
    }

    // Optional region_id must exist
    if (region_id) {
      const r = await client.query('SELECT id FROM admin_regions WHERE id = $1', [region_id]);
      if (!r.rows.length) {
        await client.query('ROLLBACK');
        return badRequest(res, 'region_id does not exist.', 'invalid_region');
      }
    }

    // Optional reports_to_user_id must exist
    if (reports_to_user_id) {
      const r = await client.query('SELECT id FROM users WHERE id = $1', [reports_to_user_id]);
      if (!r.rows.length) {
        await client.query('ROLLBACK');
        return badRequest(res, 'reports_to_user_id does not exist.', 'invalid_user');
      }
    }

    const ins = await client.query(
      `INSERT INTO corporate_assignments
         (user_id, title_id, department_id, country_code, region_id,
          reports_to_user_id, started_at, is_active, assigned_by_user_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, NOW()), TRUE, $8, $9)
       RETURNING *`,
      [
        user_id, title.id, title.department_id,
        country_code ? String(country_code).toUpperCase() : null,
        region_id || null,
        reports_to_user_id || null,
        started_at || null,
        req.user.id,
        notes || null,
      ]
    );

    await writeAuditLog(client, {
      assignmentId: ins.rows[0].id,
      action: 'create',
      performedBy: req.user.id,
      targetUserId: user_id,
      after: ins.rows[0],
      notes,
    });

    await client.query('COMMIT');
    corporateRolesService.invalidateCache(user_id);

    res.status(201).json({ data: ins.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    if (err.code === '23505') {
      return badRequest(res, 'User already holds this title in that country.', 'duplicate_assignment');
    }
    next(err);
  } finally {
    client.release();
  }
};

exports.updateAssignment = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!id) return badRequest(res, 'Assignment id required.', 'validation_failed');

    await client.query('BEGIN');

    const current = await client.query(
      `SELECT ca.*, t.seniority_level, t.is_csuite
         FROM corporate_assignments ca
         JOIN corporate_titles t ON t.id = ca.title_id
        WHERE ca.id = $1
        FOR UPDATE`,
      [id]
    );
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return notFound(res);
    }
    const before = current.rows[0];

    if (!isSuper(req)) {
      if (before.is_csuite) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Only super-admins may edit C-suite assignments.', 'no_csuite_for_admins');
      }
      const callerMax = await corporateRolesService.getMaxActiveSeniority(req.user.id, req.user.role);
      if (Number(before.seniority_level) > callerMax) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Cannot edit a title above your own seniority level.', 'cannot_grant_above_level');
      }
    }

    const { country_code, region_id, reports_to_user_id, notes, ended_at, is_active } = req.body || {};

    const upd = await client.query(
      `UPDATE corporate_assignments
          SET country_code       = $1,
              region_id          = $2,
              reports_to_user_id = $3,
              notes              = $4,
              ended_at           = COALESCE($5, ended_at),
              is_active          = COALESCE($6, is_active)
        WHERE id = $7
      RETURNING *`,
      [
        country_code === undefined ? before.country_code
          : (country_code ? String(country_code).toUpperCase() : null),
        region_id === undefined ? before.region_id : (region_id || null),
        reports_to_user_id === undefined ? before.reports_to_user_id : (reports_to_user_id || null),
        notes === undefined ? before.notes : (notes || null),
        ended_at || null,
        is_active === undefined ? null : Boolean(is_active),
        id,
      ]
    );

    await writeAuditLog(client, {
      assignmentId: id,
      action: 'update',
      performedBy: req.user.id,
      targetUserId: before.user_id,
      before,
      after: upd.rows[0],
    });

    await client.query('COMMIT');
    corporateRolesService.invalidateCache(before.user_id);
    res.json({ data: upd.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
};

exports.endAssignment = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!id) return badRequest(res, 'Assignment id required.', 'validation_failed');

    await client.query('BEGIN');

    const current = await client.query(
      `SELECT ca.*, t.seniority_level, t.is_csuite
         FROM corporate_assignments ca
         JOIN corporate_titles t ON t.id = ca.title_id
        WHERE ca.id = $1
        FOR UPDATE`,
      [id]
    );
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return notFound(res);
    }
    const before = current.rows[0];

    if (!isSuper(req)) {
      if (before.is_csuite) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Only super-admins may end C-suite assignments.', 'no_csuite_for_admins');
      }
      const callerMax = await corporateRolesService.getMaxActiveSeniority(req.user.id, req.user.role);
      if (Number(before.seniority_level) > callerMax) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Cannot end a title above your own seniority level.', 'cannot_grant_above_level');
      }
    }

    const upd = await client.query(
      `UPDATE corporate_assignments
          SET is_active = FALSE,
              ended_at  = COALESCE(ended_at, NOW())
        WHERE id = $1
      RETURNING *`,
      [id]
    );

    await writeAuditLog(client, {
      assignmentId: id,
      action: 'end',
      performedBy: req.user.id,
      targetUserId: before.user_id,
      before,
      after: upd.rows[0],
    });

    await client.query('COMMIT');
    corporateRolesService.invalidateCache(before.user_id);
    res.json({ data: upd.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Per-assignment permission overrides
// ─────────────────────────────────────────────────────────────────────────

exports.setOverrides = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const incoming = Array.isArray(req.body?.overrides) ? req.body.overrides : null;
    if (!id) return badRequest(res, 'Assignment id required.', 'validation_failed');
    if (!incoming) return badRequest(res, 'overrides[] required.', 'validation_failed');

    await client.query('BEGIN');

    const assignmentRes = await client.query(
      `SELECT ca.*, t.seniority_level, t.is_csuite
         FROM corporate_assignments ca
         JOIN corporate_titles t ON t.id = ca.title_id
        WHERE ca.id = $1
        FOR UPDATE`,
      [id]
    );
    if (!assignmentRes.rows.length) {
      await client.query('ROLLBACK');
      return notFound(res);
    }
    const assignment = assignmentRes.rows[0];

    // Guard: admins can't manage C-suite or above-level assignments.
    if (!isSuper(req)) {
      if (assignment.is_csuite) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Only super-admins may set overrides on C-suite assignments.', 'no_csuite_for_admins');
      }
      const callerMax = await corporateRolesService.getMaxActiveSeniority(req.user.id, req.user.role);
      if (Number(assignment.seniority_level) > callerMax) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Cannot edit overrides above your own seniority level.', 'cannot_grant_above_level');
      }

      // Guard: admin cannot grant a permission they do not themselves hold.
      const callerEff = await corporateRolesService.getEffectiveCorporatePermissions({
        userId: req.user.id,
        role:   req.user.role,
      });
      for (const entry of incoming) {
        if (entry.effect === 'allow' && !callerEff.permissions.has(entry.code)) {
          await client.query('ROLLBACK');
          return forbidden(
            res,
            `Cannot grant permission '${entry.code}' which you do not hold.`,
            'cannot_grant_above_level',
            { offending_permission: entry.code },
          );
        }
      }
    }

    // Map codes -> ids
    const codes = incoming.map((o) => o.code);
    const permsRes = await client.query(
      'SELECT id, code FROM corporate_permissions WHERE code = ANY ($1::text[])',
      [codes]
    );
    const byCode = new Map(permsRes.rows.map((r) => [r.code, r.id]));

    await client.query(
      'DELETE FROM corporate_assignment_permission_overrides WHERE assignment_id = $1',
      [id]
    );

    for (const entry of incoming) {
      const pid = byCode.get(entry.code);
      if (!pid) continue;
      const effect = entry.effect === 'deny' ? 'deny' : 'allow';
      await client.query(
        `INSERT INTO corporate_assignment_permission_overrides
           (assignment_id, permission_id, effect, reason, granted_by_user_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (assignment_id, permission_id) DO UPDATE
           SET effect = EXCLUDED.effect,
               reason = EXCLUDED.reason,
               granted_by_user_id = EXCLUDED.granted_by_user_id,
               expires_at = EXCLUDED.expires_at`,
        [id, pid, effect, entry.reason || null, req.user.id, entry.expires_at || null]
      );
    }

    await writeAuditLog(client, {
      assignmentId: id,
      action: 'overrides_set',
      performedBy: req.user.id,
      targetUserId: assignment.user_id,
      after: { overrides: incoming },
    });

    await client.query('COMMIT');
    corporateRolesService.invalidateCache(assignment.user_id);
    res.json({ data: { assignment_id: id, overrides: incoming } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Org chart  (tree shape for visualization)
// ─────────────────────────────────────────────────────────────────────────

exports.getOrgChart = async (req, res, next) => {
  try {
    const country = req.query.country ? String(req.query.country).toUpperCase() : null;
    const params = [];
    let where = 'ca.is_active = TRUE';
    if (country) {
      params.push(country);
      where += ` AND (ca.country_code IS NULL OR ca.country_code = $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT ca.id, ca.user_id, ca.title_id, ca.department_id,
              ca.country_code, ca.region_id, ca.reports_to_user_id,
              ca.started_at,
              t.code AS title_code, t.name AS title_name,
              t.seniority_level, t.is_csuite,
              d.code AS department_code, d.name AS department_name,
              d.color AS department_color, d.icon AS department_icon,
              u.id AS uid, u.email, u.first_name, u.last_name,
              u.profile_photo_url, u.role
         FROM corporate_assignments ca
         JOIN corporate_titles      t ON t.id = ca.title_id
         JOIN corporate_departments d ON d.id = ca.department_id
         JOIN users u ON u.id = ca.user_id
        WHERE ${where}
        ORDER BY d.sort_order, t.seniority_level DESC, t.sort_order`,
      params
    );

    // Group by department for the dept view
    const byDepartment = new Map();
    for (const row of rows) {
      const key = row.department_code;
      if (!byDepartment.has(key)) {
        byDepartment.set(key, {
          department: {
            id: row.department_id,
            code: row.department_code,
            name: row.department_name,
            color: row.department_color,
            icon: row.department_icon,
          },
          assignments: [],
        });
      }
      byDepartment.get(key).assignments.push(row);
    }

    res.json({
      data: {
        country,
        total_assignments: rows.length,
        by_department: Array.from(byDepartment.values()),
        flat: rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Audit log readout
// ─────────────────────────────────────────────────────────────────────────

exports.listAudit = async (req, res, next) => {
  if (!isSuper(req)) return forbidden(res, 'Super-admin only.', 'super_admin_only');
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      `SELECT a.id, a.assignment_id, a.action, a.performed_by, a.target_user_id,
              a.before_state, a.after_state, a.notes, a.created_at,
              pu.email AS performed_by_email,
              tu.email AS target_user_email
         FROM corporate_assignment_audit_log a
         LEFT JOIN users pu ON pu.id = a.performed_by
         LEFT JOIN users tu ON tu.id = a.target_user_id
        ORDER BY a.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};
