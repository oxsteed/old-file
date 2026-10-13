'use strict';

const { REQUIRED_CONSENTS, TERMS_CONFIG } = require('../../constants/termsConfig');

const currentConsentRows = () => REQUIRED_CONSENTS.map(consent_type => ({
  consent_type,
  version: TERMS_CONFIG[consent_type].version,
}));

async function acceptCurrentConsents(pool, userId) {
  for (const row of currentConsentRows()) {
    await pool.query(
      'INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [userId, row.consent_type, row.version, 'a'.repeat(64), 'synthetic-consent-fixture'],
    );
  }
}

module.exports = { currentConsentRows, acceptCurrentConsents };
