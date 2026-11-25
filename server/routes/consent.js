const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { TERMS_CONFIG, REQUIRED_CONSENTS } = require('../constants/termsConfig');
const User = require('../models/userModel');
const logger = require('../utils/logger');

const hashIP = (ip) => ip
  ? crypto.createHash('sha256').update(ip).digest('hex')
  : null;

// ─── GET /api/consent/status ──────────────────────────────────
// Returns the user's current consent status for all required types
router.get('/status', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (consent_type)
        consent_type, version, accepted_at
        FROM user_consents
        WHERE user_id = $1
        AND consent_type = ANY($2)
        ORDER BY consent_type, accepted_at DESC`,
      [req.user.id, REQUIRED_CONSENTS]
    );
    const accepted = {};
    rows.forEach((r) => {
      accepted[r.consent_type] = {
        version: r.version,
        accepted_at: r.accepted_at,
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
    logger.error('GET /consent/status error', { error: err.message });
    res.status(500).json({ error: 'Failed to check consent status' });
  }
});

// ─── GET /api/consent/history ─────────────────────────────────
// Group 13 Slice 4j (697): the customer's own consent history — every
// recorded acceptance, newest first. Two derived reads over the existing
// records, no second consent store: `user_consents` (per-type version +
// accepted_at) and `credit_disclosure_acceptances` (per-item disclosure
// acceptances, joined to the version row for its number/title when the
// acceptance names one; a NULL version means the built-in placeholder
// text was accepted before counsel published a version). Scoped to the
// caller's own id on both reads, so a customer sees only their history.
router.get('/history', authenticate, async (req, res) => {
  try {
    const { rows: consents } = await db.query(
      `SELECT consent_type, version, accepted_at
         FROM user_consents
        WHERE user_id = $1
        ORDER BY accepted_at DESC, id DESC
        LIMIT 100`,
      [req.user.id]
    );
    const { rows: disclosures } = await db.query(
      `SELECT a.disclosure_kind, a.language, a.context, a.accepted_at,
              v.version AS version_number, v.title AS version_title
         FROM credit_disclosure_acceptances a
         LEFT JOIN credit_disclosure_versions v ON v.id = a.disclosure_version_id
        WHERE a.user_id = $1
        ORDER BY a.accepted_at DESC, a.id DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({
      consents: consents.map((row) => ({
        consentType: row.consent_type,
        version: row.version,
        acceptedAt: row.accepted_at,
      })),
      disclosures: disclosures.map((row) => ({
        disclosureKind: row.disclosure_kind,
        language: row.language,
        context: row.context,
        version: row.version_number === null || row.version_number === undefined
          ? null
          : Number(row.version_number),
        title: row.version_title || null,
        acceptedAt: row.accepted_at,
      })),
    });
  } catch (err) {
    logger.error('GET /consent/history error', { error: err.message });
    res.status(500).json({ error: 'Failed to load consent history' });
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
    logger.error('POST /consent/accept error', { error: err.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

module.exports = router;
