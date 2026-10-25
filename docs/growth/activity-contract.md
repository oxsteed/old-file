# Native activity and offer-open contract

This documents the implemented API contract for companion app owners. It is
not evidence that an app implements, ships or adopts it. Collection remains
default-off. Push opens retain their partial label until app adoption is proven.

## Activity

For a signed-in session, read `GET /api/activity/config` using the app's existing
authenticated API client. Only collect when `enabled === true`; clear buffered
activity on logout, account change or withdrawal. Recheck on foreground and
before flushing; never persist a denied user's activity for later replay.
The server independently rechecks rollout, eligibility and current consent.

Send `POST /api/activity/batch` through that same authenticated client:

```json
{
  "surface": "ios",
  "app_version": "1.0.0",
  "locale": "en",
  "session": "019a14a0-0000-7000-8000-000000000001",
  "events": [{
    "event_id": "019a14a0-0000-7000-8000-000000000002",
    "name": "screen.view",
    "schema_ver": 1,
    "occurred_at": "2026-10-25T12:00:00.000Z",
    "props": { "route": "/food" }
  }]
}
```

Use `android` for Android. The static timestamp above illustrates the shape;
real events must use their actual timestamp. Batches are at most 50 events and
65,536 bytes. App versions start with a digit and have at most 40 alphanumeric,
dot, underscore or hyphen characters. Locale is two lowercase letters. Generate
UUIDv7 event IDs and a session UUID; rotate sessions after 30 idle minutes.
Reuse event IDs on a bounded transport retry. Do not reuse a previous account's
session or queue. A 204 response is deliberately also returned for invalid or
ineligible batches; it is not proof that an event was collected.

Event schemas in `server/growth/events/schemas/` and route/element allowlists
are authoritative. Send route templates such as `/food/orders/:orderId`, never
actual IDs, arbitrary URLs, input values, messages, labels or coordinates.
Do not send server-owned business events from the app. Search text must be
scrubbed before queuing to match the existing browser tracker; never buffer raw
queries. Do not introduce device/ad identifiers into this payload.

## Explicit offer notification taps

Handle `data.type = "growth_offer"` in cold and warm launch paths. Only on an
explicit tap, report `data.track_url` using the existing
[push-open contract](../analytics-platform/push-open-contract.md): validate the
configured HTTPS host and `/api/broadcast-tracking/p/` path, omit account bearer
credentials, accept 2xx and retry at most once on the next foreground. Never
report delivery/background receipt as an open. Growth tokens use `g_` under
that same route prefix.

Validate `data.deep_link` separately as an owned app offer-detail route; reject
external origins, protocol-relative URLs and arbitrary partner destinations.
Open the signed-in offer detail, which enforces ownership and current consent
on the API; authentication recovery must preserve the intended internal route.
The partner link is a subsequent explicit action from the detail page.

Provide the separate Offers notification category/channel and in-app opt-out,
preserving order, job and message notifications. Test malformed links, expired
offers, duplicate taps, network failure, account switching and withdrawal.
Retain app version/release and adoption evidence before removing the partial
measurement label. Review App Store/Play privacy declarations as part of release.
