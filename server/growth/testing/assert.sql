DO $$
DECLARE failed boolean := false;
BEGIN
 IF (SELECT value FROM platform_settings WHERE key='growth.activity_tracking_enabled')<>'false' THEN RAISE EXCEPTION 'Unsafe default'; END IF;
 IF (SELECT state FROM activity_tracking_rollout WHERE id=1)<>'draft' THEN RAISE EXCEPTION 'Unsafe rollout'; END IF;
 BEGIN UPDATE activity_tracking_rollout SET effective_at=NOW(),state='effective' WHERE id=1;
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Early activation accepted'; END IF;
END $$;
INSERT INTO users(id,role,country) VALUES('00000000-0000-4000-8000-000000000001','customer','US');
INSERT INTO tracking_consents(subject_key,purpose,granted,jurisdiction,source,consent_text_version)
 VALUES(repeat('a',64),'activity',TRUE,'US','settings','growth-v1');
DO $$
DECLARE failed boolean:=false;
BEGIN
 BEGIN UPDATE tracking_consents SET granted=FALSE;
 EXCEPTION WHEN raise_exception THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Consent history was mutable'; END IF;
END $$;
INSERT INTO offer_preferences(user_id) VALUES('00000000-0000-4000-8000-000000000001');
DO $$
DECLARE failed boolean:=false;
BEGIN
 IF EXISTS(SELECT 1 FROM offer_preferences WHERE offer_push OR offer_email) THEN RAISE EXCEPTION 'Marketing opt-in default'; END IF;
 BEGIN UPDATE offer_preferences SET offer_email=TRUE;
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Deferred email channel activated'; END IF;
END $$;
