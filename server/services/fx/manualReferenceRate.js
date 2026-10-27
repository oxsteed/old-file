'use strict';

/**
 * Manual entry of an official reference rate (e.g. BRH taux de référence)
 * when the central bank page is unreachable. Two administrators: the maker
 * records the published figure and date, a different checker approves
 * (oversight action 'credit_fx_reference_rate_entry'; the DB CHECK
 * credit_fx_reference_manual_two_person enforces it as well).
 */

const { AppError } = require('../../middleware/errorHandler');
const { insertComplianceAudit } = require('../creditCompliance/audit');

function validate(payload) {
  const quoteCurrency = String(payload?.quoteCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(quoteCurrency) || quoteCurrency === 'USD') throw new AppError('quoteCurrency is required', 400, 'validation_failed');
  const units = String(payload?.unitsPerUsd || '').trim();
  if (!/^\d{1,8}(\.\d{1,8})?$/.test(units) || Number(units) <= 0) throw new AppError('unitsPerUsd must be a positive decimal', 400, 'validation_failed');
  const rateDate = String(payload?.rateDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) throw new AppError('rateDate is required', 400, 'validation_failed');
  const note = String(payload?.note || '').trim();
  if (note.length < 5) throw new AppError('Say where the figure was read (note)', 400, 'validation_failed');
  return { quoteCurrency, units, rateDate, note: note.slice(0, 1000) };
}

async function applyManualReferenceRate({ client, payload, requestedBy, actorUserId }) {
  const v = validate(payload);
  const { rows } = await client.query(
    `INSERT INTO credit_fx_reference_rates
       (source, base_currency, quote_currency, units_per_base, rate_date, entered_by, approved_by, note)
     VALUES ('manual', 'USD', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (source, base_currency, quote_currency, rate_date)
     DO UPDATE SET units_per_base = EXCLUDED.units_per_base, entered_by = EXCLUDED.entered_by,
                   approved_by = EXCLUDED.approved_by, note = EXCLUDED.note, fetched_at = NOW()
     RETURNING id`,
    [v.quoteCurrency, v.units, v.rateDate, requestedBy, actorUserId, v.note]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.fx.manual_reference_rate', actorUserId, resourceType: 'credit_fx_reference_rate', resourceId: String(rows[0].id),
    reason: v.note, afterState: { quoteCurrency: v.quoteCurrency, unitsPerUsd: v.units, rateDate: v.rateDate, enteredBy: requestedBy },
  });
  return { id: String(rows[0].id), ...v };
}

function registerOversightActions(register) {
  register('credit_fx_reference_rate_entry', applyManualReferenceRate);
}

module.exports = { validate, applyManualReferenceRate, registerOversightActions };
