-- Migration 157: Schema alignment for business team + Vortex tokens
-- Ensures columns referenced by businessMembersController and vortexController exist
-- on databases that applied an older 063 without created_by_id or lack users.profile_photo_url.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

ALTER TABLE business_invite_tokens
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Legacy rows: no per-requester tracking; treat as issued by the business owner.
UPDATE business_invite_tokens t
SET created_by_id = b.user_id
FROM businesses b
WHERE t.business_id = b.id
  AND t.created_by_id IS NULL;

COMMIT;
