# Authentication & Backend Build Spec (General Purpose)

This is a reusable specification for building **signup, login, identity verification, and team/workspace access** into any app. Hand this to an AI app builder. Replace the placeholder names in **Configuration** with the values for the specific app you're building.

---

## Configuration (fill this in per app)

| Placeholder | Meaning | Example |
|---|---|---|
| `API_BASE` | Backend base URL. Frontend should call relative `/api/...` so it works in any environment. | `https://yourapp.com/api` |
| `APP_NAME` | Product name shown in emails and UI | `My App` |
| `USER_ROLES` | The list of account types a user can pick at signup | `owner`, `staff`, `customer` |
| `DEFAULT_ROUTE_BY_ROLE` | Where each role lands after auth | `owner → /dashboard`, `customer → /home` |
| `IDENTITY_PROVIDER` | Optional KYC/identity vendor (Didit, Stripe Identity, Persona, etc.) | none / Didit |
| `REQUIRE_LEGAL_NAME_ON_LOGIN` | Whether login requires typing full legal name as an e-signature | true / false |

---

## Core Principles

1. **Relative API paths.** The frontend always calls `/api/...`, never a hardcoded host. The host is resolved by the deployment environment. This keeps dev, staging, and prod identical in code.
2. **No real user until email is verified.** Signup creates a *pending registration*, not a `users` row. The real account is only created after OTP verification. This prevents junk accounts and unverified emails.
3. **Token-based sessions.** Auth returns a short-lived `accessToken` and a long-lived `refreshToken`. The client stores them and attaches the access token to every request.
4. **Role-driven routing.** A single `role`/`mode` field on the user decides which dashboard or home screen they land on. Routing logic lives in one place.
5. **Layered gates.** Email verification, optional 2FA, and optional identity verification are independent gates that a user passes in sequence before reaching protected content.

---

## 1. Signup Flow

**Goal:** Verified email + accepted terms + a real account, created only at the end.

### Step-by-step

1. **User picks a role** from `USER_ROLES`.
2. **User enters profile fields:** first name, last name, email, phone, country, address (street, city, state/region, ZIP/postal), password, and explicitly accepts the terms/privacy.
3. **Frontend → `POST /api/auth/register/start`**
   - Body: all profile fields + role + age confirmation.
   - Backend **validates** email format, password strength, phone, address, country/region/ZIP, role, age, and **duplicate email**.
   - Backend stores a **pending registration** (not a user) and returns a `pendingToken`.
4. **Frontend → `POST /api/auth/register/accept-terms`**
   - Body: `pendingToken` + electronic signature info (typed name, terms version).
   - Backend records terms version, IP address, user-agent, timestamp. Backend generates a **6-digit OTP** and emails it.
5. **User enters the OTP.**
6. **Frontend → `POST /api/auth/register/verify-otp`**
   - Body: `pendingToken` + OTP.
   - Backend verifies the OTP, **creates the real `users` row**, sets `email_verified = true`, stores consent records, creates a session, and returns `accessToken`, `refreshToken`, and the `user` object.
7. **Frontend stores tokens** (e.g. `localStorage`) and **routes by role** using `DEFAULT_ROUTE_BY_ROLE`.
8. If identity verification is enabled, protected routes will redirect to the verification step (see Section 3).

### Endpoints summary
```
POST /api/auth/register/start         → validate + save pending registration, return pendingToken
POST /api/auth/register/accept-terms  → record consent, send OTP email
POST /api/auth/register/verify-otp    → create real user, create session, return tokens + user
```

### Validation requirements (backend)
- Email: valid format, not already registered (check pending + real users).
- Password: minimum length and complexity policy.
- Phone, address, country/region/ZIP: present and well-formed for the chosen country.
- Age: explicit confirmation the user meets the minimum age.
- Terms: must be accepted with a recorded version string.

---

## 2. Login Flow

**Goal:** Authenticate, optionally enforce 2FA, return a usable session.

### Step-by-step

1. **User enters email + password.** If `REQUIRE_LEGAL_NAME_ON_LOGIN` is true, they also check a terms/privacy agreement box and type their **full legal name**.
2. **Frontend → `POST /api/auth/login`**
   - Body: `email`, `password`, and (if required) `termsAgreed: true` + `agreementName`.
3. **Backend validates:**
   - Email + password against the stored password hash.
   - (If required) Terms agreement is present for non-admin accounts.
   - (If required) The typed `agreementName` **matches the account's first + last name**.
4. **If 2FA is enabled** on the account: backend returns `requiresTwoFactor: true` and an `mfaToken` (no session yet). The client then submits the 2FA code with the `mfaToken` to complete login.
5. **Otherwise:** backend creates a session and returns `accessToken` + `refreshToken`.
6. **Frontend stores tokens**, then **calls `GET /api/auth/me`** to load the full user profile.
7. **Routing:** if identity verification is required/pending, send the user to the verification step; otherwise route to their intended destination.

### Endpoints summary
```
POST /api/auth/login        → returns tokens, OR { requiresTwoFactor, mfaToken }
POST /api/auth/login/2fa    → submit code + mfaToken, returns tokens   (if 2FA enabled)
GET  /api/auth/me           → returns full authenticated user profile
```

---

## 3. Session & Token Handling

- **accessToken:** short-lived (e.g. 15 min). Attached to every API request via an `Authorization: Bearer <token>` header (use a request interceptor).
- **refreshToken:** long-lived (e.g. 7 days). Used only to mint new access tokens.
- **Auto-refresh:** when any request returns `401`, the client calls the refresh endpoint, gets a new token pair, and retries the original request. Deduplicate concurrent refreshes so multiple failing requests trigger only one refresh.
- **Refresh rotation:** issuing a new pair invalidates the old refresh token server-side (stored in a `sessions` table).
- **Logout:** invalidates the session server-side and clears tokens client-side.

```
POST /api/auth/refresh  → issues a new accessToken + refreshToken pair
POST /api/auth/logout   → invalidates the session
```

---

## 4. Identity Verification Gate (optional)

If `IDENTITY_PROVIDER` is set, protected routes check a `verification_status` field on the user before allowing access.

- **Accepted states:** `verified` or `skipped`.
- **Strict mode:** if `verification_enforcement_required` is true, only `verified` passes (skipping is disallowed).
- A route guard inspects this status and redirects unverified users to a verification page.

```
POST /api/identity/session  → start a verification session with the provider
GET  /api/identity/status   → poll/read current verification status
POST /api/identity/skip      → mark as skipped (only allowed when not in strict mode)
```

Generalize the provider behind these three endpoints so you can swap Didit / Persona / Stripe Identity without touching the frontend.

---

## 5. Team / Workspace Access (optional — "join an organization")

This is **not a separate auth flow.** A user first creates or logs into a normal account, then connects that account to an organization (business, team, restaurant, etc.) via an access code.

### Flow

1. User signs up / logs in normally.
2. User opens the workspace/join page.
3. If they already belong to organizations, list them from `GET /api/me/organizations`.
4. If they have an **access code** from an owner/manager, they enter it.
5. **Frontend → `POST /api/workspace/preview`** — shows the org name and the role the code grants, before committing.
6. On confirm, **`POST /api/workspace/redeem`** creates or reactivates a membership row.
7. If the code requires approval, membership is `pending`; otherwise `active`.
8. Once active, the user opens the org's workspace.

### Roles an access code can grant
Define these per app. Example: `manager`, `representative`, `employee`, `support_agent`.

### Access-code features to support
- Human-readable codes (e.g. `ORG-XXXXX-XXXXX`).
- Preview before redeem.
- Optional approval step (membership starts `pending`).
- Usage limits, expiration, and rotation.
- Switching between multiple workspaces a user belongs to.

```
GET  /api/me/organizations     → list orgs the user belongs to
POST /api/workspace/preview    → validate code, return org name + granted role
POST /api/workspace/redeem     → create/reactivate membership (active or pending)
```

> Use this same model whenever an app needs owners, managers, staff, or support agents connected to a shared business/team entity.

---

## 6. Data Model (minimum tables)

- **`users`** — id, email, `email_verified`, password hash, first/last name, phone, address fields, country, `role`, `verification_status`, `two_factor_enabled`, timestamps.
- **`pending_registrations`** — token, all signup fields, OTP, OTP expiry, consent/terms version, created_at. Deleted/converted on verify.
- **`sessions`** — user_id, refresh token (or hash), issued_at, expires_at, revoked flag.
- **`consents`** — user_id, terms version, IP, user-agent, signed name, timestamp.
- **(If using workspaces) `organizations`**, **`memberships`** (user_id, org_id, role, status), **`access_codes`** (code, org_id, role, requires_approval, max_uses, expires_at).

---

## 7. Build Checklist

- [ ] All frontend API calls use relative `/api/...` paths.
- [ ] Signup creates a pending registration first; real user only after OTP.
- [ ] OTP is 6 digits, time-limited, single-use, delivered by email.
- [ ] Terms acceptance records version + IP + user-agent + signed name.
- [ ] Login returns access + refresh tokens; supports optional 2FA handoff.
- [ ] `GET /api/auth/me` returns the full profile after login.
- [ ] 401 auto-refresh with concurrent-refresh deduplication.
- [ ] Refresh rotation invalidates old tokens server-side.
- [ ] Role-based routing centralized in one place.
- [ ] (If used) Identity gate: `verified`/`skipped`, strict mode supported.
- [ ] (If used) Workspace access via preview → redeem, with approval/expiry/limits.
- [ ] Rate limiting on auth endpoints; password hashing (bcrypt/argon2); input validation on every endpoint.
