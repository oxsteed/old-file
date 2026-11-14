// Legal Documents Controller - Acceptance Recording & Compliance Metrics
const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { validate, rules } = require('../utils/validate');
const { TERMS_CONFIG } = require('../constants/termsConfig');

const VALID_DOCUMENT_TYPES = [
  'contractor_agreement',
  'dispute_resolution',
  'account_termination',
  'privacy_policy',
  'biometric_data',
  'harassment_policy',
  'background_check',
  'arbitration',
  'escrow_policy',
  // Nov 2 admin-ops audit item 2 phase B: terms_of_service is a required
  // TermsGate consent (REQUIRED_CONSENTS) but was not a recordable
  // acceptance type, so it could neither be recorded nor revoked here.
  'terms_of_service'
];

/**
 * Phase B enforcement map: acceptance document type -> user_consents
 * consent_type cleared on revocation. Only these two acceptance types have
 * a user_consents counterpart (they are also REQUIRED_CONSENTS, the set
 * requireTermsAcceptance consults). Every other acceptance type maps to
 * nothing: revoking it stays record_only and must never touch consents,
 * so unrelated consents are never cleared by a revocation.
 */
const DOCUMENT_TO_CONSENT_TYPE = Object.freeze({
  terms_of_service: 'terms_of_service',
  privacy_policy: 'privacy_policy',
});

/**
 * Domain 7 #14: recordAcceptance reactivated a revoked row but never wrote
 * user_consents, while POST /api/consent/accept writes consents but never
 * reactivates the acceptance row — two unsynced stores. After a terms
 * revocation, re-accepting via the legal endpoint left TermsGate (which
 * reads only user_consents) 403ing until the user also hit /consent/accept
 * or logged in again.
 *
 * For mapped types, an acceptance now also (re-)inserts the user_consents
 * row at the current TERMS_CONFIG version, mirroring the direct insert in
 * recordLoginAgreement (same columns, same ip-hash). The SELECT-then-INSERT
 * keeps it idempotent: a consent written earlier via /consent/accept is
 * not duplicated (duplicates are harmless — the gate reads DISTINCT ON
 * latest — but there is no reason to add them). A failure here throws like
 * any other acceptance-write failure: a 201 with no consent row would
 * leave the user gated despite a successful-looking re-accept.
 */
async function ensureConsentRow(db, { userId, consentType, ip, userAgent }) {
  const existing = await db.query(
    'SELECT id FROM user_consents WHERE user_id = $1 AND consent_type = $2 LIMIT 1',
    [userId, consentType]
  );
  if (existing.rows.length > 0) return false;
  const version = TERMS_CONFIG[consentType]?.version;
  if (!version) return false;
  const ipHash = ip ? crypto.createHash('sha256').update(String(ip)).digest('hex') : null;
  await db.query(
    `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, consentType, version, ipHash, userAgent]
  );
  return true;
}

/**
 * Record a legal document acceptance
 * POST /api/legal/{documentType}/accept
 */
async function recordAcceptance(req, res, next) {
  try {
    const { documentType } = req.params;
    const { firstName, lastName, versionNumber } = req.body;
    const userId = req.user?.id;

    const errs = validate(req.body, {
      firstName: [rules.required, rules.minLen(1), rules.maxLen(255), rules.noScript],
      lastName: [rules.required, rules.minLen(1), rules.maxLen(255), rules.noScript],
      // NOTE: utils/validate exports `integer`, not `isInt`, and has no
      // `min` rule; the previous names threw a TypeError on every accept
      // call before any database check ran.
      versionNumber: [rules.required, rules.integer]
    });
    if (errs) throw new AppError('Validation failed', 400, 'validation_failed', errs);
    if (Number(versionNumber) < 1) {
      throw new AppError('Validation failed', 400, 'validation_failed', { versionNumber: 'versionNumber must be at least 1' });
    }

    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
      throw new AppError('Invalid document type', 400, 'invalid_document_type');
    }

    if (!userId) throw new AppError('Authentication required', 401, 'unauthorized');

    const userCheck = await pool.query(
      'SELECT id, is_active, deleted_at FROM users WHERE id = $1',
      [userId]
    );
    if (userCheck.rows.length === 0) throw new AppError('User not found', 404, 'user_not_found');

    const user = userCheck.rows[0];
    if (!user.is_active || user.deleted_at) {
      throw new AppError('Account is not active', 403, 'account_inactive');
    }

    // Revoked rows (deleted_at set) are not active acceptances: they must
    // neither report alreadyAccepted nor block a fresh acceptance.
    const existing = await pool.query(
      'SELECT id FROM user_legal_acceptances WHERE user_id = $1 AND document_type = $2 AND version_number = $3 AND deleted_at IS NULL',
      [userId, documentType, versionNumber]
    );

    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;
    const consentType = DOCUMENT_TO_CONSENT_TYPE[documentType] || null;

    if (existing.rows.length > 0) {
      // Domain 7 #14: an active acceptance with no consent row (written
      // before this sync existed, or via the other store) still gates the
      // user out. Repair the missing consent on re-accept instead of
      // returning a success that leaves the gate 403ing.
      if (consentType) {
        await ensureConsentRow(pool, { userId, consentType, ip: ipAddress, userAgent });
      }
      logger.info('User already accepted document version', { userId, documentType, versionNumber });
      return res.json({
        success: true,
        alreadyAccepted: true,
        acceptanceId: existing.rows[0].id,
        acceptedAt: new Date().toISOString()
      });
    }

    // The (user, document_type, version_number) unique index from migration
    // 587 is not partial on deleted_at, so a revoked row still occupies the
    // triple. Re-accepting therefore reactivates that row with the fresh
    // signature data instead of inserting a duplicate: the revocation stays
    // visible in legal_audit_log, and the row again reads as active.
    const revoked = await pool.query(
      'SELECT id FROM user_legal_acceptances WHERE user_id = $1 AND document_type = $2 AND version_number = $3 AND deleted_at IS NOT NULL',
      [userId, documentType, versionNumber]
    );

    let result;
    if (revoked.rows.length > 0) {
      result = await pool.query(
        `UPDATE user_legal_acceptances
         SET deleted_at = NULL, first_name = $4, last_name = $5, ip_address = $6, user_agent = $7,
             accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2 AND document_type = $3
         RETURNING id, accepted_at`,
        [revoked.rows[0].id, userId, documentType, firstName, lastName, ipAddress, userAgent]
      );
      // A concurrent re-accept could have reactivated the row first; fall
      // through to a plain insert only if this update matched nothing, and
      // let the unique index guard any remaining race.
      if (result.rows.length === 0) {
        result = await pool.query(
          `INSERT INTO user_legal_acceptances
           (user_id, document_type, version_number, first_name, last_name, ip_address, user_agent, accepted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           RETURNING id, accepted_at`,
          [userId, documentType, versionNumber, firstName, lastName, ipAddress, userAgent]
        );
      }
    } else {
      result = await pool.query(
        `INSERT INTO user_legal_acceptances
         (user_id, document_type, version_number, first_name, last_name, ip_address, user_agent, accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         RETURNING id, accepted_at`,
        [userId, documentType, versionNumber, firstName, lastName, ipAddress, userAgent]
      );
    }

    const acceptance = result.rows[0];

    // Domain 7 #14: re-accepting a mapped type also re-inserts the
    // user_consents row, so TermsGate stops 403ing without a second
    // /consent/accept call or a fresh login.
    if (consentType) {
      await ensureConsentRow(pool, { userId, consentType, ip: ipAddress, userAgent });
    }

    await logAuditAction(
      'acceptance',
      documentType,
      userId,
      userId,
      req.user?.role || 'user',
      acceptance.id,
      'user_legal_acceptance',
      'success',
      ipAddress,
      userAgent,
      { documentType, versionNumber, firstName, lastName }
    );

    logger.info('Legal document acceptance recorded', { userId, documentType, versionNumber });

    res.status(201).json({
      success: true,
      acceptanceId: acceptance.id,
      acceptedAt: acceptance.accepted_at,
      documentType,
      versionNumber
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get user's legal document acceptances
 * GET /api/legal/my-acceptances
 */
async function getUserAcceptances(req, res, next) {
  try {
    const userId = req.user?.id;
    const { documentType } = req.query;

    if (!userId) throw new AppError('Authentication required', 401, 'unauthorized');

    let query = 'SELECT * FROM user_legal_acceptances WHERE user_id = $1 AND deleted_at IS NULL';
    const params = [userId];

    if (documentType) {
      if (!VALID_DOCUMENT_TYPES.includes(documentType)) {
        throw new AppError('Invalid document type', 400, 'invalid_document_type');
      }
      query += ' AND document_type = $2';
      params.push(documentType);
    }

    query += ' ORDER BY accepted_at DESC';
    const result = await pool.query(query, params);

    res.json({
      success: true,
      acceptances: result.rows.map(row => ({
        id: row.id,
        documentType: row.document_type,
        versionNumber: row.version_number,
        firstName: row.first_name,
        lastName: row.last_name,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        acceptedAt: row.accepted_at,
        createdAt: row.created_at
      })),
      total: result.rows.length
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get acceptance history for a specific document type
 * GET /api/legal/{documentType}/history
 */
async function getAcceptanceHistory(req, res, next) {
  try {
    const { documentType } = req.params;
    const userId = req.user?.id;

    if (!userId) throw new AppError('Authentication required', 401, 'unauthorized');
    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
      throw new AppError('Invalid document type', 400, 'invalid_document_type');
    }

    const result = await pool.query(
      `SELECT * FROM user_legal_acceptances
       WHERE user_id = $1 AND document_type = $2 AND deleted_at IS NULL
       ORDER BY accepted_at DESC`,
      [userId, documentType]
    );

    res.json({
      success: true,
      documentType,
      history: result.rows.map(row => ({
        versionNumber: row.version_number,
        acceptedAt: row.accepted_at,
        firstName: row.first_name,
        lastName: row.last_name,
        ipAddress: row.ip_address,
        timestamp: row.accepted_at
      })),
      total: result.rows.length,
      latestVersion: result.rows.length > 0 ? result.rows[0].version_number : null
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List all user acceptances (admin only)
 * GET /api/admin/legal/acceptances
 */
async function listAllAcceptances(req, res, next) {
  try {
    const { documentType, startDate, endDate, search, sort = 'newest', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (isNaN(offset) || isNaN(limit) || parseInt(limit) > 500) {
      throw new AppError('Invalid pagination parameters', 400, 'invalid_pagination');
    }

    let countQuery = 'SELECT COUNT(*) as total FROM user_legal_acceptances ula JOIN users u ON ula.user_id = u.id WHERE ula.deleted_at IS NULL';
    let dataQuery = `SELECT ula.*, u.email, u.first_name as user_first_name, u.last_name as user_last_name
                    FROM user_legal_acceptances ula
                    JOIN users u ON ula.user_id = u.id
                    WHERE ula.deleted_at IS NULL`;
    const params = [];
    let paramCount = 1;

    if (documentType && VALID_DOCUMENT_TYPES.includes(documentType)) {
      countQuery += ` AND ula.document_type = $${paramCount}`;
      dataQuery += ` AND ula.document_type = $${paramCount}`;
      params.push(documentType);
      paramCount++;
    }

    if (startDate) {
      try {
        const date = new Date(startDate);
        countQuery += ` AND ula.accepted_at >= $${paramCount}`;
        dataQuery += ` AND ula.accepted_at >= $${paramCount}`;
        params.push(date);
        paramCount++;
      } catch (e) {
        throw new AppError('Invalid startDate format', 400, 'invalid_date');
      }
    }

    if (endDate) {
      try {
        const date = new Date(endDate);
        countQuery += ` AND ula.accepted_at <= $${paramCount}`;
        dataQuery += ` AND ula.accepted_at <= $${paramCount}`;
        params.push(date);
        paramCount++;
      } catch (e) {
        throw new AppError('Invalid endDate format', 400, 'invalid_date');
      }
    }

    if (search) {
      countQuery += ` AND (u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      dataQuery += ` AND (u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (sort === 'oldest') {
      dataQuery += ' ORDER BY ula.accepted_at ASC';
    } else if (sort === 'name_asc') {
      dataQuery += ' ORDER BY u.first_name ASC, u.last_name ASC';
    } else {
      dataQuery += ' ORDER BY ula.accepted_at DESC';
    }

    dataQuery += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    // T56-F01: the count query takes only the filter params (no LIMIT/OFFSET).
    // paramCount is 1-based, so the filter count is paramCount - 1.
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, params.slice(0, paramCount - 1)),
      pool.query(dataQuery, params)
    ]);

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / parseInt(limit));

    const thisMonthParams = params.slice(0, paramCount - 1);
    thisMonthParams.push(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    let thisMonthQuery = countQuery + ` AND ula.accepted_at >= $${thisMonthParams.length}`;
    const thisMonthResult = await pool.query(thisMonthQuery, thisMonthParams);
    const thisMonth = parseInt(thisMonthResult.rows[0].total);

    logger.info('Listed legal acceptances', { total, thisMonth, page, limit, documentType });

    res.json({
      success: true,
      acceptances: dataResult.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.email,
        userName: `${row.user_first_name} ${row.user_last_name}`,
        documentType: row.document_type,
        versionNumber: row.version_number,
        firstName: row.first_name,
        lastName: row.last_name,
        ipAddress: row.ip_address,
        acceptedAt: row.accepted_at,
        createdAt: row.created_at
      })),
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages },
      stats: { totalAcceptances: total, thisMonth, byDocumentType: await getAcceptancesByType(documentType) }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get compliance metrics dashboard
 * GET /api/admin/legal/compliance-metrics
 */
async function getComplianceMetrics(req, res, next) {
  try {
    const totalUsersResult = await pool.query(
      'SELECT COUNT(*) as total FROM users WHERE is_active = TRUE AND deleted_at IS NULL'
    );
    const totalUsers = parseInt(totalUsersResult.rows[0].total);

    const acceptanceRates = {};
    for (const docType of VALID_DOCUMENT_TYPES) {
      const result = await pool.query(
        'SELECT COUNT(DISTINCT user_id) as accepted FROM user_legal_acceptances WHERE document_type = $1 AND deleted_at IS NULL',
        [docType]
      );
      const accepted = parseInt(result.rows[0].accepted);
      acceptanceRates[docType] = totalUsers > 0 ? (accepted / totalUsers * 100).toFixed(2) : 0;
    }

    const ccpaThisMonthResult = await pool.query(
      `SELECT COUNT(*) as total FROM ccpa_data_requests
       WHERE submitted_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)`
    );
    const ccpaThisMonth = parseInt(ccpaThisMonthResult.rows[0].total);

    const ccpaPendingResult = await pool.query(
      "SELECT COUNT(*) as total FROM ccpa_data_requests WHERE status IN ('pending', 'processing')"
    );
    const ccpaPending = parseInt(ccpaPendingResult.rows[0].total);

    const ccpaAvgTimeResult = await pool.query(
      `SELECT AVG(EXTRACT(DAY FROM (completed_at - submitted_at))) as avg_days
       FROM ccpa_data_requests
       WHERE status = 'completed' AND completed_at IS NOT NULL`
    );
    const ccpaAvgTime = ccpaAvgTimeResult.rows[0].avg_days
      ? parseFloat(ccpaAvgTimeResult.rows[0].avg_days).toFixed(2)
      : null;

    const trendResult = await pool.query(
      `SELECT DATE(accepted_at) as date, COUNT(*) as count
       FROM user_legal_acceptances
       WHERE accepted_at >= CURRENT_TIMESTAMP - INTERVAL '90 days' AND deleted_at IS NULL
       GROUP BY DATE(accepted_at)
       ORDER BY date ASC`
    );

    logger.info('Retrieved compliance metrics', { totalUsers, ccpaThisMonth, ccpaPending });

    res.json({
      success: true,
      metrics: {
        totalActiveUsers: totalUsers,
        acceptanceRates,
        documentStatus: { draft: 0, inReview: 0, approved: 0, published: 0 },
        ccpaMetrics: {
          thisMonth: ccpaThisMonth,
          pending: ccpaPending,
          avgResponseTimeDays: ccpaAvgTime,
          byType: await getCCPAMetricsByType()
        },
        trends: {
          last90Days: trendResult.rows.map(row => ({
            date: row.date,
            acceptanceCount: parseInt(row.count)
          }))
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get audit log entries
 * GET /api/admin/legal/audit-log
 */
async function getAuditLog(req, res, next) {
  try {
    const { action, documentType, startDate, endDate, sort = 'newest', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (isNaN(offset) || isNaN(limit) || parseInt(limit) > 500) {
      throw new AppError('Invalid pagination parameters', 400, 'invalid_pagination');
    }

    let countQuery = 'SELECT COUNT(*) as total FROM legal_audit_log WHERE 1=1';
    let dataQuery = `SELECT lal.*, u.first_name, u.last_name, u.email
                    FROM legal_audit_log lal
                    LEFT JOIN users u ON lal.actor_id = u.id
                    WHERE 1=1`;
    const params = [];
    let paramCount = 1;

    if (action) {
      countQuery += ` AND action_type = $${paramCount}`;
      dataQuery += ` AND action_type = $${paramCount}`;
      params.push(action);
      paramCount++;
    }

    if (documentType) {
      countQuery += ` AND document_type = $${paramCount}`;
      dataQuery += ` AND document_type = $${paramCount}`;
      params.push(documentType);
      paramCount++;
    }

    if (startDate) {
      try {
        const date = new Date(startDate);
        countQuery += ` AND created_at >= $${paramCount}`;
        dataQuery += ` AND created_at >= $${paramCount}`;
        params.push(date);
        paramCount++;
      } catch (e) {
        throw new AppError('Invalid startDate format', 400, 'invalid_date');
      }
    }

    if (endDate) {
      try {
        const date = new Date(endDate);
        countQuery += ` AND created_at <= $${paramCount}`;
        dataQuery += ` AND created_at <= $${paramCount}`;
        params.push(date);
        paramCount++;
      } catch (e) {
        throw new AppError('Invalid endDate format', 400, 'invalid_date');
      }
    }

    if (sort === 'oldest') {
      dataQuery += ' ORDER BY created_at ASC';
    } else {
      dataQuery += ' ORDER BY created_at DESC';
    }

    dataQuery += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    // T56-F01: the count query takes only the filter params (no LIMIT/OFFSET).
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, params.slice(0, paramCount - 1)),
      pool.query(dataQuery, params)
    ]);

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      events: dataResult.rows.map(row => ({
        id: row.id,
        actionType: row.action_type,
        documentType: row.document_type,
        userId: row.user_id,
        actor: {
          id: row.actor_id,
          name: row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : 'Unknown',
          email: row.email,
          role: row.actor_role
        },
        resourceId: row.resource_id,
        resourceType: row.resource_type,
        status: row.status,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        metadata: row.metadata,
        createdAt: row.created_at
      })),
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Revoke a user's legal acceptance (admin only)
 * DELETE /api/admin/legal/acceptances/{acceptanceId}
 */
async function revokeAcceptance(req, res, next) {
  try {
    const { acceptanceId } = req.params;
    const { reason = 'admin_review' } = req.body;
    const adminId = req.user?.id;

    if (!acceptanceId) throw new AppError('Acceptance ID is required', 400, 'missing_acceptance_id');

    const validReasons = ['user_requested', 'admin_review', 'version_updated'];
    if (!validReasons.includes(reason)) {
      throw new AppError('Invalid revocation reason', 400, 'invalid_reason');
    }

    const acceptanceResult = await pool.query(
      'SELECT * FROM user_legal_acceptances WHERE id = $1',
      [acceptanceId]
    );

    if (acceptanceResult.rows.length === 0) {
      throw new AppError('Acceptance record not found', 404, 'not_found');
    }

    const acceptance = acceptanceResult.rows[0];

    if (acceptance.deleted_at) {
      throw new AppError('Acceptance already revoked', 409, 'already_revoked');
    }

    // Phase B enforcement: revoking an acceptance must clear the matching
    // user_consents rows so TermsGate (requireTermsAcceptance, which reads
    // only user_consents) actually blocks the user until they re-accept.
    // The consent rows are re-affirmations, one per login agreement, all
    // carrying the same current version: deleting only the latest would
    // leave an older same-version row that still satisfies the gate, so
    // every row for this user and the mapped consent type is deleted.
    // Unmapped document types clear nothing.
    //
    // Domain 7 #14: the consent DELETE and the acceptance UPDATE used to
    // be separate pool queries, so a crash between them left an
    // active-looking acceptance with no consent (fail-closed direction,
    // but inconsistent). Both writes now run in one transaction: either
    // both land or neither does. The audit log stays outside the
    // transaction — it must survive even if the revoke itself fails, and
    // its own insert already swallows errors.
    const consentType = DOCUMENT_TO_CONSENT_TYPE[acceptance.document_type] || null;
    let clearedConsents = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (consentType) {
        const cleared = await client.query(
          'DELETE FROM user_consents WHERE user_id = $1 AND consent_type = $2',
          [acceptance.user_id, consentType]
        );
        clearedConsents = cleared.rowCount || 0;
      }

      await client.query(
        `UPDATE user_legal_acceptances
         SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [acceptanceId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await logAuditAction(
      'revoked',
      acceptance.document_type,
      acceptance.user_id,
      adminId,
      req.user?.role || 'admin',
      acceptanceId,
      'user_legal_acceptance',
      'success',
      req.ip || null,
      req.get('user-agent') || null,
      { reason, documentType: acceptance.document_type, versionNumber: acceptance.version_number, consentType, clearedConsents }
    );

    logger.info('Legal acceptance revoked', {
      acceptanceId,
      documentType: acceptance.document_type,
      userId: acceptance.user_id,
      reason,
      revokedBy: adminId,
      consentType,
      clearedConsents,
    });

    res.json({
      success: true,
      enforcement: consentType ? 'consent_cleared' : 'record_only',
      consentType,
      clearedConsents,
      revokedAt: new Date().toISOString(),
      acceptanceId
    });
  } catch (err) {
    next(err);
  }
}

async function logAuditAction(actionType, documentType, userId, actorId, actorRole, resourceId, resourceType, status, ipAddress, userAgent, metadata) {
  try {
    await pool.query(
      `INSERT INTO legal_audit_log
       (action_type, document_type, user_id, actor_id, actor_role, resource_id, resource_type, status, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [actionType, documentType, userId, actorId, actorRole, resourceId, resourceType, status, ipAddress, userAgent, JSON.stringify(metadata)]
    );
  } catch (err) {
    logger.error('Failed to log audit action', { actionType, error: err.message });
  }
}

async function getAcceptancesByType(documentType) {
  try {
    if (documentType && VALID_DOCUMENT_TYPES.includes(documentType)) {
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM user_legal_acceptances WHERE document_type = $1 AND deleted_at IS NULL',
        [documentType]
      );
      return { [documentType]: parseInt(result.rows[0].count) };
    }

    const result = await pool.query(
      'SELECT document_type, COUNT(*) as count FROM user_legal_acceptances WHERE deleted_at IS NULL GROUP BY document_type'
    );

    const stats = {};
    result.rows.forEach(row => {
      stats[row.document_type] = parseInt(row.count);
    });
    return stats;
  } catch (err) {
    logger.error('Failed to get acceptance stats by type', { error: err.message });
    return {};
  }
}

async function getCCPAMetricsByType() {
  try {
    const result = await pool.query(
      `SELECT request_type, COUNT(*) as count,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
       FROM ccpa_data_requests
       GROUP BY request_type`
    );

    const stats = {};
    result.rows.forEach(row => {
      stats[row.request_type] = { total: parseInt(row.count), completed: parseInt(row.completed) };
    });
    return stats;
  } catch (err) {
    logger.error('Failed to get CCPA metrics by type', { error: err.message });
    return {};
  }
}

module.exports = {
  recordAcceptance,
  getUserAcceptances,
  getAcceptanceHistory,
  listAllAcceptances,
  getComplianceMetrics,
  getAuditLog,
  revokeAcceptance,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TO_CONSENT_TYPE
};
