const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { TERMS_CONFIG, REQUIRED_CONSENTS } = require('../constants/termsConfig');
const User = require('../models/userModel');

const hashIP = (ip) => ip
  ? crypto.createHash('sha256').update(ip).digest('hex')
  : null;

// ─── GET /api/consent/status ──────────────────────────────────
// Returns the user's current consent status for all required types
router.get('/status', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (consent_type)
        consent_type, version, created_at
        FROM user_consents
        WHERE user_id = $1
        AND consent_type = ANY($2)
        ORDER BY consent_type, created_at DESC`,
      [req.user.id, REQUIRED_CONSENTS]
    );
    const accepted = {};
    rows.forEach((r) => {
      accepted[r.consent_type] = {
        version: r.version,
        accepted_at: r.created_at,
      };
    });
    const outstanding = [];
    for (const type of REQUIRED_CONSENTS) {
      const cfg = TERMS_CONFIG[type];
      const acc = accepted[type];
      if (!acc || acc.version < cfg.version) {
        outstanding.push({
          consent_type: type,
          required_version: cfg.version,
          accepted_version: acc?.version || null,
          label: cfg.label,
          url: cfg.url,
        });
      }
    }
    res.json({
      up_to_date: outstanding.length === 0,
      outstanding,
      accepted,
      current_versions: Object.fromEntries(
        Object.entries(TERMS_CONFIG).map(([k, v]) => [k, v.version])
      ),
    });
  } catch (err) {
    console.error('GET /consent/status error:', err);
    res.status(500).json({ error: 'Failed to check consent status' });
  }
});

// ─── POST /api/consent/accept ─────────────────────────────────
// Accept one or more consent types at their current version
router.post('/accept', authenticate, async (req, res) => {
  try {
    const { consent_types } = req.body; // e.g. ['terms_of_service', 'privacy_policy']
    if (!Array.isArray(consent_types) || consent_types.length === 0) {
      return res.status(400).json({ error: 'consent_types array is required' });
    }
    // Validate all types
    const invalid = consent_types.filter((t) => !TERMS_CONFIG[t]);
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid consent types: ${invalid.join(', ')}` });
    }
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    // Record each consent
    for (const type of consent_types) {
      await User.recordConsent({
        userId: req.user.id,
        consentType: type,
        version: TERMS_CONFIG[type].version,
        ip,
        userAgent,
      });
    }
    res.json({
      success: true,
      accepted: consent_types.map((t) => ({
        consent_type: t,
        version: TERMS_CONFIG[t].version,
      })),
    });
  } catch (err) {
    console.error('POST /consent/accept error:', err);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

module.exports = router;
