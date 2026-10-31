-- Session-scoped CSRF: each login session gets a stable, random identifier
-- (csrf_sid) that survives access-token rotation, so CSRF tokens can be
-- bound per session instead of per user. The identifier is minted into the
-- access token at login and copied across refresh rotations; it is not a
-- credential (the CSRF token itself is the secret) and is nullable so
-- pre-existing rows keep working until their next refresh mints one.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS csrf_sid TEXT;
