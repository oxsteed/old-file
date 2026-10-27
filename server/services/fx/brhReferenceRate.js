'use strict';

/**
 * Banque de la République d'Haïti (BRH) reference-rate adapter
 * (licence readiness, review bug 7). No vendor, no API key: BRH publishes
 * the daily "TAUX DE REFERENCE" (gourdes per US dollar) on its public page
 * https://www.brh.ht/taux-du-jour/. This module fetches that page, parses
 * the reference rate and its publication date, and stores it in
 * credit_fx_reference_rates.
 *
 * Fail closed everywhere: a page that cannot be fetched, a layout change
 * that hides the number, a date that cannot be read, or a value outside
 * sanity bounds throws 502 fx_rate_unavailable. Quotes then refuse HTG
 * rather than guessing.
 */

const crypto = require('crypto');
const { AppError } = require('../../middleware/errorHandler');

const BRH_URL = process.env.BRH_REFERENCE_RATE_URL || 'https://www.brh.ht/taux-du-jour/';
const MIN_HTG_PER_USD = Number(process.env.BRH_MIN_HTG_PER_USD || '40');
const MAX_HTG_PER_USD = Number(process.env.BRH_MAX_HTG_PER_USD || '1000');
const FRENCH_MONTHS = Object.freeze({
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
});

function unavailable(message) {
  return new AppError(message, 502, 'fx_rate_unavailable', { source: 'brh' });
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the BRH page. Returns { unitsPerUsd: '130.6474', rateDate: 'YYYY-MM-DD' }.
 */
function parseBrhReferencePage(html) {
  const text = htmlToText(html);
  const rateMatch = text.match(/TAUX\s+DE\s+R[ÉE]F[ÉE]RENCE\s+([0-9]{2,4}(?:[.,][0-9]{1,6})?)/i);
  if (!rateMatch) throw unavailable('BRH page did not contain a reference rate');
  const unitsPerUsd = rateMatch[1].replace(',', '.');
  const value = Number(unitsPerUsd);
  if (!Number.isFinite(value) || value < MIN_HTG_PER_USD || value > MAX_HTG_PER_USD) {
    throw unavailable('BRH reference rate is outside sanity bounds');
  }
  const dateMatch = text.match(/Taux\s+du\s+Jour\s*:?\s*(\d{1,2})\s+([A-Za-zéûÉÛ]+)\s+(\d{4})/i);
  if (!dateMatch) throw unavailable('BRH page did not contain a publication date');
  const month = FRENCH_MONTHS[dateMatch[2].toLowerCase()];
  const day = Number(dateMatch[1]);
  const year = Number(dateMatch[3]);
  if (!month || day < 1 || day > 31 || year < 2000) throw unavailable('BRH publication date is unreadable');
  const rateDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsedDate = new Date(`${rateDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.getUTCDate() !== day) throw unavailable('BRH publication date is invalid');
  return { unitsPerUsd: value.toFixed(4), rateDate };
}

async function fetchBrhPage({ timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(BRH_URL, {
      signal: controller.signal,
      headers: {
        // BRH's web firewall rejects requests without a browser-like
        // Accept header.
        'User-Agent': 'Mozilla/5.0 (compatible; OxSteedRates/1.0; +https://oxsteed.com)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr,en;q=0.8',
      },
    });
    if (!res.ok) throw unavailable(`BRH returned HTTP ${res.status}`);
    return await res.text();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable(error && error.name === 'AbortError' ? 'BRH request timed out' : 'BRH is unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch, parse and store today's BRH rate. Returns the stored row. */
async function refreshBrhReferenceRate(db, options = {}) {
  const html = await fetchBrhPage(options);
  const parsed = parseBrhReferencePage(html);
  const evidence = crypto.createHash('sha256').update(html).digest('hex');
  const { rows } = await db.query(
    `INSERT INTO credit_fx_reference_rates
       (source, base_currency, quote_currency, units_per_base, rate_date, source_url, evidence_sha256)
     VALUES ('brh', 'USD', 'HTG', $1, $2, $3, $4)
     ON CONFLICT (source, base_currency, quote_currency, rate_date)
     DO UPDATE SET units_per_base = EXCLUDED.units_per_base, fetched_at = NOW(), evidence_sha256 = EXCLUDED.evidence_sha256
     RETURNING *`,
    [parsed.unitsPerUsd, parsed.rateDate, BRH_URL, evidence]
  );
  return rows[0];
}

module.exports = { BRH_URL, parseBrhReferencePage, fetchBrhPage, refreshBrhReferenceRate, htmlToText };
