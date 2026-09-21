# Guest Live Profile Chat — Implementation Plan

> Spec: `docs/superpowers/specs/2026-09-21-guest-live-profile-chat-design.md`  
> Branch: `old-files-claude` · Ship end-to-end guest verify + live when online + offline/AI fallback.

**Goal:** Verified guests can live-chat a helper/business when online (parity with support guest rigor, separate stores).

**Architecture:** Extend `/api/chat/sessions/guest*` + `guest_profile_chat_*` tables; open live gate in `profileChatMessage` for verified guests; allow guest token on `/chat` socket; OTP UI in MessengerGuestGate; i18n ×5.

**Tech:** Express, Postgres migrations, Socket.IO `/chat`, React messenger dock, Resend email (existing), node:test.

## Constraints

- Do **not** merge into `support_conversations`.
- Prefer `/api/chat/…` over expanding `/api/guest-chat`.
- No CloudAgent; work on `old-files-claude`; push commits.
- i18n all 5 locales with any new keys.

## File map

| Area | Files |
|---|---|
| Migration | `server/migrations/532_guest_profile_chat_verification.sql` |
| OTP/token helpers | `server/services/guestProfileChatVerification.js` (new) |
| Controllers | `server/controllers/chatController.js` (verify endpoints + live gate) |
| Routes | `server/routes/chat.js` |
| Rate limits | `server/middleware/rateLimiter.js` |
| Socket | `server/realtime/chatNamespace.js` (+ maybe `bootstrap/realtime.js` if needed) |
| Client state | `messengerDockState.js`, `MessengerGuestGate.jsx`, `PublicProfileMessenger.jsx`, `ChatPanel.tsx` |
| Locales | `client/src/locales/{en,es,fr,ht,ar}.json` |
| Tests | `server/__tests__/guestProfileChatVerification.test.js`, `client/scripts/messengerDock.test.mjs` |
| Docs | `docs/PLATFORM_VS_PROFILE_CHAT_COMPARISON.md` |

---

## Task 0: Design + plan commit

- [x] Spec + this plan
- [ ] Commit: `docs: guest live profile chat design and plan`

## Task 1: Migration + verification service

- [ ] Columns on `guest_profile_chat_inbound`: `guest_access_token_hash`, `guest_token_expires_at`, `guest_verified_at`, `verification_status`
- [ ] Table `guest_profile_chat_verifications` (session_id, email, code_hash, attempts, expires_at, consumed_at)
- [ ] Allow nullable/placeholder `message` for pending verify sessions
- [ ] Service: hash, OTP generate/compare, send email (reuse `utils/email`), create/start session, verify, resend, loadSessionByToken
- [ ] Unit tests: token binding to helperId/businessId; OTP attempt/expiry; reject cross-profile
- [ ] Commit: `feat(profile-chat): guest OTP verification schema and helpers`

## Task 2: API endpoints + live gate

- [ ] `POST /api/chat/sessions/guest/verify/start|verify|resend` with OTP rate limits
- [ ] Middleware/helper to resolve `Authorization: Guest <token>` (+ session id) on `profile-message`
- [ ] Live path: `(userId || verifiedGuest)` && online && destination=helper → persist guest live message + notify; else AI with `mode: offline_ai` / clear helperOnline
- [ ] Commit: `feat(profile-chat): guest verify APIs and live path for verified guests`

## Task 3: Socket guest auth on `/chat`

- [ ] `createChatAuthenticator` accepts guestToken + guestSessionId (mirror support carefully)
- [ ] Guests join `guest_session_<id>` only; no presence as provider
- [ ] Commit: `feat(realtime): allow verified profile guest tokens on /chat`

## Task 4: Client OTP + live/offline UI

- [ ] Gate phases: contact → otp → verified; store token/sessionId in sessionStorage
- [ ] ChatPanel: Guest auth header; live waiting when online; offline/AI banner; keep claim-on-login
- [ ] Soften/replace JWT guest-token decode with opaque token pair
- [ ] i18n en/es/fr/ht/ar
- [ ] Commit: `feat(messenger-dock): guest OTP gate and live/offline states`

## Task 5: Tests, comparison doc, push

- [ ] Extend messengerDock tests for otp phase / verified gate
- [ ] Run `npm run test:messenger-dock` + `npm run verify:i18n` (client)
- [ ] Run guest verification unit tests (server)
- [ ] Update `PLATFORM_VS_PROFILE_CHAT_COMPARISON.md`
- [ ] Commit: `docs(tests): guest live chat parity docs and coverage`
- [ ] Push `old-files-claude`

## Done when

- Guest can verify email on profile dock and chat live when provider online
- Offline shows explicit AI/offline UX + leave message path
- Token cannot access another helper/business session
- `/api/guest-chat` not expanded; support stores untouched
- SHAs pushed; manual QA notes returned
