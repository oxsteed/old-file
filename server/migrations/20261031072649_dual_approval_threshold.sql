-- Audit item 12 (2026-10-31): Emile confirmed the dual-approval threshold
-- at $500. Make it explicit in platform_settings so the runtime-tunable
-- value, not just the code fallback, carries the confirmed figure.
-- ON CONFLICT DO NOTHING preserves any value an admin deliberately set at
-- runtime; this only seeds the confirmed default where the key is absent.
INSERT INTO platform_settings(key,value,value_type,description) VALUES
 ('money_dual_approval_threshold_cents','50000','number','Dual-approval threshold in cents: money movements at or above this amount queue for a second admin (confirmed $500, 2026-10-31)')
ON CONFLICT(key) DO NOTHING;
