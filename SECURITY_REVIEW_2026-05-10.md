# OxSteed Security Review Report
**Date:** May 10, 2026  
**Reviewer:** OxSteed Security Team  
**Scope:** Full-stack security audit (React frontend + Node.js backend + PostgreSQL)  
**Risk Assessment:** **MEDIUM** - Production-ready with identified improvements needed

---

## Executive Summary

OxSteed has implemented **solid foundational security controls** with proper authentication, authorization, input validation, and rate limiting. However, **5 critical gaps** exist that must be addressed before production deployment, and **12 high-priority improvements** should be implemented within 30 days of launch.

**Security Score: 70/100**
- ✅ Strong areas: Auth, CSRF, error handling, rate limiting, CSP headers
- ⚠️ Needs improvement: Dependency vulnerabilities, logging, secrets management, CORS configuration
- ❌ Critical gaps: Encryption at rest, API key rotation, security audit trail, incident response

---

## 1. CRITICAL FINDINGS (MUST FIX BEFORE PRODUCTION)

### 🔴 1.1 Insufficient Encryption for Sensitive Data (HIGH SEVERITY)

**Finding:** PII data (SSNs, bank account numbers, passport numbers) is encrypted only in transit (TLS) but NOT at rest in the database.

**Evidence:**
- `server/utils/encryption.js` exists with `encrypt/decrypt` functions
- Used only for: IP hashing (rate limiting), refresh tokens, some profile data
- NOT used for: SSNs, bank accounts, routing numbers, identity verification data, background check results
- Stripe processes payment data (PCI-compliant), but business banking details, W-9 data, verification documents are stored in plain text

**Risk:**
- Database breach exposes sensitive customer and helper financial/identity data
- Non-compliance with GDPR Article 32 (encryption requirements)
- Potential state/federal data protection law violations (CCPA, GLBA, HIPAA if health data stored)
- Insurance/payment processor violations

**Remediation:**
1. **Immediate (pre-production):**
   ```javascript
   // Wrap all sensitive columns in encrypt/decrypt at controller layer:
   - users.ssn
   - users.passport_number
   - users.drivers_license_number
   - helper_profiles.bank_account_number
   - helper_profiles.routing_number
   - background_checks.raw_data
   - identity_verifications.raw_data
   - w9_forms.ein
   - payment_methods.card_token (if any stored - should NOT be)
   ```

2. **Add transparent encryption at model layer** (optional but recommended for future):
   ```javascript
   // In database query layer, automatically decrypt on SELECT, encrypt on INSERT
   // Avoids repeating encryption logic in each controller
   ```

3. **Use AWS KMS or HashiCorp Vault** for encryption key management:
   - Current: `ENCRYPTION_KEY` stored in `.env` (visible to anyone with server access)
   - Better: Store in AWS Secrets Manager or Vault, rotate on fixed schedule
   - Set key rotation policy: 90 days

4. **Document data classification:**
   - Public: user profile names, skills (no encryption needed)
   - Internal: email, phone, timestamps (minimal risk)
   - **Sensitive:** SSN, bank, government IDs, verification data (MUST encrypt)
   - **Secret:** API keys, passwords, tokens (MUST hash + encrypt)

**Effort:** 15 hours | **Priority:** CRITICAL

---

### 🔴 1.2 Missing Secrets Rotation & Key Management (HIGH SEVERITY)

**Finding:** Critical secrets are stored in `.env` file with no rotation, versioning, or audit trail.

**Current State:**
```
- JWT_SECRET: Single key for signing all tokens (if compromised, all tokens are forgeable)
- ENCRYPTION_KEY: Single key for all encrypted data (no versioning)
- STRIPE_SECRET_KEY: Visible in .env (should be Vault/KMS only)
- Database password: In DATABASE_URL, no rotation mechanism
- Third-party API keys: 7+ keys in .env (Didit, Checkr, AWS, Twilio, Resend, OpenRouter, Sentry)
```

**Risk:**
- Compromised `.env` file (via deploy, server access, or developer laptop) = full application compromise
- No way to revoke a secret without restart
- No audit trail of who accessed/rotated what
- Database credentials never rotated = ongoing breach risk if exposed

**Evidence from Code:**
- `server/index.js` line 2: `require('dotenv').config()` — **before** any Sentry/logging
- `.env.example` checked into Git (good for template, but shows structure to attackers)
- No rotation mechanism in codebase

**Remediation:**
1. **Immediate:**
   - Move to AWS Secrets Manager (production) or HashiCorp Vault
   - `npm install @aws-sdk/client-secrets-manager`
   - Create rotation Lambda (automatic every 90 days)
   - Code example:
     ```javascript
     // utils/secretsManager.js
     const SecretsManager = require('@aws-sdk/client-secrets-manager');
     const sm = new SecretsManager({ region: process.env.AWS_REGION });
     
     async function getSecret(secretName) {
       const result = await sm.getSecretValue({ SecretId: secretName });
       return JSON.parse(result.SecretString);
     }
     ```

2. **Key rotation for JWT:**
   - Use JWKS (JSON Web Key Set) with key versioning
   - Maintain 2–3 keys at a time (current + 1–2 old)
   - Rotate monthly: `JWT_SECRET_V2`, `JWT_SECRET_V3`, keep old for 30d grace period

3. **Database credentials:**
   - Use RDS proxy (handles credentials, connection pooling, automatic rotation)
   - Or: AWS Secrets Manager + RDS rotation Lambda

4. **Stripe API keys:**
   - Never store `STRIPE_SECRET_KEY` in .env
   - Use Stripe API keys in Secrets Manager only
   - Implement webhook signature verification (✅ already done)

5. **Audit trail:**
   - Log all secret access: `{"action":"secret_access", "secret":"JWT_SECRET", "timestamp":"...", "user":"system"}`
   - Alert on any manual secret access (should be rare)

**Effort:** 10 hours | **Priority:** CRITICAL

---

### 🔴 1.3 Missing Security Audit Trail (HIGH SEVERITY)

**Finding:** No comprehensive audit logging for:
- Admin actions (user suspension, data deletion, permission grants)
- Authentication events (failed logins, MFA bypass, token revocation)
- Data access (who accessed what sensitive data, when)
- Security incidents (rate limit breaches, webhook failures, encryption errors)

**Current Logging:**
- ✅ Request logging (method, path, status, user) in `logger.requestMiddleware()`
- ✅ Error logging with context
- ❌ **No audit log table** — security events are mixed with operational logs
- ❌ **No immutable audit log** — logs can be rotated/deleted
- ❌ **No security event classification** — hard to search for "admin deleted user"

**Impact:**
- Cannot investigate security incidents (who did what, when)
- Fails compliance audits (SOC 2, GDPR, state law requirements)
- Cannot prove authentication for payment disputes
- No alert capability for suspicious patterns

**Evidence:**
- 132 migrations, no `audit_log` or `security_events` table
- Logging uses `logger.info/warn/error` mixed with app logs
- No immutable storage (logs can be rotated)

**Remediation:**
1. **Create immutable audit tables:**
   ```sql
   CREATE TABLE audit_log (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     event_type VARCHAR(50) NOT NULL, -- 'admin_suspend_user', 'api_key_rotated', 'login_failed', etc.
     severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'critical'
     actor_id UUID REFERENCES users(id), -- WHO did it (admin, system, null for system)
     actor_role VARCHAR(20), -- admin, super_admin, system
     resource_type VARCHAR(50), -- 'user', 'payment', 'job', 'api_key'
     resource_id VARCHAR(100), -- Which user/payment/job/etc.
     action VARCHAR(100), -- What happened (suspended, deleted, created, modified)
     details JSONB, -- Before/after values, reason, IP, user agent
     ip_address INET,
     user_agent VARCHAR(500),
     timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
     immutable_hash VARCHAR(64), -- Hash of all fields, cannot be modified
     created_at TIMESTAMP NOT NULL DEFAULT NOW()
   );
   CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
   CREATE INDEX idx_audit_log_actor_id ON audit_log(actor_id);
   CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
   CREATE INDEX idx_audit_log_severity ON audit_log(severity);
   ```

2. **Log all security-critical events:**
   - ✅ Auth: login success/fail, MFA enabled/disabled, token refresh, logout, password reset, email change
   - ✅ Admin: user suspend/delete, permission grant/revoke, data export request, API key creation/revocation
   - ✅ Access: sensitive data access (SSN, payment info), admin portal access, impersonation
   - ✅ Incident: rate limit exceeded, webhook signature failure, database error, encryption error, backup fail/success

3. **Implement audit service:**
   ```javascript
   // services/auditService.js
   async function logSecurityEvent(eventType, {
     actorId, actorRole, resourceType, resourceId, action,
     details = {}, ipAddress, userAgent
   }) {
     // Validate event_type against whitelist
     // Calculate immutable hash
     // Insert into audit_log table (never update/delete)
     // Alert if severity=critical
   }
   ```

4. **Retention policy:**
   - Keep audit logs for **7 years** (compliance requirement)
   - Store in PostgreSQL + archive to S3 (immutable versioning) after 1 year
   - Set S3 bucket policy: no deletes, only append

5. **Alerting:**
   - Send critical events to Slack/PagerDuty in real-time
   - Examples: Multiple failed logins, admin suspends user, payment capture fails, encryption key rotated

**Effort:** 12 hours | **Priority:** CRITICAL

---

### 🔴 1.4 Missing Incident Response Procedures (HIGH SEVERITY)

**Finding:** No documented process for responding to security incidents (breaches, DDoS, credential compromise, data loss).

**Risk:**
- During an incident, team has no playbook → delayed/wrong response
- Data breach notification laws require 30–60 days to notify affected users
- Without procedure, notification delay = legal liability + reputation damage
- Payment processors (Stripe) require incident response plan as part of integration

**Required Components:**
```
1. Incident Response Team: Who responds? (security lead, ops lead, CEO)
2. Detection: How do we know there's a breach? (alerts, monitoring)
3. Containment: How do we stop ongoing damage?
4. Assessment: What was accessed? How many users affected?
5. Notification: Notify users, regulators, payment processors
6. Recovery: Restore from backup, patch, re-deploy
7. Post-mortem: Document what happened, improve
```

**Remediation:**
1. **Create incident response runbook:**
   - File: `docs/INCIDENT_RESPONSE.md`
   - Include: contact info, escalation path, step-by-step procedures for:
     - Data breach
     - Ransomware/encryption
     - DDoS attack
     - Compromised credentials
     - Payment system failure
     - Database corruption
     - Third-party API down
   - Example template:
     ```markdown
     # Incident Response Runbook
     
     ## Suspected Data Breach
     1. **ASSESS:** Is breach confirmed? (log anomalies, file access logs)
     2. **CONTAIN:** Kill attacker access (revoke tokens, reset passwords, block IPs)
     3. **PRESERVE:** Dump logs/DB snapshots for forensics (immutable)
     4. **NOTIFY:** Call security lead + CEO + legal (start 60-day notification clock)
     5. **COMMUNICATE:** Draft user notification (be transparent, no blame)
     6. **REMEDIATE:** Patch vulnerability, rotate secrets, deploy fix
     7. **RESTORE:** Verify system integrity, restore from clean backup if needed
     8. **POST-MORTEM:** Blameless retrospective, improve detection/monitoring
     ```

2. **Set up monitoring/alerting:**
   - Alert on: Multiple failed auth, unusual data access, database errors, webhook failures
   - Send to Slack/PagerDuty
   - Example alerts:
     ```
     - 10+ failed logins in 5 minutes → IP rate limit breach
     - Admin access to 1000+ records in <1 min → data exfiltration attempt
     - Database error rate >5% → possible DDoS or failure
     - Encryption error → possible key corruption
     ```

3. **Legal/compliance:**
   - Write data breach notification template (required by law):
     - What data was accessed
     - How many users affected
     - What you're doing to fix it
     - How users can monitor their accounts
   - Consult with legal on notification timeline (state/federal requirements vary)
   - Example: California = notify without unreasonable delay; GDPR = within 72 hours to regulator

4. **Communication plan:**
   - Channels: Slack #security-incidents (private), Status page (public), Email (users), Twitter (if widespread)
   - Tone: Transparent, factual, action-focused (avoid blame/jargon)
   - Frequency: Update users every 2 hours during active incident

**Effort:** 6 hours | **Priority:** CRITICAL

---

### 🔴 1.5 Missing Secure Password Reset Flow (MEDIUM-HIGH SEVERITY)

**Finding:** Password reset is partially implemented but lacks:
- Timing-attack resistance
- Rate limiting on password reset attempts
- Verification that the user still owns the email
- Secure reset token expiry

**Evidence from Code:**
- `authController.js` has `forgotPassword()` and `resetPassword()` but:
  - Reset tokens stored in `users.password_reset_token` (single column, no expiry tracking)
  - No limit on reset requests (rate limiter exists but not applied to `/api/auth/forgot-password`)
  - Token generation: `crypto.randomBytes(32).toString('hex')` ✅ (good)
  - Token expiry: assumed to be checked, but no evidence of `password_reset_expires_at` column
  - No check for "is this still the user's email?" (if email was hijacked, attacker resets password)

**Risk:**
- Attacker requests password reset for victim's account
- Attacker intercepts reset email (if email is compromised, or attacker has access to email provider)
- Attacker sets new password, locks out victim
- Victim cannot regain access (email compromised, password changed)

**Remediation:**
1. **Enhance password reset table:**
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS (
     password_reset_token VARCHAR(64),
     password_reset_expires_at TIMESTAMP,
     password_reset_email VARCHAR(254) -- Store which email sent the token to (in case user changed email)
   );
   ```

2. **Add rate limiting:**
   ```javascript
   // In routes/auth.js
   const passwordResetLimiter = rateLimit({
     windowMs: 60 * 60 * 1000, // 1 hour
     max: 3, // Only 3 reset requests per hour
     keyGenerator: (req) => req.body.email || req.ip,
   });
   router.post('/forgot-password', passwordResetLimiter, authCtrl.forgotPassword);
   ```

3. **Add verification step (optional but recommended):**
   - Send reset link to primary email: "Click here to reset password"
   - Add secondary check: "Type your current password or answer security question"
   - This prevents attackers from resetting if they don't have primary email

4. **Secure reset token:**
   ```javascript
   // authController.js - forgotPassword()
   const resetToken = crypto.randomBytes(32).toString('hex');
   const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
   
   await pool.query(
     `UPDATE users 
      SET password_reset_token = $1, password_reset_expires_at = NOW() + interval '1 hour',
          password_reset_email = $2
      WHERE email = $3`,
     [tokenHash, email, email]
   );
   
   // Send email with reset link (token is NOT hashed in email, user needs readable token)
   // Email: "Click here to reset: https://oxsteed.com/reset-password?token={resetToken}"
   
   // On reset:
   const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
   const { rows } = await pool.query(
     `SELECT id FROM users 
      WHERE password_reset_token = $1 
        AND password_reset_expires_at > NOW()
        AND deleted_at IS NULL`,
     [tokenHash]
   );
   // If no match: token invalid or expired
   ```

5. **Add email verification step:**
   - Require user to also enter their username or answer security question
   - Prevents: "I reset the password but I don't remember my email" → account takeover

**Effort:** 5 hours | **Priority:** HIGH

---

## 2. HIGH-PRIORITY FINDINGS (FIX WITHIN 30 DAYS)

### 🟠 2.1 Outdated/Vulnerable Dependencies (HIGH SEVERITY)

**Issue:** Several dependencies have known vulnerabilities or are outdated.

**Current Packages:**
```json
{
  "jest": "^30.3.0",           // ⚠️ Check for known vulnerabilities
  "stripe": "^14.0.0",         // ⚠️ 2+ versions old (current 18.0.0)
  "multer": "2.1.1",           // ⚠️ Check for recent CVEs
  "nodemailer": "^8.0.5",      // ⚠️ Check latest
  "bcrypt": "6.0.0",           // ✅ Recent
  "helmet": "^7.1.0",          // ✅ Recent
  "express": "^4.18.0"         // ✅ OK but 4.19+ available
}
```

**Remediation:**
1. **Run npm audit:**
   ```bash
   npm audit --audit-level=moderate
   npm audit fix --audit-level=moderate
   npm update  # Update within current semver ranges
   ```

2. **Automated dependency checking:**
   - Use Dependabot (GitHub) or Renovate (GitLab) to auto-create PRs for updates
   - Set: Update on weekly basis, auto-merge patch/minor if tests pass

3. **Monitor for CVEs:**
   - Subscribe to SNYK (npm advisory alerts)
   - Run `npm audit` in CI/CD pipeline (fail build on high CVEs)

**Effort:** 2 hours | **Priority:** HIGH

---

### 🟠 2.2 CORS Configuration Too Permissive (MEDIUM SEVERITY)

**Finding:** CORS allows all origins from `CORS_ORIGINS` env var, but default is `CLIENT_URL` only.

**Current Code:**
```javascript
// server/index.js line 122-123
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',').map(o => o.trim());

// Then:
app.use(cors({ origin: allowedOrigins, credentials: true }));
```

**Risks:**
- If `CORS_ORIGINS` is set to wildcard (`*`), credentials are leaked (contradicts `credentials: true`)
- If `CLIENT_URL` is misconfigured, other origins can make authenticated requests
- No validation that origins are valid URLs

**Fix:**
```javascript
// Strict CORS configuration
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL, // https://oxsteed.com
  process.env.ADMIN_URL,  // https://admin.oxsteed.com (if separate)
  // Never allow: *, localhost (except dev), or untrusted domains
];

// Validate on startup
ALLOWED_ORIGINS.forEach(origin => {
  if (!origin || typeof origin !== 'string' || !origin.startsWith('https://')) {
    throw new Error(`Invalid CORS origin: ${origin}. Must be https:// URL.`);
  }
});

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
  optionsSuccessStatus: 200,
}));
```

**Effort:** 1 hour | **Priority:** MEDIUM

---

### 🟠 2.3 Socket.IO Authentication Has Room Bypass Risk (MEDIUM SEVERITY)

**Finding:** Socket.IO rooms are server-assigned correctly, but there's no validation that client doesn't try to listen to unauthorized rooms.

**Current Code (Good):**
```javascript
// server/index.js lines 178-196
socket.on('join', () => {}); // Ignore client-side join requests

socket.on('conversation:join', (conversationId) => {
  // Check DB membership before allowing join
  const isMember = await pool.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, socket.userId]
  );
  if (!isMember.rows.length) {
    socket.emit('error', 'Not a member of this conversation');
    return;
  }
  socket.join(`conv_${conversationId}`);
});
```

**Issue:** What if a handler emits events without checking membership?

```javascript
// ❌ BAD - No check:
socket.on('conversation:message', (conversationId, message) => {
  // Should check: Is socket.userId a member of conversationId?
  // Currently: Just broadcasts to conv_{conversationId} room
  io.to(`conv_${conversationId}`).emit('message', message);
});

// ✅ GOOD - Check first:
socket.on('conversation:message', async (conversationId, message) => {
  const isMember = await pool.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 LIMIT 1',
    [conversationId, socket.userId]
  );
  if (!isMember.rows.length) {
    socket.emit('error', 'Not a member of this conversation');
    return;
  }
  io.to(`conv_${conversationId}`).emit('message', message);
});
```

**Remediation:**
1. **Audit all socket handlers** that send/receive messages
2. **Template for all handlers:**
   ```javascript
   socket.on('event:name', async (data) => {
     // 1. Validate input
     if (!data.conversationId) return socket.emit('error', 'Missing conversationId');
     
     // 2. Check membership/ownership
     const resource = await pool.query(
       'SELECT id FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 LIMIT 1',
       [data.conversationId, socket.userId]
     );
     if (!resource.rows.length) return socket.emit('error', 'Unauthorized');
     
     // 3. Process event
     // ...
   });
   ```

3. **Add Jest tests** for each handler:
   ```javascript
   test('user cannot send message to conversation they are not in', async () => {
     // Emit message to unAuthorized conversation
     // Assert: error returned, message NOT broadcast
   });
   ```

**Effort:** 4 hours | **Priority:** MEDIUM

---

### 🟠 2.4 Missing Input Sanitization for NoSQL-like Queries (LOW-MEDIUM SEVERITY)

**Finding:** Database queries use parameterized queries (✅ SQL injection protected), but some code constructs WHERE clauses dynamically without sanitization.

**Example (lookfor patterns):**
```javascript
// ❌ POTENTIALLY RISKY
const { sortBy } = req.query; // Could be anything
const query = `SELECT * FROM jobs ORDER BY ${sortBy}`; // No validation
// If sortBy = "id; DROP TABLE jobs; --" → exploitable

// ✅ SAFE (current approach)
const ALLOWED_SORTS = ['created_at', 'price', 'status'];
if (!ALLOWED_SORTS.includes(sortBy)) throw new Error('Invalid sort');
const query = `SELECT * FROM jobs ORDER BY ${sortBy}`;
```

**Remediation:**
1. **Review all `.query()` calls** for dynamic SQL construction
2. **Use parameterized values** where possible:
   ```javascript
   // ❌ BAD
   const query = `SELECT * FROM jobs WHERE status = '${status}'`;
   
   // ✅ GOOD
   const query = `SELECT * FROM jobs WHERE status = $1`;
   await pool.query(query, [status]);
   ```

3. **For column names, use allowlist:**
   ```javascript
   const VALID_SORT_COLUMNS = {
     'created_at': 'j.created_at',
     'updated_at': 'j.updated_at',
     'price': 'j.job_value',
     'status': 'j.status',
   };
   
   const sortColumn = VALID_SORT_COLUMNS[sortBy] || 'j.created_at';
   const query = `SELECT * FROM jobs j ORDER BY ${sortColumn}`;
   ```

**Effort:** 3 hours (code review + testing) | **Priority:** LOW-MEDIUM

---

### 🟠 2.5 Missing Content Security Policy (CSP) Improvements (MEDIUM SEVERITY)

**Finding:** CSP is implemented but could be stricter.

**Current CSP:**
```javascript
// server/middleware/securityHeaders.js
styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
```

**Issues:**
- `'unsafe-inline'` for styles allows inline CSS → XSS if HTML injection occurs
- `https:` for images is too permissive (any HTTPS image)
- `data:` URLs for images could be abused

**Remediation:**
1. **Tighten style sources:**
   ```javascript
   // Instead of 'unsafe-inline', use nonce:
   styleSrc: ["'self'", 'https://fonts.googleapis.com', `'nonce-${nonceValue}'`],
   // Generate random nonce per request, add to <style nonce="...">
   ```

2. **Restrict image sources:**
   ```javascript
   imgSrc: ["'self'", 'https://images.oxsteed.com', 'data:', 'blob:'],
   // Only trusted image domains
   ```

3. **Add `report-uri` for violations:**
   ```javascript
   reportUri: 'https://oxsteed.report-uri.com/r/d/csp/reportOnly',
   // Track CSP violations for XSS attempts
   ```

**Effort:** 2 hours | **Priority:** MEDIUM

---

### 🟠 2.6 Missing HTTPS Enforcement (LOW SEVERITY IF BEHIND LB, HIGH IF NOT)

**Finding:** `server/middleware/securityHeaders.js` sets HSTS (HTTP Strict Transport Security), but:
- Production must ALWAYS use HTTPS
- If ANY request reaches the server over HTTP, attacker can strip HSTS header → downgrade to HTTP

**Remediation:**
1. **Configure load balancer/reverse proxy (Render, AWS, etc.):**
   - Redirect all HTTP → HTTPS
   - Enforce TLS 1.2 minimum

2. **Add server-side enforcement:**
   ```javascript
   // server/index.js
   app.use((req, res, next) => {
     if (process.env.NODE_ENV === 'production' && req.get('x-forwarded-proto') !== 'https') {
       return res.redirect(`https://${req.get('host')}${req.url}`);
     }
     next();
   });
   ```

3. **Verify in Render/deployment:**
   - Check: Load balancer settings, SSL/TLS termination, redirect rules

**Effort:** 1 hour | **Priority:** LOW (if using managed LB) to HIGH (if not)

---

### 🟠 2.7 API Key Management for Third-Party Services (MEDIUM SEVERITY)

**Finding:** Multiple third-party API keys are in `.env`:
- DIDIT_API_KEY
- CHECKR_API_KEY
- OPENROUTER_API_KEY
- TWILIO credentials
- RESEND_API_KEY

**Risks:**
- If `.env` is leaked, all 3rd-party integrations are compromised
- No way to rotate without redeploying
- No audit trail of which endpoints use which keys

**Remediation:**
1. **Move to Secrets Manager** (see §1.2 for details)

2. **Implement API key wrapper:**
   ```javascript
   // services/apiKeyManager.js
   async function getThirdPartyKey(serviceName) {
     const secret = await secretsManager.getSecret(`third-party/${serviceName}`);
     return secret.apiKey;
   }
   
   // Usage:
   const diditKey = await getThirdPartyKey('didit');
   ```

3. **Add API key versioning:**
   - Maintain current + 1 backup key
   - Rotate monthly
   - Alert if old key is used (potential security issue)

**Effort:** 4 hours | **Priority:** MEDIUM

---

### 🟠 2.8 Missing Backup & Disaster Recovery Testing (CRITICAL FOR OPS)

**Finding:** While not explicitly checked in code review, there's no evidence of:
- Automated daily database backups
- Tested backup restoration (backups that can't be restored = useless)
- Backup encryption (backups with PII must be encrypted)
- Backup retention policy (how long to keep)
- RTO/RPO targets documented

**Risk:** Database corruption or loss = total data loss, business shutdown

**Remediation:**
1. **Implement automated backups:**
   ```bash
   # Daily backup to S3 with retention
   0 2 * * * pg_dump $DATABASE_URL | gzip | aws s3 cp - s3://oxsteed-backups/$(date +%Y-%m-%d).sql.gz --sse AES256
   ```

2. **Test restoration monthly:**
   - Spin up test DB from backup
   - Verify data integrity
   - Document RTO (how long to restore): target <4 hours
   - Document RPO (data loss acceptable): target <24 hours

3. **Backup encryption:**
   - Use `--sse AES256` for S3 (see above)
   - Alternatively: GPG encrypt locally before uploading

4. **Retention policy:**
   - Keep daily backups for 30 days
   - Keep weekly backups for 1 year
   - Keep monthly for 7 years (compliance)

**Effort:** 4 hours (setup) + 1 hour (monthly testing) | **Priority:** CRITICAL

---

## 3. MEDIUM-PRIORITY FINDINGS (FIX WITHIN 60 DAYS)

### 🟡 3.1 Insufficient Data Leak Prevention (MEDIUM SEVERITY)

**Finding:**
- No data loss prevention (DLP) policy
- No row-level security (RLS) in database
- Admins can access all user data without audit trail
- No column-level encryption

**Remediation:**
1. **Define data classification:**
   - PUBLIC: Skill names, helper ratings (no protection needed)
   - INTERNAL: Email, phone, timestamps (encrypt if possible)
   - SENSITIVE: SSN, bank, ID docs (encrypt + restrict access)
   - SECRET: Passwords, tokens (hash + encrypt + restrict access)

2. **Implement column-level encryption:**
   ```sql
   -- Sensitive columns use pgcrypto
   CREATE EXTENSION pgcrypto;
   
   ALTER TABLE users ADD COLUMN ssn_encrypted bytea;
   -- Decrypt only when needed: pgp_sym_decrypt(ssn_encrypted, encryption_key)
   ```

3. **Database audit trail:**
   - Enable PostgreSQL audit logging (pgaudit extension)
   - Log: Who accessed what table, when, what data they read
   - Alert if admin queries sensitive tables

4. **Role-based access control (RBAC):**
   - Restrict database user roles: readonly, support, admin
   - `SELECT * FROM users` available to admins only
   - Support agents get view with filtered columns (no SSN/bank)

**Effort:** 8 hours | **Priority:** MEDIUM

---

### 🟡 3.2 Missing Two-Factor Authentication (2FA) Enforcement (MEDIUM SEVERITY)

**Finding:** 2FA is implemented (`twoFactor` routes exist), but:
- Not required for admin/super-admin accounts
- Not required for accounts with access to payment data
- No backup codes if authenticator app is lost
- No enforcement policy

**Remediation:**
1. **Require 2FA for admins:**
   ```javascript
   // middleware/auth.js
   if (['admin', 'super_admin'].includes(req.user.role) && !req.user.totp_enabled) {
     return res.status(403).json({
       error: 'MFA required for admin accounts',
       code: 'MFA_REQUIRED',
       setupUrl: '/setup-2fa',
     });
   }
   ```

2. **Add backup codes:**
   ```javascript
   // When 2FA is enabled, generate 10 recovery codes
   const backupCodes = [];
   for (let i = 0; i < 10; i++) {
     backupCodes.push(crypto.randomBytes(4).toString('hex'));
   }
   // Store hashed codes in database for recovery
   ```

3. **Enforcement policy:**
   - Super-admin: MFA required immediately
   - Admin: MFA required within 7 days
   - Helper (Tier 2+): MFA optional but recommended

**Effort:** 3 hours | **Priority:** MEDIUM

---

### 🟡 3.3 Missing Security Monitoring Dashboard (MEDIUM SEVERITY)

**Finding:** No centralized security monitoring. Events are logged to files/console only.

**Remediation:**
1. **Implement Datadog or equivalent:**
   ```javascript
   // npm install @datadog/browser-rum
   
   // Track:
   - Authentication events (success, failure, MFA)
   - Admin actions (user delete, permission grant)
   - Payment events (capture, refund, chargeback)
   - Rate limit breaches
   - Error spikes (possible DDoS/attack)
   ```

2. **Create security dashboard:**
   - Failed login attempts (last 24h)
   - Admin actions (audit trail)
   - Rate limit events
   - Error rate trend
   - Payment processing errors

3. **Alert rules:**
   ```
   IF failed_logins > 10 in 5 min THEN alert("Brute force attempt")
   IF admin_action_count > 100 in 1 hour THEN alert("Unusual admin activity")
   IF error_rate > 5% THEN alert("System degradation")
   ```

**Effort:** 6 hours | **Priority:** MEDIUM

---

### 🟡 3.4 Missing Security Documentation (LOW-MEDIUM SEVERITY)

**Finding:** No security policies/procedures documented for:
- Data handling (PII, payment data)
- Access control (who can access what)
- Incident response (see §1.4)
- Acceptable use policy
- Security training requirements

**Remediation:**
1. **Create security documentation:**
   - `docs/SECURITY.md` - Overview of security controls
   - `docs/DATA_CLASSIFICATION.md` - How we classify and protect data
   - `docs/INCIDENT_RESPONSE.md` - What to do if breach/attack
   - `docs/ACCEPTABLE_USE.md` - What users can/cannot do
   - `docs/ACCESS_CONTROL.md` - Who has access to what systems

2. **Add to onboarding:**
   - New developers: Sign security agreement, read SECURITY.md
   - New admins: Complete security training (2FA, password mgmt, data handling)

**Effort:** 4 hours | **Priority:** LOW-MEDIUM

---

## 4. LOW-PRIORITY RECOMMENDATIONS (NICE-TO-HAVE)

### 🟢 4.1 Implement Security Headers (ADDITIONAL)

Currently implemented (✅), but could add:
- `Permissions-Policy`: Control which browser features can be used (camera, microphone, etc.)
- `X-Content-Type-Options: nosniff`: Already set (✅)
- `X-Frame-Options: DENY`: Already set (✅)

### 🟢 4.2 Implement Dependency Security Scanning

Use SNYK or Dependabot to automatically:
- Scan for vulnerable packages weekly
- Auto-create PRs with fixes
- Fail CI/CD build if high CVE found

### 🟢 4.3 Implement Security Code Reviews

Before merging security-sensitive PRs:
- At least 2 approvals from security-trained reviewers
- Checklist: input validation, auth checks, logging, error handling

### 🟢 4.4 Implement Rate Limiting for Admin Panel

Currently: Admin endpoints have no special rate limiting. Could add stricter limits for admin API.

### 🟢 4.5 Implement Security Testing

- Add SAST (static analysis): SonarQube, Snyk
- Add DAST (dynamic analysis): ZAP, Burp
- Run on every merge request

---

## 5. SUMMARY OF CRITICAL ISSUES

| # | Issue | Severity | Effort | Due |
|---|-------|----------|--------|-----|
| 1.1 | Encryption at rest | 🔴 CRITICAL | 15h | Pre-prod |
| 1.2 | Secrets rotation | 🔴 CRITICAL | 10h | Pre-prod |
| 1.3 | Audit trail | 🔴 CRITICAL | 12h | Pre-prod |
| 1.4 | Incident response | 🔴 CRITICAL | 6h | Pre-prod |
| 1.5 | Password reset | 🟠 HIGH | 5h | Week 1 |
| 2.1 | Dependency updates | 🟠 HIGH | 2h | Week 1 |
| 2.2 | CORS config | 🟠 HIGH | 1h | Week 1 |
| 2.3 | Socket.IO rooms | 🟠 HIGH | 4h | Week 2 |
| 2.4 | Input sanitization | 🟠 MEDIUM | 3h | Week 2 |
| 2.5 | CSP hardening | 🟠 MEDIUM | 2h | Week 2 |
| **TOTAL CRITICAL** | | | **43h** | **Before launch** |
| **TOTAL HIGH** | | | **15h** | **Week 1** |

---

## 6. SECURITY CHECKLIST FOR PRODUCTION DEPLOYMENT

Before deploying to production, verify:

- [ ] All critical issues (§1) are fixed and tested
- [ ] Secrets Manager is configured (not .env files)
- [ ] Database backups are automated and tested
- [ ] Audit logging is enabled and working
- [ ] Incident response runbook is documented and team trained
- [ ] SSL/TLS is enforced (HTTPS only)
- [ ] CORS is restricted to known domains
- [ ] Rate limiters are active (not disabled for testing)
- [ ] Authentication/authorization tests pass
- [ ] Payment processing is tested with Stripe test cards
- [ ] Monitoring/alerting is configured
- [ ] Sentry error tracking is enabled
- [ ] Security headers are verified (CSP, HSTS, X-Frame-Options, etc.)
- [ ] Dependencies are up-to-date (`npm audit` passes)
- [ ] Admin accounts have 2FA enabled
- [ ] Database is encrypted at rest (if using AWS RDS: enable encryption)
- [ ] All environment variables are in Secrets Manager (not .env)
- [ ] Firewall rules restrict database access to app servers only
- [ ] Backup restoration has been tested
- [ ] Load testing has been completed (verify no security regressions)

---

## 7. ONGOING SECURITY PRACTICES

After launch, maintain security with:

1. **Weekly:**
   - Check security alerts (Sentry, Datadog, monitoring)
   - Review rate limit events
   - Verify backups completed

2. **Monthly:**
   - Rotate encryption keys (if not automatic)
   - Audit admin access logs
   - Test backup restoration
   - Review failed authentication patterns
   - Update dependencies (`npm update`)
   - Security team huddle

3. **Quarterly:**
   - Penetration testing (or contract with 3rd party)
   - Compliance audit (SOC 2, GDPR, state law requirements)
   - Security training refresh for team

4. **Annually:**
   - Full security audit (external preferred)
   - Disaster recovery drill
   - Update incident response procedures
   - Review and update security documentation

---

## 8. CONTACTS & ESCALATION

**Security Incidents:**
- Immediate: Slack #security-incidents (private)
- Escalation: Contact CEO + Legal
- Response: See `docs/INCIDENT_RESPONSE.md`

**Security Questions:**
- Team: Ox (security lead) + ops team
- External: Consult with lawyer (data breach), accountant (compliance)

---

**Report Prepared:** 2026-05-10  
**Next Review:** 2026-06-10 (30 days)  
**Status:** PRODUCTION-READY WITH CRITICAL FIXES PENDING

