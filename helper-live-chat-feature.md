# Helper Live Chat Feature — Full Stack Implementation

## Overview

This document captures the full implementation of the helper availability toggle feature.
When a helper marks themselves "available for live chat," messages from customers route
directly to them via Socket.IO instead of the AI assistant.

---

## What Was Changed

### 1. DB Migration — `server/migrations/059_add_helper_availability.sql`
```sql
-- Add availability toggle for helpers to indicate live chat readiness
ALTER TABLE helpers
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_since TIMESTAMPTZ;

-- Partial index for fast browse filtering
CREATE INDEX IF NOT EXISTS idx_helpers_is_available
  ON helpers (is_available)
  WHERE is_available = true;
```

---

### 2. Backend — `server/routes/helpers.js`

- Added `COALESCE(h.is_available, false) as is_available` to public GET queries
- Added `PATCH /helpers/me/availability` route to toggle availability
- Emits `helper_availability_changed` via Socket.IO on toggle

---

### 3. Backend — `server/index.js` (Socket.IO)

- Added `onlineHelpers` Map for presence tracking
- Added `helper_go_available` and `helper_go_unavailable` socket events
- Added `typing` / `stop_typing` socket events
- On disconnect: auto-sets helper unavailable in DB if no remaining sockets

---

### 4. Frontend — `client/src/pages/HelperDashboard.jsx`

- Added availability toggle UI (pill with animated switch)
- Shows green banner when available
- Emits `helper_go_available` / `helper_go_unavailable` to socket on change
- Cleans up socket on unmount

---

### 5. Frontend — `client/src/pages/HelperProfile.jsx`

- Reads `is_available` from helper fetch
- Listens for real-time `helper_availability_changed` socket events
- Contact button routes to `/messages?to=...` (direct chat) when available
- Shows green availability indicator on profile header

---

### 6. Frontend — `client/src/pages/BrowseHelpers.jsx`

- Shows green dot next to helper name when `is_available === true`

---

## Socket Events Reference

| Event | Direction | Payload |
|-------|-----------|----------|
| `helper_go_available` | client → server | `userId` |
| `helper_go_unavailable` | client → server | `userId` |
| `helper_availability_changed` | server → all clients | `{ helper_user_id, is_available }` |
| `typing` | client → server | `{ sender_id, receiver_id }` |
| `stop_typing` | client → server | `{ sender_id, receiver_id }` |
| `user_typing` | server → client | `{ sender_id }` |
| `user_stop_typing` | server → client | `{ sender_id }` |

---

## Routing Logic

- Helper **available** → "Contact Helper" navigates to `/messages?to={helper.user_id}` (direct Socket.IO chat)
- Helper **unavailable** → message routes through AI assistant (existing behavior)

---

## Run the Migration

```bash
docker exec -it <server-container> node /app/server/migrate.js
```
