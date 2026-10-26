'use strict';

// Voluntary US EEO self-ID (careers spec §6.12, Q7). Encrypted with the
// app key (AES-256-GCM via utils/encryption) in careers_private. Never
// returned to employers, never a model input; only the fairness job and
// the audit export read it, aggregated over groups of at least 10.

const { AppError } = require('../../middleware/errorHandler');
const { encrypt, decrypt } = require('../../utils/encryption');
const { EEO_OPTIONS } = require('../careerCatalog');

const KEY_VERSION = 'v1';

function cleanResponses(input = {}) {
  const out = {};
  for (const [field, allowed] of Object.entries(EEO_OPTIONS)) {
    const value = input[field];
    if (value === undefined || value === null || value === '') continue;
    if (!allowed.includes(value)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Choose one of the listed answers' });
    }
    out[field] = value;
  }
  return out;
}

async function saveResponses(db, applicationId, input) {
  const responses = cleanResponses(input);
  const ciphertext = encrypt(JSON.stringify(responses));
  await db.query(
    `INSERT INTO careers_private.career_eeo_responses (application_id, ciphertext, key_version)
     VALUES ($1, $2, $3)
     ON CONFLICT (application_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext,
       key_version = EXCLUDED.key_version, updated_at = NOW()`,
    [applicationId, ciphertext, KEY_VERSION]
  );
  return { saved: true, fields: Object.keys(responses) };
}

async function hasResponses(db, applicationId) {
  const { rows } = await db.query('SELECT 1 FROM careers_private.career_eeo_responses WHERE application_id = $1', [applicationId]);
  return rows.length > 0;
}

// Only for the fairness job and the audit export.
async function loadForApplications(db, applicationIds) {
  if (!applicationIds.length) return new Map();
  const { rows } = await db.query(
    'SELECT application_id, ciphertext FROM careers_private.career_eeo_responses WHERE application_id = ANY($1::bigint[])',
    [applicationIds]
  );
  const map = new Map();
  for (const row of rows) {
    try {
      map.set(Number(row.application_id), JSON.parse(decrypt(row.ciphertext)));
    } catch {
      // Unreadable rows are skipped, never guessed.
    }
  }
  return map;
}

module.exports = { KEY_VERSION, cleanResponses, saveResponses, hasResponses, loadForApplications };
