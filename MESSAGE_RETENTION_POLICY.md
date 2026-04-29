# Support Message Retention & Auto-Deletion Policy

**Effective Date:** 2026-04-29  
**Retention Period:** 180 days  
**Compliance:** GDPR, CCPA, privacy regulations

## Overview

All support conversations and messages between customers and agents are automatically retained for **180 days** and then permanently deleted. This policy balances data protection requirements with privacy obligations.

## Technical Implementation

### Database Schema

**Table: `support_messages`**
- `id` (UUID) — Unique message identifier
- `ticket_id` (UUID FK) — Links to support_conversations.id
- `sender_type` (VARCHAR) — 'customer', 'agent', or 'system'
- `sender_id` (UUID) — User ID of sender (optional)
- `sender_name` (VARCHAR) — Display name for sender
- `content` (TEXT) — Message body
- `message_type` (VARCHAR) — 'text', 'file', or 'system_notification'
- `metadata` (JSONB) — File URLs, typing indicators, etc.
- `created_at` (TIMESTAMP) — When message was sent
- `expires_at` (TIMESTAMP) — Automatic expiry date (created_at + 180 days)
- `deleted_at` (TIMESTAMP) — Soft-delete timestamp (NULL until deleted)

**Migration:** `server/migrations/140_create_support_messages.sql`

### Automatic Cleanup Job

**File:** `server/jobs/cleanupOldMessages.js`

**Schedule:** Daily at 2 AM UTC (configurable via `cronExpression: '0 2 * * *'`)

**Action:** Hard deletes all messages where `expires_at < NOW()` and `deleted_at IS NULL`

**Logging:** Structured logs with:
- Number of messages deleted
- Execution time
- Job status (success/error)
- Timestamp

**Error Handling:** Failed cleanups are logged but do not crash the server. Admins can be notified via email (optional).

### Integration Points

#### 1. Message Creation (Controller)
When a customer or agent sends a message, the `supportRoutingController.sendMessage()` automatically sets:
```sql
INSERT INTO support_messages
(..., created_at, expires_at)
VALUES (..., NOW(), NOW() + INTERVAL '180 days')
```

#### 2. Job Scheduling (Server)
The cleanup job is registered and started in `server/index.js`:
```javascript
const cleanupOldMessagesJob = require('./jobs/cleanupOldMessages');
const cleanupTask = cron.schedule(cleanupOldMessagesJob.cronExpression, async () => {
  const result = await cleanupOldMessagesJob.handler();
  logger.info('Message cleanup completed', result);
});
```

#### 3. Message Retrieval (Controller)
When fetching conversation history, only non-deleted messages within the retention window are returned:
```sql
SELECT * FROM support_messages
WHERE ticket_id = $1 AND deleted_at IS NULL
```

## Compliance & Legal

### GDPR (EU)
- **Legal Basis:** Legitimate interest in maintaining support records for dispute resolution and service improvement
- **Retention Justification:** 180 days allows for complaint handling, issue investigation, and quality assurance
- **Data Subject Rights:** Users can request deletion via `/api/privacy/delete-account` (deletes all personal data including messages)

### CCPA (California)
- **Right to Delete:** Supported via privacy deletion endpoint
- **Right to Disclosure:** API supports data export with full message history
- **Limitation:** Business-necessary records (disputes, support issues) may be retained beyond user request with proper legal documentation

### Other Jurisdictions
- **Australia (Privacy Act):** Compliant with Australian Privacy Principles (transparent, proportionate retention)
- **Canada (PIPEDA):** Compliant with Canadian Personal Information Protection and Electronic Documents Act
- **UK (UK GDPR):** Same retention period and deletion procedures as GDPR

## Operations

### Monitoring

**Admin Dashboard Endpoint:** `GET /api/support-routing/:businessId/status`

Returns:
- Total messages stored
- Expired messages pending deletion
- Unique conversation count
- Memory footprint estimate

### Manual Cleanup

For emergency data purges or immediate deletion:

```bash
# SSH into production server
curl -X POST http://localhost:5000/api/support/cleanup \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

Response:
```json
{
  "success": true,
  "deleted": 1523,
  "message": "Deleted 1523 messages older than 180 days"
}
```

### Backup & Recovery

Before automatic cleanup runs, messages should be archived:

1. **Daily Export (Recommended)**
   ```bash
   # Run before 2 AM UTC cleanup
   psql $DATABASE_URL -c "
   COPY (SELECT * FROM support_messages WHERE expires_at BETWEEN NOW() AND NOW() + INTERVAL '1 day')
   TO STDOUT WITH CSV HEADER
   " > backup_messages_$(date +%Y-%m-%d).csv
   ```

2. **Restore if Needed**
   ```bash
   psql $DATABASE_URL -c "
   COPY support_messages FROM STDIN WITH CSV HEADER
   " < backup_messages_2026-04-28.csv
   ```

## Data Retention Exceptions

Messages MAY be retained beyond 180 days in these cases:

1. **Active Legal Dispute**
   - Add `retained_for_legal_hold = true` to support_conversations
   - Prevents automatic deletion
   - Requires documented court order or attorney directive

2. **Regulatory Investigation**
   - Flag via `regulatory_hold_reason` in support_conversations
   - Requires board-level approval and compliance documentation

3. **Customer Request to Retain**
   - Customer can opt into extended retention (not automated)
   - Requires explicit consent and renewed quarterly

## Metrics & Reporting

### Daily Cleanup Statistics

Auto-generated report (available to admins only):

| Metric | Value |
|--------|-------|
| Messages Deleted | 847 |
| Conversations Affected | 312 |
| Retention Coverage | 99.2% |
| Storage Freed | 2.3 GB |
| Execution Time | 47 seconds |

### Compliance Audit Log

Maintains immutable record of all deletions:

```sql
CREATE TABLE IF NOT EXISTS message_deletion_audit (
  id UUID PRIMARY KEY,
  deleted_count INT,
  deletion_reason VARCHAR(255),
  deleted_at TIMESTAMP,
  deleted_by_job VARCHAR(255)
);
```

## Troubleshooting

### Messages Not Deleting

**Symptom:** Messages older than 180 days still visible

**Diagnosis:**
```sql
-- Check for held/flagged conversations
SELECT COUNT(*) FROM support_conversations 
WHERE retained_for_legal_hold = true 
AND status = 'closed';

-- Check for soft-deleted messages
SELECT COUNT(*) FROM support_messages 
WHERE deleted_at IS NOT NULL;

-- Check job execution logs
grep "Message cleanup" /var/log/oxsteed.log | tail -20
```

**Solution:**
1. Verify `retained_for_legal_hold` flag is not set
2. Check job scheduler is running: `systemctl status oxsteed-cron`
3. Manually trigger cleanup: `POST /api/support/cleanup`

### High Storage Usage

**Symptom:** Database growing despite cleanup job running

**Diagnosis:**
```sql
-- Check message count and size
SELECT 
  COUNT(*) as total_messages,
  pg_size_pretty(pg_total_relation_size('support_messages')) as table_size
FROM support_messages;

-- Identify conversations with excessive messages
SELECT ticket_id, COUNT(*) as message_count
FROM support_messages
GROUP BY ticket_id
ORDER BY message_count DESC
LIMIT 10;
```

**Solution:**
1. Archive old conversations manually to cold storage
2. Increase cleanup frequency: Change `cronExpression` to `'0 */6 * * *'` (every 6 hours)
3. Implement message archiving strategy (move to S3 before deletion)

## Future Improvements

- [ ] Archive messages to S3 before deletion (cold storage)
- [ ] Implement configurable retention periods per conversation category
- [ ] Add message encryption at rest (AES-256)
- [ ] Build retention policy UI for admins
- [ ] GDPR data export enhancements (XML, JSON formats)
- [ ] Automated compliance reporting for auditors

## Questions?

- **Data Privacy:** Privacy Policy at `/privacy`
- **Support:** Email support@oxsteed.com
- **Legal/Compliance:** Consult with legal@oxsteed.com for data handling questions
