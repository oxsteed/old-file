-- Arabic now ships as a first-class UI locale in the iOS and web clients.
-- Keep existing databases in sync with the original translation platform seed.
UPDATE languages
   SET enabled = TRUE,
       is_ui_locale = TRUE,
       is_runtime_locale = TRUE,
       display_name = 'Arabic',
       native_name = 'العربية',
       fallback_language_code = 'en',
       updated_at = CURRENT_TIMESTAMP
 WHERE code = 'ar';

INSERT INTO languages (
  code,
  display_name,
  native_name,
  enabled,
  is_ui_locale,
  is_runtime_locale,
  fallback_language_code
)
SELECT 'ar', 'Arabic', 'العربية', TRUE, TRUE, TRUE, 'en'
WHERE NOT EXISTS (
  SELECT 1 FROM languages WHERE code = 'ar'
);
