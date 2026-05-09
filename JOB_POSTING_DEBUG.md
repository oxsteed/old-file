# 🔍 Job Posting 500 Error - Diagnostic Guide

You're getting a **500 Internal Server Error** on the final POST step. Let's capture the actual error message.

---

## Step 1: Get the Server Error Logs

### Option A: Check your server logs
```bash
# If using Docker/Coolify:
docker logs <container-id> | tail -50

# If running locally:
# The error should be logged to console or a log file
# Look for: [createJob] Error inserting job
```

### Option B: Check browser Network tab
1. Open DevTools (F12)
2. Go to **Network** tab
3. Click "Post" button
4. Find the red **POST /api/jobs** request
5. Click it → **Response** tab
6. Copy the full error response

### Option C: Check browser Console
1. Open DevTools (F12)
2. Go to **Console** tab
3. Click "Post" button
4. Look for red error messages
5. Share the error stack trace

---

## Common 500 Error Causes (Let's Rule Them Out)

### 1. ❓ Column Does Not Exist (Most Likely)
**Error will say:** `column "xxx" does not exist`

**Migrations might not have applied. Check:**
```sql
-- SSH into your database and run:
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'jobs' 
ORDER BY ordinal_position;
```

**Should have these columns (check for missing ones):**
- ✓ client_id, title, description
- ✓ category_id, category_name
- ✓ budget_type, budget_min, budget_max
- ✓ urgency, is_urgent
- ✓ site_access, job_type_label, notes
- ✓ location_address, location_city, location_state, location_zip, **location_country**
- ✓ location_lat, location_lng, location_point
- ✓ location_approx_lat, location_approx_lng
- ✓ requirements, media_urls
- ✓ required_skills, skill_ids
- ✓ scheduled_date, scheduled_time, recurrence
- ✓ preferred_helper_id, preferred_helper_name
- ✓ private_notes
- ✓ status, expires_at

**If missing location_country:** Run migration 180
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location_country VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_jobs_location_country ON jobs(location_country);
```

**If missing other columns:** Run migration 151
```bash
node server/migrate.js  # Re-run migrations
```

---

### 2. ❓ PostGIS Not Installed
**Error will say:** `function st_setsrid does not exist` or `type geography does not exist`

**Check:**
```sql
SELECT PostGIS_version();  -- Should return version, not error
```

**If missing:**
```bash
# Install PostGIS extension
psql -d your_database -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

---

### 3. ❓ JWT Token Invalid or Expired
**Error will say:** `401 Unauthorized` (in browser, not 500)

**Check:**
1. Are you logged in? (Check `localStorage.accessToken` in DevTools)
2. Is it a valid JWT? (Use https://jwt.io to decode)
3. Has it expired?

---

### 4. ❓ Email Not Verified
**Error will say:** `email_not_verified` (403, not 500)

**Check:**
```sql
SELECT email, email_verified FROM users WHERE id = 'your_user_id';
```

**If false:**
```sql
UPDATE users SET email_verified = true WHERE id = 'your_user_id';
```

---

### 5. ❓ User Restricted or Suspended
**Error will say:** `ACCOUNT_SUSPENDED` or `ACCOUNT_RESTRICTED` (403, not 500)

**Check:**
```sql
SELECT is_suspended, suspended_until FROM users WHERE id = 'your_user_id';
SELECT * FROM user_restrictions WHERE user_id = 'your_user_id' AND is_active = true;
```

---

### 6. ❓ Database Connection Failed
**Error will say:** `ECONNREFUSED` or `connect ETIMEDOUT`

**Check:**
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1;"  # Should return (1)
```

---

### 7. ❓ S3 Upload Failing (Non-Critical)
**Error will say:** `AWS S3 error` (but job should still create)

**Check:**
- Are you uploading files?
- Is AWS_S3_BUCKET configured?
- Are AWS credentials valid?

**Workaround:** Post without media files first to test

---

## Step 2: Provide the Error Details

**Please run and share:**

```bash
# 1. Server logs (last 30 lines around the error)
# 2. The [createJob] Error inserting job message
# 3. The PostgreSQL error code and detail
```

Or provide:
```
Browser Console Error:
[paste full error stack trace]

Network Response:
[paste full /api/jobs response]
```

---

## Step 3: Quick Test Without Files

Try posting **without media files** to isolate the issue:

1. Go to `/post-job`
2. Fill in:
   - **Title:** "Test job to debug"
   - **Description:** "This is a test description longer than 50 characters to verify basic posting works"
   - **Location City:** "Austin"
   - **Location Country:** "United States"
   - **Category:** "Handyman"
   - **Budget Type:** "Open to bids"
3. **Don't upload any files**
4. **Don't add any requirements**
5. Click **Post**

**Does it work?** If yes, the issue is with file upload or requirements. If no, it's a core insertion issue.

---

## Step 4: Test Database Insert Directly

Test if the jobs table accepts inserts:

```sql
INSERT INTO jobs (
  client_id, title, description,
  category_name,
  budget_type, urgency,
  location_city, location_country,
  status, expires_at
)
VALUES (
  'YOUR_USER_UUID',
  'Direct test job',
  'Testing direct database insert to verify schema is correct',
  'handyman',
  'open',
  'flexible',
  'Austin',
  'United States',
  'published',
  now() + interval '30 days'
)
RETURNING *;
```

**Did it work?** If yes, the issue is in the Node.js code. If no, it's a schema issue.

---

## Step 5: Check Migration Order

Migrations must run in order. Some columns depend on others:

```sql
SELECT id, name, status FROM _migrations 
WHERE id IN (1, 12, 36, 44, 80, 151, 180, 181)
ORDER BY id;
```

**All should be "applied":**
- ✓ 001 - Core jobs table
- ✓ 012 - Phase 4 enhancements  
- ✓ 036 - Post job wizard
- ✓ 044 - Scheduling columns
- ✓ 080 - Required skills
- ✓ 151 - Idempotent wizard columns
- ✓ 180 - Location country
- ✓ 181 - Repair location country

**If any are missing or failed:**
```bash
node server/migrate.js --force  # Re-run migrations
```

---

## Step 6: Enable Verbose Logging

Add this to `server/index.js` before the app starts:

```javascript
const logger = require('./utils/logger');
logger.setLevel('debug');  // More detailed logs

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
```

Then try posting again and check logs.

---

## What I Need From You

Please provide:

1. **Server logs** from the moment you click "Post"
2. **PostgreSQL error code and detail** (e.g., `23505`, `42703`)
3. **Browser Network response** JSON
4. **Database schema check** output (list of columns in jobs table)
5. **Migration status** (which migrations are applied?)

---

## Common Fixes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "`location_country` does not exist" | Migration 180 not applied | `node server/migrate.js` |
| "`job_drafts` table not found" | Old migration order | Run all migrations in order |
| "`geography` type not found" | PostGIS not installed | `CREATE EXTENSION postgis;` |
| "`email_verified` missing" | User table out of sync | Check user schema |
| "ECONNREFUSED" | Database not running | `pg_isready` or check Docker |
| "Token invalid" | Session expired | Re-login |
| "File too large" | Multer limit | ≤10MB per file |

---

## Next Steps

Once you provide the **actual error message**, I can:
1. Identify the exact line failing
2. Provide a targeted fix
3. Update the code if needed

**Please reply with the server error logs from the POST request.**
