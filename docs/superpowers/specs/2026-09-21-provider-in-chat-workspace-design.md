# Provider in-chat workspace — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: old-files-claude  
Surfaces: Business Hub messaging, helper `/helper/messages`, public-profile `ChatPanel` when actor is provider

## Problem

Customers can already pay quotes/payment requests with OxSteed Credit in-thread, and helper inbox (`ConversationThread`) can share quote / POP / agreement / payment request. Business Hub messaging is still a thin text-only inbox (`BusinessMessagingTab` → `business_conversations`), so businesses leave the page for day-to-day deal work. Helper-only threads also fail credit pay with `credit_provider_not_eligible` when no `business_id` partner is resolved, and there is no in-chat refund UI.

## Goals

1. **Unified provider messenger workspace** — Business Hub customer/deal chat reuses `ConversationThread` (same action bar as helper inbox). Team chat may remain on `business_conversations`.
2. **In-thread deal lifecycle** without leaving: quote, payment request, agreement, POP, availability/booking, credit refund, customer contact drawer.
3. **ChatPanel provider tools** when the signed-in user is the profile helper or business owner (`isProvider`).
4. **Credit residuals**: resolve helper → linked partner business; in-chat refund via existing ledger; document order-type mapping for partner agreements.
5. Guest POP upload path unchanged; Telegram cloud-chat model unchanged; admin break-glass still sees payment/refund artifacts.

## Non-goals

- Second ledger / wallet.
- E2EE messenger.
- Replacing team (`business_conversations`) with deal threads.

## Architecture

### A. Surfaces

| Surface | Provider tools |
|---|---|
| Helper Messages (`MessagingWorkspace` + `ConversationThread`) | Existing bar + refund + schedule + contact drawer |
| Business Hub Messaging tab | **Deals** tab: `/messages/conversations?business_id=` + `ConversationThread role="helper"`; **Team** tab: legacy inbox |
| `ChatPanel` (own profile) | Same provider action bar when `user.id === helperId` or user manages `businessId` |

Shared UI: `ProviderMessengerToolbar` (quote, pay request, agreement, POP, schedule, refund, contact).

### B. Credit partner eligibility (helpers)

`resolveCreditPartner({ businessId, helperId })`:

1. If `businessId` → active partner where `partners.business_id = businessId`.
2. Else if `helperId` → find owned/member businesses for that helper that have an active partner (`businesses.user_id` or `business_members`), prefer primary.
3. Else → `credit_provider_not_eligible` with clear i18n.

No `helper_id` column on partners in this slice — **documented fallback** is helper→linked business partner resolution.

### C. Partner agreement order types

Default agreements allow `pickup|delivery|dine_in`. Chat purchase historically used `orderType: 'service'`, which fails those filters.

**Choice:** resolve order type as:

1. Prefer `service` when allowed (or allow-list empty).
2. Else use the first allowed order type on the active agreement.
3. Keep `category: 'chat_payment'` (empty `allowed_categories` ⇒ all allowed).
4. Metadata always records `channel: live_messenger` + `chatOrderTypeMapped`.

Documented in this spec; no silent second ledger.

### D. In-chat refund

`POST /api/chat/payments/:id/refund` (payment request id **or** query `popId` / body `creditTxnId`):

- Auth: conversation member + provider (helper or business access).
- Calls `refundCredit` / `refundCreditForReferenceInTransaction` with `reference_type=chat_payment`.
- Idempotency-Key required; partial or full; reason required.
- Updates POP status → `refunded` / `partially_refunded`; payment_request → `refunded` when fully refunded.
- Posts `[credit_refund:…]` marker + socket; customer sees confirmation card.
- Admin break-glass lists refund artifacts with POPs / payment requests.

### E. Contact drawer

`GET` existing conversation meta (+ guest inquiry fields when present). Side drawer shows name, email, linked quote/booking ids — no navigation away.


### F. Availability picker gate (business + helper)

`canShowAvailabilityPicker` opens the in-dock calendar for helper destination **and** business destination / `businessId` sessions (business slots API). Schedule toolbar + Propose different time remain available to business actors on ChatPanel and Business Hub deals (`ConversationThread`).

## Success criteria

- Business Hub Deals chat: quote, pay request, agreement, POP, schedule, refund in-tab.
- Helper messages parity + ChatPanel provider tools for provider actor.
- Helper threads receive credit when a linked partner business exists; else clear error.
- Refund E2E with Jest + messenger-dock tests + `verify:i18n` (en/es/fr/ht/ar).
