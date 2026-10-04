-- Migration 670: Universal entity IDs + ownership graph.
--
-- Every entity (person, business, restaurant, helper profile) gets one opaque,
-- permanent, non-reusable public ID shaped like OX-P-7KQ4-92MD-3:
--   OX          brand prefix
--   P           type code (P person, B business, R restaurant, H helper profile)
--   8 chars     Crockford base32 (no 0/O, 1/I, L, U confusion), grouped 4-4
--   trailing    Luhn-mod-32 check character so typos fail loudly
--
-- IDs are random, never sequential: they leak no user counts and resist
-- enumeration. entity_ids is the single minter, so no two entity types can
-- ever collide.
--
-- entity_links is the ownership/control graph. It is APPEND-ONLY by
-- convention: ownership changes close the old row (valid_to = now()) and
-- insert a new row. Never UPDATE a closed row, never DELETE. This preserves
-- the full history of who owned/controlled what and when.
--
-- Additive only. All statements are idempotent (IF NOT EXISTS / NOT EXISTS
-- guards) so a retried run is safe.

CREATE TABLE IF NOT EXISTS entity_ids (
  public_id  TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_key  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at  TIMESTAMPTZ,
  CONSTRAINT uq_entity_ids_type_key UNIQUE (entity_type, entity_key)
);

CREATE TABLE IF NOT EXISTS entity_links (
  id          BIGSERIAL PRIMARY KEY,
  subject_id  TEXT NOT NULL REFERENCES entity_ids(public_id),
  object_id   TEXT NOT NULL REFERENCES entity_ids(public_id),
  relation    TEXT NOT NULL
    CHECK (relation IN ('owns', 'belongs_to', 'acts_as', 'manages', 'represents')),
  share       NUMERIC
    CHECK (share IS NULL OR (share >= 0 AND share <= 100)),
  granted_by  TEXT REFERENCES entity_ids(public_id),
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (subject_id <> object_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_links_object_current
  ON entity_links (object_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_links_subject_current
  ON entity_links (subject_id) WHERE valid_to IS NULL;

-- Luhn-mod-32 check character over exactly 8 Crockford base32 chars.
-- Mirrors server/lib/entityIds.js computeCheckChar; keep them in sync.
CREATE OR REPLACE FUNCTION entity_id_check_char(eight_chars TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  sum INT := 0;
  i INT;
  v INT;
  addend INT;
BEGIN
  IF eight_chars IS NULL OR length(eight_chars) <> 8 THEN
    RAISE EXCEPTION 'entity_id_check_char: expected 8 chars, got %', eight_chars;
  END IF;
  FOR i IN 1..8 LOOP
    -- i = 1 is the rightmost char; every second char from the right doubles.
    v := position(substr(eight_chars, 9 - i, 1) IN alphabet) - 1;
    IF v < 0 THEN
      RAISE EXCEPTION 'entity_id_check_char: invalid char in %', eight_chars;
    END IF;
    IF i % 2 = 1 THEN
      addend := v * 2;
    ELSE
      addend := v;
    END IF;
    sum := sum + (addend / 32) + (addend % 32);
  END LOOP;
  RETURN substr(alphabet, ((32 - (sum % 32)) % 32) + 1, 1);
END;
$$;

-- Mint one globally-unique public ID. Loops until no collision; with 32^8
-- possibilities a collision is a once-in-a-trillion event, the loop is the
-- correctness guarantee.
CREATE OR REPLACE FUNCTION mint_entity_id(type_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw BYTEA;
  chars TEXT;
  i INT;
  candidate TEXT;
BEGIN
  IF type_code IS NULL OR type_code NOT IN ('P', 'B', 'R', 'H') THEN
    RAISE EXCEPTION 'mint_entity_id: unknown type code %', type_code;
  END IF;
  LOOP
    raw := gen_random_bytes(8);
    chars := '';
    -- 256 = 8 * 32 exactly, so (byte % 32) is unbiased.
    FOR i IN 0..7 LOOP
      chars := chars || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
    END LOOP;
    candidate := 'OX-' || type_code || '-'
      || substr(chars, 1, 4) || '-' || substr(chars, 5, 4)
      || '-' || entity_id_check_char(chars);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM entity_ids WHERE public_id = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

-- ── Backfill: mint IDs for every existing row that lacks one ────────────────
DO $$
DECLARE
  r RECORD;
  pid TEXT;
BEGIN
  FOR r IN
    SELECT u.id::TEXT AS k FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_ids e
      WHERE e.entity_type = 'person' AND e.entity_key = u.id::TEXT)
  LOOP
    pid := mint_entity_id('P');
    INSERT INTO entity_ids (public_id, entity_type, entity_key)
    VALUES (pid, 'person', r.k);
  END LOOP;

  FOR r IN
    SELECT b.id::TEXT AS k FROM businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_ids e
      WHERE e.entity_type = 'business' AND e.entity_key = b.id::TEXT)
  LOOP
    pid := mint_entity_id('B');
    INSERT INTO entity_ids (public_id, entity_type, entity_key)
    VALUES (pid, 'business', r.k);
  END LOOP;

  FOR r IN
    SELECT fr.id::TEXT AS k FROM food_restaurants fr
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_ids e
      WHERE e.entity_type = 'restaurant' AND e.entity_key = fr.id::TEXT)
  LOOP
    pid := mint_entity_id('R');
    INSERT INTO entity_ids (public_id, entity_type, entity_key)
    VALUES (pid, 'restaurant', r.k);
  END LOOP;

  FOR r IN
    SELECT hp.id::TEXT AS k FROM helper_profiles hp
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_ids e
      WHERE e.entity_type = 'helper_profile' AND e.entity_key = hp.id::TEXT)
  LOOP
    pid := mint_entity_id('H');
    INSERT INTO entity_ids (public_id, entity_type, entity_key)
    VALUES (pid, 'helper_profile', r.k);
  END LOOP;
END;
$$;

-- ── Backfill: seed ownership links from current foreign keys ────────────────
-- Each guarded by NOT EXISTS on (subject, object, relation, current) so a
-- retried run never duplicates.

-- users -> businesses 'owns'
INSERT INTO entity_links (subject_id, object_id, relation)
SELECT eu.public_id, eb.public_id, 'owns'
FROM businesses b
JOIN entity_ids eu
  ON eu.entity_type = 'person' AND eu.entity_key = b.user_id::TEXT
JOIN entity_ids eb
  ON eb.entity_type = 'business' AND eb.entity_key = b.id::TEXT
WHERE b.user_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM entity_links l
  WHERE l.subject_id = eu.public_id
    AND l.object_id = eb.public_id
    AND l.relation = 'owns'
    AND l.valid_to IS NULL
);

-- users -> food_restaurants 'owns'
INSERT INTO entity_links (subject_id, object_id, relation)
SELECT eu.public_id, er.public_id, 'owns'
FROM food_restaurants fr
JOIN entity_ids eu
  ON eu.entity_type = 'person' AND eu.entity_key = fr.owner_user_id::TEXT
JOIN entity_ids er
  ON er.entity_type = 'restaurant' AND er.entity_key = fr.id::TEXT
WHERE fr.owner_user_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM entity_links l
  WHERE l.subject_id = eu.public_id
    AND l.object_id = er.public_id
    AND l.relation = 'owns'
    AND l.valid_to IS NULL
);

-- food_restaurants -> businesses 'belongs_to'
INSERT INTO entity_links (subject_id, object_id, relation)
SELECT er.public_id, eb.public_id, 'belongs_to'
FROM food_restaurants fr
JOIN entity_ids er
  ON er.entity_type = 'restaurant' AND er.entity_key = fr.id::TEXT
JOIN entity_ids eb
  ON eb.entity_type = 'business' AND eb.entity_key = fr.business_id::TEXT
WHERE fr.business_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM entity_links l
  WHERE l.subject_id = er.public_id
    AND l.object_id = eb.public_id
    AND l.relation = 'belongs_to'
    AND l.valid_to IS NULL
);

-- users -> helper_profiles 'acts_as'
INSERT INTO entity_links (subject_id, object_id, relation)
SELECT eu.public_id, eh.public_id, 'acts_as'
FROM helper_profiles hp
JOIN entity_ids eu
  ON eu.entity_type = 'person' AND eu.entity_key = hp.user_id::TEXT
JOIN entity_ids eh
  ON eh.entity_type = 'helper_profile' AND eh.entity_key = hp.id::TEXT
WHERE hp.user_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM entity_links l
  WHERE l.subject_id = eu.public_id
    AND l.object_id = eh.public_id
    AND l.relation = 'acts_as'
    AND l.valid_to IS NULL
);

-- active business_members -> businesses 'manages' / 'represents'
INSERT INTO entity_links (subject_id, object_id, relation)
SELECT eu.public_id, eb.public_id,
       CASE WHEN bm.role = 'manager' THEN 'manages' ELSE 'represents' END
FROM business_members bm
JOIN entity_ids eu
  ON eu.entity_type = 'person' AND eu.entity_key = bm.member_id::TEXT
JOIN entity_ids eb
  ON eb.entity_type = 'business' AND eb.entity_key = bm.business_id::TEXT
WHERE bm.member_id IS NOT NULL
  AND bm.status = 'active'
  AND bm.role IN ('manager', 'representative')
AND NOT EXISTS (
  SELECT 1 FROM entity_links l
  WHERE l.subject_id = eu.public_id
    AND l.object_id = eb.public_id
    AND l.relation = CASE WHEN bm.role = 'manager' THEN 'manages' ELSE 'represents' END
    AND l.valid_to IS NULL
);
