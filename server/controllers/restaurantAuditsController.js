// OxSteed Restaurants — Quality audits (franchise system).
// Audit templates with scored items, audit runs, findings, and corrective
// actions with an assignee/due-date/verification loop.
// Access model mirrors restaurantOpsController: owner/manager author templates
// and corrective actions; any active member can run audits and log findings.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const AUDIT_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'safety'];
const AUDIT_STATUSES = ['in_progress', 'completed', 'abandoned'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ACTION_STATUSES = ['open', 'in_progress', 'resolved', 'verified'];
const MANAGE_ROLES = new Set(['owner', 'manager']);

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Identical access query to restaurantOpsController.requireRestaurantAccess.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

async function loadTemplates(restaurantId) {
  const { rows: templates } = await pool.query(
    `SELECT * FROM restaurant_audit_templates
      WHERE restaurant_id = $1
      ORDER BY is_active DESC, sort_order ASC, id ASC`,
    [restaurantId]
  );
  const ids = templates.map((t) => t.id);
  let itemsByTemplate = {};
  if (ids.length) {
    const { rows: items } = await pool.query(
      `SELECT * FROM restaurant_audit_items
        WHERE template_id = ANY($1::bigint[])
        ORDER BY sort_order ASC, id ASC`,
      [ids]
    );
    itemsByTemplate = items.reduce((acc, it) => {
      (acc[it.template_id] ||= []).push(it);
      return acc;
    }, {});
  }
  return templates.map((t) => ({ ...t, items: itemsByTemplate[t.id] || [] }));
}

// ── Templates ────────────────────────────────────────────────────────────────
exports.listTemplates = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    res.json({ templates: await loadTemplates(restaurantId) });
  } catch (err) {
    next(err);
  }
};

exports.createTemplate = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { name, description, category, items } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError('Name is required', 400, 'name_required');
    if (category && !AUDIT_CATEGORIES.includes(category)) throw new AppError('Invalid category', 400, 'invalid_category');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [template] } = await client.query(
        `INSERT INTO restaurant_audit_templates
           (restaurant_id, name, description, category, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [restaurantId, String(name).trim(), description || null, category || 'general', req.user.id]
      );
      const created = await insertItems(client, template.id, items);
      await client.query('COMMIT');
      res.status(201).json({ template: { ...template, items: created } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

async function insertItems(client, templateId, items) {
  const list = Array.isArray(items) ? items : [];
  const created = [];
  for (let i = 0; i < list.length; i += 1) {
    const it = list[i] || {};
    if (!it.label || !String(it.label).trim()) continue;
    const maxScore = Number.isInteger(it.maxScore) && it.maxScore > 0 ? it.maxScore : 5;
    const weight = Number(it.weight) > 0 ? Number(it.weight) : 1;
    const { rows: [row] } = await client.query(
      `INSERT INTO restaurant_audit_items
         (template_id, label, instructions, max_score, weight, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [templateId, String(it.label).trim(), it.instructions || null, maxScore, weight, i]
    );
    created.push(row);
  }
  return created;
}

exports.updateTemplate = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const templateId = parsePositiveInt(req.params.templateId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { name, description, category, isActive, items } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_audit_templates WHERE id = $1 AND restaurant_id = $2`,
        [templateId, restaurantId]
      );
      if (!existing) throw new AppError('Audit template not found', 404, 'template_not_found');
      if (category && !AUDIT_CATEGORIES.includes(category)) throw new AppError('Invalid category', 400, 'invalid_category');
      const { rows: [template] } = await client.query(
        `UPDATE restaurant_audit_templates
            SET name = COALESCE($3, name),
                description = $4,
                category = COALESCE($5, category),
                is_active = COALESCE($6, is_active),
                updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $2
          RETURNING *`,
        [
          templateId, restaurantId,
          name && String(name).trim() ? String(name).trim() : null,
          description === undefined ? existing.description : description,
          category || null,
          isActive == null ? null : Boolean(isActive),
        ]
      );
      let created = null;
      if (Array.isArray(items)) {
        await client.query(`DELETE FROM restaurant_audit_items WHERE template_id = $1`, [templateId]);
        created = await insertItems(client, templateId, items);
      }
      await client.query('COMMIT');
      const withItems = created
        ? { ...template, items: created }
        : (await loadTemplates(restaurantId)).find((t) => t.id === templateId);
      res.json({ template: withItems });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteTemplate = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const templateId = parsePositiveInt(req.params.templateId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_audit_templates WHERE id = $1 AND restaurant_id = $2`,
      [templateId, restaurantId]
    );
    if (!rowCount) throw new AppError('Audit template not found', 404, 'template_not_found');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

// ── Audit runs ───────────────────────────────────────────────────────────────
exports.startAudit = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const templateId = parsePositiveInt(req.params.templateId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [template] } = await pool.query(
      `SELECT id FROM restaurant_audit_templates WHERE id = $1 AND restaurant_id = $2 AND is_active`,
      [templateId, restaurantId]
    );
    if (!template) throw new AppError('Audit template not found', 404, 'template_not_found');
    const { rows: [audit] } = await pool.query(
      `INSERT INTO restaurant_audits (template_id, restaurant_id, auditor_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [templateId, restaurantId, req.user.id]
    );
    res.status(201).json({ audit });
  } catch (err) {
    next(err);
  }
};

exports.getAudit = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const auditId = parsePositiveInt(req.params.auditId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [audit] } = await pool.query(
      `SELECT a.*, t.name AS template_name
         FROM restaurant_audits a
         JOIN restaurant_audit_templates t ON t.id = a.template_id
        WHERE a.id = $1 AND a.restaurant_id = $2`,
      [auditId, restaurantId]
    );
    if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
    const { rows: scores } = await pool.query(
      `SELECT * FROM restaurant_audit_scores WHERE audit_id = $1 ORDER BY id ASC`,
      [auditId]
    );
    const { rows: findings } = await pool.query(
      `SELECT f.*, u.first_name, u.last_name
         FROM restaurant_audit_findings f
         LEFT JOIN users u ON u.id = f.created_by
        WHERE f.audit_id = $1 ORDER BY f.created_at ASC`,
      [auditId]
    );
    res.json({ audit: { ...audit, scores, findings } });
  } catch (err) {
    next(err);
  }
};

exports.listAudits = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(Number(req.query.limit) || 15, 50);
    const { rows } = await pool.query(
      `SELECT a.*, t.name AS template_name,
              u.first_name AS auditor_first_name, u.last_name AS auditor_last_name,
              (SELECT COUNT(*) FROM restaurant_audit_findings f WHERE f.audit_id = a.id) AS finding_count,
              (SELECT COUNT(*) FROM restaurant_corrective_actions ca
                WHERE ca.audit_id = a.id AND ca.status NOT IN ('resolved', 'verified')) AS open_action_count
         FROM restaurant_audits a
         JOIN restaurant_audit_templates t ON t.id = a.template_id
         LEFT JOIN users u ON u.id = a.auditor_id
        WHERE a.restaurant_id = $1
        ORDER BY a.started_at DESC
        LIMIT $2`,
      [restaurantId, limit]
    );
    res.json({ audits: rows });
  } catch (err) {
    next(err);
  }
};

// Score one item inside a run (upsert). Scores snapshot the label/max/weight
// so history survives template edits.
exports.scoreItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const auditId = parsePositiveInt(req.params.auditId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { itemId, score, note } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [audit] } = await client.query(
        `SELECT * FROM restaurant_audits WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [auditId, restaurantId]
      );
      if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
      if (audit.status !== 'in_progress') throw new AppError('Audit is not in progress', 409, 'audit_closed');
      const { rows: [item] } = await client.query(
        `SELECT * FROM restaurant_audit_items WHERE id = $1 AND template_id = $2`,
        [itemId, audit.template_id]
      );
      if (!item) throw new AppError('Audit item not found', 404, 'item_not_found');
      const s = Math.max(0, Math.min(Number(score) || 0, item.max_score));
      await client.query(
        `INSERT INTO restaurant_audit_scores
           (audit_id, item_id, label, score, max_score, weight, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (audit_id, item_id)
         DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note`,
        [auditId, item.id, item.label, s, item.max_score, item.weight, note || null]
      );
      await client.query('COMMIT');
      res.json({ scored: true, score: s });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.completeAudit = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const auditId = parsePositiveInt(req.params.auditId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { notes } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [audit] } = await client.query(
        `SELECT * FROM restaurant_audits WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [auditId, restaurantId]
      );
      if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
      if (audit.status !== 'in_progress') throw new AppError('Audit is not in progress', 409, 'audit_closed');
      const { rows: [totals] } = await client.query(
        `SELECT COALESCE(SUM(score * weight), 0) AS total,
                COALESCE(SUM(max_score * weight), 0) AS max
           FROM restaurant_audit_scores WHERE audit_id = $1`,
        [auditId]
      );
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_audits
            SET status = 'completed', total_score = $3, max_score = $4,
                notes = COALESCE($5, notes), completed_at = NOW()
          WHERE id = $1 AND restaurant_id = $2
          RETURNING *`,
        [auditId, restaurantId, totals.total, totals.max, notes || null]
      );
      await client.query('COMMIT');
      res.json({ audit: updated });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// ── Findings ─────────────────────────────────────────────────────────────────
exports.addFinding = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const auditId = parsePositiveInt(req.params.auditId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { itemId, severity, note, photoUrl, clientKey } = req.body || {};
    if (!note || !String(note).trim()) throw new AppError('Note is required', 400, 'note_required');
    if (severity && !SEVERITIES.includes(severity)) throw new AppError('Invalid severity', 400, 'invalid_severity');
    const { rows: [audit] } = await pool.query(
      `SELECT id, status FROM restaurant_audits WHERE id = $1 AND restaurant_id = $2`,
      [auditId, restaurantId]
    );
    if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
    if (audit.status !== 'in_progress') throw new AppError('Audit is not in progress', 409, 'audit_closed');
    // Offline replay guard: a queued finding carries a client-generated key so
    // a retried POST never creates a duplicate.
    if (clientKey) {
      const { rows: [existing] } = await pool.query(
        `SELECT * FROM restaurant_audit_findings WHERE audit_id = $1 AND client_key = $2`,
        [auditId, String(clientKey)]
      );
      if (existing) return res.status(200).json({ finding: existing, replayed: true });
    }
    const { rows: [finding] } = await pool.query(
      `INSERT INTO restaurant_audit_findings
         (audit_id, item_id, severity, note, photo_url, created_by, client_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [auditId, itemId || null, severity || 'medium', String(note).trim(), photoUrl || null, req.user.id, clientKey ? String(clientKey) : null]
    );
    if (!finding) {
      const { rows: [existing] } = await pool.query(
        `SELECT * FROM restaurant_audit_findings WHERE audit_id = $1 AND client_key = $2`,
        [auditId, String(clientKey)]
      );
      return res.status(200).json({ finding: existing, replayed: true });
    }
    res.status(201).json({ finding });
  } catch (err) {
    next(err);
  }
};

// ── Corrective actions ───────────────────────────────────────────────────────
exports.createCorrectiveAction = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const findingId = parsePositiveInt(req.params.findingId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { description, assigneeId, dueAt } = req.body || {};
    if (!description || !String(description).trim()) throw new AppError('Description is required', 400, 'description_required');
    const { rows: [finding] } = await pool.query(
      `SELECT f.*, a.restaurant_id
         FROM restaurant_audit_findings f
         JOIN restaurant_audits a ON a.id = f.audit_id
        WHERE f.id = $1`,
      [findingId]
    );
    if (!finding || Number(finding.restaurant_id) !== Number(restaurantId)) {
      throw new AppError('Finding not found', 404, 'finding_not_found');
    }
    if (assigneeId) {
      const { rows: [member] } = await pool.query(
        `SELECT 1 FROM business_members
          WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
        [restaurant.business_id, assigneeId]
      );
      if (!member) throw new AppError('Assignee not found', 404, 'assignee_not_found');
    }
    const { rows: [action] } = await pool.query(
      `INSERT INTO restaurant_corrective_actions
         (finding_id, audit_id, description, assignee_id, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [findingId, finding.audit_id, String(description).trim(), assigneeId || null, dueAt || null, req.user.id]
    );
    res.status(201).json({ action });
  } catch (err) {
    next(err);
  }
};

exports.listCorrectiveActions = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = MANAGE_ROLES.has(restaurant.effective_role);
    const mineOnly = req.query.mine === '1' || !isManager;
    const status = req.query.status;
    const { rows } = await pool.query(
      `SELECT ca.*, f.note AS finding_note, f.severity,
              u.first_name AS assignee_first_name, u.last_name AS assignee_last_name
         FROM restaurant_corrective_actions ca
         JOIN restaurant_audit_findings f ON f.id = ca.finding_id
         JOIN restaurant_audits a ON a.id = ca.audit_id
         LEFT JOIN users u ON u.id = ca.assignee_id
        WHERE a.restaurant_id = $1
          ${mineOnly ? 'AND ca.assignee_id = $2' : ''}
          ${status && ACTION_STATUSES.includes(status) ? `AND ca.status = '${status}'` : ''}
        ORDER BY ca.created_at DESC
        LIMIT 200`,
      mineOnly ? [restaurantId, req.user.id] : [restaurantId]
    );
    res.json({ actions: rows });
  } catch (err) {
    next(err);
  }
};

// Status transitions: the assignee moves open -> in_progress -> resolved;
// only a manager can verify (resolved -> verified).
exports.updateCorrectiveAction = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const actionId = parsePositiveInt(req.params.actionId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = MANAGE_ROLES.has(restaurant.effective_role);
    const { status } = req.body || {};
    if (!ACTION_STATUSES.includes(status)) throw new AppError('Invalid status', 400, 'invalid_status');
    const { rows: [action] } = await pool.query(
      `SELECT ca.*, a.restaurant_id
         FROM restaurant_corrective_actions ca
         JOIN restaurant_audits a ON a.id = ca.audit_id
        WHERE ca.id = $1`,
      [actionId]
    );
    if (!action || Number(action.restaurant_id) !== Number(restaurantId)) {
      throw new AppError('Action not found', 404, 'action_not_found');
    }
    const isAssignee = action.assignee_id && String(action.assignee_id) === String(req.user.id);
    if (status === 'verified' && !isManager) {
      throw new AppError('Only a manager can verify an action', 403, 'forbidden');
    }
    if (!isManager && !isAssignee) {
      throw new AppError('You do not have permission to update this action', 403, 'forbidden');
    }
    const { rows: [updated] } = await pool.query(
      `UPDATE restaurant_corrective_actions
          SET status = $2,
              resolved_at = CASE WHEN $2 IN ('resolved', 'verified') THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [actionId, status]
    );
    res.json({ action: updated });
  } catch (err) {
    next(err);
  }
};

exports.auditCategories = AUDIT_CATEGORIES;
exports.auditStatuses = AUDIT_STATUSES;
exports.severities = SEVERITIES;
exports.actionStatuses = ACTION_STATUSES;
