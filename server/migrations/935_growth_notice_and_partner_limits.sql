-- Conservative limits remain subject to the reviewed partner agreement.
ALTER TABLE affiliate_partners ADD COLUMN cookie_window_days INTEGER NOT NULL DEFAULT 30 CHECK(cookie_window_days BETWEEN 1 AND 365);
CREATE TABLE policy_notice_daily_budget(day DATE PRIMARY KEY, attempts INTEGER NOT NULL CHECK(attempts>=0));
