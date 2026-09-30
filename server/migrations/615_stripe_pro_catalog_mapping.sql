-- Map existing OxSteed live prices verified in Stripe on 2026-09-30.
-- No prices, fees, subscriptions, or customer balances are changed.
-- Update only the known placeholders and their exact approved billing terms;
-- preserve any operator-configured mapping or different regional contract.
UPDATE plans
   SET stripe_price_id = 'price_1THyAiGo54BMlgSyPzPoIOk6',
       stripe_product_id = 'prod_UGVBSsIIQhKVg9', updated_at = NOW()
 WHERE slug = 'pro'
   AND amount_cents = 1499 AND LOWER(currency) = 'usd' AND interval = 'month'
   AND stripe_price_id = 'REPLACE_WITH_REAL_STRIPE_PRICE_ID_MONTHLY';

UPDATE plans
   SET stripe_price_id = 'price_1THyCDGo54BMlgSyzrRM6Swt',
       stripe_product_id = 'prod_UGVCD2A1DN8KHT', updated_at = NOW()
 WHERE slug = 'pro-yearly'
   AND amount_cents = 7999 AND LOWER(currency) = 'usd' AND interval = 'year'
   AND stripe_price_id = 'REPLACE_WITH_REAL_STRIPE_PRICE_ID_YEARLY';
