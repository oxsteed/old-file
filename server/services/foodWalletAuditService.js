'use strict';

function normalizeText(value, max) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeCurrency(value) {
  const raw = normalizeText(value, 3);
  return raw ? raw.toUpperCase() : null;
}

async function logFoodWalletOperatorAudit(client, entry) {
  if (!entry || !entry.restaurantId || !entry.actionType) return null;

  const { rows: [event] } = await client.query(
    `INSERT INTO food_customer_wallet_operator_audit_events
       (restaurant_id, business_id, wallet_account_id, customer_id, operator_user_id,
        action_type, amount_cents, currency_code, correlation_id, request_ip, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING *`,
    [
      entry.restaurantId,
      entry.businessId || null,
      entry.walletAccountId || null,
      entry.customerId || null,
      entry.operatorUserId || null,
      normalizeText(entry.actionType, 80),
      entry.amountCents ?? null,
      normalizeCurrency(entry.currencyCode),
      normalizeText(entry.correlationId, 120),
      entry.requestIp || null,
      JSON.stringify(entry.metadata || {}),
    ]
  );

  return event || null;
}

module.exports = { logFoodWalletOperatorAudit };
