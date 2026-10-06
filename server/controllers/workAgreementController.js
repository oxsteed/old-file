// server/controllers/workAgreementController.js
// Work Agreement Records-Room: OxSteed acts as records keeper (notary),
// never employer or adjudicator. Bilateral agreements between helper and
// customer with drawn signatures, versioned change orders, evidence,
// outside documents, and warranty claims.
//
// Key rules enforced here:
//  - Only the helper or customer on the agreement may act (server-side).
//  - Both parties must sign the current version before status -> active.
//  - A new version starts unsigned; prior signatures stay with their version.
//  - Signature data must be non-empty base64 within size limits.
//  - All money is integer cents.

const db = require('../db');
const logger = require('../utils/logger');

const MAX_SIGNATURE_CHARS = 2000000;
const MIN_SIGNATURE_CHARS = 100;

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadAgreement(agreementId) {
  const { rows } = await db.query('SELECT * FROM work_agreements WHERE id = $1::uuid', [agreementId]);
  return rows[0] || null;
}

function isParty(agreement, userId) {
  return agreement && (String(agreement.helper_id) === String(userId) || String(agreement.customer_id) === String(userId));
}

function partyRole(agreement, userId) {
  if (String(agreement.helper_id) === String(userId)) return 'helper';
  if (String(agreement.customer_id) === String(userId)) return 'customer';
  return null;
}

async function currentVersion(agreementId) {
  const { rows } = await db.query(
    `SELECT * FROM work_agreement_versions WHERE agreement_id = $1::uuid ORDER BY version_number DESC LIMIT 1`,
    [agreementId]
  );
  return rows[0] || null;
}

function validSignatureData(data) {
  if (typeof data !== 'string') return false;
  const s = data.trim();
  if (s.length < MIN_SIGNATURE_CHARS || s.length > MAX_SIGNATURE_CHARS) return false;
  // Accept raw base64 or data-URL base64 PNG.
  const b64 = s.replace(/^data:image\/png;base64,/, '');
  return /^[A-Za-z0-9+/=]+$/.test(b64);
}

function validCents(n) {
  return Number.isInteger(n) && Math.abs(n) <= 100000000;
}

// After a signature lands, flip pending_signatures -> active when both
// parties have signed the current version. Runs inside the caller's txn.
async function maybeActivate(client, agreementId, versionId) {
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT signer_role)::int AS c FROM work_agreement_signatures WHERE version_id = $1::uuid`,
    [versionId]
  );
  if ((rows[0]?.c || 0) >= 2) {
    await client.query(
      `UPDATE work_agreements SET status = 'active', updated_at = now()
        WHERE id = $1::uuid AND status = 'pending_signatures'`,
      [agreementId]
    );
    return true;
  }
  return false;
}

// ─── Agreements ─────────────────────────────────────────────────────────────

// POST /api/work-agreements — create from a job. Caller must be the job's
// helper or customer. Creates the agreement in draft with version 1.
exports.createAgreement = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId, content, warrantyMonths, warrantyTerms, reimbursementTerms } = req.body || {};
    if (!jobId) return res.status(400).json({ error: 'jobId is required.' });
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'content is required.' });

    const { rows: [job] } = await db.query(
      'SELECT id, client_id, assigned_helper_id FROM jobs WHERE id = $1::uuid',
      [jobId]
    );
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const helperId = job.assigned_helper_id;
    const customerId = job.client_id;
    if (!helperId || !customerId) return res.status(400).json({ error: 'Job must have an assigned helper and a customer.' });
    if (String(userId) !== String(helperId) && String(userId) !== String(customerId)) {
      return res.status(403).json({ error: 'Only the job helper or customer can create this agreement.' });
    }

    const wm = warrantyMonths === undefined ? 6 : Number(warrantyMonths);
    if (!Number.isInteger(wm) || wm < 0 || wm > 60) return res.status(400).json({ error: 'warrantyMonths must be 0-60.' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [agreement] } = await client.query(
        `INSERT INTO work_agreements (job_id, helper_id, customer_id, status, warranty_months, warranty_terms, reimbursement_terms)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending_signatures', $4, $5, $6) RETURNING *`,
        [jobId, helperId, customerId, wm, warrantyTerms || null, reimbursementTerms || null]
      );
      const { rows: [version] } = await client.query(
        `INSERT INTO work_agreement_versions (agreement_id, version_number, content, created_by)
         VALUES ($1::uuid, 1, $2::jsonb, $3::uuid) RETURNING *`,
        [agreement.id, JSON.stringify(content), userId]
      );
      await client.query('COMMIT');
      logger.info('work agreement created', { agreementId: agreement.id, jobId, userId });
      return res.status(201).json({ agreement, version });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('work agreement create error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not create agreement.' });
  }
};

// GET /api/work-agreements/:id — detail with current version, signatures, status.
exports.getAgreement = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });

    const version = await currentVersion(agreement.id);
    const { rows: signatures } = await db.query(
      `SELECT id, signer_id, signer_role, signed_at FROM work_agreement_signatures
        WHERE version_id = $1::uuid ORDER BY signed_at ASC`,
      [version.id]
    );
    const { rows: changeOrders } = await db.query(
      `SELECT * FROM work_agreement_change_orders WHERE agreement_id = $1::uuid ORDER BY created_at DESC LIMIT 100`,
      [agreement.id]
    );
    return res.json({ agreement, version, signatures, changeOrders });
  } catch (err) {
    logger.error('work agreement detail error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not load agreement.' });
  }
};

// GET /api/work-agreements?jobId= — list agreements for a job (party only).
exports.listAgreements = async (req, res) => {
  try {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId is required.' });
    const { rows } = await db.query(
      `SELECT * FROM work_agreements WHERE job_id = $1::uuid
         AND (helper_id = $2::uuid OR customer_id = $2::uuid)
       ORDER BY created_at DESC`,
      [jobId, req.user.id]
    );
    return res.json({ agreements: rows });
  } catch (err) {
    logger.error('work agreement list error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not list agreements.' });
  }
};

// POST /api/work-agreements/:id/versions — new version. Prior signatures stay
// with their version; the new version starts unsigned and status returns to
// pending_signatures.
exports.createVersion = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    if (['completed', 'closed'].includes(agreement.status)) {
      return res.status(409).json({ error: 'Cannot version a completed or closed agreement.' });
    }
    const { content } = req.body || {};
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'content is required.' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [maxRow] } = await client.query(
        'SELECT COALESCE(MAX(version_number), 0)::int AS m FROM work_agreement_versions WHERE agreement_id = $1::uuid',
        [agreement.id]
      );
      const next = maxRow.m + 1;
      const { rows: [version] } = await client.query(
        `INSERT INTO work_agreement_versions (agreement_id, version_number, content, created_by)
         VALUES ($1::uuid, $2, $3::jsonb, $4::uuid) RETURNING *`,
        [agreement.id, next, JSON.stringify(content), req.user.id]
      );
      await client.query(
        `UPDATE work_agreements SET status = 'pending_signatures', updated_at = now() WHERE id = $1::uuid`,
        [agreement.id]
      );
      await client.query('COMMIT');
      logger.info('work agreement versioned', { agreementId: agreement.id, version: next, userId: req.user.id });
      return res.status(201).json({ version });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('work agreement version error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not create version.' });
  }
};

// POST /api/work-agreements/:id/complete — mark active agreement complete (party only).
exports.completeAgreement = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    if (agreement.status !== 'active') return res.status(409).json({ error: 'Only an active agreement can be completed.' });
    const { rows: [updated] } = await db.query(
      `UPDATE work_agreements SET status = 'completed', updated_at = now() WHERE id = $1::uuid RETURNING *`,
      [agreement.id]
    );
    return res.json({ agreement: updated });
  } catch (err) {
    logger.error('work agreement complete error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not complete agreement.' });
  }
};

// ─── Signatures ─────────────────────────────────────────────────────────────

// POST /api/work-agreements/:id/sign — { versionId, signatureData, role }.
// Drawn signature; both roles must sign the current version for activation.
exports.signAgreement = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    const role = partyRole(agreement, req.user.id);
    if (!role) return res.status(403).json({ error: 'Not a party to this agreement.' });

    const { versionId, signatureData, role: claimedRole } = req.body || {};
    if (claimedRole && claimedRole !== role) return res.status(400).json({ error: 'Role does not match your party.' });
    if (!validSignatureData(signatureData)) {
      return res.status(400).json({ error: 'Invalid signature data.' });
    }

    const version = await currentVersion(agreement.id);
    if (!version || String(version.id) !== String(versionId)) {
      return res.status(409).json({ error: 'Can only sign the current version.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO work_agreement_signatures (agreement_id, version_id, signer_id, signer_role, signature_data)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
         ON CONFLICT (version_id, signer_id) DO UPDATE
           SET signature_data = EXCLUDED.signature_data, signed_at = now()`,
        [agreement.id, version.id, req.user.id, role, signatureData.trim()]
      );
      const activated = await maybeActivate(client, agreement.id, version.id);
      await client.query('COMMIT');
      logger.info('work agreement signed', { agreementId: agreement.id, versionId: version.id, role, activated });
      return res.json({ ok: true, activated });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('work agreement sign error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not record signature.' });
  }
};

// GET /api/work-agreements/:id/signatures — list signatures (party only).
exports.listSignatures = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { rows } = await db.query(
      `SELECT s.id, s.version_id, s.signer_id, s.signer_role, s.signed_at, v.version_number
         FROM work_agreement_signatures s
         JOIN work_agreement_versions v ON v.id = s.version_id
        WHERE s.agreement_id = $1::uuid ORDER BY v.version_number DESC, s.signed_at ASC`,
      [agreement.id]
    );
    return res.json({ signatures: rows });
  } catch (err) {
    logger.error('work agreement signatures list error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not list signatures.' });
  }
};

// ─── Change orders ──────────────────────────────────────────────────────────

// POST /api/work-agreements/:id/change-orders — { description, priceChangeCents }.
exports.proposeChangeOrder = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    if (!['active', 'pending_signatures'].includes(agreement.status)) {
      return res.status(409).json({ error: 'Change orders require an open agreement.' });
    }
    const { description, priceChangeCents } = req.body || {};
    if (!description || String(description).trim().length < 10 || String(description).length > 10000) {
      return res.status(400).json({ error: 'Description must be 10-10000 characters.' });
    }
    const cents = priceChangeCents === undefined ? 0 : Number(priceChangeCents);
    if (!validCents(cents)) return res.status(400).json({ error: 'priceChangeCents must be an integer.' });

    const version = await currentVersion(agreement.id);
    const { rows: [co] } = await db.query(
      `INSERT INTO work_agreement_change_orders (agreement_id, version_id, description, price_change_cents, proposed_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid) RETURNING *`,
      [agreement.id, version.id, String(description).trim(), cents, req.user.id]
    );
    logger.info('change order proposed', { agreementId: agreement.id, changeOrderId: co.id });
    return res.status(201).json({ changeOrder: co });
  } catch (err) {
    logger.error('change order propose error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not propose change order.' });
  }
};

// Bilateral decision: the counterparty (not the proposer) approves or rejects.
async function decideChangeOrder(req, res, decision) {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });

    const { rows: [co] } = await db.query(
      'SELECT * FROM work_agreement_change_orders WHERE id = $1::uuid AND agreement_id = $2::uuid',
      [req.params.coId, agreement.id]
    );
    if (!co) return res.status(404).json({ error: 'Change order not found.' });
    if (co.status !== 'proposed') return res.status(409).json({ error: 'Change order already decided.' });
    if (String(co.proposed_by) === String(req.user.id)) {
      return res.status(403).json({ error: 'The counterparty must decide.' });
    }

    const { rows: [updated] } = await db.query(
      `UPDATE work_agreement_change_orders
          SET status = $2, decided_by = $3::uuid, decided_at = now()
        WHERE id = $1::uuid RETURNING *`,
      [co.id, decision, req.user.id]
    );
    logger.info('change order decided', { changeOrderId: co.id, decision, userId: req.user.id });
    return res.json({ changeOrder: updated });
  } catch (err) {
    logger.error('change order decide error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not decide change order.' });
  }
}

exports.approveChangeOrder = (req, res) => decideChangeOrder(req, res, 'approved');
exports.rejectChangeOrder = (req, res) => decideChangeOrder(req, res, 'rejected');

// ─── Evidence ───────────────────────────────────────────────────────────────

// POST /api/work-agreements/:id/evidence — { type, fileUrl, description }.
exports.addEvidence = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { type, fileUrl, description } = req.body || {};
    if (!['before_photo', 'after_photo', 'testing_record'].includes(type)) {
      return res.status(400).json({ error: 'Invalid evidence type.' });
    }
    if (!fileUrl || String(fileUrl).length > 2048) return res.status(400).json({ error: 'fileUrl is required.' });

    const { rows: [row] } = await db.query(
      `INSERT INTO work_agreement_evidence (agreement_id, evidence_type, file_url, description, uploaded_by)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid) RETURNING *`,
      [agreement.id, type, String(fileUrl), description ? String(description).slice(0, 2000) : null, req.user.id]
    );
    return res.status(201).json({ evidence: row });
  } catch (err) {
    logger.error('work agreement evidence error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not add evidence.' });
  }
};

exports.listEvidence = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { rows } = await db.query(
      'SELECT * FROM work_agreement_evidence WHERE agreement_id = $1::uuid ORDER BY created_at ASC',
      [agreement.id]
    );
    return res.json({ evidence: rows });
  } catch (err) {
    logger.error('work agreement evidence list error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not list evidence.' });
  }
};

// ─── Documents ──────────────────────────────────────────────────────────────

// POST /api/work-agreements/:id/documents — { fileUrl, fileName }.
exports.addDocument = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { fileUrl, fileName } = req.body || {};
    if (!fileUrl || String(fileUrl).length > 2048) return res.status(400).json({ error: 'fileUrl is required.' });
    if (!fileName || String(fileName).length > 255) return res.status(400).json({ error: 'fileName is required.' });

    const { rows: [row] } = await db.query(
      `INSERT INTO work_agreement_documents (agreement_id, file_url, file_name, uploaded_by)
       VALUES ($1::uuid, $2, $3, $4::uuid) RETURNING *`,
      [agreement.id, String(fileUrl), String(fileName), req.user.id]
    );
    return res.status(201).json({ document: row });
  } catch (err) {
    logger.error('work agreement document error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not add document.' });
  }
};

exports.listDocuments = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { rows } = await db.query(
      'SELECT * FROM work_agreement_documents WHERE agreement_id = $1::uuid ORDER BY created_at ASC',
      [agreement.id]
    );
    return res.json({ documents: rows });
  } catch (err) {
    logger.error('work agreement documents list error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not list documents.' });
  }
};

// ─── Warranty claims ────────────────────────────────────────────────────────
// Recorded only. OxSteed never adjudicates; resolution is noted by the parties.

// POST /api/work-agreements/:id/warranty-claims — { description }.
exports.fileWarrantyClaim = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { description } = req.body || {};
    if (!description || String(description).trim().length < 10 || String(description).length > 10000) {
      return res.status(400).json({ error: 'Description must be 10-10000 characters.' });
    }
    const { rows: [claim] } = await db.query(
      `INSERT INTO work_agreement_warranty_claims (agreement_id, description, filed_by)
       VALUES ($1::uuid, $2, $3::uuid) RETURNING *`,
      [agreement.id, String(description).trim(), req.user.id]
    );
    logger.info('warranty claim filed', { agreementId: agreement.id, claimId: claim.id });
    return res.status(201).json({ claim });
  } catch (err) {
    logger.error('warranty claim file error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not file warranty claim.' });
  }
};

exports.listWarrantyClaims = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { rows } = await db.query(
      'SELECT * FROM work_agreement_warranty_claims WHERE agreement_id = $1::uuid ORDER BY created_at DESC',
      [agreement.id]
    );
    return res.json({ claims: rows });
  } catch (err) {
    logger.error('warranty claim list error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not list warranty claims.' });
  }
};

// POST /api/work-agreements/:id/warranty-claims/:claimId/resolve — { decision, note }.
// Records the parties' own resolution; the platform does not adjudicate.
exports.resolveWarrantyClaim = async (req, res) => {
  try {
    const agreement = await loadAgreement(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found.' });
    if (!isParty(agreement, req.user.id)) return res.status(403).json({ error: 'Not a party to this agreement.' });
    const { decision, note } = req.body || {};
    if (!['resolved', 'denied'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be resolved or denied.' });
    }
    const { rows: [claim] } = await db.query(
      `UPDATE work_agreement_warranty_claims
          SET status = $2, resolved_by = $3::uuid, resolved_at = now(),
              resolution_note = $4
        WHERE id = $1::uuid AND agreement_id = $5::uuid AND status IN ('filed', 'under_review')
        RETURNING *`,
      [req.params.claimId, decision, req.user.id, note ? String(note).slice(0, 5000) : null, agreement.id]
    );
    if (!claim) return res.status(404).json({ error: 'Claim not found or already decided.' });
    return res.json({ claim });
  } catch (err) {
    logger.error('warranty claim resolve error', { err, userId: req.user?.id });
    return res.status(500).json({ error: 'Could not resolve warranty claim.' });
  }
};
