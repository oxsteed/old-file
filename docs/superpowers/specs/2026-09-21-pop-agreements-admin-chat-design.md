# Proof of Payment, Agreements & Admin Chat Access — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: old-files-claude  
Surfaces: profile messenger dock, helper/business inbox threads, admin Conversations (break-glass)

## Problem

Quotes are first-class in live helper/business chat. Operators still need:

1. **Proof of payment (POP)** shareable in the same thread (image/PDF or structured reference).
2. **Agreements / terms** shareable with Acknowledge / Accept / Decline + durable acceptance evidence.
3. **Admin access** to helper↔customer and business↔customer threads (messages, quotes, POPs, agreements, bookings) when support requires it.
4. Messaging security comparable to **Telegram cloud chats** — membership-enforced, server-stored — while preserving **admin break-glass** (so **not** Telegram secret-chat / true E2EE).

## Goals

1. Provider or customer can attach/share a POP artifact in the live thread.
2. Timeline card: view, authorized download, status (`submitted` / `confirmed` / `rejected`) when the provider can confirm.
3. Share agreement document or structured terms card; customer can Acknowledge / Accept / Decline (auth or OTP guest) with timestamp + identity recorded.
4. Revise / re-share supersedes prior agreement version (mirror quotes-in-chat).
5. Admin can search/view threads and linked artifacts only via audited break-glass endpoints (reason required).
6. Conversation membership enforced on every message / attachment / quote / POP / agreement fetch; guest tokens scoped; no public unguessable-only attachment URLs without authz.

## Non-goals

- True end-to-end encryption (secret chat) — incompatible with required admin access.
- Full accounting / payment processor redesign.
- Replacing Business Hub legal/contract tooling outside chat.

## Security model: Telegram cloud-chat analogue (not secret chat)

### Why not E2EE

Admin support, dispute review, and compliance require the platform to read thread content and artifacts. Telegram **secret chats** are device-to-device E2EE and intentionally inaccessible to Telegram (and thus to any admin). That model **cannot** satisfy requirement (3).

We therefore implement the **cloud chat** analogue:

| Property | Telegram cloud chat | OxSteed chat (this design) |
|---|---|---|
| Storage | Server-side | PostgreSQL + private object storage |
| Access control | Chat membership | Conversation / guest-session membership on every read |
| Admin access | Telegram support (limited) | Explicit **break-glass** with reason → `admin_conversation_access_log` + `admin_audit_log` |
| Attachments | Auth-gated | Signed short-lived URLs only after membership check |
| Guest access | N/A | OTP-verified guest tokens scoped to one session |

### Threat model (summary)

**In scope / mitigated**

- Unauthorized users reading another thread → membership checks on all artifact APIs.
- Guessable public attachment URLs → store keys privately; download via authorized endpoint that re-checks membership and issues short-lived signed URLs.
- Guest token reuse across sessions → token bound to `guest_session_id`.
- Silent admin snooping → break-glass requires non-empty reason; every open logged (who / when / why / conversation).
- Abuse of share/accept → rate limits on share / respond / confirm endpoints.
- Sensitive types leaking into app logs → optional `sensitive` flag; non-admin logs redact POP amounts / agreement body.

**Out of scope / residual**

- Compromised admin account with break-glass privilege (mitigated by audit + super-admin review, not crypto).
- Compromised application DB / object-store credentials (standard infra controls).
- Client device compromise after download.
- Metadata visible to admins who already have break-glass (by design).

## Approach

Structured chat markers (same family as `[quote:…]` / `[attachment:…]`):

```
[pop:id|status|amount_cents|method_enc|txn_enc|paid_on|quote_kind|quote_id]
[agreement:id|token|status|version|title_enc]
```

Human-readable preface may precede the marker; UI strips marker and renders `ProofOfPaymentCard` / `AgreementCard`.

### Related expansions (in scope when natural)

- Link POP → quote / booking when context exists (`quote_kind`, `quote_id`, `booking_request_id`).
- Optional **agreement required before schedule**: if the thread has a non-superseded agreement marked `required_before_schedule`, `scheduleFromQuote` / availability confirm refuses until status is `accepted` (or `acknowledged` when only ack is required).

## Data model (migration 534)

- `chat_proof_of_payments` — amount, method, txn id, paid_on, status, attachment key/name/mime/size, conversation / guest session, quote/booking links, submitted_by, confirmed_by, notes.
- `chat_agreements` — title, body/terms, version, parent_id, status, token, attachment, required_before_schedule, conversation / guest, shared_by, superseded_at.
- `chat_agreement_responses` — agreement_id, action (`acknowledge`|`accept`|`decline`), actor user/guest identity, ip hash, user agent, created_at (append-only evidence).
- `admin_conversation_access_log` — admin_id, conversation_id (nullable for guest inquiry), guest_session_id, reason, ip, user_agent, created_at.

## API sketch

### Chat (membership / guest scoped)

- `POST /api/chat/pop/share` — create + post marker (upload optional via multipart or prior attachment key)
- `GET  /api/chat/pop/:id` — card payload
- `GET  /api/chat/pop/:id/download` — authorized signed URL / stream
- `POST /api/chat/pop/:id/confirm` — provider confirm | reject
- `POST /api/chat/agreements/share` — create-or-revise + post marker
- `GET  /api/chat/agreements/:id` — card payload (+ token)
- `POST /api/chat/agreements/:id/respond` — acknowledge | accept | decline
- `POST /api/chat/agreements/:id/revise` — new version + optional re-share
- `GET  /api/chat/agreements/:id/download` — authorized attachment download

Guest auth: same headers as messenger (`X-Guest-Profile-Token`, `X-Guest-Session-Id`).

### Admin (break-glass)

- `GET  /api/admin/super/conversations` — list/search (already audited lightly)
- `POST /api/admin/super/conversations/:id/break-glass` — body `{ reason }` (min length) → writes access log, returns thread + quotes + POPs + agreements + bookings
- `GET  /api/admin/super/conversations/:id` — requires `?reason=` (same min length); preferred path for UI after prompt
- Guest inquiries: `GET /api/admin/super/guest-inquiries/:id?reason=`

Do **not** expose these controls in normal helper UI.

## Client

- `messengerPop.js` / `messengerAgreements.js` — marker build/parse (tested)
- `ProofOfPaymentCard.jsx`, `PopSharePanel.jsx`
- `AgreementCard.jsx`, `AgreementSharePanel.jsx`
- Wire `MessageBubble`, `ConversationThread`, `GuestInquiryPanel`, `ChatPanel`
- Admin `ConversationsAdmin`: reason modal before open; show linked POP/agreement/quote panels

## i18n

Keys under `helperProfile.messenger.pop*`, `helperProfile.messenger.agreement*`, and `messages.popShare*` / `messages.agreementShare*` in en/es/fr/ht/ar.

## Success criteria

- POP share + confirm/reject + authorized download in helper and business threads
- Agreement share + acknowledge/accept/decline with evidence rows; revise supersedes
- Admin thread open requires reason and is logged; linked artifacts visible
- Membership denied for non-participants; guest scoped
- `test:messenger-dock` + `verify:i18n` green; server unit tests for markers, authz helpers, accept flows, admin audit reason gating
