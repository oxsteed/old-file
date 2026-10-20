-- Growth is additive and disabled until a reviewed policy rollout completes.
CREATE TABLE tracking_consents (
  id BIGSERIAL PRIMARY KEY,
  subject_key CHAR(64) NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('activity','activity_offers','offer_push','offer_email','sale_share_optout')),
  granted BOOLEAN NOT NULL,
  jurisdiction TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('banner','settings','signup','gpc','do_not_sell_page','unsubscribe_link')),
  consent_text_version TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON tracking_consents(subject_key, purpose, id DESC);
CREATE TABLE tracking_consent_current (
  subject_key CHAR(64) NOT NULL,
  purpose TEXT NOT NULL,
  consent_id BIGINT NOT NULL REFERENCES tracking_consents(id),
  granted BOOLEAN NOT NULL,
  PRIMARY KEY(subject_key, purpose)
);
CREATE FUNCTION growth_consent_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tracking_consents is append only'; END $$;
CREATE TRIGGER growth_consent_append_only BEFORE UPDATE OR DELETE ON tracking_consents
FOR EACH ROW EXECUTE FUNCTION growth_consent_append_only();
CREATE TABLE jurisdiction_rules (
  code TEXT PRIMARY KEY,
  activity_basis TEXT NOT NULL CHECK (activity_basis IN ('notice','consent')),
  offers_basis TEXT NOT NULL CHECK (offers_basis IN ('notice','consent')),
  sale_share_control BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Unknown is deliberately strict. These are conservative defaults, not legal approval.
INSERT INTO jurisdiction_rules(code,activity_basis,offers_basis,sale_share_control)
VALUES ('unknown','consent','consent',TRUE), ('default','notice','notice',FALSE),
 ('US','notice','notice',TRUE), ('US-CA','notice','notice',TRUE),
 ('CA','consent','consent',FALSE), ('CA-QC','consent','consent',FALSE),
 ('CH','consent','consent',FALSE);
INSERT INTO jurisdiction_rules(code,activity_basis,offers_basis)
SELECT code,'consent','consent' FROM unnest(ARRAY[
 'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV',
 'LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB'
]) code;
-- No age field exists in this checkout. Do not guess adult status from account activity.
CREATE TABLE growth_subject_eligibility (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  adult_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_ref TEXT,
  reviewed_at TIMESTAMPTZ
  ,subject_key CHAR(64) UNIQUE
);
