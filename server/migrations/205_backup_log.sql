-- BACKUP_LOG: Track all backup operations for disaster recovery compliance

CREATE TABLE IF NOT EXISTS backup_log (
  id BIGSERIAL PRIMARY KEY,
  backup_id VARCHAR(255) UNIQUE NOT NULL,
  success BOOLEAN NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  tested_at TIMESTAMP,
  test_result BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_backup_log_created_at
  ON backup_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backup_log_success
  ON backup_log(success, created_at DESC);
