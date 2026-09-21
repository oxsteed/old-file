# Guest Live Profile Chat — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: `old-files-claude`  
Surfaces: public helper + business profile Messenger Dock

## Goal

Guests on a helper or business public profile can reach **live chat with that provider** after **email verification**, with similar rigor to OxSteed **platform support** guest flow — but scoped to the profile provider and **without** merging `support_conversations` into profile chat stores.

Success looks like:

1. Dock open → guest gate (name + email) → send OTP → verify → guest token bound to that profile conversation.
2. If provider is online and live is allowed (`destination=helper`): live DM/thread with realtime on `/chat`.
3. Otherwise: AI with clear **offline / AI** messaging, plus optional leave-a-message into the existing guest inbound inbox.
4. Claim-on-login remains (verified guest inquiries merge after signup when emails match).

## Non-goals

- Merging profile chat into `support_conversations` / support queue / agent portal.
- Expanding legacy `/api/guest-chat` (retire / avoid for new UI).
- Changing OxSteed destination behavior (still AI-only on profile + handoff CTA to `/support/escalation`).
- New SLA/queue admin for profile threads.

## Current gaps (baseline)

| Area | Today | Target |
|---|---|---|
| Guest gate | Name+email in sessionStorage only | OTP email verify → opaque guest token |
| Live path | Requires authenticated `userId` | Verified guest OR `userId` when provider online |
| Socket `/chat` | JWT users only | Also verified profile guest tokens |
| Offline | Silent AI | Explicit offline/AI copy + leave message |
| Storage | `guest_profile_chat_inbound` unused by messenger send | Extend that stack for verified sessions |

## Flow

```
Dock open
  └─ Authenticated? → thread (existing live/AI routing)
  └─ Guest
       ├─ Phase contact: name + email
       │    POST /api/chat/sessions/guest/verify/start
       │    → creates pending guest_profile_chat_inbound row
       │    → emails 6-digit OTP (reuse email infra from support OTP)
       ├─ Phase otp: enter code (+ resend)
       │    POST /api/chat/sessions/guest/verify
       │    → guestToken (24h), sessionId bound to helperId/businessId
       └─ Phase thread
            ├─ Provider online + destination=helper + live allowed
            │    → live messages on guest session + /chat socket
            └─ Else
                 → AI via profile-message + clear offline/AI banner
                 → optional leave message (persist inbound / first message)
```

Claim-on-login: unchanged `POST /api/chat/sessions/guest/claim` after auth when guest email matches account email.

## API surface (prefer `/api/chat/…`)

Extend profile guest session APIs; **do not** invent a third stack under `/api/guest-chat`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/chat/sessions/guest/verify/start` | public + rate limit | Start/resume pending session; send OTP |
| POST | `/api/chat/sessions/guest/verify` | public + rate limit | Consume OTP → guestToken |
| POST | `/api/chat/sessions/guest/verify/resend` | public + rate limit | Resend OTP |
| POST | `/api/chat/sessions/guest` | public (existing) | Leave message / create inquiry (prefer after verify; still allowed for leave-message) |
| POST | `/api/chat/sessions/guest/claim` | JWT (existing) | Claim after login |
| POST | `/api/chat/profile-message` | optional JWT **or** `Authorization: Guest <token>` + session id | Live when online for verified guests; AI otherwise |

Request/response sketches:

**start**

```json
{ "helperId": "uuid", "businessId": 123, "guestName": "…", "guestEmail": "a@b.com" }
→ { "sessionId": "uuid", "verificationRequired": true, "emailMasked": "a***@b.com", "expiresInSeconds": 900 }
```

**verify**

```json
{ "sessionId": "uuid", "guestEmail": "a@b.com", "code": "123456" }
→ { "guestToken": "hex", "sessionId": "uuid", "expiresInSeconds": 86400, "providerOnline": true|false, "helperId": "uuid", "businessId": 123|null }
```

**profile-message (guest)**

Headers: `Authorization: Guest <token>`, body includes `guestSessionId` (and helperId/businessId as today).  
Live response: `{ "type": "live", "guestSessionId", "helperOnline": true, … }`  
AI response: `{ "type": "ai", "reply", "threadId", "helperOnline": false, "mode": "offline_ai", … }`

## Persistence (profile only)

- Reuse `guest_profile_chat_inbound` + `guest_profile_chat_messages`.
- Add verification columns on inbound (token hash, token expiry, verified_at, status).
- Add `guest_profile_chat_verifications` (code hash, attempts, expiry, consumed) — mirror `support_guest_verifications` patterns, **separate table**.
- Allow pending sessions with placeholder / nullable first message until verify or first send.
- **Do not** write profile guest threads into `support_conversations`.

Live guest messages when provider online:

- Persist on guest session message table (conversations still require `customer_id` for logged-in DMs).
- Notify owner + online reps via existing `profile_chat:new_message` (guestInquiry payload / session id).
- On claim-login, existing claim path can promote into `conversations`.

## Realtime

Mirror support guest handshake carefully on **`/chat`** (not `/support`):

- Handshake `auth: { guestToken, guestSessionId }` OR user JWT.
- Validate `guest_access_token_hash` + `guest_token_expires_at` + session id.
- Bind socket to that session only (`guest_session_<id>`); no cross-profile room joins.
- Guests are **not** counted as provider presence.
- Client `useSocket` / dock: when verified guest token present, connect `/chat` with guest auth (polling allowed like support).

## Live vs AI gating

```
liveAllowed =
  destination === 'helper'
  && allowLiveChat
  && (helperOnline || anyRepOnline)
  && (authenticatedUserId OR verifiedGuestForThisProfile)

else → AI + mode offline_ai / ai_assistant with explicit UI copy
```

Remove the hard `&& userId` live gate for **verified** guests only. Unverified guests never enter live.

Token must be bound to `helper_id` (+ `business_id` when present). Reject if body helperId/businessId disagree with session.

## Security

- OTP: 6 digits, ~15 min TTL, max attempts (5), consume on success.
- Rate limits on start / verify / resend (IP + email keyed), reuse/adapt auth/OTP limiter patterns.
- Guest token: 32-byte random, store SHA-256 hash only, 24h TTL.
- Bind token → session → helperId/businessId; no cross-profile access.
- Timing-safe hash compare (same as support).
- Reuse `emailService.sendEmail` / Resend path used by support OTP.
- Do not leak whether a helper exists beyond existing public profile checks; still require `allow_guest_contact`.

## Client

- `MessengerGuestGate`: contact → OTP → continue (store token + sessionId in sessionStorage keyed by helper/business).
- `PublicProfileMessenger` / `messengerDockState`: phases include `guest_otp`; gate until verified (not merely name+email saved).
- `ChatPanel`: send Guest auth on profile-message; when online show live waiting UI; when offline show clear offline/AI banner + leave-message affordance; keep claim-on-login.
- Replace brittle JWT-shaped `guest-token` localStorage decode with opaque token + sessionId pair.
- i18n: all new strings in **en, es, fr, ht, ar**.

## Tests & docs

- Unit: token binding, destination/online gating, OTP helpers.
- Run `test:messenger-dock` + `verify:i18n`.
- Update `docs/PLATFORM_VS_PROFILE_CHAT_COMPARISON.md` for guest verify + live parity.

## Decisions

- 2026-09-21: Emile approved guest live-chat parity with OxSteed support for helper/business profiles (verified guest sessions + live routing when online + clear offline/AI fallback).
- Prefer extending `/api/chat/sessions/guest*` over `/api/guest-chat`.
- Keep profile and support stores separate.
