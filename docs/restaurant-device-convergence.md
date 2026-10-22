# Restaurant device convergence (F-26)

Three device/pairing systems grew up independently and now converge on one
canonical registry. This document is the map; the code is the truth.

## The three sources

| Source | Table | Flow |
|---|---|---|
| App-device pairing (POS, kitchen, kiosk, runner, manager, inventory, crew, and managed screens v2) | `restaurant_app_devices` | Pairing code + device token; `requireDeviceCredential` in `restaurantAppFlowController` |
| TV display claim flow (PR #612) | `display_pairings` | Claim code, heartbeat with pairing token |
| Manual / hub designations | — | Created directly in the registry (see below) |

## The canonical registry

`restaurant_devices` (migration 99922) is the single read model new code joins
against: one row per device with `device_role`, `location_id`, `capabilities`,
`pairing_source` (`app_device` | `display_pairing` | `hub` | `manual`),
`source_key` (`<source>:<source id>`, unique per restaurant), and `status`
(`active` | `disabled`).

The legacy tables stay the pairing-flow sources of truth: pairing, token
rotation, and heartbeat credentials keep working exactly as before. Two
triggers mirror new/changed rows into the registry:

- `restaurant_device_registry_app_device` on `restaurant_app_devices`
- `restaurant_device_registry_display_pairing` on `display_pairings`

`server/services/unifiedDeviceService.js` is the only writer new code should
use. Disabling a device writes through to the pairing source: the app-device
row is marked `disabled`, and a display pairing's token hash is nulled so its
heartbeat credential stops working.

## Who builds on the registry

- **In-store hubs (F-08):** `storeHubService.registerHub` designates the hub
  through `unifiedDeviceService.designateHubDevice` (role `hub`, one hub per
  store enforced by `store_hubs`). The hub authenticates its cloud calls with
  its underlying app-device credential.
- **HQ console (F-02):** brand/store views join the registry for fleet status.
- **Printer claiming (F-05/F-26):** the in-store print agent is a `printer`
  role device; jobs are claimed from `restaurant_printer_jobs`. Nothing is
  ever dialed from the server.

## Device fleet API

- `GET /api/restaurants/:restaurantId/devices/registry` — list (role, store,
  status filters; location-scoped for assigned staff)
- `PATCH /api/restaurants/:restaurantId/devices/registry/:deviceId` —
  `active` | `disabled` (writes through, audit-logged)

Both require the canonical restaurant gate; status changes require
`settings.manage`.
