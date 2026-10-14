'use strict';

/**
 * CSV cell sanitization (ADM-152).
 *
 * Formula injection: a cell whose text begins with =, +, -, @ (or a tab /
 * carriage return) is interpreted as a formula when the CSV is opened in a
 * spreadsheet. Prefixing with a single quote forces text interpretation.
 * Standard RFC 4180 quoting (double inner quotes, wrap when the cell holds a
 * quote, comma, or newline) is applied on top.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvCell(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  if (/["\n,]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

module.exports = { csvCell, csvRow };
