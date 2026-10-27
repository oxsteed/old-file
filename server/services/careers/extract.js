'use strict';

// Ollama extraction for careers (spec §10.2). Rules first, Ollama second,
// never an outside model: growth/ollamaClient only talks to the local,
// digest-pinned Ollama and returns null otherwise. Suggestions are never
// "verified"; the employer or worker confirms them.

const { generate } = require('../../growth/ollamaClient');
const { extractionConfig } = require('./providers/config');
const { scanText } = require('./compliance');
const { inputHash, logRun } = require('./aiRuns');
const { SCHEDULE_TAGS } = require('./matching');

const CODE = { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,63}$' };
const OPENING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role_codes', 'required_credentials', 'preferred_credentials', 'languages', 'schedule', 'flags'],
  properties: {
    role_codes: { type: 'array', items: CODE, maxItems: 5 },
    required_credentials: { type: 'array', items: CODE, maxItems: 10 },
    preferred_credentials: { type: 'array', items: CODE, maxItems: 10 },
    languages: { type: 'array', items: { type: 'string', pattern: '^[a-z]{2,3}$' }, maxItems: 8 },
    schedule: { type: 'array', items: { type: 'string', enum: SCHEDULE_TAGS }, maxItems: 6 },
    flags: { type: 'array', items: { type: 'string', enum: ['salary_history', 'age_coded', 'native_speaker', 'background_blanket', 'citizens_only', 'gendered'] }, maxItems: 6 },
  },
};
const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role_codes', 'skill_codes'],
  properties: {
    role_codes: { type: 'array', items: CODE, maxItems: 5 },
    skill_codes: { type: 'array', items: CODE, maxItems: 20 },
  },
};

async function extractOpeningRequirements(db, opening, { actorId = null, generateImpl = generate } = {}) {
  const ruleFlags = scanText([opening.title, opening.description, opening.requirements].join('\n'));
  if (!extractionConfig().enabled) return { available: false, reason: 'disabled', ruleFlags };
  const data = {
    title: String(opening.title || '').slice(0, 200),
    description: String(opening.description || '').slice(0, 12000),
    requirements: String(opening.requirements || '').slice(0, 6000),
  };
  const hash = inputHash({ purpose: 'extract_opening_requirements', data });
  const result = await generateImpl({ data, schema: OPENING_SCHEMA, task: 'careers_extract' });
  const runId = await logRun(db, {
    purpose: 'extract_opening_requirements', openingId: opening.id || null, hash, result,
    fallbackReason: result ? null : 'model_unavailable', acceptedBy: actorId,
  });
  if (!result) return { available: false, reason: 'model_unavailable', ruleFlags, runId };
  return { available: true, suggestions: result.output, ruleFlags, runId };
}

async function extractProfileSkills(db, profile, { generateImpl = generate } = {}) {
  if (!extractionConfig().enabled) return { available: false, reason: 'disabled' };
  // Only the worker's own summary and headline; never name, contact or address.
  const data = { headline: String(profile.headline || '').slice(0, 200), summary: String(profile.summary || '').slice(0, 4000) };
  const hash = inputHash({ purpose: 'extract_profile_skills', data });
  const result = await generateImpl({ data, schema: PROFILE_SCHEMA, task: 'careers_extract' });
  const runId = await logRun(db, { purpose: 'extract_profile_skills', hash, result, fallbackReason: result ? null : 'model_unavailable' });
  if (!result) return { available: false, reason: 'model_unavailable', runId };
  return { available: true, suggestions: result.output, runId };
}

module.exports = { OPENING_SCHEMA, PROFILE_SCHEMA, extractOpeningRequirements, extractProfileSkills };
