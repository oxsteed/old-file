'use strict';

/**
 * Normalize a Postgres array column to a JS string array.
 *
 * node-pg parses arrays of built-in element types (text[], char(2)[]) into
 * real JS arrays, but arrays of custom enum types (e.g.
 * logistics_user_role[], freight_option[]) arrive as raw Postgres array
 * literals ('{}', '{individual_buyer}'). A literal '{}' is truthy and has
 * .length 2, so a naive `arr.length > 0` membership gate treats "no
 * restriction" as "everyone is blocked". Always normalize before testing
 * membership or emptiness.
 *
 * @param {*} value - JS array, Postgres array literal, null/undefined
 * @returns {string[]} the elements as strings (never null)
 */
function pgStringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (text.length < 2 || !text.startsWith('{') || !text.endsWith('}')) return [];
  const inner = text.slice(1, -1);
  if (!inner) return [];
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuotes) {
      if (ch === '"' && inner[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

module.exports = { pgStringArray };
