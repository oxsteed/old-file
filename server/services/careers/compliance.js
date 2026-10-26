'use strict';

// Posting compliance checks (careers spec §10.1, Q12).
//
// Pay is required everywhere (validation.parseOpening). These checks add
// the jurisdiction rules on top and scan the posting text for wording that
// is unlawful or risky. `blocking` stops publishing; `warnings` are shown
// in the compliance panel. The rule list is product guidance, not legal
// advice; docs/careers/README.md lists it for counsel review.

const { EU_COUNTRIES } = require('../careerCatalog');

// Fallback rules used when career_pay_rules has no row (or the DB is not
// reachable in a pure unit test). The table is the source of truth.
const PAY_TRANSPARENCY = Object.freeze({
  'US-CO': { benefits_required: true, close_date_required: true, internal_promotion_notice: true },
  'US-WA': { benefits_required: true }, 'US-IL': { benefits_required: true }, 'US-MD': { benefits_required: true },
  'US-MN': { benefits_required: true }, 'US-NJ': { benefits_required: true, internal_promotion_notice: true },
});

const US_STATE_NAMES = Object.freeze({
  colorado: 'CO', california: 'CA', washington: 'WA', 'new york': 'NY', illinois: 'IL', maryland: 'MD',
  hawaii: 'HI', 'district of columbia': 'DC', minnesota: 'MN', 'new jersey': 'NJ', vermont: 'VT', massachusetts: 'MA',
});

function jurisdictionOf(opening) {
  const country = String(opening.country_code || '').toUpperCase();
  if (!country) return null;
  const rawRegion = String(opening.region || '').trim();
  let region = rawRegion.toUpperCase();
  if (country === 'US' && region.length > 2) region = US_STATE_NAMES[rawRegion.toLowerCase()] || region;
  return region && region.length <= 3 ? `${country}-${region}` : country;
}

const BLOCKING_PATTERNS = [
  { code: 'salary_history', re: /\b(salary|pay|wage|compensation)\s+history\b|\b(current|previous|prior|last)\s+(salary|pay|wage)\b|\bhistorial\s+salarial\b|\bsalaire\s+(actuel|pr[ée]c[ée]dent)\b/i },
  { code: 'citizens_only', re: /\b(u\.?s\.?\s+)?citizens?\s+only\b|\bmust\s+be\s+an?\s+(u\.?s\.?\s+)?citizen\b|\bno\s+(immigrants|foreigners|visa\s+holders)\b|\bsolo\s+ciudadanos\b/i },
  { code: 'age_limit', re: /\b(under|younger\s+than|no\s+older\s+than|not\s+older\s+than|maximum\s+age|max\.?\s+age)\s+\d{2}\b|\bages?\s+\d{2}\s*(-|to)\s*\d{2}\s+only\b/i },
  { code: 'gender_only', re: /\b(males?|men|females?|women|ladies|guys)\s+only\b|\bsolo\s+(hombres|mujeres)\b/i },
  { code: 'religion_only', re: /\b(christians?|muslims?|jews|jewish|hindus?|catholics?)\s+only\b/i },
  { code: 'arrest_record', re: /\bno\s+(arrests?|arrest\s+records?)\b|\bnever\s+been\s+arrested\b/i },
  { code: 'pregnancy', re: /\bnot\s+pregnant\b|\bno\s+pregnan(t|cy)\b/i },
];

const WARNING_PATTERNS = [
  { code: 'age_coded', re: /\b(young|youthful|recent\s+(college\s+)?grad(uate)?s?|digital\s+natives?|overqualified)\b/i },
  { code: 'native_speaker', re: /\bnative\s+(english|spanish|french)\s+speakers?\b/i },
  { code: 'gendered_title', re: /\b(salesman|waitress|hostess|chairman|foreman|handyman|cleaning\s+lady)\b/i },
  { code: 'background_blanket', re: /\b(no\s+felon(s|ies)|clean\s+(criminal\s+)?record\s+required|must\s+pass\s+(a\s+)?background\s+check)\b/i },
  { code: 'physical_unneeded', re: /\b(attractive|good[-\s]looking|well[-\s]groomed\s+appearance)\b/i },
];

function scanText(text) {
  const blocking = [];
  const warnings = [];
  const source = String(text || '');
  for (const p of BLOCKING_PATTERNS) {
    const m = source.match(p.re);
    if (m) blocking.push({ code: p.code, match: m[0].slice(0, 80) });
  }
  for (const p of WARNING_PATTERNS) {
    const m = source.match(p.re);
    if (m) warnings.push({ code: p.code, match: m[0].slice(0, 80) });
  }
  return { blocking, warnings };
}

/**
 * Full compliance result for an opening. `opening` is the parsed body
 * (or the stored row) with compensation_min/max, country_code, region,
 * applications_close_at, benefits_summary, title, description, requirements.
 */
function checkOpening(opening, { rule: loadedRule } = {}) {
  const jurisdiction = jurisdictionOf(opening);
  const isEu = EU_COUNTRIES.includes(String(opening.country_code || '').toUpperCase());
  const rule = loadedRule !== undefined ? loadedRule : (jurisdiction ? PAY_TRANSPARENCY[jurisdiction] || null : null);
  const blocking = [];
  const warnings = [];

  const min = Number(opening.compensation_min);
  const max = Number(opening.compensation_max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || opening.compensation_min == null || opening.compensation_max == null) {
    blocking.push({ code: 'pay_required' });
  } else if (min > 0 && max > 2 * min) {
    // Good-faith range: a max more than double the min is rarely good faith.
    warnings.push({ code: 'range_too_wide' });
  } else if (min === 0 && max > 0) {
    warnings.push({ code: 'range_too_wide' });
  }

  if (rule?.close_date_required && !opening.applications_close_at && !opening.closes_at) {
    blocking.push({ code: 'close_date_required', jurisdiction });
  }
  if (rule?.benefits_required && !String(opening.benefits_summary || opening.benefits || '').trim()) {
    warnings.push({ code: 'benefits_summary_recommended', jurisdiction });
  }
  if (opening.background_check_required && !String(opening.background_check_reason || '').trim()) {
    blocking.push({ code: 'background_check_reason_required' });
  }
  if (Number(opening.min_age) > 18 && !String(opening.min_age_reason || '').trim()) {
    blocking.push({ code: 'min_age_reason_required' });
  }

  if (rule?.internal_promotion_notice && opening.is_internal) {
    warnings.push({ code: 'internal_posting_notice', jurisdiction });
  }
  if ((rule?.gender_neutral_titles || isEu) && /\b(salesman|waitress|hostess|chairman|foreman|handyman)\b/i.test(String(opening.title || ''))) {
    blocking.push({ code: 'gendered_title_eu', jurisdiction });
  }

  const scan = scanText([opening.title, opening.description, opening.requirements, opening.benefits,
    opening.benefits_summary, opening.schedule_summary].filter(Boolean).join('\n'));
  blocking.push(...scan.blocking);
  warnings.push(...scan.warnings);

  return {
    jurisdiction,
    payTransparencyLaw: Boolean(rule) || isEu,
    rule: rule ? { code: rule.code || jurisdiction, legal_ref: rule.legal_ref || null } : null,
    euPayTransparency: isEu,
    blocking,
    warnings,
    ok: blocking.length === 0,
  };
}

/**
 * Most specific pay rule for the opening: region row, then country row.
 */
async function loadPayRule(db, opening) {
  const jurisdiction = jurisdictionOf(opening);
  if (!jurisdiction) return null;
  const country = jurisdiction.split('-')[0];
  const { rows } = await db.query(
    `SELECT code, pay_range_required, benefits_required, close_date_required, pay_history_banned,
            gender_neutral_titles, internal_promotion_notice, min_employees, legal_ref, reviewed_at
       FROM career_pay_rules
      WHERE code = ANY($1::text[])
      ORDER BY length(code) DESC
      LIMIT 1`,
    [[jurisdiction, country]]
  );
  return rows[0] || null;
}

async function checkOpeningWithRules(db, opening) {
  const rule = await loadPayRule(db, opening);
  const result = checkOpening(opening, { rule });
  return { ...result, payRequiredReason: rule?.legal_ref || 'OxSteed rule: pay on every opening (Q12)' };
}

module.exports = {
  PAY_TRANSPARENCY,
  loadPayRule,
  checkOpeningWithRules,
  jurisdictionOf,
  scanText,
  checkOpening,
};
