CREATE TABLE offer_clicks (
 click_id UUID PRIMARY KEY, delivery_id BIGINT NOT NULL,
 offer_id BIGINT NOT NULL REFERENCES offers(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE affiliate_conversions (
 id BIGSERIAL PRIMARY KEY, partner_id INTEGER NOT NULL REFERENCES affiliate_partners(id),
 click_id UUID NOT NULL REFERENCES offer_clicks(click_id), order_ref_hash CHAR(64) NOT NULL,
 sale_minor BIGINT NOT NULL CHECK(sale_minor>=0), commission_minor BIGINT NOT NULL CHECK(commission_minor>=0),
 currency CHAR(3) NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','reversed','paid')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(partner_id,order_ref_hash)
);
CREATE TABLE growth_partner_receipts (
 partner_id INTEGER NOT NULL REFERENCES affiliate_partners(id),event_id TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(partner_id,event_id)
);
