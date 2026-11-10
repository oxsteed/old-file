'use strict';

/**
 * CSV cell sanitization — the single helper every export uses (ADM-152,
 * security review F-15).
 *
 * Formula injection: a cell whose text begins with =, +, -, @ (or a tab /
 * carriage return / newline) is interpreted as a formula when the CSV is
 * opened in a spreadsheet. The trigger can also hide behind leading
 * whitespace, a BOM, zero-width characters or Unicode direction controls,
 * which spreadsheets skip before evaluating, and behind the full-width
 * forms of the trigger characters. Prefixing the original text with a single
 * quote forces text interpretation. NUL bytes are dropped. RFC 4180 quoting
 * (double inner quotes) is applied on top.
 */

const HIDDEN_LEAD = /^[\s\uFEFF\u200B-\u200F\u202A-\u202E\u2060-\u2069]+/u;
const FORMULA_TRIGGER = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u;
const CONTROL_LEAD = /^[\t\r\n]/;

function toText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Returns the formula-neutralized text (no CSV quoting). With
 * `{ allowNumeric: true }` a plain signed number (e.g. -42.10) is left as
 * is so numeric report columns stay numeric; it cannot carry a formula.
 */
function neutralizeCsvText(value, { allowNumeric = false } = {}) {
  const text = toText(value).replace(/\u0000/g, '');
  if (allowNumeric && PLAIN_NUMBER.test(text)) return text;
  const candidate = text.replace(HIDDEN_LEAD, '');
  if (FORMULA_TRIGGER.test(candidate) || CONTROL_LEAD.test(text)) return `'${text}`;
  return text;
}

/**
 * One CSV cell. Quotes only when needed (quote, comma, CR or LF) unless
 * `{ alwaysQuote: true }`.
 */
function csvCell(value, { alwaysQuote = false, allowNumeric = false } = {}) {
  const neutralized = neutralizeCsvText(value, { allowNumeric });
  if (alwaysQuote || /["\r\n,]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

/** Always-quoted cell, for exports that quote every field. */
function csvQuotedCell(value) {
  return csvCell(value, { alwaysQuote: true });
}

function csvRow(values, options) {
  return values.map((v) => csvCell(v, options)).join(',');
}

module.exports = { csvCell, csvQuotedCell, csvRow, neutralizeCsvText };
