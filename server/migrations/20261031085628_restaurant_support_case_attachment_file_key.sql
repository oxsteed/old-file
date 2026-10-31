-- Support-URL re-mint on read (rec track 6): support-case attachments must
-- no longer serve the 7-day signed URL minted at upload time. The read path
-- now mints a fresh short-lived signed URL per read from a stored key, so a
-- leaked URL expires within minutes instead of a week.
--
-- New uploads store the key in file_key and the private:// key reference in
-- file_url (the convention the dispute-evidence and business-message
-- attachment tables already use). This backfill recovers keys for existing
-- rows whose stored URL is this codebase's own local signed-download format
-- (/api/storage/files/<key>?exp=...&sig=...), but only when the key segment
-- contains no percent-encoding: SQL cannot URL-decode, and a partially
-- decoded key would mint the wrong object. Rows left NULL are handled at
-- read time by the JS extractor (which decodes properly) or fail closed
-- with no link when no key can be recovered. Never guess a key here.

ALTER TABLE restaurant_support_case_attachments
  ADD COLUMN IF NOT EXISTS file_key TEXT;

UPDATE restaurant_support_case_attachments
   SET file_key = split_part(split_part(file_url, '/api/storage/files/', 2), '?', 1)
 WHERE file_key IS NULL
   AND file_url LIKE '%/api/storage/files/%'
   AND split_part(split_part(file_url, '/api/storage/files/', 2), '?', 1) <> ''
   AND split_part(split_part(file_url, '/api/storage/files/', 2), '?', 1) NOT LIKE '%\%%';
