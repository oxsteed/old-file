# Login rate-limit isolation

Authentication throttling is applied once at each route, not to the entire
`/api/auth` mount. Previously that mount used the same limiter as individual
routes, counting a login twice and sharing its budget with session/profile reads.

All windows below are 15 minutes and keyed by IP. Redis prefixes keep operation
budgets separate across instances; the existing memory fallback remains available.

- Password login, login MFA, and internal-access login share 30 requests.
- Refresh and logout share 120 requests, without consuming login attempts.
- Non-authoritative email/ZIP lookups share 60 requests.
- Registration, OTP, and sensitive account mutations retain their 30-request cap.
- Routine profile reads use the existing general/authenticated API limits.

The global API limits still apply. Account-level password lockouts, OTP cooldowns,
passkey throttling, password-recovery limits, CAPTCHA, and authentication checks
are unchanged. Successful requests are still counted; this change does not allow
unlimited password or MFA attempts. HTTP 429 and Retry-After remain available.

Helper registration's `/complete` endpoint is explicitly limited so both its
canonical URL and its `/api/auth/helper/register` alias retain abuse protection
after removal of the shared auth mount.

Regression coverage: `server/__tests__/loginRateLimit.test.js` exercises the real
router and in-memory limiter with synthetic traffic, including exhaustion,
isolation, MFA, IP separation, and recovery/mutation protections. Controller and
session-security suites separately verify authentication and account lockouts.

No frontend, production account, credential, database, or deployment configuration
changes are required. The fix takes effect when the updated API is deployed;
existing account lockouts must still expire normally.
