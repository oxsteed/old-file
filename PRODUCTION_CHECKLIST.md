# OxSteed Production Readiness Checklist

Complete this checklist before deploying to production. Use `[ ]` for unchecked and `[x]` for completed.

## Infrastructure & Deployment

- [ ] Database provisioned (PostgreSQL 14+)
- [ ] Redis instance provisioned (for distributed rate limiting)
- [ ] Docker image builds successfully: `docker build .`
- [ ] Environment variables documented in DEPLOYMENT.md
- [ ] All required env vars set (see REQUIRED section in .env.example)
- [ ] Load balancer configured (health check endpoint: `/health`)
- [ ] SSL/TLS certificate configured at load balancer
- [ ] Database backups scheduled (daily minimum)
- [ ] Database backups tested (can be restored)
- [ ] Monitoring/APM configured (Datadog, Sentry, or equivalent)

## Database & Migrations

- [ ] Database schema migrated: `npm run migrate` succeeds
- [ ] All 113 migrations applied successfully
- [ ] `_migrations` table exists and shows all applied migrations
- [ ] Database user has appropriate permissions (not root/admin)
- [ ] Connection pooling configured (default: 10 connections)
- [ ] Query performance monitoring enabled (slow query logs)

## Authentication & Security

- [ ] `JWT_SECRET` is strong (min 32 random characters)
- [ ] `ENCRYPTION_KEY` is set to 32-byte hex string
- [ ] CORS origins configured correctly (no wildcard `*`)
- [ ] HTTPS enforced (redirect HTTP → HTTPS)
- [ ] Security headers enabled (Content-Security-Policy, X-Frame-Options, etc)
- [ ] Rate limiting enabled (5-100 req/15min per IP)
- [ ] CSRF protection enabled
- [ ] SQL injection prevention verified (all queries parameterized)
- [ ] Authentication cookies set to `secure; httponly; samesite=strict`

## Payment Processing

- [ ] Stripe account setup complete
- [ ] Stripe API keys are LIVE (not test keys)
- [ ] Stripe webhook configured (`POST /api/webhooks/stripe`)
- [ ] Stripe webhook secret matches `STRIPE_WEBHOOK_SECRET` env var
- [ ] Stripe Connect enabled (for Tier 3 direct charges)
- [ ] `STRIPE_CONNECT_CLIENT_ID` configured
- [ ] Payment intent capture tested (post job → bid → capture)
- [ ] Refund flow tested (admin cancel job → Stripe refund)
- [ ] Webhook delivery confirmed in Stripe Dashboard
- [ ] PCI compliance audit passed (or delegated to Stripe)

## Email & Notifications

- [ ] Resend API configured with valid key (or equivalent SMTP)
- [ ] Test email sent successfully
- [ ] Email templates render correctly (no broken links)
- [ ] Unsubscribe links work
- [ ] SPF/DKIM/DMARC records configured for domain
- [ ] Emails not going to spam (check deliverability)

## Identity & KYC

- [ ] Didit API key configured and valid
- [ ] Didit webhook secret configured
- [ ] Identity verification flow tested (sign up → Didit → verified)
- [ ] Helper onboarding tested (customer + helper paths)

## File Storage

- [ ] S3 bucket created (or fallback to base64 in DB)
- [ ] S3 permissions configured (app can read/write)
- [ ] File upload tested (profile photo, job media, documents)
- [ ] File download/serving works correctly
- [ ] File size limits enforced (10MB per file)
- [ ] Virus scanning enabled (optional but recommended)

## Real-Time Features

- [ ] Socket.IO configured for production (sticky sessions on load balancer)
- [ ] Redis configured for Socket.IO adapters
- [ ] Typing indicators, presence, and notifications tested
- [ ] WebSocket reconnection works after disconnects

## Logging & Monitoring

- [ ] Structured JSON logging to stdout/stderr
- [ ] Logs aggregated (Datadog, Logtail, Papertrail, ELK, etc)
- [ ] Error tracking configured (Sentry or equivalent)
- [ ] APM configured for performance monitoring
- [ ] Log retention policy set (default: 30 days)
- [ ] Alert configured for critical errors (500s, payment failures)

## Content & i18n

- [ ] All UI text uses i18n keys (no hardcoded English)
- [ ] All 4 languages verified (EN, ES, FR, HT)
- [ ] Translations complete and accurate
- [ ] Date/time formatting respects user's language
- [ ] Special characters render correctly (UTF-8)

## SEO & Public Pages

- [ ] Homepage loads without errors
- [ ] Meta tags present (title, description, og:image)
- [ ] Canonical URLs set correctly
- [ ] Sitemap generated at `/sitemap.xml`
- [ ] Robots.txt configured at `/robots.txt`
- [ ] Public helper profiles indexed (helpers with verified email + onboarding)
- [ ] JSON-LD structured data present (Person, Organization, LocalBusiness)

## API & Integrations

- [ ] All public API endpoints return proper error messages (no 500s)
- [ ] Rate limiting thresholds appropriate for expected load
- [ ] API versioning ready (soft version detection via headers)
- [ ] Pagination limits enforced (max 100 results)
- [ ] Search results limited (Discover, helpers, jobs)
- [ ] Webhook signature verification working (Stripe, Didit)
- [ ] Payment Queue working (if `PAYMENT_CAPTURE_ASYNC=true`)

## Frontend

- [ ] React build completes: `npm run build`
- [ ] Bundle size acceptable (main-*.js < 2.5MB gzipped)
- [ ] No console errors in production build
- [ ] Service Worker registered (offline caching)
- [ ] Error boundaries prevent full-page crashes
- [ ] Fallback error page rendered on network errors
- [ ] Mobile responsive (test on small screens)
- [ ] Dark mode works correctly
- [ ] All links are functional (no 404s)

## First-Time Visitor Flows (CRITICAL)

Test as a NEW user with NO history on the platform:

- [ ] **Homepage**: Loads, hero CTAs work, no JS errors
- [ ] **Browse Helpers**: Search, filter, view profiles (no auth required)
- [ ] **Browse Jobs**: View public job listings (no auth required)
- [ ] **Discover**: Search, view results, save searches (no auth required)
- [ ] **Sign Up (Customer)**: Email → OTP → Didit → dashboard (complete flow)
- [ ] **Sign Up (Helper)**: Email → OTP → Didit → helper dashboard (complete flow)
- [ ] **Login**: Existing user can log back in
- [ ] **Post Job**: Customer creates job, sees it listed, can edit/cancel
- [ ] **Browse Helpers**: See matching helpers for posted job
- [ ] **Send Message**: Customer messages helper, helper sees it
- [ ] **Payment**: Stripe payment intent succeeds, payment recorded
- [ ] **Verify Email**: Email verification link works
- [ ] **Verify Identity**: Didit verification completes
- [ ] **Password Reset**: Forgot password → email link → new password → login

## Load Testing

- [ ] Tested with 50+ concurrent users
- [ ] Database connection pool not exhausted
- [ ] Response time acceptable under load (<500ms p95)
- [ ] No memory leaks detected (check memory growth over 1 hour)
- [ ] Graceful degradation under high load (queuing, rate limiting)

## Backup & Disaster Recovery

- [ ] Database backup schedule: at least daily
- [ ] Backup retention: minimum 30 days
- [ ] Restore from backup tested successfully
- [ ] Recovery Time Objective (RTO): < 1 hour documented
- [ ] Recovery Point Objective (RPO): < 1 day documented
- [ ] Disaster recovery plan documented

## Documentation

- [ ] DEPLOYMENT.md complete and accurate
- [ ] Environment variables documented (REQUIRED vs OPTIONAL)
- [ ] Troubleshooting guide updated
- [ ] Support contact information available
- [ ] Runbook for common incidents created
- [ ] Escalation procedures documented

## Legal & Compliance

- [ ] Terms of Service page deployed and linked
- [ ] Privacy Policy page deployed and linked
- [ ] Cookie consent banner working
- [ ] GDPR compliance verified (if applicable)
- [ ] Payment Terms (Stripe, refund policy) documented
- [ ] Data retention policies documented

## Post-Launch Monitoring (First 24 Hours)

- [ ] Monitor error rates (should be < 0.1% 5xx errors)
- [ ] Check payment processing success rate (should be > 99%)
- [ ] Verify email delivery (check provider dashboard)
- [ ] Check user registrations (expect 0-10% conversion on first day)
- [ ] Monitor database query performance (p95 < 100ms)
- [ ] Check for any unusual traffic patterns
- [ ] Verify Socket.IO connections are stable
- [ ] Test critical user journeys manually (register, post job, pay)

## Sign-Off

- [ ] All checklist items completed
- [ ] All tests passing (npm test)
- [ ] Code reviewed by second person
- [ ] No known critical/blocker bugs
- [ ] Performance acceptable (load test passed)
- [ ] Ready for production launch

**Approved by:** _________________ **Date:** _________

**Deployed to production:** ___________ **Version:** _________

---

## Rollback Plan

If production issues arise:

1. **Critical Error (>1% 5xx)**: Revert to previous stable version
2. **Payment Processing Down**: Disable payments, show maintenance message
3. **Database Corruption**: Restore from last known-good backup
4. **Security Breach**: Invalidate all sessions, force password reset

Estimated rollback time: < 15 minutes
