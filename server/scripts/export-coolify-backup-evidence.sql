-- Allowlisted metadata only. Never select execution messages or S3 credentials.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL TIME ZONE 'UTC';
WITH target AS (
  SELECT b.*, d.uuid AS database_uuid, s.bucket,
    COALESCE(s.endpoint ~ '^https://[a-zA-Z0-9]+\.r2\.cloudflarestorage\.com/?$', false) AS is_r2
  FROM scheduled_database_backups b
  JOIN service_databases d ON b.database_id = d.id AND b.database_type = 'App\Models\ServiceDatabase'
  LEFT JOIN s3_storages s ON s.id = b.s3_storage_id
  WHERE b.uuid = 'fthxpltbf0v8waof9r2fqsi0'
    AND d.uuid = 'd8tng2ulcrc1pgbvkr6ehcn4' AND d.deleted_at IS NULL
), executions AS (
  SELECT e.* FROM scheduled_database_backup_executions e JOIN target t ON t.id = e.scheduled_database_backup_id
  WHERE e.database_name = 'oxsteed_db'
  ORDER BY e.created_at DESC, e.uuid DESC LIMIT 1001
), included AS (SELECT * FROM executions ORDER BY created_at DESC, uuid DESC LIMIT 1000)
SELECT json_build_object(
  'schemaVersion', 1, 'source', 'coolify',
  'observedAt', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'target', (SELECT json_build_object('scheduleUuid', uuid, 'databaseUuid', database_uuid,
    'databaseName', 'oxsteed_db', 'bucket', bucket, 'enabled', enabled, 'frequency', frequency,
    'saveS3', save_s3, 'keepLocal', NOT disable_local_backup, 'isR2', is_r2) FROM target),
  'truncated', (SELECT count(*) > 1000 FROM executions),
  'executions', COALESCE((SELECT json_agg(json_build_object(
    'uuid', uuid, 'databaseName', database_name, 'status', status,
    'startedAt', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'finishedAt', to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'filename', regexp_replace(filename, '^.*/', ''),
    'sizeBytes', CASE WHEN size ~ '^[0-9]+$' THEN size::bigint ELSE NULL END,
    's3Uploaded', s3_uploaded, 'localDeleted', local_storage_deleted, 's3Deleted', s3_storage_deleted
  ) ORDER BY created_at DESC, uuid DESC) FROM included), '[]'::json)
);
ROLLBACK;
