# Unified booking-request lifecycle — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: old-files-claude  
Surfaces: Calendar `BookingRequestsPanel` / `BookingRequestsView`, messenger `BookingRequestCard`

## Problem

Calendar (`/bookings/incoming`, `/bookings/:id/accept|decline`) and messenger
(`/api/chat/booking-requests/*`) both use `booking_requests`, but accept/decline
logic, status sets, appointment creation, and sockets drifted apart:

- Calendar accept ignored `counter_proposed` and never confirmed/created appointments.
- Incoming list `JOIN users` dropped guest rows (`customer_id` null) and defaulted to `pending` only.
- Chat emitted `booking:updated` + `booking:chat_updated`; calendar accept only notified the customer.
- Legacy calendar counter-propose used `counter_*` columns while chat uses `status = counter_proposed`.

## Goals

1. One durable ledger: `booking_requests` (migrations 176 → 537+).
2. Shared service for list-incoming / accept / decline / propose / customer-accept|decline.
3. Both UIs stay; calendar is a thin client over the same mutations as chat.
4. Cross-surface sockets so calendar refreshes on chat accept and vice versa.
5. Guest chat booking unbroken; calendar-only rows (no `conversation_id`) still work.

## Non-goals

- Full calendar rewrite, E2EE, Business Hub Team threads.
- Deleting Calendar Requests view or chat markers/sockets.

## Architecture choice

**Canonical store = messenger-extended `booking_requests`.**  
Do not invent a second ledger. Prefer extending this table (already has
`conversation_id`, `guest_session_id`, `appointment_id`, `source`,
`counter_proposed`) over inventing a parallel bookings table.

| Concern | Decision |
|---|---|
| Table that wins | `booking_requests` |
| Status enum | `pending`, `counter_proposed`, `accepted`, `declined`, `expired`, `cancelled`, `accepted_cancelled` |
| Propose model | Update `requested_*` + `status = counter_proposed` (chat). Sync legacy `counter_*` columns for older mobile readers. |
| Shared module | `server/services/bookingRequestLifecycle.js` |
| Chat routes | Keep `/api/chat/booking-requests/*` (markers / guest / sockets) |
| Calendar routes | Thin wrappers: `/bookings/incoming`, `/bookings/:id/accept|decline`, `/bookings/:id/counter-propose` → shared service |
| List default | `pending` + `counter_proposed` (+ optional `expired`) |

## Migration 538

1. Backfill rows with `counter_status = 'pending'` and `status = 'pending'` →
   `status = 'counter_proposed'`; copy `counter_date/start/end` into `requested_*`
   when set (matches chat propose semantics).
2. Normalize null `source` → `'calendar'` when no conversation/guest; leave
   messenger sources intact.
3. Document: appointments with `status = 'requested'` that never created a
   `booking_requests` row are **not** migratable automatically (out of scope).

## Deprecation

- Duplicate *behavior* of calendar accept/decline is replaced by shared service;
  HTTP paths remain for the Calendar UI.
- Legacy `counter_*` columns remain readable; new writes keep them in sync but
  status enum is authoritative.

## Success criteria

- Accept from either UI creates/confirms appointment and refreshes the other via socket.
- Messenger-originated requests appear on calendar incoming; guest rows included.
- `counter_proposed` visible on calendar with conversation deep-link when set.
- Jest for lifecycle + both route surfaces; `verify:i18n` if UI strings change.

## Residuals (post-1babc6b8)

**Closed — calendar provider authz parity.** Calendar wrappers
(`/bookings/incoming`, `/:id/accept|decline`, `/:id/counter-propose`, and
helper accepted-cancel / get-by-id) previously checked `helper_id` only.
They now use `bookingRequestLifecycle.isProviderForBooking` (same rules as
chat: helper owner, business owner/member, conversation helper/business,
guest-inquiry provider). `listIncomingForProvider` returns helper-owned
**and** business/conversation/guest-scoped inbox rows for those actors.

**Intentional remaining residuals**

- Socket fanout still targets `helper_id` + `customer_id` (+ conversation /
  guest rooms), not every business member individually. Calendar panels
  refresh for the acting user; full business-wide fanout is out of scope.
- `BookingRequestsPanel` UI still exposes accept/decline only (no in-panel
  counter-propose form); the `/bookings/:id/counter-propose` API is parity-
  authorized for business providers when a client calls it.
- Customer respond on calendar (`counter-propose/respond`) remains
  `customer_id`-only; guest customer respond stays on the messenger path
  (guest token), which is intentional.

