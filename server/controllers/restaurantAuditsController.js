'use strict';

// Quality audits retain their run content and history as brand templates evolve.
const pool = require('../db');
const AppError = require('../utils/appError');
const v = require('../utils/restaurantReviewValidation');
const {
  resolveRestaurantAccess
} = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const {
  withTransaction
} = require('../utils/transaction');
const {
  logBusinessAction
} = require('../services/businessAuditLog');
const {
  attachScope,
  requireBrand,
  assertStore,
  assertStaff
} = require('../services/restaurantReviewScope');
const {
  resolveReportTimezone
} = require('../services/restaurantPayrollService');
const AUDIT_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'safety'];
const AUDIT_STATUSES = ['in_progress', 'completed', 'abandoned'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ACTION_STATUSES = ['open', 'in_progress', 'resolved', 'verified'];
async function access(req) {
  const id = v.integer(req.params.restaurantId, 'restaurantId');
  return attachScope(await resolveRestaurantAccess(req.user.id, id), req.user.id);
}
async function canManage(restaurant, userId) {
  return (await permissions.hasRestaurantPermission(restaurant, userId, ['audit.view'])) && (await permissions.hasRestaurantPermission(restaurant, userId, ['audit.manage']));
}
async function manage(restaurant, userId, brand = false) {
  if (!(await canManage(restaurant, userId))) throw new AppError('Audit management permission required', 403, 'forbidden');
  if (brand) requireBrand(restaurant);
}
async function writable(restaurant, audit, userId) {
  assertStore(restaurant, audit.location_id);
  if (String(audit.auditor_id) !== String(userId)) await manage(restaurant, userId);
}
async function auditEvent(client, req, restaurant, action, type, before, after, locationId = null) {
  await logBusinessAction(req, {
    client,
    throwOnError: true,
    business_id: restaurant.business_id,
    actor_role: restaurant.effective_role,
    action: `restaurant.${action}`,
    target_type: type,
    target_id: after?.id || before?.id,
    before_state: before || {},
    after_state: after || {},
    metadata: {
      location_id: locationId
    }
  });
}
function page(query = {}) {
  return {
    limit: query.limit === undefined ? 50 : v.integer(query.limit, 'limit', 1, 200),
    offset: query.offset === undefined ? 0 : v.integer(query.offset, 'offset', 0, 1000000)
  };
}
function storeWhere(restaurant, column, params, requested) {
  if(requested!==undefined){
    const id=v.integer(requested,'locationId');
    if(restaurant.locationScope.mode==='assigned'&&!restaurant.locationScope.location_ids.includes(id))throw new AppError('Store access denied',403,'location_scope_forbidden');
    params.push(id);return ` AND ${column}=$${params.length}`;
  }
  if (restaurant.locationScope.mode !== 'assigned') return '';
  params.push(restaurant.locationScope.location_ids);
  return ` AND ${column}=ANY($${params.length}::bigint[])`;
}
function itemsInput(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) v.invalid('audit items');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) v.invalid('audit item');
    const maxScore = item.maxScore === undefined ? 5 : v.integer(item.maxScore, 'maxScore', 1, 1000);
    const weight = item.weight === undefined ? 1 : item.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 1000) v.invalid('weight');
    return {
      label: v.text(item.label, 'label', 255),
      instructions: v.text(item.instructions, 'instructions', 10000, {
        optional: true
      }),
      maxScore,
      weight
    };
  });
}
function category(value) {
  if (!AUDIT_CATEGORIES.includes(value)) v.invalid('category');
  return value;
}
async function loadTemplates(restaurantId, db = pool) {
  const {
    rows
  } = await db.query('SELECT * FROM restaurant_audit_templates WHERE restaurant_id=$1 AND archived_at IS NULL ORDER BY is_active DESC, sort_order, id', [restaurantId]);
  if (!rows.length) return [];
  const {
    rows: items
  } = await db.query('SELECT * FROM restaurant_audit_items WHERE template_id=ANY($1::bigint[]) AND is_active=TRUE ORDER BY sort_order,id', [rows.map(r => r.id)]);
  return rows.map(r => ({
    ...r,
    items: items.filter(i => String(i.template_id) === String(r.id))
  }));
}
async function insertItems(client, templateId, items) {
  const created = [];
  for (const [index, item] of items.entries()) {
    const {
      rows: [row]
    } = await client.query(`INSERT INTO restaurant_audit_items(template_id,label,instructions,max_score,weight,sort_order)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [templateId, item.label, item.instructions, item.maxScore, item.weight, index]);
    created.push(row);
  }
  return created;
}
async function runItems(client, audit) {
  if (Array.isArray(audit.snapshot_items)) return audit.snapshot_items;
  const {
    rows
  } = await client.query('SELECT * FROM restaurant_audit_items WHERE template_id=$1 AND is_active=TRUE ORDER BY sort_order,id', [audit.template_id]);
  return rows;
}
async function selectLocation(client, restaurant, requested) {
  const scope = restaurant.locationScope;
  let id = requested == null ? null : v.integer(requested, 'locationId');
  if (id == null && scope.mode === 'assigned') {
    if (scope.location_ids.length !== 1) v.invalid('locationId');
    id = scope.location_ids[0];
  }
  if (id != null) assertStore(restaurant, id);
  const {
    rows: [location]
  } = await client.query(`SELECT id,timezone FROM restaurant_locations WHERE restaurant_id=$1 AND status <> 'archived'
    AND (($2::bigint IS NULL AND is_primary=TRUE) OR id=$2) ORDER BY id LIMIT 1`, [restaurant.id, id]);
  if (!location) throw new AppError('Location not found', 404, 'location_not_found');
  return location;
}
exports.listTemplates = async (req, res, next) => {
  try {
    const r = await access(req);
    res.json({
      templates: await loadTemplates(r.id)
    });
  } catch (e) {
    next(e);
  }
};
exports.createTemplate = async (req, res, next) => {
  try {
    const r = await access(req);
    await manage(r, req.user.id, true);
    const body = req.body || {};
    const name = v.text(body.name, 'name', 160),
      description = v.text(body.description, 'description', 10000, {
        optional: true
      });
    const cat = category(body.category ?? 'general'),
      input = itemsInput(body.items);
    const template = await withTransaction(pool, async client => {
      const {
        rows: [row]
      } = await client.query(`INSERT INTO restaurant_audit_templates(restaurant_id,name,description,category,created_by)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [r.id, name, description, cat, req.user.id]);
      const items = await insertItems(client, row.id, input);
      await auditEvent(client, req, r, 'audit_template.created', 'audit_template', null, row);
      return {
        ...row,
        items
      };
    }, 'audit_template_create');
    res.status(201).json({
      template
    });
  } catch (e) {
    next(e);
  }
};
exports.updateTemplate = async (req, res, next) => {
  try {
    const r = await access(req);
    await manage(r, req.user.id, true);
    const id = v.integer(req.params.templateId, 'templateId'),
      body = req.body || {};
    const input = body.items === undefined ? null : itemsInput(body.items);
    const template = await withTransaction(pool, async client => {
      const {
        rows: [before]
      } = await client.query('SELECT * FROM restaurant_audit_templates WHERE id=$1 AND restaurant_id=$2 AND archived_at IS NULL FOR UPDATE', [id, r.id]);
      if (!before) throw new AppError('Audit template not found', 404, 'template_not_found');
      const {
        rows: [row]
      } = await client.query(`UPDATE restaurant_audit_templates SET name=$3,description=$4,category=$5,is_active=$6,updated_at=NOW()
        WHERE id=$1 AND restaurant_id=$2 RETURNING *`, [id, r.id, body.name === undefined ? before.name : v.text(body.name, 'name', 160), body.description === undefined ? before.description : v.text(body.description, 'description', 10000, {
        optional: true
      }), body.category === undefined ? before.category : category(body.category), body.isActive === undefined ? before.is_active : v.boolean(body.isActive, 'isActive')]);
      if (input !== null) {
        await client.query('UPDATE restaurant_audit_items SET is_active=FALSE WHERE template_id=$1', [id]);
        await insertItems(client, id, input);
      }
      await auditEvent(client, req, r, 'audit_template.updated', 'audit_template', before, row);
      return (await loadTemplates(r.id, client)).find(t => Number(t.id) === id);
    }, 'audit_template_update');
    res.json({
      template
    });
  } catch (e) {
    next(e);
  }
};
exports.deleteTemplate = async (req, res, next) => {
  try {
    const r = await access(req);
    await manage(r, req.user.id, true);
    const id = v.integer(req.params.templateId, 'templateId');
    await withTransaction(pool, async client => {
      const {
        rows: [row]
      } = await client.query('UPDATE restaurant_audit_templates SET is_active=FALSE,archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 RETURNING *', [id, r.id]);
      if (!row) throw new AppError('Audit template not found', 404, 'template_not_found');
      await auditEvent(client, req, r, 'audit_template.archived', 'audit_template', null, row);
    }, 'audit_template_archive');
    res.json({
      deleted: true
    });
  } catch (e) {
    next(e);
  }
};
exports.startAudit = async (req, res, next) => {
  try {
    const r = await access(req),
      id = v.integer(req.params.templateId, 'templateId');
    const audit = await withTransaction(pool, async client => {
      const {
        rows: [template]
      } = await client.query('SELECT id FROM restaurant_audit_templates WHERE id=$1 AND restaurant_id=$2 AND is_active=TRUE FOR SHARE', [id, r.id]);
      if (!template) throw new AppError('Audit template not found', 404, 'template_not_found');
      const location = await selectLocation(client, r, req.body?.locationId);
      const locationId = location.id;
      const {
        rows: items
      } = await client.query('SELECT * FROM restaurant_audit_items WHERE template_id=$1 AND is_active=TRUE ORDER BY sort_order,id', [id]);
      const {
        rows: [row]
      } = await client.query(`INSERT INTO restaurant_audits(template_id,restaurant_id,auditor_id,location_id,snapshot_items,business_day)
        VALUES($1,$2,$3,$4,$5::jsonb,(NOW() AT TIME ZONE $6)::date) RETURNING *`, [id, r.id, req.user.id, locationId, JSON.stringify(items), resolveReportTimezone({ timezone: location.timezone || r.timezone })]);
      await auditEvent(client, req, r, 'audit.started', 'audit', null, row, locationId);
      return row;
    }, 'audit_start');
    res.status(201).json({
      audit
    });
  } catch (e) {
    next(e);
  }
};
exports.getAudit = async (req, res, next) => {
  try {
    const r = await access(req),
      id = v.integer(req.params.auditId, 'auditId');
    const params = [id, r.id],
      filter = storeWhere(r, 'a.location_id', params,req.query?.locationId);
    const {
      rows: [audit]
    } = await pool.query(`SELECT a.*,t.name AS template_name FROM restaurant_audits a JOIN restaurant_audit_templates t ON t.id=a.template_id
      WHERE a.id=$1 AND a.restaurant_id=$2${filter}`, params);
    if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
    const [{
      rows: scores
    }, {
      rows: findings
    }] = await Promise.all([pool.query('SELECT * FROM restaurant_audit_scores WHERE audit_id=$1 ORDER BY id', [id]), pool.query('SELECT f.*,u.first_name,u.last_name FROM restaurant_audit_findings f LEFT JOIN users u ON u.id=f.created_by WHERE f.audit_id=$1 ORDER BY f.created_at,f.id', [id])]);
    res.json({
      audit: {
        ...audit,
        scores,
        findings
      }
    });
  } catch (e) {
    next(e);
  }
};
exports.listAudits = async (req, res, next) => {
  try {
    const r = await access(req),
      {
        limit,
        offset
      } = page(req.query),
      params = [r.id];
    const filter = storeWhere(r, 'a.location_id', params,req.query?.locationId);
    params.push(limit, offset);
    const {
      rows
    } = await pool.query(`SELECT a.*,t.name AS template_name,u.first_name AS auditor_first_name,u.last_name AS auditor_last_name,
      (SELECT COUNT(*) FROM restaurant_audit_findings f WHERE f.audit_id=a.id) AS finding_count,
      (SELECT COUNT(*) FROM restaurant_corrective_actions ca WHERE ca.audit_id=a.id AND ca.status <> 'verified') AS open_action_count
      FROM restaurant_audits a JOIN restaurant_audit_templates t ON t.id=a.template_id LEFT JOIN users u ON u.id=a.auditor_id
      WHERE a.restaurant_id=$1${filter} ORDER BY a.started_at DESC,a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({
      audits: rows,
      limit,
      offset
    });
  } catch (e) {
    next(e);
  }
};
exports.scoreItem = async (req, res, next) => {
  try {
    const r = await access(req),
      id = v.integer(req.params.auditId, 'auditId'),
      itemId = v.integer(req.body?.itemId, 'itemId');
    const score = v.integer(req.body?.score, 'score', 0, 1000),
      note = v.text(req.body?.note, 'note', 10000, {
        optional: true
      });
    await withTransaction(pool, async client => {
      const {
        rows: [audit]
      } = await client.query('SELECT * FROM restaurant_audits WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, r.id]);
      if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
      await writable(r, audit, req.user.id);
      if (audit.status !== 'in_progress') throw new AppError('Audit is not in progress', 409, 'audit_closed');
      const item = (await runItems(client, audit)).find(i => Number(i.id) === itemId);
      if (!item) throw new AppError('Audit item not found', 404, 'item_not_found');
      if (score > Number(item.max_score)) v.invalid('score');
      await client.query(`INSERT INTO restaurant_audit_scores(audit_id,item_id,label,score,max_score,weight,note) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(audit_id,item_id) DO UPDATE SET score=EXCLUDED.score,note=EXCLUDED.note`, [id, itemId, item.label, score, item.max_score, item.weight, note]);
      await auditEvent(client, req, r, 'audit.scored', 'audit', null, {
        id,
        item_id: itemId,
        score
      }, audit.location_id);
    }, 'audit_score');
    res.json({
      scored: true,
      score
    });
  } catch (e) {
    next(e);
  }
};
exports.completeAudit = async (req, res, next) => {
  try {
    const r = await access(req),
      id = v.integer(req.params.auditId, 'auditId'),
      notes = v.text(req.body?.notes, 'notes', 10000, {
        optional: true
      });
    const audit = await withTransaction(pool, async client => {
      const {
        rows: [before]
      } = await client.query('SELECT * FROM restaurant_audits WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, r.id]);
      if (!before) throw new AppError('Audit not found', 404, 'audit_not_found');
      await writable(r, before, req.user.id);
      if (before.status !== 'in_progress') throw new AppError('Audit is not in progress', 409, 'audit_closed');
      const items = await runItems(client, before);
      const {
        rows: scores
      } = await client.query('SELECT * FROM restaurant_audit_scores WHERE audit_id=$1', [id]);
      const required = items.map(i => scores.find(s => Number(s.item_id) === Number(i.id)));
      if (!items.length || required.some(s => !s)) throw new AppError('Score every audit item before completion', 409, 'audit_incomplete');
      const total = required.reduce((sum, s) => sum + Number(s.score) * Number(s.weight), 0),
        max = required.reduce((sum, s) => sum + Number(s.max_score) * Number(s.weight), 0);
      const {
        rows: [row]
      } = await client.query(`UPDATE restaurant_audits SET status='completed',total_score=$3,max_score=$4,notes=COALESCE($5,notes),completed_at=NOW()
        WHERE id=$1 AND restaurant_id=$2 RETURNING *`, [id, r.id, total, max, notes]);
      await auditEvent(client, req, r, 'audit.completed', 'audit', before, row, before.location_id);
      const { rows: findings } = await client.query('SELECT * FROM restaurant_audit_findings WHERE audit_id=$1 ORDER BY created_at,id', [id]);
      return { ...row, scores, findings };
    }, 'audit_complete');
    res.json({
      audit
    });
  } catch (e) {
    next(e);
  }
};
exports.addFinding = async (req, res, next) => {
  try {
    const r = await access(req),
      id = v.integer(req.params.auditId, 'auditId'),
      body = req.body || {};
    const input = {
      note: v.text(body.note, 'note', 10000),
      severity: body.severity ?? 'medium',
      photo: body.photoUrl == null ? null : v.text(body.photoUrl, 'photoUrl', 2000),
      itemId: body.itemId == null ? null : v.integer(body.itemId, 'itemId'),
      key: body.clientKey == null ? null : v.text(body.clientKey, 'clientKey', 180)
    };
    if (!SEVERITIES.includes(input.severity)) v.invalid('severity');
    const result = await withTransaction(pool, async client => {
      const {
        rows: [audit]
      } = await client.query('SELECT * FROM restaurant_audits WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [id, r.id]);
      if (!audit) throw new AppError('Audit not found', 404, 'audit_not_found');
      await writable(r, audit, req.user.id);
      if (input.key) {
        const {
          rows: [old]
        } = await client.query('SELECT * FROM restaurant_audit_findings WHERE audit_id=$1 AND client_key=$2', [id, input.key]);
        if (old) {
          if (old.note !== input.note || old.severity !== input.severity || (old.photo_url || null) !== input.photo || Number(old.item_id || 0) !== Number(input.itemId || 0) || String(old.created_by) !== String(req.user.id)) throw new AppError('Finding retry conflicts with the original', 409, 'finding_idempotency_conflict');
          return {
            finding: old,
            replayed: true
          };
        }
      }
      if (audit.status !== 'in_progress') throw new AppError('Audit is not in progress', 409, 'audit_closed');
      if (input.itemId && !(await runItems(client, audit)).some(i => Number(i.id) === input.itemId)) throw new AppError('Audit item not found', 404, 'item_not_found');
      const {
        rows: [row]
      } = await client.query(`INSERT INTO restaurant_audit_findings(audit_id,item_id,severity,note,photo_url,created_by,client_key)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id, input.itemId, input.severity, input.note, input.photo, req.user.id, input.key]);
      await auditEvent(client, req, r, 'audit.finding_created', 'audit_finding', null, row, audit.location_id);
      return {
        finding: row,
        replayed: false
      };
    }, 'audit_finding');
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (e) {
    next(e);
  }
};
exports.createCorrectiveAction = async (req, res, next) => {
  try {
    const r = await access(req);
    await manage(r, req.user.id);
    const id = v.integer(req.params.findingId, 'findingId'),
      body = req.body || {};
    const description = v.text(body.description, 'description', 10000),
      assignee = body.assigneeId == null ? null : v.uuid(body.assigneeId, 'assigneeId'),
      due = v.timestamp(body.dueAt, 'dueAt');
    const action = await withTransaction(pool, async client => {
      const {
        rows: [finding]
      } = await client.query(`SELECT f.*,a.location_id FROM restaurant_audit_findings f JOIN restaurant_audits a ON a.id=f.audit_id
        WHERE f.id=$1 AND a.restaurant_id=$2 FOR SHARE OF a`, [id, r.id]);
      if (!finding) throw new AppError('Finding not found', 404, 'finding_not_found');
      assertStore(r, finding.location_id);
      if (assignee) await assertStaff(r, assignee, client);
      const {
        rows: [row]
      } = await client.query(`INSERT INTO restaurant_corrective_actions(finding_id,audit_id,description,assignee_id,due_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [id, finding.audit_id, description, assignee, due, req.user.id]);
      await auditEvent(client, req, r, 'audit.action_created', 'corrective_action', null, row, finding.location_id);
      return row;
    }, 'audit_action_create');
    res.status(201).json({
      action
    });
  } catch (e) {
    next(e);
  }
};
exports.listCorrectiveActions = async (req, res, next) => {
  try {
    const r = await access(req),
      manager = await permissions.hasRestaurantPermission(r, req.user.id, ['audit.view']),
      params = [r.id],
      {
        limit,
        offset
      } = page(req.query);
    let filter = storeWhere(r, 'a.location_id', params,req.query?.locationId);
    if (req.query.mine === '1' || !manager) {
      params.push(req.user.id);
      filter += ` AND ca.assignee_id=$${params.length}`;
    }
    if (req.query.status) {
      if (!ACTION_STATUSES.includes(req.query.status)) v.invalid('status');
      params.push(req.query.status);
      filter += ` AND ca.status=$${params.length}`;
    }
    params.push(limit, offset);
    const {
      rows
    } = await pool.query(`SELECT ca.*,f.note AS finding_note,f.severity,u.first_name AS assignee_first_name,u.last_name AS assignee_last_name
      FROM restaurant_corrective_actions ca JOIN restaurant_audit_findings f ON f.id=ca.finding_id JOIN restaurant_audits a ON a.id=ca.audit_id
      LEFT JOIN users u ON u.id=ca.assignee_id WHERE a.restaurant_id=$1${filter} ORDER BY ca.created_at DESC,ca.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({
      actions: rows,
      limit,
      offset
    });
  } catch (e) {
    next(e);
  }
};
exports.updateCorrectiveAction = async (req, res, next) => {
  try {
    const r = await access(req),
      id = v.integer(req.params.actionId, 'actionId'),
      status = req.body?.status;
    if (!ACTION_STATUSES.includes(status)) v.invalid('status');
    const manager = await canManage(r, req.user.id);
    const action = await withTransaction(pool, async client => {
      const {
        rows: [before]
      } = await client.query(`SELECT ca.*,a.location_id FROM restaurant_corrective_actions ca JOIN restaurant_audits a ON a.id=ca.audit_id
        WHERE ca.id=$1 AND a.restaurant_id=$2 FOR UPDATE OF ca`, [id, r.id]);
      if (!before) throw new AppError('Action not found', 404, 'action_not_found');
      assertStore(r, before.location_id);
      if (status === 'verified' && !manager || !manager && String(before.assignee_id) !== String(req.user.id)) throw new AppError('Action access denied', 403, 'forbidden');
      if (status === before.status) return before;
      const allowed = {
        open: ['in_progress'],
        in_progress: ['resolved'],
        resolved: manager ? ['verified', 'in_progress'] : [],
        verified: []
      };
      if (!allowed[before.status]?.includes(status)) throw new AppError('Invalid corrective action transition', 409, 'action_transition_invalid');
      const {
        rows: [row]
      } = await client.query(`UPDATE restaurant_corrective_actions SET status=$2::text,
        resolved_at=CASE WHEN $2::text='resolved' THEN NOW() WHEN $2::text='in_progress' THEN NULL ELSE resolved_at END,updated_at=NOW()
        WHERE id=$1 RETURNING *`, [id, status]);
      await auditEvent(client, req, r, 'audit.action_updated', 'corrective_action', before, row, before.location_id);
      return row;
    }, 'audit_action_update');
    res.json({
      action
    });
  } catch (e) {
    next(e);
  }
};
exports.auditCategories = AUDIT_CATEGORIES;
exports.auditStatuses = AUDIT_STATUSES;
exports.severities = SEVERITIES;
exports.actionStatuses = ACTION_STATUSES;
exports._validation = {
  itemsInput,
  page
};
