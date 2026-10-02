'use strict';

/**
 * M5 — Market Governance workspace (super-admin only).
 *
 * Two versioned, audited registries:
 *
 *   policy_rules — the marketplace policy registry (code of conduct,
 *     fraud, content moderation, disputes, ...). An admin CRUD registry
 *     ONLY: it is separate from the mode-policy runtime that actually
 *     enforces platform behavior. Edits bump the version; retirement is
 *     an explicit lifecycle step, never a silent delete.
 *
 *   contracts — a records registry of executed vendor / partner /
 *     contractor agreements (counterparty, type, signed + expiry dates).
 *     Records only: legal execution, signatures, and counsel review stay
 *     operational and are not handled here.
 *
 * Every mutation writes an admin audit row.
 */

const db = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');

const POLICY_STATUSES = ['draft', 'active', 'retired'];
const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated'];
const POLICY_CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function bad(res, message, code) {
  return res.status(400).json({ error: message, code });
}

function notFound(res, what) {
  return res.status(404).json({ error: `${what} not found.`, code: 'not_found' });
}

function duplicate(res, message, code) {
  return res.status(409).json({ error: message, code });
}

function handleDbError(res, err, next, dupMessage, dupCode) {
  if (err && err.code === '23505') return duplicate(res, dupMessage, dupCode);
  return next(err);
}

function requireText(value, maxLen) {
  const text = String(value || '').trim();
  if (!text) return null;
  return maxLen ? text.slice(0, maxLen) : text;
}

function validStatus(status, allowed) {
  return status === undefined || allowed.includes(status);
}

function checkDateOrder(signedAt, expiresAt) {
  if (!signedAt || !expiresAt) return true;
  return new Date(expiresAt) >= new Date(signedAt);
}

// ── Policy rules ─────────────────────────────────────────────────────────────

exports.listPolicies = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM policy_rules ORDER BY category, code`
    );
    return res.json({ policies: rows });
  } catch (err) {
    return next(err);
  }
};

exports.createPolicy = async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim().toLowerCase();
    const title = requireText(req.body?.title, 200);
    const category = requireText(req.body?.category, 80);
    const body = requireText(req.body?.body);
    const effectiveFrom = req.body?.effective_from || null;

    if (!POLICY_CODE_RE.test(code)) {
      return bad(res, 'Policy code must be a lowercase slug (letters, numbers, hyphens).', 'invalid_policy_code');
    }
    if (!title || !category || !body) {
      return bad(res, 'title, category, and body are required.', 'policy_fields_required');
    }

    const { rows } = await db.query(
      `INSERT INTO policy_rules (code, title, category, body, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [code, title, category, body, effectiveFrom, req.user.id]
    );
    const policy = rows[0];

    await logAdminAction({
      adminId: req.user.id,
      action: 'policy_rule_created',
      targetType: 'policy_rule',
      targetKey: String(policy.id),
      description: `Created policy rule ${code} (v${policy.version}).`,
      after: { code, title, category, status: policy.status },
    });

    logger.info('Policy rule created', { policyId: policy.id, code });
    return res.status(201).json({ policy });
  } catch (err) {
    return handleDbError(res, err, next, 'A policy with this code already exists.', 'policy_code_duplicate');
  }
};

exports.updatePolicy = async (req, res, next) => {
  try {
    const { title, category, body, status, effective_from } = req.body || {};
    if (!validStatus(status, POLICY_STATUSES)) {
      return bad(res, `status must be one of: ${POLICY_STATUSES.join(', ')}.`, 'invalid_policy_status');
    }
    const updates = [];
    const params = [];
    const push = (fragment, value) => { params.push(value); updates.push(`${fragment} $${params.length}`); };
    if (title !== undefined) push('title =', requireText(title, 200));
    if (category !== undefined) push('category =', requireText(category, 80));
    if (body !== undefined) push('body =', requireText(body));
    if (status !== undefined) push('status =', status);
    if (effective_from !== undefined) push('effective_from =', effective_from || null);
    if (!updates.length) {
      return bad(res, 'Nothing to update.', 'policy_no_updates');
    }

    const { rows } = await db.query(
      `UPDATE policy_rules
          SET ${updates.join(', ')}, version = version + 1, updated_at = NOW()
        WHERE id = $${params.length + 1}
        RETURNING *`,
      [...params, req.params.id]
    );
    if (!rows.length) return notFound(res, 'Policy');

    await logAdminAction({
      adminId: req.user.id,
      action: 'policy_rule_updated',
      targetType: 'policy_rule',
      targetKey: String(req.params.id),
      description: `Updated policy rule ${rows[0].code} to v${rows[0].version}.`,
      after: { version: rows[0].version, status: rows[0].status },
    });

    return res.json({ policy: rows[0] });
  } catch (err) {
    return next(err);
  }
};

exports.retirePolicy = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE policy_rules
          SET status = 'retired', version = version + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return notFound(res, 'Policy');

    await logAdminAction({
      adminId: req.user.id,
      action: 'policy_rule_retired',
      targetType: 'policy_rule',
      targetKey: String(req.params.id),
      description: `Retired policy rule ${rows[0].code} (v${rows[0].version}).`,
      after: { status: 'retired', version: rows[0].version },
    });

    return res.json({ policy: rows[0] });
  } catch (err) {
    return next(err);
  }
};

// ── Contracts ────────────────────────────────────────────────────────────────

exports.listContracts = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM contracts ORDER BY expires_at NULLS LAST, created_at DESC`
    );
    return res.json({ contracts: rows });
  } catch (err) {
    return next(err);
  }
};

exports.createContract = async (req, res, next) => {
  try {
    const counterparty = requireText(req.body?.counterparty, 200);
    const contractType = requireText(req.body?.contract_type, 80);
    const title = requireText(req.body?.title, 200);
    const signedAt = req.body?.signed_at || null;
    const expiresAt = req.body?.expires_at || null;
    const storageRef = requireText(req.body?.storage_ref, 500);
    const notes = requireText(req.body?.notes);

    if (!counterparty || !contractType || !title) {
      return bad(res, 'counterparty, contract_type, and title are required.', 'contract_fields_required');
    }
    if (!checkDateOrder(signedAt, expiresAt)) {
      return bad(res, 'expires_at cannot be before signed_at.', 'contract_dates_invalid');
    }

    const { rows } = await db.query(
      `INSERT INTO contracts (counterparty, contract_type, title, signed_at, expires_at, storage_ref, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [counterparty, contractType, title, signedAt, expiresAt, storageRef, notes, req.user.id]
    );
    const contract = rows[0];

    await logAdminAction({
      adminId: req.user.id,
      action: 'contract_created',
      targetType: 'contract',
      targetKey: String(contract.id),
      description: `Recorded contract "${title}" with ${counterparty}.`,
      after: { counterparty, contract_type: contractType, signed_at: signedAt, expires_at: expiresAt },
    });

    logger.info('Contract recorded', { contractId: contract.id, counterparty });
    return res.status(201).json({ contract });
  } catch (err) {
    return next(err);
  }
};

exports.updateContract = async (req, res, next) => {
  try {
    const { counterparty, contract_type, title, signed_at, expires_at, storage_ref, notes, status } = req.body || {};
    if (!validStatus(status, CONTRACT_STATUSES)) {
      return bad(res, `status must be one of: ${CONTRACT_STATUSES.join(', ')}.`, 'invalid_contract_status');
    }
    if (!checkDateOrder(signed_at, expires_at)) {
      return bad(res, 'expires_at cannot be before signed_at.', 'contract_dates_invalid');
    }

    const updates = [];
    const params = [];
    const push = (fragment, value) => { params.push(value); updates.push(`${fragment} $${params.length}`); };
    if (counterparty !== undefined) push('counterparty =', requireText(counterparty, 200));
    if (contract_type !== undefined) push('contract_type =', requireText(contract_type, 80));
    if (title !== undefined) push('title =', requireText(title, 200));
    if (signed_at !== undefined) push('signed_at =', signed_at || null);
    if (expires_at !== undefined) push('expires_at =', expires_at || null);
    if (storage_ref !== undefined) push('storage_ref =', requireText(storage_ref, 500));
    if (notes !== undefined) push('notes =', requireText(notes));
    if (status !== undefined) push('status =', status);
    if (!updates.length) {
      return bad(res, 'Nothing to update.', 'contract_no_updates');
    }

    const { rows } = await db.query(
      `UPDATE contracts
          SET ${updates.join(', ')}
        WHERE id = $${params.length + 1}
        RETURNING *`,
      [...params, req.params.id]
    );
    if (!rows.length) return notFound(res, 'Contract');

    await logAdminAction({
      adminId: req.user.id,
      action: 'contract_updated',
      targetType: 'contract',
      targetKey: String(req.params.id),
      description: `Updated contract "${rows[0].title}".`,
      after: { status: rows[0].status, expires_at: rows[0].expires_at },
    });

    return res.json({ contract: rows[0] });
  } catch (err) {
    return handleDbError(res, err, next, 'A conflicting contract record exists.', 'contract_conflict');
  }
};

exports.terminateContract = async (req, res, next) => {
  try {
    const reason = requireText(req.body?.reason, 500);
    const { rows } = await db.query(
      `UPDATE contracts
          SET status = 'terminated',
              notes = CASE
                        WHEN $2 IS NULL THEN notes
                        WHEN notes IS NULL OR notes = '' THEN 'Termination: ' || $2
                        ELSE notes || E'\nTermination: ' || $2
                      END
        WHERE id = $1
        RETURNING *`,
      [req.params.id, reason]
    );
    if (!rows.length) return notFound(res, 'Contract');

    await logAdminAction({
      adminId: req.user.id,
      action: 'contract_terminated',
      targetType: 'contract',
      targetKey: String(req.params.id),
      description: `Terminated contract "${rows[0].title}" with ${rows[0].counterparty}${reason ? `: ${reason}` : ''}.`,
      after: { status: 'terminated' },
    });

    return res.json({ contract: rows[0] });
  } catch (err) {
    return next(err);
  }
};
