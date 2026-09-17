'use strict';

// OxSteed Credit card ecosystem.
//
// A "card" (virtual or physical) is never a second value store: it is an
// alternate, revocable credential that resolves back to the customer's
// existing oxsteed_credit_accounts row, the same way an existing restaurant
// QR session resolves to a restaurant wallet. All spend, refund, hold,
// settlement, currency, and rail-suspension logic already lives in
// oxsteedCreditService.js and is reused unchanged here.
//
// Two credential-backed flows sit on top of that shared ledger:
//   - redeemCardAtPartner: card -> existing purchaseWithCreditInTransaction.
//   - cashOutWithCard: card -> a new 'cash_out' ledger movement (mirror of a
//     'load'), gated by its own PIN, velocity, and single-transaction caps
//     because physical cash cannot be clawed back the way a refund can.
//
// Raw credentials and PINs are never persisted. Only a SHA-256 hash (plus a
// per-card random salt for PINs) is stored; the raw values are returned to
// the caller exactly once, at issuance/activation/PIN-set time.

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const creditService = require('./oxsteedCreditService');

const {
  CREDIT_CURRENCY,
  MAX_CARD_CASH_OUT_TRANSACTION_CENTS,
  MAX_DAILY_CUSTOMER_CASH_OUT_CENTS,
  MAX_DAILY_CUSTOMER_CASH_OUT_COUNT,
  MAX_CARD_PIN_ATTEMPTS,
  CARD_PIN_LOCKOUT_MINUTES,
  assertSupportedCreditCurrency,
  assertCreditRailEnabled,
  ensureAccount,
  findCustomerAccount,
  getExistingTransaction,
  loadAccountEntries,
  normalizeMetadata,
  normalizeString,
  parseAmountCents,
  postJournalTransaction,
  purchaseWithCreditInTransaction,
  formatTransaction,
} = creditService;

const ACTIVATION_CODE_TTL_MINUTES = 60 * 24 * 14; // 14 days to receive + activate a physical card
const VIRTUAL_CREDENTIAL_BYTES = 24; // -> 32-char base64url token
const PHYSICAL_ACTIVATION_CODE_LENGTH = 10; // human-typeable, printed on the card carrier

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateCredential() {
  return crypto.randomBytes(VIRTUAL_CREDENTIAL_BYTES).toString('base64url');
}

function generateActivationCode() {
  // Avoid visually ambiguous characters (0/O, 1/I/L) on a physically printed card.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(PHYSICAL_ACTIVATION_CODE_LENGTH);
  for (let i = 0; i < PHYSICAL_ACTIVATION_CODE_LENGTH; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function last4Of(rawCredential) {
  const normalized = String(rawCredential || '');
  return normalized.slice(-4).toUpperCase();
}

function requireCardOwner(actorUserId, customerId) {
  if (!normalizeString(actorUserId, 160) || String(actorUserId) !== String(customerId)) {
    throw new AppError('Only the card owner may perform this action', 403, 'credit_card_actor_required');
  }
}

function requireAdministrativeActor(actorUserId) {
  if (!normalizeString(actorUserId, 160)) {
    throw new AppError('An identified administrator is required', 400, 'credit_card_admin_actor_required');
  }
}

function formatCard(row, { includeIssuedCredential = null, includeActivationCode = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    accountId: String(row.account_id),
    cardType: row.card_type,
    status: row.status,
    fulfillmentStatus: row.fulfillment_status,
    hasCredential: Boolean(row.credential_hash),
    credentialLast4: row.credential_last4 || null,
    hasPin: Boolean(row.pin_hash),
    pinLocked: Boolean(row.pin_locked_until && new Date(row.pin_locked_until).getTime() > Date.now()),
    nickname: row.nickname || null,
    replacesCardId: row.replaces_card_id || null,
    issuedAt: row.issued_at || null,
    activatedAt: row.activated_at || null,
    frozenAt: row.frozen_at || null,
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    // Returned exactly once, only by the mutation that just minted them.
    ...(includeIssuedCredential ? { credential: includeIssuedCredential } : {}),
    ...(includeActivationCode ? { activationCode: includeActivationCode } : {}),
  };
}

function assertCardMutable(card) {
  if (!card) throw new AppError('Card not found', 404, 'credit_card_not_found');
  if (card.status === 'revoked' || card.status === 'expired') {
    throw new AppError('This card can no longer be changed', 409, 'credit_card_terminal_state');
  }
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

async function issueVirtualCard({ customerId, currencyCode = CREDIT_CURRENCY, nickname, idempotencyKey, actorUserId, correlationId, requestIp, metadata = {}, isAdmin = false, issuanceReason }) {
  if (isAdmin) requireAdministrativeActor(actorUserId);
  else requireCardOwner(actorUserId, customerId);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required to issue a card', 400, 'credit_idempotency_key_required');
  const currency = assertSupportedCreditCurrency(currencyCode);

  return withTransaction(pool, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_cards WHERE idempotency_key = $1 FOR UPDATE`,
      [normalizedIdempotencyKey]
    );
    if (existingRows[0]) {
      if (String(existingRows[0].customer_id) !== String(customerId)) {
        throw new AppError('Credit idempotency key was already used for a different customer', 409, 'credit_idempotency_conflict');
      }
      return { card: formatCard(existingRows[0]), replayed: true };
    }

    await assertCreditRailEnabled(client);
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: currency });
    if (account.status !== 'active') {
      throw new AppError('OxSteed Credit account is not active', 409, 'credit_account_inactive');
    }

    const rawCredential = generateCredential();
    const credentialHash = sha256Hex(rawCredential);

    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_cards
         (customer_id, account_id, card_type, status, fulfillment_status,
          credential_hash, credential_last4, nickname, idempotency_key, issued_by,
          activated_at, metadata)
       VALUES ($1, $2, 'virtual', 'active', 'not_applicable', $3, $4, $5, $6, $7, NOW(), $8::jsonb)
       RETURNING *`,
      [customerId, account.id, credentialHash, last4Of(rawCredential), normalizeString(nickname, 80), normalizedIdempotencyKey, actorUserId || null, JSON.stringify({ ...normalizeMetadata(metadata), ...(isAdmin ? { issuedByAdmin: true } : {}) })]
    );

    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, correlation_id, request_ip, after_state)
       VALUES ('credit.card.issued', $1, $2, 'credit_card', $3, $4, $5, $6, $7::jsonb)`,
      [actorUserId || null, customerId, String(rows[0].id), isAdmin ? normalizeString(issuanceReason, 500) : null, normalizeString(correlationId, 160), requestIp || null, JSON.stringify({ cardType: 'virtual', status: 'active', issuedByAdmin: isAdmin })]
    );

    return { card: formatCard(rows[0], { includeIssuedCredential: rawCredential }), replayed: false };
  }, 'credit_card_issue_virtual');
}

// Admin counterpart to issueVirtualCard: an operator (support, fraud recovery,
// a proactive card program, etc.) issues a virtual card directly to a
// customer who has not requested one themselves. Reuses the exact same
// issuance path so limits, currency checks, and idempotency semantics never
// diverge between the two entry points.
function adminIssueVirtualCard({ customerId, currencyCode, nickname, idempotencyKey, actorUserId, correlationId, requestIp, metadata = {}, reason }) {
  return issueVirtualCard({ customerId, currencyCode, nickname, idempotencyKey, actorUserId, correlationId, requestIp, metadata, isAdmin: true, issuanceReason: reason });
}

async function requestPhysicalCard({ customerId, currencyCode = CREDIT_CURRENCY, nickname, shippingAddress, idempotencyKey, actorUserId, correlationId, requestIp, metadata = {}, isAdmin = false, issuanceReason }) {
  if (isAdmin) requireAdministrativeActor(actorUserId);
  else requireCardOwner(actorUserId, customerId);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required to request a card', 400, 'credit_idempotency_key_required');
  const currency = assertSupportedCreditCurrency(currencyCode);
  if (!shippingAddress || typeof shippingAddress !== 'object' || Array.isArray(shippingAddress)) {
    throw new AppError('A shipping address is required for a physical card', 400, 'credit_card_shipping_address_required');
  }

  return withTransaction(pool, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_cards WHERE idempotency_key = $1 FOR UPDATE`,
      [normalizedIdempotencyKey]
    );
    if (existingRows[0]) {
      if (String(existingRows[0].customer_id) !== String(customerId)) {
        throw new AppError('Credit idempotency key was already used for a different customer', 409, 'credit_idempotency_conflict');
      }
      return { card: formatCard(existingRows[0]), replayed: true };
    }

    await assertCreditRailEnabled(client);
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: currency });
    if (account.status !== 'active') {
      throw new AppError('OxSteed Credit account is not active', 409, 'credit_account_inactive');
    }

    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_cards
         (customer_id, account_id, card_type, status, fulfillment_status,
          nickname, shipping_address, idempotency_key, issued_by, metadata)
       VALUES ($1, $2, 'physical', 'pending', 'pending', $3, $4::jsonb, $5, $6, $7::jsonb)
       RETURNING *`,
      [customerId, account.id, normalizeString(nickname, 80), JSON.stringify(shippingAddress), normalizedIdempotencyKey, actorUserId || null, JSON.stringify({ ...normalizeMetadata(metadata), ...(isAdmin ? { issuedByAdmin: true } : {}) })]
    );

    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, correlation_id, request_ip, after_state)
       VALUES ('credit.card.requested', $1, $2, 'credit_card', $3, $4, $5, $6, $7::jsonb)`,
      [actorUserId || null, customerId, String(rows[0].id), isAdmin ? normalizeString(issuanceReason, 500) : null, normalizeString(correlationId, 160), requestIp || null, JSON.stringify({ cardType: 'physical', status: 'pending', issuedByAdmin: isAdmin })]
    );

    return { card: formatCard(rows[0]), replayed: false };
  }, 'credit_card_request_physical');
}

// Admin counterpart to requestPhysicalCard: an operator originates a physical
// card on a customer's behalf (e.g. a support-driven replacement, or a
// proactive card program) instead of waiting for the customer to apply.
function adminIssuePhysicalCard({ customerId, currencyCode, nickname, shippingAddress, idempotencyKey, actorUserId, correlationId, requestIp, metadata = {}, reason }) {
  return requestPhysicalCard({ customerId, currencyCode, nickname, shippingAddress, idempotencyKey, actorUserId, correlationId, requestIp, metadata, isAdmin: true, issuanceReason: reason });
}

// Admin/fulfillment-pipeline transition for a physical card: pending -> printed
// -> shipped -> delivered. The activation code is minted once, at the moment
// the card is marked 'printed' (i.e. it is about to be embedded on the
// physical card stock), and is never persisted in raw form.
async function markCardFulfillment({ cardId, fulfillmentStatus, actorUserId, reason, correlationId, requestIp }) {
  requireAdministrativeActor(actorUserId);
  const nextStatus = normalizeString(fulfillmentStatus, 20);
  const order = ['pending', 'printed', 'shipped', 'delivered'];
  if (!order.includes(nextStatus)) {
    throw new AppError('Invalid fulfillment status', 400, 'credit_card_fulfillment_status_invalid');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE id = $1 FOR UPDATE`, [cardId]);
    const card = rows[0];
    assertCardMutable(card);
    if (card.card_type !== 'physical') {
      throw new AppError('Only physical cards have a fulfillment lifecycle', 409, 'credit_card_not_physical');
    }
    if (order.indexOf(nextStatus) < order.indexOf(card.fulfillment_status)) {
      throw new AppError('Fulfillment status cannot move backward', 409, 'credit_card_fulfillment_regression');
    }

    let rawActivationCode = null;
    const setClauses = ['fulfillment_status = $2'];
    const values = [cardId, nextStatus];
    if (nextStatus === 'printed' && !card.activation_code_hash) {
      rawActivationCode = generateActivationCode();
      setClauses.push(`activation_code_hash = $${values.length + 1}`);
      values.push(sha256Hex(rawActivationCode));
      setClauses.push(`activation_code_expires_at = NOW() + INTERVAL '${ACTIVATION_CODE_TTL_MINUTES} minutes'`);
      setClauses.push(`credential_last4 = $${values.length + 1}`);
      values.push(rawActivationCode.slice(-4));
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_cards SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, correlation_id, request_ip, before_state, after_state)
       VALUES ('credit.card.fulfillment_updated', $1, $2, 'credit_card', $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [actorUserId, card.customer_id, String(cardId), normalizeString(reason, 500), normalizeString(correlationId, 160), requestIp || null,
        JSON.stringify({ fulfillmentStatus: card.fulfillment_status }), JSON.stringify({ fulfillmentStatus: nextStatus })]
    );

    return { card: formatCard(updatedRows[0], { includeActivationCode: rawActivationCode }) };
  }, 'credit_card_fulfillment_update');
}

async function activatePhysicalCard({ cardId, customerId, activationCode, actorUserId, correlationId, requestIp }) {
  requireCardOwner(actorUserId, customerId);
  const normalizedCode = normalizeString(activationCode, 40)?.toUpperCase();
  if (!normalizedCode) throw new AppError('An activation code is required', 400, 'credit_card_activation_code_required');

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [cardId, customerId]);
    const card = rows[0];
    if (!card) throw new AppError('Card not found', 404, 'credit_card_not_found');
    if (card.card_type !== 'physical') throw new AppError('Only physical cards require activation', 409, 'credit_card_not_physical');
    if (card.status === 'active') return { card: formatCard(card), replayed: true };
    if (card.status !== 'pending') throw new AppError('This card can no longer be activated', 409, 'credit_card_terminal_state');
    if (!card.activation_code_hash) throw new AppError('This card has not been printed yet', 409, 'credit_card_not_printed');
    if (card.activation_code_expires_at && new Date(card.activation_code_expires_at).getTime() < Date.now()) {
      throw new AppError('The activation code has expired; request a replacement card', 410, 'credit_card_activation_expired');
    }
    if (sha256Hex(normalizedCode) !== card.activation_code_hash) {
      throw new AppError('Invalid activation code', 401, 'credit_card_activation_code_invalid');
    }

    // Mint the real spend credential only at activation, once the customer has
    // physically received the card and proven it via the printed code.
    const rawCredential = generateCredential();
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_cards
          SET status = 'active', fulfillment_status = 'delivered', activated_at = NOW(),
              credential_hash = $2, credential_last4 = $3
        WHERE id = $1
        RETURNING *`,
      [cardId, sha256Hex(rawCredential), last4Of(rawCredential)]
    );

    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, correlation_id, request_ip, after_state)
       VALUES ('credit.card.activated', $1, $2, 'credit_card', $3, $4, $5, $6::jsonb)`,
      [actorUserId, customerId, String(cardId), normalizeString(correlationId, 160), requestIp || null, JSON.stringify({ status: 'active' })]
    );

    return { card: formatCard(updatedRows[0], { includeIssuedCredential: rawCredential }), replayed: false };
  }, 'credit_card_activate');
}

// ---------------------------------------------------------------------------
// Lifecycle: freeze / unfreeze / report lost / reissue / revoke
// ---------------------------------------------------------------------------

async function transitionCardStatus({ cardId, customerId, actorUserId, targetStatus, allowedFrom, reason, correlationId, requestIp, isAdmin = false }) {
  if (isAdmin) requireAdministrativeActor(actorUserId);
  else requireCardOwner(actorUserId, customerId);

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_cards WHERE id = $1 ${isAdmin ? '' : 'AND customer_id = $2'} FOR UPDATE`,
      isAdmin ? [cardId] : [cardId, customerId]
    );
    const card = rows[0];
    if (!card) throw new AppError('Card not found', 404, 'credit_card_not_found');
    if (card.status === targetStatus) return { card: formatCard(card), replayed: true };
    if (!allowedFrom.includes(card.status)) {
      throw new AppError(`Card cannot move from ${card.status} to ${targetStatus}`, 409, 'credit_card_transition_invalid');
    }

    const timestampColumn = { frozen: 'frozen_at', revoked: 'revoked_at' }[targetStatus];
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_cards
          SET status = $2${timestampColumn ? `, ${timestampColumn} = NOW()` : ''}
        WHERE id = $1
        RETURNING *`,
      [cardId, targetStatus]
    );

    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, correlation_id, request_ip, before_state, after_state)
       VALUES ($1, $2, $3, 'credit_card', $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [`credit.card.${targetStatus}`, actorUserId || null, card.customer_id, String(cardId), normalizeString(reason, 500), normalizeString(correlationId, 160), requestIp || null,
        JSON.stringify({ status: card.status }), JSON.stringify({ status: targetStatus })]
    );

    return { card: formatCard(updatedRows[0]), replayed: false };
  }, `credit_card_transition_${targetStatus}`);
}

function freezeCard(args) {
  return transitionCardStatus({ ...args, targetStatus: 'frozen', allowedFrom: ['active'] });
}

function unfreezeCard(args) {
  return transitionCardStatus({ ...args, targetStatus: 'active', allowedFrom: ['frozen'] });
}

function revokeCard(args) {
  return transitionCardStatus({ ...args, targetStatus: 'revoked', allowedFrom: ['pending', 'active', 'frozen', 'lost', 'stolen'], isAdmin: true });
}

// Reporting a card lost/stolen retires it permanently and, for a card the
// customer still wants access through, immediately issues a fresh virtual
// replacement so the customer is never left without a working credential
// while a physical replacement ships.
async function reportCardLostOrStolen({ cardId, customerId, status = 'lost', actorUserId, reason, correlationId, requestIp, issueReplacement = true }) {
  requireCardOwner(actorUserId, customerId);
  if (!['lost', 'stolen'].includes(status)) {
    throw new AppError('Status must be lost or stolen', 400, 'credit_card_report_status_invalid');
  }

  const { card: retiredCard } = await transitionCardStatus({
    cardId, customerId, actorUserId, targetStatus: status, allowedFrom: ['pending', 'active', 'frozen'], reason, correlationId, requestIp,
  });

  if (!issueReplacement) return { retiredCard, replacementCard: null };

  const account = await getCardAccount(retiredCard.id, customerId);
  const replacement = await issueVirtualCard({
    customerId,
    currencyCode: account.currencyCode,
    nickname: retiredCard.nickname ? `${retiredCard.nickname} (replacement)` : 'Replacement card',
    idempotencyKey: `card-reissue:${retiredCard.id}`,
    actorUserId,
    correlationId,
    requestIp,
    metadata: { replacesCardId: retiredCard.id },
  });
  await pool.query(`UPDATE oxsteed_credit_cards SET replaces_card_id = $1 WHERE id = $2`, [retiredCard.id, replacement.card.id]);

  return { retiredCard, replacementCard: { ...replacement.card, replacesCardId: retiredCard.id } };
}

async function getCardAccount(cardId, customerId) {
  const { rows } = await pool.query(
    `SELECT a.currency_code
       FROM oxsteed_credit_cards c
       JOIN oxsteed_credit_accounts a ON a.id = c.account_id
      WHERE c.id = $1 AND c.customer_id = $2`,
    [cardId, customerId]
  );
  if (!rows[0]) throw new AppError('Card not found', 404, 'credit_card_not_found');
  return { currencyCode: rows[0].currency_code };
}

// ---------------------------------------------------------------------------
// PIN management (required before a card can be used for kiosk cash-out)
// ---------------------------------------------------------------------------

async function setCardPin({ cardId, customerId, pin, actorUserId, correlationId, requestIp }) {
  requireCardOwner(actorUserId, customerId);
  const normalizedPin = normalizeString(pin, 12);
  if (!normalizedPin || !/^\d{4,8}$/.test(normalizedPin)) {
    throw new AppError('PIN must be 4-8 digits', 400, 'credit_card_pin_invalid');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [cardId, customerId]);
    const card = rows[0];
    assertCardMutable(card);
    if (card.status !== 'active') throw new AppError('Only an active card can have a PIN set', 409, 'credit_card_not_active');

    const salt = crypto.randomBytes(16).toString('hex');
    const pinHash = sha256Hex(`${salt}:${normalizedPin}`);
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_cards
          SET pin_hash = $2, pin_salt = $3, failed_pin_attempts = 0, pin_locked_until = NULL
        WHERE id = $1
        RETURNING *`,
      [cardId, pinHash, salt]
    );

    await client.query(
      `INSERT INTO oxsteed_credit_audit_events (action_type, actor_user_id, customer_id, resource_type, resource_id, correlation_id, request_ip)
       VALUES ('credit.card.pin_set', $1, $2, 'credit_card', $3, $4, $5)`,
      [actorUserId, customerId, String(cardId), normalizeString(correlationId, 160), requestIp || null]
    );

    return { card: formatCard(updatedRows[0]) };
  }, 'credit_card_set_pin');
}

async function verifyCardPin(client, card, pin) {
  if (!card.pin_hash || !card.pin_salt) {
    throw new AppError('This card has no PIN configured; set a PIN before cashing out', 409, 'credit_card_pin_not_set');
  }
  if (card.pin_locked_until && new Date(card.pin_locked_until).getTime() > Date.now()) {
    throw new AppError('This card is temporarily locked after too many incorrect PIN attempts', 423, 'credit_card_pin_locked');
  }
  const normalizedPin = normalizeString(pin, 12);
  const providedHash = normalizedPin ? sha256Hex(`${card.pin_salt}:${normalizedPin}`) : null;
  if (providedHash && providedHash === card.pin_hash) {
    if (card.failed_pin_attempts > 0) {
      await client.query(`UPDATE oxsteed_credit_cards SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = $1`, [card.id]);
    }
    return;
  }
  const attempts = Number(card.failed_pin_attempts || 0) + 1;
  const locked = attempts >= MAX_CARD_PIN_ATTEMPTS;
  await client.query(
    `UPDATE oxsteed_credit_cards
        SET failed_pin_attempts = $2,
            pin_locked_until = CASE WHEN $3 THEN NOW() + INTERVAL '${CARD_PIN_LOCKOUT_MINUTES} minutes' ELSE pin_locked_until END
      WHERE id = $1`,
    [card.id, attempts, locked]
  );
  throw new AppError(
    locked ? 'Too many incorrect PIN attempts; this card is now temporarily locked' : 'Incorrect PIN',
    locked ? 423 : 401,
    locked ? 'credit_card_pin_locked' : 'credit_card_pin_incorrect',
    { attemptsRemaining: String(Math.max(0, MAX_CARD_PIN_ATTEMPTS - attempts)) }
  );
}

// ---------------------------------------------------------------------------
// Credential resolution (shared by redemption and cash-out)
// ---------------------------------------------------------------------------

async function resolveCardByCredential(client, rawCredential) {
  const normalized = normalizeString(rawCredential, 200);
  if (!normalized) throw new AppError('A card credential is required', 400, 'credit_card_credential_required');
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_cards WHERE credential_hash = $1 FOR UPDATE`,
    [sha256Hex(normalized)]
  );
  const card = rows[0];
  if (!card) throw new AppError('Card not recognized', 404, 'credit_card_not_found');
  if (card.status === 'frozen') throw new AppError('This card is frozen', 409, 'credit_card_frozen');
  if (card.status !== 'active') throw new AppError('This card is not active', 409, 'credit_card_inactive');
  if (card.expires_at && new Date(card.expires_at).getTime() < Date.now()) {
    throw new AppError('This card has expired', 410, 'credit_card_expired');
  }
  return card;
}

async function listCustomerCards(customerId) {
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_cards WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId]
  );
  return rows.map((row) => formatCard(row));
}

async function adminListCards({ customerId, status, cardType, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const values = [];
  if (customerId) { values.push(customerId); conditions.push(`customer_id = $${values.length}`); }
  if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
  if (cardType) { values.push(cardType); conditions.push(`card_type = $${values.length}`); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  values.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_cards ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows.map((row) => formatCard(row));
}

// ---------------------------------------------------------------------------
// Redemption at a partner restaurant (spend) -- delegates entirely to the
// existing, fully-verified purchase pipeline; the card is only how the
// customer is identified.
// ---------------------------------------------------------------------------

async function redeemCardAtPartner({ credential, partnerId, amountCents, currencyCode = null, idempotencyKey, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, referenceType = 'credit_kiosk_redemption', referenceId, correlationId, requestIp, description, actorType = 'kiosk', metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required to redeem a card', 400, 'credit_idempotency_key_required');

  return withTransaction(pool, async (client) => {
    const card = await resolveCardByCredential(client, credential);
    const result = await purchaseWithCreditInTransaction(client, {
      customerId: card.customer_id,
      partnerId,
      amountCents: amount,
      currencyCode,
      idempotencyKey: normalizedIdempotencyKey,
      actorUserId: null,
      actorType,
      orderType,
      category,
      categories,
      menuItemId,
      menuItemIds,
      city,
      state,
      postalCode,
      country,
      referenceType,
      referenceId,
      correlationId,
      requestIp,
      description,
      metadata: { ...normalizeMetadata(metadata), cardId: card.id, redemptionMethod: 'card', cardLast4: card.credential_last4 },
    });
    await client.query(`UPDATE oxsteed_credit_cards SET last_used_at = NOW() WHERE id = $1`, [card.id]);
    return { ...result, card: formatCard({ ...card, last_used_at: new Date() }) };
  }, 'credit_card_redeem_at_partner');
}

// ---------------------------------------------------------------------------
// Kiosk cash-out -- the private, closed-loop "ATM" flow. Debits the
// customer's wallet and credits platform_treasury, the exact mirror of a
// 'load'. Requires an active card, a correct PIN, and passes its own
// deliberately tighter velocity caps before postJournalTransaction runs the
// same account-locking, currency, and balance-limit checks as every other
// ledger movement.
// ---------------------------------------------------------------------------

async function assertCustomerCashOutCapacity(client, { customerId, amountCents, currencyCode }) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  if (amountCents > MAX_CARD_CASH_OUT_TRANSACTION_CENTS) {
    throw new AppError('Cash-out transaction limit exceeded', 409, 'credit_cash_out_transaction_limit', {
      requestedCents: String(amountCents),
      maxTransactionCents: String(MAX_CARD_CASH_OUT_TRANSACTION_CENTS),
    });
  }
  const { rows } = await client.query(
    `WITH lock AS (
       SELECT pg_advisory_xact_lock(hashtext($3)) AS acquired
     )
     SELECT COUNT(*)::int AS cash_out_count, COALESCE(SUM(t.amount_cents), 0) AS cash_out_cents
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
       CROSS JOIN lock
      WHERE t.status = 'posted'
        AND t.transaction_type = 'cash_out'
        AND t.created_at >= CURRENT_DATE
        AND t.currency_code = $1
        AND debit_account.account_type = 'customer_wallet'
        AND debit_account.customer_id = $2`,
    [currency, customerId, `oxsteed-credit-cash-out-limit:${customerId}:${currency}`]
  );
  const cashOutCount = Number(rows[0]?.cash_out_count || 0);
  const cashOutCents = Number(rows[0]?.cash_out_cents || 0);
  if (cashOutCount >= MAX_DAILY_CUSTOMER_CASH_OUT_COUNT || cashOutCents + amountCents > MAX_DAILY_CUSTOMER_CASH_OUT_CENTS) {
    throw new AppError('Daily OxSteed Credit cash-out limit reached for this customer', 409, 'credit_daily_cash_out_limit', {
      cashOutsToday: String(cashOutCount),
      cashedOutTodayCents: String(cashOutCents),
      requestedCents: String(amountCents),
      maxDailyCashOutCount: String(MAX_DAILY_CUSTOMER_CASH_OUT_COUNT),
      maxDailyCashOutCents: String(MAX_DAILY_CUSTOMER_CASH_OUT_CENTS),
    });
  }
}

async function cashOutWithCard({ credential, pin, kioskDeviceId, partnerId = null, amountCents, currencyCode = null, idempotencyKey, correlationId, requestIp, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required to cash out', 400, 'credit_idempotency_key_required');
  if (!kioskDeviceId) throw new AppError('A kiosk device is required to cash out', 400, 'credit_cash_out_kiosk_required');

  return withTransaction(pool, async (client) => {
    const existing = await getExistingTransaction(client, normalizedIdempotencyKey);
    if (existing) {
      if (existing.transaction_type !== 'cash_out') {
        throw new AppError('Credit idempotency key was already used for a different transaction', 409, 'credit_idempotency_conflict');
      }
      return { transaction: { ...formatTransaction(existing, await loadAccountEntries(client, existing.id)), replayed: true }, replayed: true };
    }

    const card = await resolveCardByCredential(client, credential);
    await verifyCardPin(client, card, pin);
    await assertCreditRailEnabled(client);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit-cashout:${card.customer_id}`]);

    const customerAccount = await findCustomerAccount(client, card.customer_id, currencyCode || CREDIT_CURRENCY, true);
    if (!customerAccount) throw new AppError('OxSteed Credit account not found', 404, 'credit_customer_not_found');
    const currency = assertSupportedCreditCurrency(currencyCode || customerAccount.currency_code);

    await assertCustomerCashOutCapacity(client, { customerId: card.customer_id, amountCents: amount, currencyCode: currency });
    const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });

    const result = await postJournalTransaction(client, {
      transactionType: 'cash_out',
      debitAccountId: customerAccount.id,
      creditAccountId: treasuryAccount.id,
      amountCents: amount,
      currencyCode: currency,
      idempotencyKey: normalizedIdempotencyKey,
      actorType: 'kiosk',
      referenceType: 'credit_kiosk_cash_out',
      referenceId: String(kioskDeviceId),
      correlationId,
      requestIp,
      description: 'OxSteed Credit kiosk cash-out',
      customerId: card.customer_id,
      partnerId: null,
      metadata: { ...normalizeMetadata(metadata), cardId: card.id, kioskDeviceId: String(kioskDeviceId), partnerId: partnerId ? String(partnerId) : null, cardLast4: card.credential_last4 },
      existingTransaction: null,
    });

    await client.query(`UPDATE oxsteed_credit_cards SET last_used_at = NOW() WHERE id = $1`, [card.id]);
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, customer_id, resource_type, resource_id, correlation_id, request_ip, after_state)
       VALUES ('credit.card.cash_out_completed', $1, 'credit_card', $2, $3, $4, $5::jsonb)`,
      [card.customer_id, String(card.id), normalizeString(correlationId, 160), requestIp || null, JSON.stringify({ amountCents: amount, currencyCode: currency, kioskDeviceId: String(kioskDeviceId) })]
    );

    return { ...result, card: formatCard({ ...card, last_used_at: new Date() }) };
  }, 'credit_card_cash_out');
}

module.exports = {
  MAX_CARD_CASH_OUT_TRANSACTION_CENTS,
  MAX_DAILY_CUSTOMER_CASH_OUT_CENTS,
  MAX_DAILY_CUSTOMER_CASH_OUT_COUNT,
  formatCard,
  issueVirtualCard,
  requestPhysicalCard,
  adminIssueVirtualCard,
  adminIssuePhysicalCard,
  markCardFulfillment,
  activatePhysicalCard,
  freezeCard,
  unfreezeCard,
  revokeCard,
  reportCardLostOrStolen,
  setCardPin,
  listCustomerCards,
  adminListCards,
  redeemCardAtPartner,
  cashOutWithCard,
  // Exported for tests / reuse.
  sha256Hex,
  generateCredential,
  generateActivationCode,
};
