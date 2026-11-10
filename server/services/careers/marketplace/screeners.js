'use strict';

// Screener questions and deal-breakers (docs/careers/marketplace.md §7).
// Employers add up to 10 questions per opening: presets from the catalog
// (localized in the UI) or custom text. Only presets with an objective
// expected answer can be deal-breakers, and custom prompts that ask about
// protected characteristics are refused. When the opening turns on
// `screener_auto_reject`, an application that misses a deal-breaker is
// moved to rejected with reason `requirements_not_met`, naming the
// requirement, so the candidate gets the same transparent notice as a
// manual rejection. Signed-in workers can save preset answers as defaults.

const { AppError } = require('../../../middleware/errorHandler');
const { SCREENER_PRESETS, EDUCATION_ORDER } = require('../../careerCatalog');
const { stampDecision } = require('../retention');
const { notifyApplicant } = require('../notify');
const { cleanUserText } = require('./common');

const MAX_QUESTIONS = 10;
const ANSWER_TYPES = ['yes_no', 'number', 'choice', 'text'];
// Custom prompts may not probe protected characteristics (EEOC/Title VII,
// ADA, ADEA and the equivalents in the other launch markets).
const PROTECTED_PATTERNS = [
  /\b(how old|your age|date of birth|birth ?date|born in|year of birth)\b/i,
  /\b(religio\w*|church|mosque|synagogue|pray\w*)\b/i,
  /\b(pregnan\w*|maternity|married|marital|spouse|husband|wife|do you have (any )?(children|kids)|plan(ning)? to have (children|kids))\b/i,
  /\b(disab\w*|handicap\w*|medical condition|illness|medication|mental health|workers'? comp\w*)\b/i,
  /\b(race|racial|ethnic\w*|skin colou?r|national origin|nationality|citizenship|immigra\w*)\b/i,
  /\b(gender|sex|sexual orientation|transgender|gay|lesbian)\b/i,
  /\b(arrest\w*|criminal record|convict\w*|felon\w*)\b/i,
  /\b(salary history|current salary|previous salary|what (do|did) you (make|earn))\b/i,
];

function fieldError(field, message) {
  return new AppError('Validation failed', 400, 'validation_failed', { [field]: message });
}

function parseExpected(code, preset, raw) {
  if (raw == null) return null;
  if (preset.answer_type === 'yes_no') return { answer: raw.answer !== false };
  if (preset.answer_type === 'number') {
    const min = Number(raw.min);
    if (!Number.isFinite(min) || min < 0 || min > 60) return undefined;
    return { min };
  }
  if (code === 'education') return EDUCATION_ORDER.includes(raw.min) ? { min: raw.min } : undefined;
  const anyOf = Array.isArray(raw.any_of) ? raw.any_of.filter((c) => preset.choices.includes(c)) : [];
  return anyOf.length ? { any_of: [...new Set(anyOf)] } : undefined;
}

function parseQuestions(list) {
  if (!Array.isArray(list)) throw fieldError('questions', 'Send a list of questions');
  if (list.length > MAX_QUESTIONS) throw fieldError('questions', `Up to ${MAX_QUESTIONS} questions`);
  return list.map((q, i) => {
    const key = `questions.${i}`;
    if (q.preset_code) {
      const preset = SCREENER_PRESETS[q.preset_code];
      if (!preset) throw fieldError(key, 'Unknown preset question');
      const detail = cleanUserText(q.detail || q.prompt || '', 300).text;
      const dealbreaker = Boolean(q.dealbreaker);
      const expected = parseExpected(q.preset_code, preset, q.expected);
      if (expected === undefined) throw fieldError(key, 'Set the answer you need');
      if (dealbreaker && !expected) throw fieldError(key, 'A deal-breaker needs the answer you require');
      return {
        position: i, kind: 'preset', preset_code: q.preset_code, prompt: detail || q.preset_code,
        answer_type: preset.answer_type, choices: preset.choices || [], required: q.required !== false || dealbreaker,
        dealbreaker, expected: expected || null,
      };
    }
    const clean = cleanUserText(q.prompt, 300);
    if (!clean.text || clean.text.length < 5) throw fieldError(key, 'Write the question');
    if (PROTECTED_PATTERNS.some((re) => re.test(clean.text))) {
      throw new AppError('Validation failed', 400, 'validation_failed', { [key]: 'This asks about a protected characteristic. Use a preset question or rephrase it around the job.' });
    }
    const answerType = ANSWER_TYPES.includes(q.answer_type) ? q.answer_type : 'text';
    const choices = answerType === 'choice'
      ? [...new Set((Array.isArray(q.choices) ? q.choices : []).map((c) => cleanUserText(c, 80).text).filter(Boolean))].slice(0, 10)
      : [];
    if (answerType === 'choice' && choices.length < 2) throw fieldError(key, 'Add at least two choices');
    if (q.dealbreaker) throw fieldError(key, 'Only preset questions can be deal-breakers');
    return {
      position: i, kind: 'custom', preset_code: null, prompt: clean.text, answer_type: answerType, choices,
      required: q.required !== false, dealbreaker: false, expected: null,
    };
  });
}

async function listQuestions(db, openingId, { forCandidate = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, position, kind, preset_code, prompt, answer_type, choices, required, dealbreaker, expected
       FROM career_screener_questions WHERE opening_id = $1 ORDER BY position, id`,
    [openingId]
  );
  // Candidates see the question and whether it is required, never the
  // expected answer, so deal-breakers can't be gamed by reading the page.
  return forCandidate ? rows.map(({ expected, dealbreaker, ...q }) => q) : rows;
}

async function replaceQuestions(db, { openingId, questions }) {
  const parsed = parseQuestions(questions);
  await db.query('DELETE FROM career_screener_questions WHERE opening_id = $1', [openingId]);
  for (const q of parsed) {
    await db.query(
      `INSERT INTO career_screener_questions (opening_id, position, kind, preset_code, prompt, answer_type, choices, required, dealbreaker, expected)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [openingId, q.position, q.kind, q.preset_code, q.prompt, q.answer_type, JSON.stringify(q.choices), q.required, q.dealbreaker,
        q.expected ? JSON.stringify(q.expected) : null]
    );
  }
  return listQuestions(db, openingId);
}

function normalizeAnswer(q, raw) {
  if (raw == null || raw === '') return undefined;
  if (q.answer_type === 'yes_no') {
    if (raw === true || raw === 'yes' || raw === 'true') return true;
    if (raw === false || raw === 'no' || raw === 'false') return false;
    return null;
  }
  if (q.answer_type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 80 ? Math.round(n * 10) / 10 : null;
  }
  if (q.answer_type === 'choice') {
    const values = Array.isArray(raw) ? raw : [raw];
    const ok = values.map(String).filter((v) => q.choices.includes(v));
    if (!ok.length) return null;
    return q.preset_code === 'shift_availability' ? [...new Set(ok)] : ok[0];
  }
  return cleanUserText(raw, 1000).text || undefined;
}

function meets(q, answer) {
  if (!q.dealbreaker || !q.expected) return true;
  if (answer === undefined || answer === null) return false;
  if (q.answer_type === 'yes_no') return answer === q.expected.answer;
  if (q.answer_type === 'number') return Number(answer) >= Number(q.expected.min);
  if (q.preset_code === 'education') return EDUCATION_ORDER.indexOf(answer) >= EDUCATION_ORDER.indexOf(q.expected.min);
  const given = Array.isArray(answer) ? answer : [answer];
  return given.some((v) => (q.expected.any_of || []).includes(v));
}

/**
 * Validate a candidate's answers for an opening. Returns the stored form
 * and the deal-breaker outcome. Throws a field-level 400 on missing or
 * malformed answers so nothing reaches the employer half-filled.
 */
async function evaluateAnswers(db, openingId, rawAnswers) {
  const questions = await listQuestions(db, openingId);
  if (!questions.length) return { answers: null, passed: null, failed: [] };
  const input = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const fields = {};
  const answers = [];
  const failed = [];
  for (const q of questions) {
    const answer = normalizeAnswer(q, input[q.id] ?? input[String(q.id)]);
    if (answer === null) fields[`screener_answers.${q.id}`] = 'Choose a valid answer';
    else if (answer === undefined && q.required) fields[`screener_answers.${q.id}`] = 'Answer this question';
    answers.push({ question_id: q.id, preset_code: q.preset_code, prompt: q.prompt, answer_type: q.answer_type, answer: answer ?? null, dealbreaker: q.dealbreaker });
    if (!meets(q, answer)) failed.push(q.preset_code || `q${q.id}`);
  }
  if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);
  return { answers, passed: failed.length === 0, failed };
}

/** Store answers on the new application and apply auto-reject if enabled. */
async function applyOutcome(db, { application, opening, screen }) {
  if (!screen || !screen.answers) return { autoRejected: false };
  await db.query(
    'UPDATE career_applications SET screener_answers = $2, screener_passed = $3 WHERE id = $1',
    [application.id, JSON.stringify(screen.answers), screen.passed]
  );
  if (screen.passed) return { autoRejected: false };
  const { rows: [cfg] } = await db.query('SELECT screener_auto_reject FROM career_openings WHERE id = $1', [opening.id]);
  if (!cfg?.screener_auto_reject) return { autoRejected: false };
  const requirement = `screener:${screen.failed[0]}`.slice(0, 120);
  await db.query(
    `UPDATE career_applications SET stage = 'rejected', rejection_reason_code = 'requirements_not_met', rejection_requirement = $2, updated_at = NOW()
      WHERE id = $1`,
    [application.id, requirement]
  );
  await stampDecision(db, application.id, { decidedBy: null });
  // eslint-disable-next-line global-require
  const { recordEvent, employerName } = require('../applications');
  await recordEvent(db, {
    applicationId: application.id, actorId: null, from: 'received', to: 'rejected', reasonCode: 'requirements_not_met',
    metadata: { requirement, auto: 'screener' },
  });
  await notifyApplicant(db, application, {
    type: 'career_application_rejected',
    params: { openingTitle: opening.title, employerName: employerName(opening), reasonCode: 'requirements_not_met', requirement },
    deliveryKey: `career_rejected:${application.id}`,
  });
  return { autoRejected: true };
}

// ── Saved defaults (signed-in workers) ──────────────────────────────────────

async function getDefaults(db, userId) {
  const { rows } = await db.query('SELECT preset_code, answer FROM career_profile_screener_defaults WHERE user_id = $1', [userId]);
  return Object.fromEntries(rows.map((r) => [r.preset_code, r.answer]));
}

async function saveDefaults(db, userId, answers) {
  const list = Array.isArray(answers) ? answers : [];
  for (const a of list) {
    if (!a.preset_code || !SCREENER_PRESETS[a.preset_code] || a.answer == null) continue;
    await db.query(
      `INSERT INTO career_profile_screener_defaults (user_id, preset_code, answer) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, preset_code) DO UPDATE SET answer = EXCLUDED.answer, updated_at = NOW()`,
      [userId, a.preset_code, JSON.stringify(a.answer)]
    );
  }
  return getDefaults(db, userId);
}

async function setDefaults(db, userId, body) {
  const input = body && typeof body === 'object' ? body : {};
  const list = [];
  for (const [code, raw] of Object.entries(input)) {
    const preset = SCREENER_PRESETS[code];
    if (!preset) continue;
    const answer = normalizeAnswer({ ...preset, preset_code: code, choices: preset.choices || [] }, raw);
    if (answer === null) throw fieldError(code, 'Choose a valid answer');
    if (answer === undefined) {
      await db.query('DELETE FROM career_profile_screener_defaults WHERE user_id = $1 AND preset_code = $2', [userId, code]);
    } else list.push({ preset_code: code, answer });
  }
  return saveDefaults(db, userId, list);
}

module.exports = {
  MAX_QUESTIONS,
  PROTECTED_PATTERNS,
  parseQuestions,
  listQuestions,
  replaceQuestions,
  normalizeAnswer,
  meets,
  evaluateAnswers,
  applyOutcome,
  getDefaults,
  saveDefaults,
  setDefaults,
};
