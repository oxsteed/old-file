const { v4: uuidv4 } = require('uuid');
const pool = require('../../db');
const { normalizeLanguageCode } = require('../localization/localeService');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listGlossaries(ownerUserId) {
  const { rows } = await pool.query(
    `SELECT id,
            name,
            domain,
            description,
            status,
            version,
            source_language_code AS "sourceLanguage",
            target_language_code AS "targetLanguage",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
       FROM glossaries
      WHERE owner_user_id = $1
      ORDER BY updated_at DESC, created_at DESC`,
    [ownerUserId]
  );
  return rows;
}

async function getGlossaryById(glossaryId, ownerUserId) {
  const { rows } = await pool.query(
    `SELECT id,
            owner_user_id AS "ownerUserId",
            name,
            domain,
            description,
            status,
            version,
            source_language_code AS "sourceLanguage",
            target_language_code AS "targetLanguage",
            metadata,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
       FROM glossaries
      WHERE id = $1
        AND owner_user_id = $2
      LIMIT 1`,
    [glossaryId, ownerUserId]
  );
  const glossary = rows[0];
  if (!glossary) return null;

  const termsResult = await pool.query(
    `SELECT id,
            source_term AS "sourceTerm",
            target_term AS "targetTerm",
            locale_pair AS "localePair",
            is_locked AS "isLocked",
            notes,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
       FROM glossary_terms
      WHERE glossary_id = $1
      ORDER BY source_term ASC`,
    [glossaryId]
  );

  glossary.terms = termsResult.rows;
  return glossary;
}

async function createGlossary({ ownerUserId, name, domain, sourceLanguage, targetLanguage, description }) {
  const id = uuidv4();
  const normalizedSource = sourceLanguage ? normalizeLanguageCode(sourceLanguage) : null;
  const normalizedTarget = targetLanguage ? normalizeLanguageCode(targetLanguage) : null;

  const { rows } = await pool.query(
    `INSERT INTO glossaries (
       id,
       owner_user_id,
       name,
       domain,
       source_language_code,
       target_language_code,
       description
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id,
               name,
               domain,
               description,
               version,
               source_language_code AS "sourceLanguage",
               target_language_code AS "targetLanguage",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [id, ownerUserId, name.trim(), domain?.trim() || null, normalizedSource, normalizedTarget, description?.trim() || null]
  );

  return rows[0];
}

async function addGlossaryTerms(glossaryId, ownerUserId, terms) {
  const glossary = await getGlossaryById(glossaryId, ownerUserId);
  if (!glossary) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const term of terms) {
      const localePair = `${normalizeLanguageCode(term.sourceLanguage || glossary.sourceLanguage)}:${normalizeLanguageCode(term.targetLanguage || glossary.targetLanguage)}`;
      const id = uuidv4();
      const { rows } = await client.query(
        `INSERT INTO glossary_terms (
           id,
           glossary_id,
           source_term,
           target_term,
           locale_pair,
           is_locked,
           notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (glossary_id, locale_pair, source_term)
         DO UPDATE SET
           target_term = EXCLUDED.target_term,
           is_locked = EXCLUDED.is_locked,
           notes = EXCLUDED.notes,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id,
                   source_term AS "sourceTerm",
                   target_term AS "targetTerm",
                   locale_pair AS "localePair",
                   is_locked AS "isLocked",
                   notes`,
        [
          id,
          glossaryId,
          term.sourceTerm.trim(),
          term.targetTerm.trim(),
          localePair,
          term.locked !== false,
          term.notes?.trim() || null,
        ]
      );
      inserted.push(rows[0]);
    }

    await client.query(
      `UPDATE glossaries
          SET version = version + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [glossaryId]
    );
    await client.query('COMMIT');

    return getGlossaryById(glossaryId, ownerUserId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateGlossary(glossaryId, ownerUserId, patch = {}) {
  const fields = [];
  const params = [glossaryId, ownerUserId];
  const allowed = {
    name: (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
    domain: (v) => (typeof v === 'string' ? (v.trim() || null) : v == null ? null : undefined),
    description: (v) => (typeof v === 'string' ? (v.trim() || null) : v == null ? null : undefined),
    status: (v) => (v === 'active' || v === 'archived' ? v : undefined),
    sourceLanguage: (v) => (typeof v === 'string' ? normalizeLanguageCode(v) : v == null ? null : undefined),
    targetLanguage: (v) => (typeof v === 'string' ? normalizeLanguageCode(v) : v == null ? null : undefined),
  };
  const columnMap = {
    name: 'name',
    domain: 'domain',
    description: 'description',
    status: 'status',
    sourceLanguage: 'source_language_code',
    targetLanguage: 'target_language_code',
  };
  for (const [key, transform] of Object.entries(allowed)) {
    if (!(key in patch)) continue;
    const value = transform(patch[key]);
    if (value === undefined) continue;
    params.push(value);
    fields.push(`${columnMap[key]} = $${params.length}`);
  }
  if (!fields.length) {
    return getGlossaryById(glossaryId, ownerUserId);
  }
  const { rows } = await pool.query(
    `UPDATE glossaries
        SET ${fields.join(', ')},
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND owner_user_id = $2
      RETURNING id`,
    params
  );
  if (!rows[0]) return null;
  return getGlossaryById(glossaryId, ownerUserId);
}

async function deleteGlossary(glossaryId, ownerUserId) {
  const { rowCount } = await pool.query(
    `DELETE FROM glossaries
      WHERE id = $1
        AND owner_user_id = $2`,
    [glossaryId, ownerUserId]
  );
  return rowCount > 0;
}

async function deleteGlossaryTerm(glossaryId, termId, ownerUserId) {
  const owns = await pool.query(
    `SELECT 1
       FROM glossaries
      WHERE id = $1
        AND owner_user_id = $2
      LIMIT 1`,
    [glossaryId, ownerUserId]
  );
  if (!owns.rows.length) return null;
  const { rowCount } = await pool.query(
    `DELETE FROM glossary_terms
      WHERE id = $1
        AND glossary_id = $2`,
    [termId, glossaryId]
  );
  if (rowCount > 0) {
    await pool.query(
      `UPDATE glossaries
          SET version = version + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [glossaryId]
    );
  }
  return rowCount > 0;
}

async function getGlossaryContext(glossaryId, sourceLanguage, targetLanguage, ownerUserId = null) {
  if (!glossaryId) {
    return { glossary: null, terms: [], glossaryVersion: 0 };
  }

  const params = [glossaryId];
  let ownerClause = '';
  if (ownerUserId) {
    params.push(ownerUserId);
    ownerClause = 'AND owner_user_id = $2';
  }

  const { rows } = await pool.query(
    `SELECT id,
            name,
            version
       FROM glossaries
      WHERE id = $1
        AND status = 'active'
        ${ownerClause}
      LIMIT 1`,
    params
  );

  const glossary = rows[0];
  if (!glossary) {
    return { glossary: null, terms: [], glossaryVersion: 0 };
  }

  const localePair = `${normalizeLanguageCode(sourceLanguage)}:${normalizeLanguageCode(targetLanguage)}`;
  const termsResult = await pool.query(
    `SELECT source_term AS "sourceTerm",
            target_term AS "targetTerm",
            is_locked AS "isLocked"
       FROM glossary_terms
      WHERE glossary_id = $1
        AND locale_pair = $2
      ORDER BY LENGTH(source_term) DESC, source_term ASC`,
    [glossaryId, localePair]
  );

  return {
    glossary,
    terms: termsResult.rows,
    glossaryVersion: glossary.version,
  };
}

function protectGlossaryTerms(text, terms) {
  if (!text || !terms.length) {
    return {
      maskedText: text,
      glossaryHits: [],
      replacements: [],
    };
  }

  let maskedText = text;
  const replacements = [];
  const glossaryHits = [];

  terms.forEach((term, index) => {
    if (!term?.sourceTerm || !maskedText.includes(term.sourceTerm)) return;
    const placeholder = `__OXSTEED_GLOSSARY_${index}__`;
    const expression = new RegExp(escapeRegExp(term.sourceTerm), 'g');
    const hitCount = (maskedText.match(expression) || []).length;
    if (!hitCount) return;

    maskedText = maskedText.replace(expression, placeholder);
    replacements.push({
      placeholder,
      sourceTerm: term.sourceTerm,
      targetTerm: term.targetTerm,
      isLocked: !!term.isLocked,
      hitCount,
    });
    glossaryHits.push(term.sourceTerm);
  });

  return {
    maskedText,
    glossaryHits,
    replacements,
  };
}

function restoreGlossaryTerms(text, replacements) {
  let restoredText = text;
  for (const replacement of replacements) {
    const expression = new RegExp(escapeRegExp(replacement.placeholder), 'g');
    restoredText = restoredText.replace(expression, replacement.targetTerm);
  }
  return restoredText;
}

function validateGlossaryOutput(text, replacements) {
  const warnings = [];
  for (const replacement of replacements) {
    if (replacement.isLocked && !text.includes(replacement.targetTerm)) {
      warnings.push(`Locked glossary term missing from output: ${replacement.targetTerm}`);
    }
  }
  return warnings;
}

module.exports = {
  listGlossaries,
  getGlossaryById,
  createGlossary,
  updateGlossary,
  deleteGlossary,
  addGlossaryTerms,
  deleteGlossaryTerm,
  getGlossaryContext,
  protectGlossaryTerms,
  restoreGlossaryTerms,
  validateGlossaryOutput,
};
