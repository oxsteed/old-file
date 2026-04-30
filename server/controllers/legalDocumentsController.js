// Legal Documents Controller
// Manages T&C, Privacy Policy, and other legal documents with versioning, approvals, and i18n support

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

// ────────────────────────────────────────────────────────────
// PUBLIC HUB
// ────────────────────────────────────────────────────────────

const CATEGORY_SLUGS = {
  terms_of_service: 'terms',
  privacy_policy: 'privacy',
  helper_agreement: 'helper-agreement',
  seller_agreement: 'seller-agreement',
  payment_terms: 'payment-terms',
  dispute_resolution: 'dispute-resolution',
  data_retention: 'data-retention',
  background_check_policy: 'background-checks',
  fcra_compliance: 'fcra',
  incident_response: 'incident-response',
  accessibility_policy: 'accessibility-policy',
};

/**
 * GET /api/legal/hub
 * List all live legal documents (title + public path slug) for the /legal index
 */
const getLegalHub = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, title, description, published_at, current_version
       FROM legal_documents
       WHERE status = 'live'
       ORDER BY
         CASE category
           WHEN 'terms_of_service' THEN 1
           WHEN 'privacy_policy' THEN 2
           WHEN 'helper_agreement' THEN 3
           WHEN 'seller_agreement' THEN 4
           WHEN 'payment_terms' THEN 5
           WHEN 'dispute_resolution' THEN 6
           ELSE 99
         END,
         title ASC`
    );

    res.json({
      documents: rows.map((d) => ({
        category: d.category,
        title: d.title,
        description: d.description,
        version: d.current_version,
        publishedAt: d.published_at,
        path: `/legal/${CATEGORY_SLUGS[d.category] || d.category}`,
        legacyPath: d.category === 'terms_of_service' ? '/terms' : d.category === 'privacy_policy' ? '/privacy' : null,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ────────────────────────────────────────────────────────────
// PUBLIC ENDPOINTS
// ────────────────────────────────────────────────────────────

/**
 * GET /api/legal/documents/:category
 * Fetch published legal document in user's language, or admin draft preview (?preview=uuid)
 */
const getLegalDocument = async (req, res, next) => {
  try {
    const { category } = req.params;
    const { language = 'en', preview: previewId } = req.query;

    const validCategories = [
      'terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement',
      'payment_terms', 'dispute_resolution', 'data_retention', 'background_check_policy',
      'fcra_compliance', 'incident_response', 'accessibility_policy'
    ];
    if (!validCategories.includes(category)) {
      throw new AppError('Invalid document category', 400, 'invalid_category');
    }

    const isPreview = typeof previewId === 'string' && previewId.length > 0;
    if (isPreview) {
      if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
        throw new AppError('Preview requires admin authentication', 403, 'forbidden');
      }
      const { rows } = await pool.query(
        `SELECT d.id, d.category, d.title, d.description, d.current_version,
                d.effective_date, d.published_at, d.status,
                COALESCE(dt.title, d.title) AS title_localized,
                COALESCE(dt.content, d.current_content) AS content
         FROM legal_documents d
         LEFT JOIN legal_document_translations dt ON d.id = dt.document_id
           AND dt.language_code = $2 AND dt.status IN ('live', 'draft')
         WHERE d.id = $1::uuid AND d.category = $3`,
        [previewId, language, category]
      );
      if (!rows[0]) {
        throw new AppError('Document not found', 404, 'not_found');
      }
      const doc = rows[0];

      const { rows: sections } = await pool.query(
        `SELECT s.id, s.section_key, s.title, s.content, s.section_order,
                s.is_critical, s.updated_at AS section_row_updated_at,
                COALESCE(st.title, s.title) AS title_localized,
                COALESCE(st.content, s.content) AS content_localized,
                (
                  SELECT MAX(sv.published_at)
                  FROM legal_section_versions sv
                  WHERE sv.section_id = s.id AND sv.status = 'live'
                ) AS section_last_published_at
         FROM legal_document_sections s
         LEFT JOIN legal_section_translations st ON s.id = st.section_id
           AND st.language_code = $2 AND st.status IN ('live', 'draft')
         WHERE s.document_id = $1
         ORDER BY s.section_order`,
        [doc.id, language]
      );

      let userAccepted = false;
      if (req.user && doc.status === 'live') {
        const { rows: acceptanceRows } = await pool.query(
          `SELECT accepted_at FROM user_legal_acceptances_latest
           WHERE user_id = $1 AND document_id = $2 AND version_number = $3`,
          [req.user.id, doc.id, doc.current_version]
        );
        userAccepted = acceptanceRows.length > 0;
      }

      await logAuditEvent(req, 'document_viewed', 'document', doc.id, doc.id);

      return res.json({
        document: {
          id: doc.id,
          category: doc.category,
          title: doc.title_localized || doc.title,
          description: doc.description,
          version: doc.current_version,
          effectiveDate: doc.effective_date,
          publishedAt: doc.published_at,
          status: doc.status,
          isPreview: true,
          userAccepted,
          lastUpdated: doc.published_at || doc.effective_date
        },
        sections: sections.map(s => ({
          id: s.id,
          key: s.section_key,
          title: s.title_localized || s.title,
          content: s.content_localized || s.content,
          order: s.section_order,
          isCritical: s.is_critical,
          lastUpdatedAt: s.section_row_updated_at || s.section_last_published_at
        })),
        language
      });
    }

    // Published (live) document
    const { rows } = await pool.query(
      `SELECT d.id, d.category, d.title, d.description, d.current_version,
              d.effective_date, d.published_at,
              COALESCE(dt.title, d.title) as title_localized,
              COALESCE(dt.content, d.current_content) as content
       FROM legal_documents d
       LEFT JOIN legal_document_translations dt ON d.id = dt.document_id
         AND dt.language_code = $2 AND dt.status = 'live'
       WHERE d.category = $1 AND d.status = 'live'
       ORDER BY d.published_at DESC NULLS LAST LIMIT 1`,
      [category, language]
    );

    if (!rows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = rows[0];

    const { rows: sections } = await pool.query(
      `SELECT s.id, s.section_key, s.title, s.content, s.section_order,
              s.is_critical, s.updated_at AS section_row_updated_at,
              COALESCE(st.title, s.title) as title_localized,
              COALESCE(st.content, s.content) as content_localized,
              (
                SELECT MAX(sv.published_at)
                FROM legal_section_versions sv
                WHERE sv.section_id = s.id AND sv.status = 'live'
              ) AS section_last_published_at
       FROM legal_document_sections s
       LEFT JOIN legal_section_translations st ON s.id = st.section_id
         AND st.language_code = $2 AND st.status = 'live'
       WHERE s.document_id = $1
       ORDER BY s.section_order`,
      [doc.id, language]
    );

    let userAccepted = false;
    if (req.user) {
      const { rows: acceptanceRows } = await pool.query(
        `SELECT accepted_at FROM user_legal_acceptances_latest
         WHERE user_id = $1 AND document_id = $2 AND version_number = $3`,
        [req.user.id, doc.id, doc.current_version]
      );
      userAccepted = acceptanceRows.length > 0;
    }

    await logAuditEvent(req, 'document_viewed', 'document', doc.id, doc.id);

    res.json({
      document: {
        id: doc.id,
        category: doc.category,
        title: doc.title_localized || doc.title,
        description: doc.description,
        version: doc.current_version,
        effectiveDate: doc.effective_date,
        publishedAt: doc.published_at,
        status: doc.status,
        isPreview: false,
        userAccepted,
        lastUpdated: doc.published_at
      },
      sections: sections.map(s => ({
        id: s.id,
        key: s.section_key,
        title: s.title_localized || s.title,
        content: s.content_localized || s.content,
        order: s.section_order,
        isCritical: s.is_critical,
        lastUpdatedAt: s.section_last_published_at || s.section_row_updated_at
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
        category: doc.category,
        categoryLabel: doc.category.replace(/_/g, ' '),
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
 * GET /api/legal/admin/documents/:id
 * Admin: document + sections + section version history
 */
const getAdminDocument = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows: docRows } = await pool.query(
      `SELECT d.id, d.category, d.title, d.description, d.current_version, d.status,
              d.updated_at, d.published_at,
              u.first_name AS editor_first_name, u.last_name AS editor_last_name
       FROM legal_documents d
       LEFT JOIN users u ON u.id = d.updated_by
       WHERE d.id = $1`,
      [id]
    );

    if (!docRows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = docRows[0];

    const { rows: sections } = await pool.query(
      `SELECT id, section_key, title, content, section_order, is_critical, updated_at
       FROM legal_document_sections
       WHERE document_id = $1
       ORDER BY section_order ASC, title ASC`,
      [id]
    );

    const sectionsOut = [];
    for (const s of sections) {
      const { rows: hist } = await pool.query(
        `SELECT version_number, change_summary, created_at,
                cu.first_name AS editor_first_name, cu.last_name AS editor_last_name
         FROM legal_section_versions sv
         LEFT JOIN users cu ON cu.id = sv.created_by
         WHERE sv.section_id = $1
         ORDER BY sv.version_number DESC
         LIMIT 5`,
        [s.id]
      );

      sectionsOut.push({
        id: s.id,
        key: s.section_key,
        title: s.title,
        content: s.content,
        order: s.section_order,
        isCritical: s.is_critical,
        updatedAt: s.updated_at,
        history: hist.map((h) => ({
          version: h.version_number,
          changeSummary: h.change_summary,
          createdAt: h.created_at,
          editorName: [h.editor_first_name, h.editor_last_name].filter(Boolean).join(' ') || 'Admin',
        })),
      });
    }

    const editorName = [doc.editor_first_name, doc.editor_last_name].filter(Boolean).join(' ') || null;

    res.json({
      document: {
        id: doc.id,
        category: doc.category,
        title: doc.title,
        description: doc.description,
        version: doc.current_version,
        status: doc.status,
        updatedAt: doc.updated_at,
        publishedAt: doc.published_at,
        lastEditedBy: editorName,
      },
      sections: sectionsOut,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/legal/admin/documents
 * Body: { category, title, description, content?, sections?: [{ key, title, content, isCritical? }] }
 */
const createLegalDocument = async (req, res, next) => {
  try {
    const { category, title, description, content, sections: sectionPayload } = req.body;
    const userId = req.user.id;

    const validCategories = [
      'terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement',
      'payment_terms', 'dispute_resolution', 'data_retention', 'background_check_policy',
      'fcra_compliance', 'incident_response', 'accessibility_policy'
    ];

    let resolvedContent = content;
    if (!resolvedContent && Array.isArray(sectionPayload) && sectionPayload.length > 0) {
      resolvedContent = sectionPayload.map((s) => s.content || '').join('\n\n');
    }

    if (!validCategories.includes(category) || !title || !resolvedContent) {
      throw new AppError('Missing required fields', 400, 'validation_failed');
    }

    const { rows } = await pool.query(
      `INSERT INTO legal_documents (category, title, description, current_content, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, status, current_version`,
      [category, title, description || null, resolvedContent, userId]
    );

    const doc = rows[0];

    await pool.query(
      `INSERT INTO legal_document_versions (document_id, version_number, title, content, status, created_by)
       VALUES ($1, 1, $2, $3, 'draft', $4)`,
      [doc.id, title, resolvedContent, userId]
    );

    const sectionsToInsert = Array.isArray(sectionPayload) && sectionPayload.length > 0
      ? sectionPayload
      : [{ key: 'introduction', title: 'Introduction', content: resolvedContent, isCritical: false }];

    let order = 0;
    for (const s of sectionsToInsert) {
      const sectionKey = (s.key || `section_${order}`).toString().slice(0, 100);
      const sectionTitle = (s.title || 'Section').toString().slice(0, 255);
      const sectionContent = (s.content || '').toString();
      const isCritical = !!s.isCritical;
      const { rows: ins } = await pool.query(
        `INSERT INTO legal_document_sections (document_id, section_key, title, content, section_order, is_critical, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id`,
        [doc.id, sectionKey, sectionTitle, sectionContent, order, isCritical, userId]
      );
      await pool.query(
        `INSERT INTO legal_section_versions (section_id, document_id, version_number, title, content, status, created_by)
         VALUES ($1, $2, 1, $3, $4, 'draft', $5)`,
        [ins[0].id, doc.id, sectionTitle, sectionContent, userId]
      );
      order += 1;
    }

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
 * PUT /api/legal/admin/documents/:id
 * Body: { title, description, content?, changeSummary?, sections?: [...] }
 */
const updateLegalDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, content, changeSummary, sections: sectionPayload } = req.body;
    const userId = req.user.id;

    const { rows: docRows } = await pool.query(
      `SELECT id, current_version, status FROM legal_documents WHERE id = $1`,
      [id]
    );

    if (!docRows[0]) {
      throw new AppError('Document not found', 404, 'not_found');
    }

    const doc = docRows[0];
    const newVersion = doc.current_version + 1;

    let resolvedTitle = title || req.body.title;
    let resolvedContent = content;
    if (Array.isArray(sectionPayload) && sectionPayload.length > 0) {
      resolvedContent = sectionPayload.map((s) => s.content || '').join('\n\n');
    }
    if (!resolvedContent) {
      throw new AppError('Content or sections required', 400, 'validation_failed');
    }

    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE legal_documents SET title = $2, description = $3, current_content = $4,
          updated_by = $5, updated_at = NOW(), status = 'draft'
         WHERE id = $1`,
        [id, resolvedTitle, description ?? null, resolvedContent, userId]
      );

      await client.query(
        `INSERT INTO legal_document_versions (document_id, version_number, title, content, change_summary, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6)`,
        [id, newVersion, resolvedTitle, resolvedContent, changeSummary || null, userId]
      );

      if (Array.isArray(sectionPayload) && sectionPayload.length > 0) {
        let order = 0;
        for (const s of sectionPayload) {
          const sectionKey = (s.key || `section_${order}`).toString().slice(0, 100);
          const sectionTitle = (s.title || 'Section').toString().slice(0, 255);
          const sectionContent = (s.content || '').toString();
          const isCritical = !!s.isCritical;
          const sectionChange = s.sectionChangeSummary || changeSummary || null;

          let sectionId = s.id;
          if (sectionId) {
            const { rows: own } = await client.query(
              `SELECT id FROM legal_document_sections WHERE id = $1 AND document_id = $2`,
              [sectionId, id]
            );
            if (!own[0]) sectionId = null;
          }

          if (sectionId) {
            await client.query(
              `UPDATE legal_document_sections
               SET title = $2, content = $3, section_order = $4, is_critical = $5, updated_by = $6, updated_at = NOW()
               WHERE id = $1`,
              [sectionId, sectionTitle, sectionContent, order, isCritical, userId]
            );
          } else {
            const { rows: ins } = await client.query(
              `INSERT INTO legal_document_sections (document_id, section_key, title, content, section_order, is_critical, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
               RETURNING id`,
              [id, sectionKey, sectionTitle, sectionContent, order, isCritical, userId]
            );
            sectionId = ins[0].id;
          }

          const { rows: verRows } = await client.query(
            `SELECT COALESCE(MAX(version_number), 0) AS max_v FROM legal_section_versions WHERE section_id = $1`,
            [sectionId]
          );
          const nextSecVer = (verRows[0]?.max_v || 0) + 1;

          await client.query(
            `INSERT INTO legal_section_versions (section_id, document_id, version_number, title, content, change_summary, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)`,
            [sectionId, id, nextSecVer, sectionTitle, sectionContent, sectionChange, userId]
          );

          order += 1;
        }
      }
    }, 'legal_document_update');

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

    const { rows: approvedApproval } = await pool.query(
      `SELECT id FROM legal_document_approvals
       WHERE document_id = $1 AND status = 'approved'
       ORDER BY reviewed_at DESC NULLS LAST
       LIMIT 1`,
      [id]
    );
    await logAuditEvent(
      req,
      'approval_approved',
      'approval',
      approvedApproval[0]?.id || null,
      id
    );

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

    // Publish section versions: mark latest draft snapshot per section as live
    await pool.query(
      `UPDATE legal_section_versions sv
       SET status = 'live', published_by = $2, published_at = NOW()
       FROM (
         SELECT DISTINCT ON (section_id) id
         FROM legal_section_versions
         WHERE document_id = $1 AND status = 'draft'
         ORDER BY section_id, version_number DESC
       ) latest
       WHERE sv.id = latest.id`,
      [id, userId]
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

/**
 * POST /api/legal/admin/documents/:id/sections/:sectionId/restore-version/:versionNumber
 * Copy an older section version into the section body (new draft version row).
 */
const restoreSectionVersion = async (req, res, next) => {
  try {
    const { id, sectionId, versionNumber } = req.params;
    const userId = req.user.id;
    const verNum = parseInt(versionNumber, 10);
    if (Number.isNaN(verNum)) {
      throw new AppError('Invalid version number', 400, 'validation_failed');
    }

    const { rows: secRows } = await pool.query(
      `SELECT id, section_key, title, content FROM legal_document_sections
       WHERE id = $1 AND document_id = $2`,
      [sectionId, id]
    );
    if (!secRows[0]) {
      throw new AppError('Section not found', 404, 'not_found');
    }

    const { rows: oldRows } = await pool.query(
      `SELECT title, content FROM legal_section_versions
       WHERE section_id = $1 AND version_number = $2`,
      [sectionId, verNum]
    );
    if (!oldRows[0]) {
      throw new AppError('Section version not found', 404, 'not_found');
    }

    const { title, content } = oldRows[0];

    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE legal_document_sections
         SET title = $2, content = $3, updated_by = $4, updated_at = NOW()
         WHERE id = $1`,
        [sectionId, title, content, userId]
      );

      const { rows: verRows } = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_v FROM legal_section_versions WHERE section_id = $1`,
        [sectionId]
      );
      const nextSecVer = (verRows[0]?.max_v || 0) + 1;

      await client.query(
        `INSERT INTO legal_section_versions (section_id, document_id, version_number, title, content, change_summary, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)`,
        [
          sectionId,
          id,
          nextSecVer,
          title,
          content,
          `Restored from section version ${verNum}`,
          userId
        ]
      );
    }, 'legal_section_restore');

    await logAuditEvent(req, 'section_updated', 'section', sectionId, id);

    res.json({ ok: true, sectionId, restoredFromVersion: verNum });
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
  getLegalHub,
  getLegalDocument,
  getDocumentHistory,
  getDocumentVersion,
  acceptDocument,
  getUserAcceptances,
  listLegalDocuments,
  getAdminDocument,
  createLegalDocument,
  updateLegalDocument,
  requestApproval,
  approveDocument,
  publishDocument,
  restoreSectionVersion
};
