# In-thread booking request Accept / Decline — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: old-files-claude  
Surfaces: ConversationThread (helper / Business Hub deals), ChatPanel / MessageBubble (profile messenger), guest live replies

## Problem

Customers and guests can already request a time via messenger availability picker or quote schedule, but providers leave the thread to accept/decline (calendar inbox). Pending intent is only a `[booking_slot:…]` text marker with no durable in-thread actions or status card.

## Goals

1. **In-thread Accept / Decline** (optional decline note) for pending booking requests without leaving the page.
2. **Durable `booking_requests` rows** for messenger picker + guest path + quote schedule, linked to `conversation_id` / `guest_session_id` / `appointment_id`.
3. **Parity**: signed-in and verified guest create paths; customer sees confirmed/declined status in-thread.
4. **Socket refresh** so both sides update without reload.
5. **Admin break-glass** continues to list booking artifacts via `booking_requests.conversation_id`.
6. Provider **Propose different time** opens `MessengerAvailabilityPicker` and updates the pending request (ConversationThread + ChatPanel dock).

## Non-goals

- Replacing calendar `BookingRequestsPanel` / `/api/bookings/:id/accept`.
- Breaking quote schedule toolbar flow or guest live reply sockets.
- New escrow / payment on accept.

## Architecture

### Marker

```
[booking_req:ID|status|YYYY-MM-DD|HH:MM|HH:MM|name:ENC|svc:ID]
```

Posted with human summary text. Client strips marker and renders `BookingRequestCard`. Legacy `[booking_slot:…]` remains for intent text.

### API

| Method | Path | Who |
|---|---|---|
| GET | `/api/chat/booking-requests/:id` | Participant / verified guest |
| POST | `/api/chat/booking-requests/:id/accept` | Provider (helper owner or business member) |
| POST | `/api/chat/booking-requests/:id/decline` | Provider (`reason` optional) |
| POST | `/api/chat/booking-requests/:id/propose` | Provider (counter time) |

Authz reuses `chatThreadAccess` (conversation participant, business member, guest inquiry access).

### Accept

1. Transition `pending|expired|counter_proposed` → `accepted`.
2. Confirm linked `appointment_id` or create a confirmed appointment.
3. Post status message with updated marker; emit `booking:chat_updated` + `booking:updated`.

### Decline

1. → `declined` + optional `helper_response_reason`.
2. Cancel linked appointment when present.
3. Post status + sockets.

### Propose (stretch → done)

Update requested date/times → `counter_proposed`; keep pending for customer visibility; post revised marker.

**ChatPanel parity (2026-09-21):** when `isProviderActor` (`user.id === helperId` or business actor), `BookingRequestCard` gets `onProposeTime` via MessageBubble/ChatTimeline; opens in-dock `MessengerAvailabilityPicker` and POSTs `/api/chat/booking-requests/:id/propose` (same as ConversationThread/inbox). Customer/guest path unchanged.

### Migration 537

Adds `conversation_id`, `guest_session_id`, `appointment_id`, `quote_kind`, `quote_id`, `source`, `service_id`, `timezone`; nullable `customer_id` for guests; `counter_proposed` status.

## UI

- `helperProfile/chat/BookingRequestCard.jsx` in MessageBubble + ConversationThread.
- Provider: Accept / Decline (+ note) / Propose different time.
- Customer/guest: status badge + hint copy (en/es/fr/ht/ar).

## Success criteria

- Provider accepts/declines in helper messages and Business Hub deals without leaving.
- Guest + signed-in create paths store durable rows and render cards.
- Quote schedule still works; guest live reply unchanged.
- Jest + messenger-dock tests + `verify:i18n`.
