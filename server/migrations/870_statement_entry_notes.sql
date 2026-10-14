-- Additive, money-neutral: private per-user notes and receipt attachments on
-- statement entries. Owner-only access is enforced in the service layer
-- (every query filters on user_id); this table never stores money movement.
--
-- attachment_url stores the PRIVATE storage object key returned by POST
-- /upload (e.g. user-uploads/<userId>/.../statement-note/<name>), never a
-- signed URL: signed URLs expire, so the service resolves the key to a
-- short-lived signed URL at read time after re-checking ownership.
-- document_id is the archived statement document UUID; it is NULL for
-- interim (not yet issued) statements, whose entries are still note-worthy.
-- entry_id is the entry/transaction id inside the statement document.
CREATE TABLE IF NOT EXISTS statement_entry_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product VARCHAR(24) NOT NULL CHECK (product IN ('oxsteed','restaurant','restaurant_settlement','helper_earnings','business')),
  document_id TEXT,
  entry_id TEXT NOT NULL CHECK (char_length(entry_id) BETWEEN 1 AND 128),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2000),
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One private note per user per statement entry.
CREATE UNIQUE INDEX IF NOT EXISTS statement_entry_notes_owner_entry_uidx
  ON statement_entry_notes (user_id, product, entry_id, COALESCE(document_id, ''));
CREATE INDEX IF NOT EXISTS statement_entry_notes_owner_idx
  ON statement_entry_notes (user_id, product, COALESCE(document_id, ''), entry_id);
COMMENT ON TABLE statement_entry_notes IS
  'Private per-user notes and receipt attachments on statement entries. Owner-only; attachment_url holds a private storage key resolved to a signed URL at read time.';
