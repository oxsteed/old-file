const db = require('../db');
const logger = require('../utils/logger');

/**
 * GET /api/jobs/draft
 * Returns the current user's active draft, or null.
 */
exports.getDraft = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, wizard_step, payload, updated_at
         FROM job_drafts
        WHERE client_id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.json(null);
    return res.json(rows[0]);
  } catch (err) {
    logger.error('getDraft error:', err);
    res.status(500).json({ error: 'Failed to load draft' });
  }
};

/**
 * PUT /api/jobs/draft
 * Upserts the current user's draft.
 * Body: { wizard_step, payload }
 */
exports.saveDraft = async (req, res) => {
  try {
    const { wizard_step = 1, payload = {} } = req.body;

    // Strip any File objects that can't be serialised (media handled separately)
    const safePayload = sanitisePayload(payload);

    const { rows } = await db.query(
      `INSERT INTO job_drafts (client_id, wizard_step, payload)
            VALUES ($1, $2, $3)
       ON CONFLICT (client_id)
       DO UPDATE SET wizard_step = $2,
                     payload     = $3,
                     updated_at  = now()
       RETURNING id, updated_at`,
      [req.user.id, wizard_step, JSON.stringify(safePayload)]
    );

    res.json({ draft_id: rows[0].id, saved_at: rows[0].updated_at });
  } catch (err) {
    logger.error('saveDraft error:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
};

/**
 * DELETE /api/jobs/draft
 * Clears the user's draft (called after successful publish).
 */
exports.deleteDraft = async (req, res) => {
  try {
    await db.query(
      `DELETE FROM job_drafts WHERE client_id = $1`,
      [req.user.id]
    );
    res.json({ deleted: true });
  } catch (err) {
    logger.error('deleteDraft error:', err);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitisePayload(payload) {
  // Remove fields that can't be JSON-stored safely
  const { mediaFiles, mediaPreviews, submitting, submitted, geocoding,
          draftSaving, ...safe } = payload;
  return safe;
}
