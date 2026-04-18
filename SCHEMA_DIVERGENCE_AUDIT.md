# Schema Divergence Audit & Reconciliation

**Date**: 2026-04-18  
**Migration**: `072_schema_divergence_reconciliation.sql`  
**Status**: ⚠️ Requires manual verification before production deployment

## Problem Summary

Multiple migrations create the same database tables with conflicting schemas. The `IF NOT EXISTS` clause masks these conflicts, causing:
- Silent schema divergence (different environments may have different structures)
- Potential query failures if code expects columns that don't exist
- Data loss risk if columns are dropped unintentionally
- Maintainability issues (which version is authoritative?)

## Divergences Identified

### 1. `sessions` Table (CRITICAL)

**Conflicting Migrations**: `025_merge_legacy_unique_fields.sql` vs `026_fix_auth_schema.sql`

**Migration 025 schema**:
```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  refresh_token VARCHAR(255),
  is_valid BOOLEAN DEFAULT true,
  device_info TEXT,           -- ← Extra
  ip_address VARCHAR(45),     -- ← Extra
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ      -- ← Extra
);
```

**Migration 026 schema**:
```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),  -- ← NOT NULL added
  refresh_token TEXT NOT NULL,                 -- ← Type & NOT NULL changed
  is_valid BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
  -- Missing device_info, ip_address, revoked_at
);
```

**Issues**:
- `refresh_token`: Migration 025 uses `VARCHAR(255)`, migration 026 uses `TEXT`
- `device_info`, `ip_address`, `revoked_at`: Present in 025, missing in 026
- NOT NULL constraints added in 026 but not in 025

**Fix Applied**: Migration 072 adds missing columns from 025 and ensures NOT NULL constraints from 026

---

### 2. `feature_flags` Table (HIGH)

**Conflicting Migrations**: `001_initial_schema.sql`, `005_admin.sql`, `023_create_platform_settings_and_feature_flags.sql`

**Migration 001 schema**:
```sql
CREATE TABLE feature_flags (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) NOT NULL UNIQUE,
  is_enabled BOOLEAN DEFAULT false,
  description TEXT,
  updated_by UUID REFERENCES users(id)
);
```

**Migration 005 schema** (problematic!):
```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  key VARCHAR(80) PRIMARY KEY,        -- ← Different! Key as PK, VARCHAR(80) instead of 100
  is_enabled BOOLEAN DEFAULT false,
  description TEXT,
  rollout_pct INT DEFAULT 100,        -- ← Extra column
  updated_by UUID REFERENCES users(id)
);
```

**Migration 023 schema**:
```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  description TEXT,
  updated_by UUID REFERENCES users(id)
  -- Missing rollout_pct from migration 005
);
```

**Issues**:
- Migration 005 breaks the design by using `key` as PRIMARY KEY instead of `id`
- `rollout_pct`: Present in 005, missing in 023
- `key` length: VARCHAR(80) in 005, VARCHAR(100) in 001/023

**Fix Applied**: Migration 072 adds `rollout_pct` column and ensures id-based primary key + unique key

---

### 3. `dispute_messages` Table (CRITICAL)

**Conflicting Migrations**: `015_phase4_create_disputes.sql`, `025_merge_legacy_unique_fields.sql`, `050_database_reconciliation.sql`

**Migration 015 schema**:
```sql
CREATE TABLE IF NOT EXISTS dispute_messages (
  id SERIAL PRIMARY KEY,                         -- ← SERIAL vs UUID
  dispute_id INTEGER NOT NULL,
  sender_id UUID NOT NULL,
  message TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',                -- ← Extra (deprecated)
  is_admin BOOLEAN DEFAULT false,                -- ← Different column name
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Migration 025 schema**:
```sql
CREATE TABLE IF NOT EXISTS dispute_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id INTEGER REFERENCES disputes(id),    -- ← No NOT NULL
  sender_id UUID REFERENCES users(id),           -- ← No NOT NULL
  sender_role VARCHAR(20) NOT NULL,              -- ← Extra
  message TEXT NOT NULL,
  is_admin_only BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ
);
```

**Migration 050 schema**:
```sql
CREATE TABLE IF NOT EXISTS dispute_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id INTEGER NOT NULL,                   -- ← NOT NULL enforced
  sender_id UUID NOT NULL,                       -- ← NOT NULL enforced
  sender_role VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  is_admin_only BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Issues**:
- ID type: SERIAL (015) vs UUID (025/050) — major incompatibility
- `attachments` column: Present in 015, absent in 025/050
- `is_admin` vs `is_admin_only`: Different column naming
- NOT NULL constraints: Inconsistent across versions

**Fix Applied**: Migration 072 recreates table to match migration 050 (most recent), preserves data from backup

⚠️ **WARNING**: This migration deletes the old table. If production data exists in the `attachments` column (migration 015), it will be lost!

---

### 4. `dispute_evidence` Table (LOW)

**Conflicting Migrations**: `025_merge_legacy_unique_fields.sql`, `050_database_reconciliation.sql`

**Migration 025**:
```sql
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID PRIMARY KEY,
  dispute_id INTEGER REFERENCES disputes(id),    -- ← No NOT NULL
  submitted_by UUID REFERENCES users(id),        -- ← No NOT NULL
  ...
);
```

**Migration 050**:
```sql
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID PRIMARY KEY,
  dispute_id INTEGER NOT NULL,
  submitted_by UUID NOT NULL,
  ...
);
```

**Issues**:
- NOT NULL constraints added in 050 but not in 025
- No data loss risk (columns exist in both)

**Fix Applied**: Migration 072 adds NOT NULL constraints and indexes

---

## Pre-Deployment Checklist

⚠️ **CRITICAL**: Before running migration 072 in production:

### 1. Verify Current Schema
Connect to your production database and run:

```sql
-- Check sessions table structure
\d sessions

-- Check feature_flags table structure
\d feature_flags

-- Check dispute_messages table structure
\d dispute_messages

-- Check dispute_evidence table structure
\d dispute_evidence

-- List all indexes
SELECT * FROM pg_indexes WHERE tablename IN ('sessions', 'feature_flags', 'dispute_messages', 'dispute_evidence');
```

### 2. Compare Against Expectations

Record the actual schema and compare:
- Are the columns mentioned in migration 072 already present?
- Which migration's schema was actually applied?
- Are there extra columns we didn't account for?

### 3. Backup Your Database

```bash
pg_dump -Fc your_database_name > backup_before_migration_072.dump
```

### 4. Test Migration in Staging

Run migration 072 against a staging copy of your database:

```bash
# In staging environment
node migrate.js  # This will apply migration 072
```

Verify:
- No errors during migration
- Data is preserved (run SELECT COUNT(*) on each table before/after)
- Queries still work (run your application's critical queries)
- API endpoints work correctly

### 5. Review Migration Output

Migration 072 creates a `schema_audit` table with:
- Record of each change made
- Table affected
- Description of fix
- Timestamp
- Verification flag (manually set to true after testing)

---

## Data Loss Risks

### ⚠️ HIGH RISK: `dispute_messages.attachments` Column

If you have data in the `attachments` column (from migration 015), **migration 072 will lose it**.

**Mitigation**:
Before running migration 072, export this data:

```sql
SELECT id, dispute_id, attachments FROM dispute_messages WHERE attachments IS NOT NULL AND attachments != '[]';
```

Store it in a backup file or migrate it to another table.

### ✅ LOW RISK: Other Tables

- `sessions`: New columns are added (no data loss)
- `feature_flags`: New column added (no data loss)
- `dispute_evidence`: Constraints added (no data loss)

---

## Recommendations

1. **Before Production Deployment** (mandatory):
   - Backup production database
   - Verify actual schema matches one of the conflict migration versions
   - If production has merged schema (columns from multiple migrations), create custom migration
   - Test in staging environment
   - Document any custom decisions

2. **Going Forward**:
   - Consolidate all table definitions into single authoritative migration
   - Remove duplicate table creation statements
   - Consider adding schema versioning to database
   - Add database schema CI checks to prevent future divergences

3. **Code Audit**:
   - Verify all code accessing `dispute_messages` handles `sender_role` field
   - Check if `attachments` field is used anywhere in code
   - Confirm `device_info` and `ip_address` on `sessions` are utilized

---

## Files Modified

- `server/migrations/072_schema_divergence_reconciliation.sql` — Reconciliation migration
- `SCHEMA_DIVERGENCE_AUDIT.md` — This file (audit documentation)

---

## References

- Migration 001: `001_initial_schema.sql`
- Migration 005: `005_admin.sql`
- Migration 015: `015_phase4_create_disputes.sql`
- Migration 023: `023_create_platform_settings_and_feature_flags.sql`
- Migration 025: `025_merge_legacy_unique_fields.sql`
- Migration 026: `026_fix_auth_schema.sql`
- Migration 050: `050_database_reconciliation.sql`
- Migration 072: `072_schema_divergence_reconciliation.sql`
