# Quotes in Chat — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Surfaces: public profile messenger dock (customer) + helper/business inbox threads (provider)

## Problem

Providers already build business/helper quotes outside chat (Business Hub Quotes, job helper quotes). Customers accept via email/token portal. Profile messenger already supports live threads, guest OTP, and in-dock availability booking — but **quotes are not first-class in the live thread**, so pricing → accept → schedule is fragmented.

## Goals

1. Provider (helper or business owner/rep) can **build or pick a quote** and **share it as a structured quote card** in the live inbox/thread.
2. Customer (auth or OTP-verified guest) can **view line items/total** and **Accept** or **Decline** in-thread.
3. On Accept → **in-dock availability/slot picker** (reuse `MessengerAvailabilityPicker`) → creates **pending booking/appointment** linked to the quote.
4. Both sides see timeline status chips: `quote_sent`, `accepted`, `declined`, `scheduled` (plus `superseded` / `expired` when relevant).

## Non-goals

- Full accounting / invoice redesign
- New payment processor or inventing deposit/pay-link stack (deposit only if already present — it is not for quotes)
- Replacing Business Hub Quotes tab (share from hub/inbox; hub remains source of truth for business drafts)

## Approach

Prefer **structured chat markers** + rich card UI (same pattern as `[booking_slot:…]` / `[attachment:…]`):

```
[quote:kind|id|token|status|total_cents|title_enc|valid_until|version]
```

- `kind`: `business` | `helper`
- Human-readable preface text may precede the marker; UI strips marker and renders `QuoteCard`.

Server APIs under `/api/chat/quotes` attach quotes to conversations / guest sessions, respond in-chat, revise, and schedule-from-quote. Reuses:

- `business_quotes` (+ token portal respond)
- `helper_quotes` (extended for job-less profile threads)
- Existing guest booking-request + auth `booking_requests`
- `profile_chat:new_message` / guest room sockets

## User flows

### A. Provider shares (auth conversation)

1. Open `/messages` or `/helper/messages` thread (or guest inquiry).
2. **Share quote** → pick existing draft/sent quote **or** quick-build line items.
3. Server marks quote `sent`, posts message with marker, emits `profile_chat:new_message` / `message:new`.
4. Customer dock/inbox shows live quote card.

### B. Customer accepts → schedules

1. Card shows title, line items, total, validity.
2. **Accept** (auth or verified guest). Unsigned guests hit OTP gate first.
3. If expired → Accept blocked with clear copy.
4. On success → status chip + open availability picker.
5. Slot select → pending booking/appointment with `quote_id` / `quote_kind` in description metadata; timeline `scheduled`.

### C. Decline / request changes

1. **Decline** updates status; optional short reason.
2. **Request changes** = decline + posts template message asking for a revision (no new status enum required).

### D. Revise & re-share

1. Provider revises (new version or update).
2. Prior share marked superseded; new card posted; old card CTAs disabled.

## Status mapping

| Surface | business_quotes | helper_quotes | Chat UI |
|---|---|---|---|
| Sent | `sent` | `sent` | quote_sent |
| Accept | `approved` | `accepted` | accepted |
| Decline | `declined` | `declined` | declined |
| Expired | `expired` / valid_until | `expired` / valid_until | expired (blocked) |
| After schedule | unchanged + booking link | unchanged + booking link | scheduled |
| Revised | parent superseded | parent superseded | superseded |

## API sketch

- `POST /api/chat/quotes/share` — create-or-pick + post marker message
- `GET /api/chat/quotes/:kind/:id?token=` — card payload (line items)
- `POST /api/chat/quotes/:kind/:id/respond` — accept | decline | request_changes
- `POST /api/chat/quotes/:kind/:id/revise` — new version + optional re-share
- `POST /api/chat/quotes/:kind/:id/schedule` — slot → pending booking linked to quote

Guest auth: same headers as messenger (`X-Guest-Profile-Token`, `X-Guest-Session-Id`).

## Client

- `messengerQuotes.js` — pure marker build/parse, expiry, display helpers (tested)
- `QuoteCard.jsx` — timeline/inbox card + CTAs
- `QuoteSharePanel.jsx` — provider share entry from ConversationThread / GuestInquiryPanel
- Wire `MessageBubble` / ConversationThread / GuestInquiryPanel / ChatPanel accept→picker

## i18n

New keys under `helperProfile.messenger.quote*` and `messages.quoteShare*` in en/es/fr/ht/ar.

## Success criteria

- Helper **and** business threads can share + accept/decline in chat
- Verified guests can accept + schedule; unsigned see verify gate
- Expiry and revise/supersede behave clearly
- `test:messenger-dock` + `verify:i18n` green
