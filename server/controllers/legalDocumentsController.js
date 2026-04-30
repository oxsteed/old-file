// Legal Documents Controller
// Manages T&C, Privacy Policy, and other legal documents with versioning, approvals, and i18n support

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

// ────────────────────────────────────────────────────────────
// PUBLIC ENDPOINTS
// ────────────────────────────────────────────────────────────

/**
 * GET /api/legal/documents/:category
 * Fetch published legal document in user's language
 */
const getLegalDocument = async (req, res, next) => {
  try {
    const { category } = req.params;
    const { language = 'en' } = req.query;

    // Validate category
    const validCategories = [
      'terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement',
      'payment_terms', 'dispute_resolution', 'data_retention', 'background_check_policy',
      'fcra_compliance', 'incident_response', 'accessibility_policy'
    ];
    if (!validCategories.includes(category)) {
      throw new AppError('Invalid document category', 400, 'invalid_category');
    }

    // Fetch live version
    const { rows } = await pool.query(
      `SELECT d.id, d.category, d.title, d.description, d.current_version,
              d.effective_date, d.published_at,
              COALESCE(dt.title, d.title) as title_localized,
              COALESCE(dt.content, d.current_content) as content
       FROM legal_documents d
       LEFT JOIN legal_document_translations dt ON d.id = dt.document_id
         AND dt.language_code = $2 AND dt.status = 'live'
       WHERE d.category = $1 AND d.status = 'live'
       ORDER BY d.published_at DESC LIMIT 1`,
      [category, language]
    );

    if (!rows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = rows[0];

    // Fetch sections
    const { rows: sections } = await pool.query(
      `SELECT s.id, s.section_key, s.title, s.content, s.section_order,
              s.is_critical, COALESCE(st.title, s.title) as title_localized,
              COALESCE(st.content, s.content) as content_localized
       FROM legal_document_sections s
       LEFT JOIN legal_section_translations st ON s.id = st.section_id
         AND st.language_code = $2 AND st.status = 'live'
       WHERE s.document_id = $1
       ORDER BY s.section_order`,
      [doc.id, language]
    );

    // Check if user has accepted this version
    let userAccepted = false;
    if (req.user) {
      const { rows: acceptanceRows } = await pool.query(
        `SELECT accepted_at FROM user_legal_acceptances_latest
         WHERE user_id = $1 AND document_id = $2 AND version_number = $3`,
        [req.user.id, doc.id, doc.current_version]
      );
      userAccepted = acceptanceRows.length > 0;
    }

    // Log view
    await logAuditEvent(req, 'document_viewed', 'document', doc.id, null);

    res.json({
      document: {
        id: doc.id,
        category: doc.category,
        title: doc.title_localized || doc.title,
        description: doc.description,
        version: doc.current_version,
        effectiveDate: doc.effective_date,
        publishedAt: doc.published_at,
        userAccepted,
        lastUpdated: doc.published_at
      },
      sections: sections.map(s => ({
        id: s.id,
        key: s.section_key,
        title: s.title_localized || s.title,
        content: s.content_localized || s.content,
        order: s.section_order,
        isCritical: s.is_critical
      })),
      language
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/legal/documents/:id/history
 * Fetch version history for a legal document
 */
const getDocumentHistory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT version_number, title, change_summary, created_at, published_at,
              created_by, published_by
       FROM legal_document_versions
       WHERE document_id = $1
       ORDER BY version_number DESC`,
      [id]
    );

    res.json({
      versions: rows.map(v => ({
        versionNumber: v.version_number,
        title: v.title,
        changeSummary: v.change_summary,
        createdAt: v.created_at,
        publishedAt: v.published_at,
        createdBy: v.created_by,
        publishedBy: v.published_by
      }))
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/legal/documents/:id/version/:versionNumber
 * Fetch specific version for comparison/history
 */
const getDocumentVersion = async (req, res, next) => {
  try {
    const { id, versionNumber } = req.params;

    const { rows } = await pool.query(
      `SELECT version_number, title, content, change_summary, effective_date
       FROM legal_document_versions
       WHERE document_id = $1 AND version_number = $2`,
      [id, parseInt(versionNumber)]
    );

    if (!rows[0]) {
      throw new AppError('Version not found', 404, 'not_found');
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/legal/documents/:id/accept
 * User accepts a legal document (with electronic signature)
 */
const acceptDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { firstName, lastName } = req.body;
    const userId = req.user.id;

    if (!firstName || !lastName) {
      throw new AppError('First and last name required', 400, 'validation_failed');
    }

    // Get current document version
    const { rows: docRows } = await pool.query(
      `SELECT id, current_version, status FROM legal_documents WHERE id = $1`,
      [id]
    );

    if (!docRows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = docRows[0];
    if (doc.status !== 'live') {
      throw new AppError('Document not published', 400, 'invalid_state');
    }

    // Check if already accepted
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM user_legal_acceptances_latest
       WHERE user_id = $1 AND document_id = $2 AND version_number = $3`,
      [userId, doc.id, doc.current_version]
    );

    if (existingRows.length > 0) {
      return res.json({ message: 'Already accepted' });
    }

    // Record acceptance
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    const { rows: acceptanceRows } = await pool.query(
      `INSERT INTO user_legal_acceptances (user_id, document_id, version_number,
        accepted_at, ip_address, user_agent, signature_first_name, signature_last_name, signature_timestamp)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, NOW())
       RETURNING id, accepted_at`,
      [userId, doc.id, doc.current_version, ipAddress, userAgent, firstName, lastName]
    );

    // Update latest acceptance denormalization table
    await pool.query(
      `INSERT INTO user_legal_acceptances_latest (user_id, document_id, version_number, accepted_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, document_id)
       DO UPDATE SET version_number = $3, accepted_at = NOW()`,
      [userId, doc.id, doc.current_version]
    );

    // Audit log
    await logAuditEvent(req, 'user_accepted', 'acceptance', acceptanceRows[0].id, doc.id);

    res.json({
      accepted: true,
      acceptedAt: acceptanceRows[0].accepted_at,
      version: doc.current_version
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/legal/my-acceptances
 * Fetch user's acceptance history
 */
const getUserAcceptances = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT a.id, d.category, d.title, a.version_number, a.accepted_at
       FROM user_legal_acceptances a
       JOIN legal_documents d ON a.document_id = d.id
       WHERE a.user_id = $1
       ORDER BY a.accepted_at DESC`,
      [userId]
    );

    res.json({
      acceptances: rows.map(a => ({
        id: a.id,
        category: a.category,
        title: a.title,
        version: a.version_number,
        acceptedAt: a.accepted_at
      }))
    });
  } catch (err) {
    next(err);
  }
};

// ────────────────────────────────────────────────────────────
// ADMIN ENDPOINTS
// ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/legal/documents
 * List all legal documents with optional status filter
 */
const listLegalDocuments = async (req, res, next) => {
  try {
    const { status } = req.query;

    let query = `SELECT id, category, title, description, current_version, status,
                        updated_at, created_at, created_by, published_at
                 FROM legal_documents`;
    const params = [];

    if (status && status !== 'all') {
      query += ` WHERE status = $1`;
      params.push(status);
    }

    query += ` ORDER BY updated_at DESC`;

    const { rows } = await pool.query(query, params);

    res.json({
      documents: rows.map(doc => ({
        id: doc.id,
        title: doc.title,
        category: doc.category.replace('_', ' '),
        version: doc.current_version,
        status: doc.status,
        updatedAt: doc.updated_at,
        createdAt: doc.created_at,
        publishedAt: doc.published_at
      }))
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/legal/documents
 * Create new legal document
 */
const createLegalDocument = async (req, res, next) => {
  try {
    const { category, title, description, content } = req.body;
    const userId = req.user.id;

    const validCategories = [
      'terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement',
      'payment_terms', 'dispute_resolution', 'data_retention', 'background_check_policy',
      'fcra_compliance', 'incident_response', 'accessibility_policy'
    ];

    if (!validCategories.includes(category) || !title || !content) {
      throw new AppError('Missing required fields', 400, 'validation_failed');
    }

    const { rows } = await pool.query(
      `INSERT INTO legal_documents (category, title, description, current_content, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, status, current_version`,
      [category, title, description || null, content, userId]
    );

    const doc = rows[0];

    // Create initial version
    await pool.query(
      `INSERT INTO legal_document_versions (document_id, version_number, title, content, status, created_by)
       VALUES ($1, 1, $2, $3, 'draft', $4)`,
      [doc.id, title, content, userId]
    );

    await logAuditEvent(req, 'document_created', 'document', doc.id, null);

    res.status(201).json({
      id: doc.id,
      category,
      title,
      status: doc.status,
      version: doc.current_version
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/legal/documents/:id
 * Update legal document (saves as draft)
 */
const updateLegalDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, content, changeSummary } = req.body;
    const userId = req.user.id;

    // Get current document
    const { rows: docRows } = await pool.query(
      `SELECT id, current_version, status FROM legal_documents WHERE id = $1`,
      [id]
    );

    if (!docRows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = docRows[0];
    const newVersion = doc.current_version + 1;

    // Update document
    await pool.query(
      `UPDATE legal_documents SET title = $2, description = $3, current_content = $4,
        updated_by = $5, updated_at = NOW(), status = 'draft'
       WHERE id = $1`,
      [id, title || req.body.title, description, content, userId]
    );

    // Create new version
    await pool.query(
      `INSERT INTO legal_document_versions (document_id, version_number, title, content, change_summary, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6)`,
      [id, newVersion, title, content, changeSummary, userId]
    );

    await logAuditEvent(req, 'document_updated', 'document', id, null);

    res.json({
      id,
      version: newVersion,
      status: 'draft',
      updatedAt: new Date()
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/legal/documents/:id/request-approval
 * Submit document for legal review
 */
const requestApproval = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { changeSummary, changedSections } = req.body;
    const userId = req.user.id;

    // Create approval record
    const { rows } = await pool.query(
      `INSERT INTO legal_document_approvals (document_id, requested_by, change_summary, changed_sections, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [id, userId, changeSummary, changedSections || []]
    );

    // Update document status
    await pool.query(
      `UPDATE legal_documents SET status = 'pending_review', awaiting_review_since = NOW() WHERE id = $1`,
      [id]
    );

    // Notify admin/legal team
    // await emailService.notifyLegalReview(id);

    await logAuditEvent(req, 'approval_requested', 'approval', rows[0].id, id);

    res.json({
      approvalId: rows[0].id,
      status: 'pending'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/legal/documents/:id/approve
 * Approve document and schedule publication
 */
const approveDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledPublishDate, reviewComments } = req.body;
    const userId = req.user.id;

    // Get document
    const { rows: docRows } = await pool.query(
      `SELECT id, status FROM legal_documents WHERE id = $1`,
      [id]
    );

    if (!docRows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    // Update approval
    await pool.query(
      `UPDATE legal_document_approvals SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(),
        review_comments = $3, scheduled_publish_date = $4
       WHERE document_id = $1 AND status = 'pending'`,
      [id, userId, reviewComments, scheduledPublishDate || new Date()]
    );

    // Update document
    const publishDate = scheduledPublishDate || new Date();
    await pool.query(
      `UPDATE legal_documents SET status = 'scheduled', effective_date = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $1`,
      [id, publishDate, userId]
    );

    await logAuditEvent(req, 'approval_approved', 'approval', id, null);

    res.json({
      id,
      status: 'scheduled',
      effectiveDate: publishDate
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/legal/documents/:id/publish
 * Publish document immediately (make it live)
 */
const publishDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notifyUsers = true } = req.body;
    const userId = req.user.id;

    // Update document
    const { rows } = await pool.query(
      `UPDATE legal_documents SET status = 'live', published_by = $2, published_at = NOW(), effective_date = NOW()
       WHERE id = $1
       RETURNING id, category, current_version, requires_reacceptance`,
      [id, userId]
    );

    if (!rows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = rows[0];

    // Publish current version
    await pool.query(
      `UPDATE legal_document_versions SET status = 'live', published_by = $2, published_at = NOW()
       WHERE document_id = $1 AND version_number = $3`,
      [id, userId, doc.current_version]
    );

    // If requires reacceptance, create notification
    if (notifyUsers && doc.requires_reacceptance) {
      // Queue email notifications
      // await emailService.notifyReacceptanceRequired(id);
    }

    await logAuditEvent(req, 'document_published', 'document', id, null);

    res.json({
      id,
      status: 'live',
      publishedAt: new Date(),
      version: doc.current_version
    });
  } catch (err) {
    next(err);
  }
};

// ────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ────────────────────────────────────────────────────────────

const logAuditEvent = async (req, actionType, resourceType, resourceId, documentId) => {
  try {
    await pool.query(
      `INSERT INTO legal_audit_log (action_type, resource_type, resource_id, document_id, user_id, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [actionType, resourceType, resourceId, documentId, req.user?.id || null,
       req.ip || null, req.headers['user-agent'] || null]
    );
  } catch (err) {
    logger.error('Failed to log audit event', { err });
  }
};

module.exports = {
  getLegalDocument,
  getDocumentHistory,
  getDocumentVersion,
  acceptDocument,
  getUserAcceptances,
  listLegalDocuments,
  createLegalDocument,
  updateLegalDocument,
  requestApproval,
  approveDocument,
  publishDocument
};
