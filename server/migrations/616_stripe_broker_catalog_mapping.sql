-- Replace only the verified missing Broker price after approval of its
-- replacement at identical USD 39/month terms. Preserve custom mappings,
-- historical subscriptions and any differently priced plan.
UPDATE plans
SET stripe_price_id = 'price_1ULXZLGo54BMlgSyEbdvgz2f',
    stripe_product_id = 'prod_VMG57RImt3RZiM',
    updated_at = NOW()
WHERE slug = 'broker'
  AND amount_cents = 3900
  AND currency = 'usd'
  AND interval = 'month'
  AND stripe_price_id = 'price_1THs8GGo54BMlgSyGjMDOWo7';
