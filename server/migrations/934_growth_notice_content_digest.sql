-- Pin the reviewed twenty-language policy and notice text to the send plan.
ALTER TABLE policy_notice_campaigns ADD COLUMN content_digest CHAR(64);
