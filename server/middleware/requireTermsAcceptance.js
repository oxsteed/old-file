const db = require('../db');
const { TERMS_CONFIG, REQUIRED_CONSENTS } = require('../constants/termsConfig');

/**
 * Middleware: requireTermsAcceptance
 * Checks if the authenticated user has accepted the latest version
 * of all required consent documents. If not, returns 403 with
 * a list of outstanding consents so the frontend can show the gate.
 *
 * Must be used AFTER authenticate middleware.
 */
const requireTermsAcceptance = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return next(); // let auth middleware handle

    // Get the user's latest consent for each required type
    const { rows } = await db.query(
      `SELECT DISTINCT ON (consent_type)
        consent_type, version
      FROM user_consents
      WHERE user_id = $1
        AND consent_type = ANY($2)
      ORDER BY consent_type, created_at DESC`,
      [userId, REQUIRED_CONSENTS]
    );

    // Build a map of accepted versions
    const accepted = {};
    rows.forEach((r) => {
      accepted[r.consent_type] = r.version;
    });

    // Check which consents are outdated or missing
    const outstanding = [];
    for (const type of REQUIRED_CONSENTS) {
      const required = TERMS_CONFIG[type];
      if (!accepted[type] || accepted[type] < required.version) {
        outstanding.push({
          consent_type: type,
          required_version: required.version,
          accepted_version: accepted[type] || null,
          label: required.label,
          url: required.url,
        });
      }
    }

    if (outstanding.length > 0) {
      return res.status(403).json({
        error: 'terms_acceptance_required',
        message: 'You must accept the updated terms to continue.',
        outstanding,
      });
    }

    next();
  } catch (err) {
    console.error('requireTermsAcceptance error:', err);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
  }
};

module.exports = requireTermsAcceptance;
