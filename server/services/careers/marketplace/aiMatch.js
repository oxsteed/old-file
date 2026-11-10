'use strict';

// AI résumé-to-job match (docs/careers/marketplace.md §9). Runs only when
// CAREERS_AI_MATCH_ENABLED=true AND matching.rankingGate allows the opening
// (global ranking flag, per-opening opt-in shown to applicants, market
// enabled with a current bias audit, EU AI Act / UK DPIA sign-offs, no open
// impact-ratio block, NYC notice period). The model is the self-hosted,
// digest-pinned Ollama and sees job-related data only: role titles and
// months of experience, credential names, skills and verified fact types.
// It never sees names, photos, contact details, employers, schools, cities,
// postal codes or EEO data. Employers get met/gap reasons and a band,
// never a bare number, and the result is advisory: there is no auto-reject.

const { AppError } = require('../../../middleware/errorHandler');
const { generate } = require('../../../growth/ollamaClient');
const { matchConfig } = require('../providers/config');
const { rankingGate } = require('../matching');
const { inputHash, logRun } = require('../aiRuns');
const { featureOff } = require('./common');

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'met', 'gaps'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    met: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 120 } },
    gaps: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 120 } },
  },
};

function band(score) {
  if (score >= 75) return 'strong';
  if (score >= 45) return 'partial';
  return 'limited';
}

function months(start, end) {
  const a = new Date(start);
  const b = end ? new Date(end) : new Date();
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

/** Build the minimized, job-related input. Exported for tests. */
async function buildInput(db, opening, application) {
  const userId = application.user_id;
  const [work, edu, lic, profile, facts] = await Promise.all([
    db.query('SELECT title, start_month, end_month, is_current FROM career_profile_work_history WHERE user_id = $1 ORDER BY start_month DESC LIMIT 15', [userId]),
    db.query('SELECT credential, field_of_study FROM career_profile_education WHERE user_id = $1 LIMIT 8', [userId]),
    db.query('SELECT name, expires_on FROM career_profile_licenses WHERE user_id = $1 LIMIT 15', [userId]),
    db.query('SELECT skill_codes, desired_roles FROM career_profiles WHERE user_id = $1', [userId]),
    db.query('SELECT DISTINCT fact_type FROM career_profile_facts WHERE user_id = $1', [userId]),
  ]);
  return {
    job: {
      title: String(opening.title || '').slice(0, 160),
      requirements: String(opening.requirements || '').slice(0, 4000),
      required_credentials: opening.required_credentials || [],
      preferred_credentials: opening.preferred_credentials || [],
      required_languages: opening.required_languages || [],
      experience_level: opening.experience_level || null,
    },
    candidate: {
      roles: work.rows.map((w) => ({ title: String(w.title).slice(0, 120), months: months(w.start_month, w.is_current ? null : w.end_month) })),
      education: edu.rows.map((e) => [e.credential, e.field_of_study].filter(Boolean).join(' — ').slice(0, 160)).filter(Boolean),
      licences: lic.rows.map((l) => ({ name: String(l.name).slice(0, 120), expired: Boolean(l.expires_on && new Date(l.expires_on) < new Date()) })),
      skills: profile.rows[0]?.skill_codes || [],
      verified_fact_types: facts.rows.map((f) => f.fact_type),
      self_reported: true,
    },
  };
}

async function runMatch(db, { applicationId, actorId, generateImpl = generate }) {
  if (!matchConfig().enabled) throw featureOff('ai_match');
  const { rows: [app] } = await db.query(
    'SELECT id, opening_id, user_id, is_guest, anonymized_at, stage FROM career_applications WHERE id = $1', [applicationId]
  );
  if (!app) throw new AppError('Application not found', 404, 'not_found');
  if (!app.user_id || app.is_guest || app.anonymized_at) return { available: false, reason: 'no_profile' };
  const { rows: [opening] } = await db.query('SELECT * FROM career_openings WHERE id = $1', [app.opening_id]);
  const gate = await rankingGate(db, opening);
  if (!gate.allowed) return { available: false, reason: gate.reason };
  const data = await buildInput(db, opening, app);
  const hash = inputHash({ purpose: 'match_resume', data });
  const result = await generateImpl({ data, schema: MATCH_SCHEMA, task: 'careers_rank' });
  const runId = await logRun(db, { purpose: 'match_resume', openingId: opening.id, hash, result, fallbackReason: result ? null : 'model_unavailable', acceptedBy: actorId });
  if (!result) return { available: false, reason: 'model_unavailable', runId };
  const { score, met, gaps } = result.output;
  await db.query(
    `INSERT INTO career_ai_match_scores (application_id, run_id, score, met, gaps) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (application_id) DO UPDATE SET run_id = EXCLUDED.run_id, score = EXCLUDED.score, met = EXCLUDED.met, gaps = EXCLUDED.gaps, created_at = NOW()`,
    [app.id, runId, score, met, gaps]
  );
  return { available: true, band: band(score), met, gaps, runId, advisory: true };
}

async function matchForEmployer(db, applicationId) {
  if (!matchConfig().enabled) return null;
  const { rows: [row] } = await db.query('SELECT score, met, gaps, created_at FROM career_ai_match_scores WHERE application_id = $1', [applicationId]);
  if (!row) return null;
  return { band: band(row.score), met: row.met, gaps: row.gaps, created_at: row.created_at, advisory: true };
}

module.exports = { MATCH_SCHEMA, band, buildInput, runMatch, matchForEmployer };
