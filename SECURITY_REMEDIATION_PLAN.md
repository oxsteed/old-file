# OxSteed Security Remediation Plan
**Created:** 2026-05-10  
**Target Completion:** Pre-production (Estimated: 2026-05-30)

---

## Sprint 1: CRITICAL FIXES (Before Production)
**Deadline:** 2026-05-20  
**Owner:** Security Team + Backend Lead

### Task 1.1: Implement Encryption at Rest
- [ ] **Design Phase (2h)**
  - [ ] Create data classification document
  - [ ] Identify all sensitive columns (SSN, bank, IDs, background checks)
  - [ ] Design encryption strategy (field-level vs. table-level)
  - [ ] Choose library: `crypto` (native) vs. `sodium.js` (libsodium) vs. `@hapi/iron`
  
- [ ] **Implementation (10h)**
  - [ ] Create `utils/dataEncryption.js` with encrypt/decrypt functions
  - [ ] Add migration to create encrypted versions of sensitive columns
  - [ ] Update all controllers that read/write sensitive data
  - [ ] Test: encrypt on write, decrypt on read
  - [ ] Verify no sensitive data leaks in logs
  
- [ ] **Testing (3h)**
  - [ ] Unit tests: encrypt/decrypt functions
  - [ ] Integration tests: user registration (password hashing + SSN encryption)
  - [ ] Manual test: query DB directly, verify encrypted data is unreadable
  
- [ ] **Deployment**
  - [ ] Run migration on production
  - [ ] Backfill encrypted values for existing data
  - [ ] Verify no data loss

**Evidence:** All sensitive columns use encrypted values in DB, decrypt only in memory

---

### Task 1.2: Implement Secrets Manager
- [ ] **Setup AWS Secrets Manager (1h)**
  - [ ] Create AWS account / grant access
  - [ ] Create secrets: JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD, STRIPE_SECRET, etc.
  - [ ] Test retrieval from app

- [ ] **Code Changes (6h)**
  - [ ] Create `utils/secretsManager.js`:
    ```javascript
    const SecretsManager = require('@aws-sdk/client-secrets-manager');
    async function getSecret(name) { /* ... */ }
    ```
  - [ ] Update `server/index.js` to call `getSecret()` instead of reading `.env`
  - [ ] Remove STRIPE_SECRET_KEY, JWT_SECRET, etc. from `.env`
  - [ ] Keep only non-sensitive env vars in `.env` (PORT, LOG_LEVEL, etc.)
  
- [ ] **Key Rotation (2h)**
  - [ ] Create Lambda function to rotate JWT_SECRET monthly
  - [ ] Create Lambda function to rotate ENCRYPTION_KEY yearly
  - [ ] Set up CloudWatch rules to trigger rotation
  
- [ ] **Testing (1h)**
  - [ ] Verify app starts with Secrets Manager
  - [ ] Verify key rotation doesn't break running app
  - [ ] Verify old keys still work during grace period

**Evidence:** No secrets in `.env`, all in Secrets Manager with rotation policy

---

### Task 1.3: Implement Audit Logging
- [ ] **Database Schema (2h)**
  - [ ] Create `audit_log` table (see §1.3 for SQL)
  - [ ] Create indexes for fast queries
  - [ ] Run migration on dev, test, prod

- [ ] **Audit Service (5h)**
  - [ ] Create `services/auditService.js`:
    ```javascript
    async function logSecurityEvent(eventType, { actorId, action, resourceType, resourceId, details, ipAddress, userAgent }) {
      // Validate event type
      // Calculate immutable hash
      // Insert into audit_log
      // Alert if severity=critical
    }
    ```
  - [ ] Define event types: login_success, login_fail, mfa_enabled, user_suspended, admin_delete, etc.
  - [ ] Implement alert mechanism (Slack webhook on critical events)

- [ ] **Integration (3h)**
  - [ ] Update `authController.js` to log login attempts
  - [ ] Update `superAdminController.js` to log all admin actions
  - [ ] Update `paymentController.js` to log payment events
  - [ ] Update `webhookController.js` to log webhook failures

- [ ] **Testing (2h)**
  - [ ] Verify events are logged
  - [ ] Verify immutable hash calculation
  - [ ] Test alert delivery

**Evidence:** All security events logged to audit_log, alerts firing on critical events

---

### Task 1.4: Create Incident Response Documentation
- [ ] **Write Runbooks (3h)**
  - [ ] Create `docs/INCIDENT_RESPONSE.md`
  - [ ] Document: Data breach, ransomware, DDoS, credential compromise, database failure
  - [ ] Include: Contact info, escalation path, containment steps, recovery steps
  
- [ ] **Setup Monitoring (2h)**
  - [ ] Configure Slack alerts:
    - 10+ failed logins in 5 min → #security-incidents
    - Admin delete user action → #security-incidents
    - Database error rate >5% → #security-incidents
    - Encryption error → #security-incidents
  
- [ ] **Setup Status Page (1h)**
  - [ ] Use Statuspage.io or Atlassian status page
  - [ ] Create incident template for public communication

**Evidence:** Runbook exists, team trained, alerts configured and tested

---

### Task 1.5: Enhance Password Reset Flow
- [ ] **Database Changes (1h)**
  - [ ] Add columns to users table:
    ```sql
    ALTER TABLE users ADD COLUMN IF NOT EXISTS (
      password_reset_token VARCHAR(64),
      password_reset_expires_at TIMESTAMP,
      password_reset_email VARCHAR(254)
    );
    ```

- [ ] **Implementation (3h)**
  - [ ] Update `authController.forgotPassword()`:
    - Rate limit to 3 requests per hour
    - Generate reset token: `crypto.randomBytes(32).toString('hex')`
    - Hash token before storing: `crypto.createHash('sha256')`
    - Send unhashed token in email link
    - Set expiry: NOW() + 1 hour
  
  - [ ] Update `authController.resetPassword()`:
    - Hash incoming token
    - Verify against stored hash
    - Verify not expired
    - Verify token hasn't been used
    - Update password + invalidate reset token

- [ ] **Testing (1h)**
  - [ ] Unit test: token generation, hashing, verification
  - [ ] Integration test: forgot password → email → reset → login works
  - [ ] Test: expired token returns error
  - [ ] Test: rate limiting (4th request in 1h fails)

**Evidence:** Password reset flow requires valid token, rate-limited, tokens expire

---

## Sprint 2: HIGH-PRIORITY FIXES (Week 1-2)
**Deadline:** 2026-05-27

### Task 2.1: Update Dependencies
```bash
# Run audit
npm audit
npm audit fix

# Update major versions carefully
npm update --save

# Specific updates if needed
npm install stripe@latest --save
npm install @otplib/v12-adapter@latest --save

# Test
npm run test
npm run build
```

**Evidence:** `npm audit` shows no high/critical vulnerabilities

---

### Task 2.2: Tighten CORS Configuration
- [ ] Update `server/index.js`:
  ```javascript
  const ALLOWED_ORIGINS = [
    process.env.CLIENT_URL,
    process.env.ADMIN_URL,
  ];
  
  ALLOWED_ORIGINS.forEach(origin => {
    if (!origin?.startsWith('https://')) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  });
  
  app.use(cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }));
  ```

**Evidence:** CORS restricted to known HTTPS origins, startup fails if config invalid

---

### Task 2.3: Audit Socket.IO Room Access
- [ ] Code review: Check all socket event handlers for membership validation
- [ ] Create test suite:
  ```javascript
  test('user cannot send message to conversation without membership', async () => {
    const socket = createSocket(userId1);
    socket.emit('conversation:message', { conversationId: 999, message: 'hack' });
    // Assert: error returned, broadcast NOT sent
  });
  ```

**Evidence:** All socket handlers validate membership before broadcasting

---

### Task 2.4: Input Sanitization Audit
- [ ] Review all `pool.query()` calls
- [ ] Check for dynamic SQL construction (WHERE, ORDER BY, JOIN)
- [ ] Update any unsafe patterns to use allowlists or parameterization

**Evidence:** No dynamic SQL without parameterization

---

### Task 2.5: Harden CSP
- [ ] Update `middleware/securityHeaders.js`:
  - Remove `'unsafe-inline'` for styles, use nonce instead
  - Restrict image sources to specific domains
  - Add `report-uri` for CSP violations

**Evidence:** CSP report from browser shows no violations

---

## Sprint 3: MEDIUM-PRIORITY FIXES (Week 2-4)
**Deadline:** 2026-06-10

### Task 3.1: Implement Data Leak Prevention
- [ ] Add column-level encryption for sensitive data
- [ ] Configure PostgreSQL audit logging (pgaudit extension)
- [ ] Create RBAC roles in database (readonly, support, admin)

**Evidence:** Admin queries logged, sensitive columns encrypted

---

### Task 3.2: Require 2FA for Admins
- [ ] Update auth middleware to check `totp_enabled` for admin/super_admin roles
- [ ] Add 2FA setup endpoint that generates backup codes
- [ ] Add grace period: admins have 7 days to enable 2FA

**Evidence:** Admin accounts have 2FA enabled or are locked out after 7 days

---

### Task 3.3: Setup Security Monitoring
- [ ] Sign up for Datadog or Sentry
- [ ] Create security dashboard:
  - Failed login attempts (24h)
  - Admin actions (audit trail)
  - Rate limit events
  - Error rate trend
- [ ] Configure alert rules
- [ ] Test alerts (fire test alert, verify notification received)

**Evidence:** Dashboard accessible, alerts firing correctly

---

### Task 3.4: Write Security Documentation
- [ ] Create:
  - `docs/SECURITY.md` - Overview
  - `docs/DATA_CLASSIFICATION.md` - How we classify/protect data
  - `docs/INCIDENT_RESPONSE.md` - What to do if breach
  - `docs/ACCEPTABLE_USE.md` - Rules for users/staff
  - `docs/ACCESS_CONTROL.md` - Who has access to what

**Evidence:** Documentation reviewed by legal, linked from onboarding

---

## Ongoing Tasks (After Production Launch)

### Weekly
- [ ] Check security alerts
- [ ] Verify backups completed
- [ ] Review rate limit events

### Monthly
- [ ] Rotate encryption keys (if manual)
- [ ] Audit admin access logs
- [ ] Test backup restoration
- [ ] Review authentication patterns
- [ ] Update dependencies
- [ ] Security team sync

### Quarterly
- [ ] Penetration testing
- [ ] Compliance audit
- [ ] Security training

### Annually
- [ ] Full security audit (external)
- [ ] Disaster recovery drill

---

## Progress Tracking

| Task | Status | Owner | ETA | Notes |
|------|--------|-------|-----|-------|
| 1.1 Encryption at rest | ⏳ In Progress | Backend Lead | 2026-05-15 | Design phase complete |
| 1.2 Secrets Manager | ⏳ Pending | DevOps | 2026-05-18 | Waiting AWS account |
| 1.3 Audit Logging | ⏳ Pending | Security | 2026-05-20 | Schema designed |
| 1.4 Incident Response | ⏳ Pending | Ox (Security) | 2026-05-17 | Template ready |
| 1.5 Password Reset | ⏳ Pending | Backend | 2026-05-19 | Code changes ready |
| 2.1 Dependencies | ⏳ Pending | Backend | 2026-05-22 | npm audit run |
| 2.2 CORS | ⏳ Pending | Backend | 2026-05-22 | Config ready |
| 2.3 Socket.IO | ⏳ Pending | Backend | 2026-05-25 | Review in progress |
| 2.4 Input Sanitization | ⏳ Pending | Backend | 2026-05-25 | Code review underway |
| 2.5 CSP | ⏳ Pending | Backend | 2026-05-24 | Config updated |

---

## Sign-Off Checklist

Before marking complete, verify:

- [ ] All code changes reviewed by 2+ security-aware developers
- [ ] All tests passing (unit + integration)
- [ ] Load testing shows no regressions
- [ ] Manual testing in staging environment completed
- [ ] Documentation updated
- [ ] Team trained on new processes
- [ ] Incidents/alerts tested and firing correctly

---

**Plan Approved By:** _________________  
**Date:** _________________

