# Push-open reporting contract (native apps)

Business broadcasts sent by push carry a per-recipient tracking URL. The web
service worker (`client/public/sw.js`) already reports opens. The native iOS and
Android apps live outside this repository and must implement the call below
when the user taps a broadcast notification. Until they do, opens of push
broadcasts delivered to native devices are not counted. Delivered counts are
unaffected.

## Payload the app receives

Web push and mobile push (`mobilePushService.sendToUser`) both send:

```json
{
  "title": "<broadcast subject>",
  "body": "<first 240 characters of the message>",
  "data": {
    "type": "business_broadcast",
    "broadcast_id": "123",
    "track_url": "https://<api host>/api/broadcast-tracking/p/<recipient token>"
  }
}
```

On FCM/APNs, `data` arrives as the notification's custom data (string values).
`type` may be at the top level or inside `data`, depending on the platform
adapter. Check both.

## Call to make on tap

```
POST {data.track_url}
Content-Type: application/json   (body ignored; send "{}" or nothing)
```

- **No authentication.** The opaque recipient token in the path is the
  credential. Do not add the user's bearer token, because the URL may be a
  different host from the app API.
- **Response:** always `204 No Content`, including for unknown or expired
  tokens, so nobody can probe which tokens exist. Treat any 2xx as done. Treat
  network errors as fire-and-forget. Retry at most once on the next app foreground.
- **Idempotent:** repeated calls keep the first `opened_at` and increase
  `open_count`. The first open is what reporting uses (one per recipient), so
  retries do not inflate the open rate.
- **When to call:** call only on an explicit tap or open of the notification.
  Do not call on delivery or display. Background receipt must not report an
  open.
- **Validation:** only call URLs whose path starts with
  `/api/broadcast-tracking/p/` and whose host is the configured API host or
  `BROADCAST_TRACKING_BASE_URL`. Ignore anything else, so a crafted payload
  cannot make the app call arbitrary URLs.
- **Privacy:** the call carries no device or user identifiers. Reporting is
  aggregate per broadcast and channel in Business Hub.

## Server side (implemented)

- **Route:** `POST /api/broadcast-tracking/p/:token`, handled by
  `broadcastTrackingController.pushOpen` and
  `broadcastDeliveryService.recordOpen(db, token, 'push')`.
- **Effect:** sets `opened_at` (first only) and increments `open_count` on the
  recipient's `push` delivery when its status is `sent`.

## Not in this repository

App code for tap handling on iOS and Android. App release and adoption are ops
and product items.
