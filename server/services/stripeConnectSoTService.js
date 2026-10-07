'use strict';

/**
 * Stripe Connect source-of-truth helpers (business OAuth vs restaurant_connect_accounts,
 * helper Express connect_accounts vs legacy helper_profiles.stripe_*).
 *
 * See docs/stripe-connect-helper-business.md
 */

const pool = require('../db');

function normalizeAccountId(value) {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
}

async function loadBusinessStripeRow(client, businessId) {
  const { rows } = await client.query(
    `SELECT id,
            stripe_account_id,
            stripe_charges_enabled,
            stripe_payouts_enabled,
            stripe_account_status
       FROM businesses
      WHERE id = $1`,
    [businessId],
  );
  return rows[0] || null;
}

async function loadPrimaryRestaurantConnect(client, businessId) {
  const { rows } = await client.query(
    `SELECT rca.stripe_account_id,
            rca.charges_enabled,
            rca.payouts_enabled,
            rca.onboarding_complete,
            fr.id AS restaurant_id
       FROM food_restaurants fr
       JOIN restaurant_connect_accounts rca ON rca.restaurant_id = fr.id
      WHERE fr.business_id = $1
        AND rca.stripe_account_id IS NOT NULL
      ORDER BY rca.charges_enabled DESC, fr.id ASC
      LIMIT 1`,
    [businessId],
  );
  return rows[0] || null;
}

async function businessHasRestaurants(client, businessId) {
  const { rows } = await client.query(
    `SELECT 1 FROM food_restaurants WHERE business_id = $1 LIMIT 1`,
    [businessId],
  );
  return Boolean(rows[0]);
}

/**
 * Idempotent: copy businesses.stripe_* onto restaurant_connect_accounts rows that
 * are missing, using the same rules as migration 714 (no overwrite of a different
 * onboarded restaurant account).
 */
async function syncBusinessOAuthToRestaurantConnect(client, businessId) {
  const db = client || pool;
  const biz = await loadBusinessStripeRow(db, businessId);
  const accountId = normalizeAccountId(biz?.stripe_account_id);
  if (!biz || !accountId) {
    return { synced: 0, skipped: true, reason: 'no_business_stripe_account' };
  }

  const chargesEnabled = Boolean(biz.stripe_charges_enabled);
  const payoutsEnabled = Boolean(biz.stripe_payouts_enabled);
  const onboardingComplete = chargesEnabled || payoutsEnabled || biz.stripe_account_status === 'active';

  const { rowCount } = await db.query(
    `INSERT INTO restaurant_connect_accounts
       (restaurant_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
     SELECT fr.id,
            $2,
            $3,
            $4,
            $5
       FROM food_restaurants fr
       LEFT JOIN restaurant_connect_accounts rca ON rca.restaurant_id = fr.id
      WHERE fr.business_id = $1
        AND rca.restaurant_id IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM restaurant_connect_accounts r2
               WHERE r2.stripe_account_id = $2
            )
        AND NOT EXISTS (
              SELECT 1
                FROM food_restaurants fr2
                JOIN businesses b2 ON b2.id = fr2.business_id
               WHERE b2.stripe_account_id = $2
                 AND fr2.id < fr.id
            )
     ON CONFLICT DO NOTHING`,
    [businessId, accountId, chargesEnabled, payoutsEnabled, onboardingComplete],
  );

  await db.query(
    `UPDATE restaurant_connect_accounts rca
        SET charges_enabled = $3,
            payouts_enabled = $4,
            onboarding_complete = $5,
            updated_at = NOW()
       FROM food_restaurants fr
      WHERE fr.id = rca.restaurant_id
        AND fr.business_id = $1
        AND rca.stripe_account_id = $2`,
    [businessId, accountId, chargesEnabled, payoutsEnabled, onboardingComplete],
  );

  return { synced: rowCount || 0, accountId };
}

/**
 * Resolve Connect destination for business-issued invoices (not food checkout).
 * Prefers businesses.stripe_*; RCA is only used when the business row has no OAuth account.
 * Fails closed when both stores point at different Stripe account ids.
 */
async function resolveBusinessInvoiceConnect(client, businessId) {
  const db = client || pool;
  if (await businessHasRestaurants(db, businessId)) {
    await syncBusinessOAuthToRestaurantConnect(db, businessId);
  }

  const biz = await loadBusinessStripeRow(db, businessId);
  const rca = await loadPrimaryRestaurantConnect(db, businessId);
  const bizAccountId = normalizeAccountId(biz?.stripe_account_id);
  const rcaAccountId = normalizeAccountId(rca?.stripe_account_id);

  if (bizAccountId && rcaAccountId && bizAccountId !== rcaAccountId) {
    return {
      accountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      ready: false,
      reason: 'stripe_connect_accounts_mismatch',
      payeeKind: 'business',
      divergence: {
        businessAccountId: bizAccountId,
        restaurantConnectAccountId: rcaAccountId,
        restaurantId: rca.restaurant_id,
      },
    };
  }

  if (bizAccountId) {
    return {
      accountId: bizAccountId,
      chargesEnabled: Boolean(biz.stripe_charges_enabled),
      payoutsEnabled: Boolean(biz.stripe_payouts_enabled),
      accountStatus: biz.stripe_account_status,
      source: 'business_standard',
      payeeKind: 'business',
    };
  }

  if (rcaAccountId) {
    return {
      accountId: rcaAccountId,
      chargesEnabled: Boolean(rca.charges_enabled),
      payoutsEnabled: Boolean(rca.payouts_enabled),
      accountStatus: rca.charges_enabled ? 'active' : 'pending',
      source: 'restaurant_connect',
      payeeKind: 'business',
    };
  }

  return {
    accountId: null,
    chargesEnabled: false,
    payoutsEnabled: false,
    source: null,
    payeeKind: 'business',
    ready: false,
    reason: 'no_connect_account',
  };
}

async function syncHelperProfileStripeFromConnect(client, userId, {
  stripeAccountId,
  chargesEnabled,
  payoutsEnabled,
  onboardingComplete,
}) {
  if (!userId) return { updated: false };
  const db = client || pool;
  const accountId = normalizeAccountId(stripeAccountId);
  const { rowCount } = await db.query(
    `UPDATE helper_profiles
        SET stripe_account_id = $2,
            stripe_charges_enabled = $3,
            stripe_payouts_enabled = $4,
            stripe_onboarded_at = CASE
              WHEN $5 AND stripe_onboarded_at IS NULL THEN NOW()
              ELSE stripe_onboarded_at
            END,
            updated_at = NOW()
      WHERE user_id = $1`,
    [
      userId,
      accountId,
      Boolean(chargesEnabled),
      Boolean(payoutsEnabled),
      Boolean(onboardingComplete),
    ],
  );
  return { updated: (rowCount || 0) > 0 };
}

module.exports = {
  normalizeAccountId,
  loadBusinessStripeRow,
  loadPrimaryRestaurantConnect,
  syncBusinessOAuthToRestaurantConnect,
  resolveBusinessInvoiceConnect,
  syncHelperProfileStripeFromConnect,
};
