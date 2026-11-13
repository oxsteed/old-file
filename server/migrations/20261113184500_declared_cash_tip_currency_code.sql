-- Domain 8 #10: declared cash tips record the currency they were
-- declared in, so they bucket in their own currency instead of always
-- the restaurant currency.
--
-- Before this, a confirmed cash tip declared at a EUR store under a
-- USD restaurant landed in the USD tip bucket, so a single-store EUR
-- pay run always failed finalization with
-- pay_run_finalize_multi_currency_tips and the period could never
-- finalize short of direct SQL: reviewCashTip only moves pending rows,
-- so a confirmed declaration could not be rejected or re-bucketed.
--
-- New rows record currency_code at entry (declareCashTip resolves the
-- declaration store's currency, falling back to the restaurant
-- currency when the declaration has no store). Existing rows are
-- backfilled from the same source: the declaration store's currency
-- when it has one, otherwise the restaurant currency at migration
-- time. That is the best available signal for old rows — the cash was
-- handled at that store — and it leaves no NULLs behind. The
-- bucketing code still treats a NULL currency_code as the restaurant
-- currency, so any row that escapes the backfill (or is written by
-- raw SQL without a currency) keeps the old behavior instead of
-- vanishing from pay.
ALTER TABLE restaurant_declared_cash_tips
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3);

UPDATE restaurant_declared_cash_tips d
   SET currency_code = COALESCE(
     (SELECT l.currency_code FROM restaurant_locations l
       WHERE l.id = d.location_id AND l.restaurant_id = d.restaurant_id),
     (SELECT fr.currency_code FROM food_restaurants fr WHERE fr.id = d.restaurant_id))
 WHERE d.currency_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_declared_cash_tips_currency
  ON restaurant_declared_cash_tips (restaurant_id, currency_code, business_date);
