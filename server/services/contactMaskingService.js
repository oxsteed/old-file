'use strict';

/**
 * Contact details in chat (decision #10): hidden before a hire, gentle
 * reminders after. Before the customer accepts a bid from this helper,
 * emails, links and messaging handles are masked in stored content (phone
 * numbers are already masked by utils/messageSanitizer). Once they have a
 * hired job together, nothing is masked; messages that share contact
 * details carry an 'off_platform_reminder' warning instead.
 * Behind FEATURE_CONTACT_MASKING; off = today's warn-only behaviour.
 */

const flags = require('./paymentLayerFlags');

const MASK = '•••';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const BARE_DOMAIN_RE = /\b(?:wa\.me|t\.me|m\.me|instagram\.com|facebook\.com|telegram\.me|signal\.me)\/[^\s<>"']*/gi;
const HANDLE_RE = /(^|[\s(])@[a-zA-Z0-9_.]{3,30}\b/g;
const PRE_HIRE_STATUSES = new Set(['draft', 'published', 'matched', 'negotiating']);
const HIRED_STATUSES = ['accepted', 'in_progress', 'completed', 'closed'];

function maskContactDetails(text) {
  if (!text) return text;
  return String(text)
    .replace(URL_RE, MASK)
    .replace(BARE_DOMAIN_RE, MASK)
    .replace(EMAIL_RE, MASK)
    .replace(HANDLE_RE, (_, lead) => `${lead}${MASK}`);
}

function hasContactDetails(text) {
  const value = String(text || '');
  return [EMAIL_RE, URL_RE, BARE_DOMAIN_RE, HANDLE_RE].some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(value));
}

/** { mask, remind } for a conversation row (customer_id, helper_id, job_id). */
async function evaluate(client, conv) {
  if (!flags.isEnabled('CONTACT_MASKING') || !conv?.customer_id || !conv?.helper_id) return { mask: false, remind: false };
  if (conv.job_id) {
    const { rows } = await client.query('SELECT status, assigned_helper_id FROM jobs WHERE id = $1', [conv.job_id]);
    const job = rows[0];
    if (job && !PRE_HIRE_STATUSES.has(String(job.status)) && String(job.assigned_helper_id) === String(conv.helper_id)) {
      return { mask: false, remind: true };
    }
    if (job) return { mask: true, remind: false };
  }
  const { rows } = await client.query(
    `SELECT 1 FROM jobs WHERE client_id = $1 AND assigned_helper_id = $2 AND status::text = ANY($3::text[]) LIMIT 1`,
    [conv.customer_id, conv.helper_id, HIRED_STATUSES]
  );
  return rows[0] ? { mask: false, remind: true } : { mask: true, remind: false };
}

module.exports = { MASK, maskContactDetails, hasContactDetails, evaluate };
