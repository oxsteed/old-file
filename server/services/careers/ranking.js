'use strict';

// AI applicant ranking (spec §10.4, Q6). Gated per market; when the gate
// is closed or Ollama is unavailable the board uses the neutral sort and
// says why. The model sees only requirement codes and each applicant's
// shared, non-identifying facts: never photos, names, contact details,
// postal codes, ratings, EEO answers, boosts or payments.

const { generate } = require('../../growth/ollamaClient');
const { rankingGate, rankOrder, requirementChecklist } = require('./matching');
const { inputHash, findCached, logRun } = require('./aiRuns');

// Fact types the model may see. Ratings, rehire eligibility, background
// checks and ID status are excluded on purpose.
const MODEL_FACT_TYPES = Object.freeze(['completed_jobs', 'on_time_rate', 'training_completed', 'certificate', 'badge', 'shifts_worked', 'tenure']);
const ALLOWED_FACT_VALUE_KEYS = Object.freeze(['count', 'rate', 'months', 'doc_type', 'expires_on', 'code', 'level']);

const RANK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assessments'],
  properties: {
    assessments: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'status', 'reason'],
        properties: {
          code: { type: 'string', maxLength: 64 },
          status: { type: 'string', enum: ['met', 'partly_met', 'not_shown'] },
          reason: { type: 'string', maxLength: 160 },
        },
      },
    },
  },
};

function requirementList(opening) {
  return [
    ...(opening.required_credentials || []).map((code) => ({ code, kind: 'credential', required: true })),
    ...(opening.preferred_credentials || []).map((code) => ({ code, kind: 'credential', required: false })),
    ...(opening.required_languages || []).map((code) => ({ code: String(code).split(':')[0], kind: 'language', required: true })),
    ...((opening.requirement_tags?.skills || []).map((code) => ({ code, kind: 'skill', required: false }))),
  ];
}

/**
 * The exact JSON the model receives for one applicant. Exported so tests
 * can assert that nothing identifying or protected is ever included.
 */
function buildRankInput(opening, application) {
  const facts = (application.profile_snapshot?.facts || [])
    .filter((f) => MODEL_FACT_TYPES.includes(f.fact_type))
    .map((f) => ({
      type: f.fact_type,
      category: f.category || null,
      value: Object.fromEntries(Object.entries(f.value || {}).filter(([k]) => ALLOWED_FACT_VALUE_KEYS.includes(k))),
      sample_size: f.sample_size ?? null,
    }));
  return {
    requirements: requirementList(opening),
    applicant: {
      facts,
      skill_codes: (application.profile_snapshot?.skill_codes || []).slice(0, 30),
      languages: (application.languages || []).map((l) => String(l).split(':')[0]).slice(0, 8),
    },
  };
}

/**
 * Rank applications for an opening. Returns
 *   { mode: 'ai', order, runIds } when ranking ran, or
 *   { mode: 'neutral', reason } when it may not or could not.
 */
async function rankApplicants(db, opening, applications, { actorId = null, generateImpl = generate } = {}) {
  const gate = await rankingGate(db, opening);
  if (!gate.allowed) return { mode: 'neutral', reason: gate.reason };
  const assessments = new Map();
  const runIds = [];
  for (const app of applications) {
    const data = buildRankInput(opening, app);
    if (!data.requirements.length) return { mode: 'neutral', reason: 'no_confirmed_requirements' };
    const hash = inputHash({ purpose: 'rank_applicants', data });
    let output;
    let runId;
    const cached = await findCached(db, 'rank_applicants', hash);
    if (cached) {
      output = cached.output;
      runId = cached.id;
    } else {
      const result = await generateImpl({ data, schema: RANK_SCHEMA, task: 'careers_rank' });
      runId = await logRun(db, { purpose: 'rank_applicants', openingId: opening.id, hash, result, fallbackReason: result ? null : 'model_unavailable', acceptedBy: actorId });
      if (!result) return { mode: 'neutral', reason: 'model_unavailable' };
      output = result.output;
    }
    const reqByCode = new Map(data.requirements.map((r) => [String(r.code), r]));
    assessments.set(Number(app.id), (output.assessments || [])
      .filter((a) => reqByCode.has(String(a.code)))
      .map((a) => ({ ...a, required: reqByCode.get(String(a.code)).required, kind: reqByCode.get(String(a.code)).kind })));
    runIds.push(runId);
    await db.query('UPDATE career_applications SET ai_rank_run_id = $2 WHERE id = $1', [app.id, runId]);
  }
  return { mode: 'ai', order: rankOrder(applications, assessments), runIds, market: gate.market };
}

// Non-AI checklist per application (always available).
function checklistFor(opening, application) {
  return requirementChecklist(opening, {
    facts: application.profile_snapshot?.facts || [],
    languages: application.languages || [],
    authorizedToWork: application.authorized_to_work,
    needsSponsorship: application.needs_sponsorship,
  });
}

module.exports = { MODEL_FACT_TYPES, RANK_SCHEMA, requirementList, buildRankInput, rankApplicants, checklistFor };
