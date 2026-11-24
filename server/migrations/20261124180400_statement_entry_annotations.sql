-- Group 14 Slice 5b (708, D-425): shared annotations on statement
-- differences (statement entries), so a bookkeeper can annotate a
-- difference for another authorized reader to see.
--
-- This extends the 688 annotation pattern (append-only, author recorded,
-- scope derived from the annotated record) to the statement domain. The
-- anchor is the same (product, document, entry) as the private per-user
-- notes, but these annotations are SHARED: any reader authorized for the
-- document sees them. The private statement_entry_notes are untouched and
-- are never read by the annotation endpoints.
--
-- Scope is derived from the annotated document at read and write time
-- (the statement-investigation router's loadDocument authorization), so
-- this table carries no restaurant_id/location_id/business_id columns and
-- needs no store-boundary audit registration. Additive only; safe to run
-- twice.
CREATE TABLE IF NOT EXISTS statement_entry_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product VARCHAR(32) NOT NULL CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business')),
  document_id UUID NOT NULL,
  entry_id TEXT NOT NULL CHECK (char_length(entry_id) >= 1 AND char_length(entry_id) <= 128),
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_statement_entry_annotations_entry
  ON statement_entry_annotations (product, document_id, entry_id, created_at DESC);
