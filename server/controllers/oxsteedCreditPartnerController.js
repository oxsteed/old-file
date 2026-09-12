'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { listSettlements } = require('../services/oxsteedCreditAdminService');

const MANAGE_ROLES = new Set(['owner', 'manager']);

function formatPartnerSettlement(settlement) {
  return {
    id: settlement.id,
    partnerId: settlement.partnerId,
    agreementId: settlement.agreementId,
    currencyCode: settlement.currencyCode,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    grossCents: settlement.grossCents,
    refundCents: settlement.refundCents,
    feeCents: settlement.feeCents,
    netCents: settlement.netCents,
    status: settlement.status,
    paymentReference: settlement.paymentReference,
    paidAt: settlement.paidAt,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
  };
}

function parseRestaurantId(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return parsed;
}

async function requireRestaurantManager(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  if (!MANAGE_ROLES.has(restaurant.effective_role)) throw new AppError('Owner or manager access required', 403, 'forbidden');
  return restaurant;
}

async function getPartnerId(restaurantId) {
  const { rows } = await pool.query(`SELECT id, status FROM oxsteed_credit_partners WHERE restaurant_id = $1`, [restaurantId]);
  if (!rows[0]) throw new AppError('This restaurant is not enrolled as an OxSteed Credit partner', 404, 'credit_partner_not_found');
  return rows[0];
}

async function listPartnerSettlements(req, res, next) {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    await requireRestaurantManager(req.user.id, restaurantId);
    const partner = await getPartnerId(restaurantId);
    const settlementOptions = { partnerId: partner.id, status: req.query.status, limit: req.query.limit };
    if (req.query.offset !== undefined) settlementOptions.offset = req.query.offset;
    const settlements = await listSettlements(settlementOptions);
    res.json({
      partnerId: String(partner.id),
      partnerStatus: partner.status,
      settlements: settlements.map(formatPartnerSettlement),
    });
  } catch (error) {
    next(error);
  }
}

async function listPartnerTransactions(req, res, next) {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    await requireRestaurantManager(req.user.id, restaurantId);
    const partner = await getPartnerId(restaurantId);
    const limit = Math.max(1, Math.min(Number.parseInt(String(req.query.limit), 10) || 100, 250));
    const parsedOffset = Number.parseInt(String(req.query.offset), 10);
    const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
    const { rows } = await pool.query(
      `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
              t.agreement_id, t.reference_type, t.reference_id, t.description,
              t.posted_at, t.created_at
         FROM oxsteed_credit_transactions t
        WHERE t.partner_id = $1
          AND t.currency_code = 'USD'
          AND t.status = 'posted'
        ORDER BY COALESCE(t.posted_at, t.created_at) DESC, t.id DESC
        LIMIT $2 OFFSET $3`,
      [partner.id, limit + 1, offset]
    );
    const hasMore = rows.length > limit;
    res.json({
      partnerId: String(partner.id),
      partnerStatus: partner.status,
      transactions: rows.slice(0, limit).map((row) => ({
        id: String(row.id),
        transactionType: row.transaction_type,
        status: row.status,
        amountCents: Number(row.amount_cents || 0),
        currencyCode: row.currency_code,
        agreementId: row.agreement_id || null,
        referenceType: row.reference_type || null,
        referenceId: row.reference_id || null,
        description: row.description || null,
        postedAt: row.posted_at || null,
        createdAt: row.created_at || null,
      })),
      pagination: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listPartnerSettlements, listPartnerTransactions };
