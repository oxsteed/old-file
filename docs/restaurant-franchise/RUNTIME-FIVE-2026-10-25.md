# Restaurant runtime follow-up, 2026-10-25

This is an implementation checkpoint for the five requested runtime areas on
`old-files-claude`. It does **not** close all five review findings. Provider
approvals, a native POS host and hardware acceptance are unavailable, and the
software limitations below remain explicit.

## Implemented and exercised locally

| Area | New implementation | Still open |
| --- | --- | --- |
| LAN hub | Dedicated HTTPS appliance; SQLite WAL/full-sync journal; bounded cloud-authorized same-store device leases; manager-configured drawer binding; cached store prices and tax policy; cash tickets through kitchen, print claim, ready and pickup; durable cloud upload identities; browser retry recovery | Required modifiers/dayparts and service-fee stores require online POS; one-hour leases deliberately stop new offline work after expiry. Reconnected sales enter the existing manager replay/review queue. Install certificates/DNS, connect physical devices and exercise an outage in a store. |
| Offline Terminal | Native iOS Stripe SDK component; durable opaque attempt IDs; pre-issued store/POS/drawer/order permits; pending tender reservations; store/day exposure caps; currency/amount/account/metadata verification; manager capture and connected-account refunds | Component is not wired into a shipping native POS application. Permits require an existing online ticket; brand-new outage-created card orders remain unsupported. Reader connection, forwarding, decline/cancellation recovery and hardware acceptance require a supported reader and an approved Stripe test account. Web checkout remains offline-cash-only. |
| Device convergence | Canonical active registry standing governs legacy app/display credential authentication; store consistency checks; source-deletion revocation; both display token generations revoked without breaking claim-state constraints; paired hub/printer roles and printer route contracts | Canonical source adapters remain for compatibility. Replacing all duplicated controllers/write adapters and validating every native client remains open. A manual fleet designation alone is never a credential. |
| Accounting | QuickBooks/Xero OAuth state and company binding; encrypted renewable credentials with refresh fencing; durable daily journal documents; explicit account mapping; provider POST and readback reconciliation; uncertain sends quarantined; merchant controls localized in five languages | No real sandbox has been connected. Refund periods, inclusive-tax allocation and currencies outside the supported two-decimal journal contract require review and cannot be dispatched by the generated-journal route. Provider account mapping, token rotation, rejection/reconciliation and external-ledger acceptance remain open. |
| Marketplaces | Integrations and queues pinned to a store; assigned-store access; concurrent order deduplication with changed-retry rejection; published store menu pricing/availability; exact-body Uber HMAC and configured DoorDash Authorization verification; encrypted durable webhook receipts | Verified receipt is not an imported restaurant order. Provider OAuth/client calls, full menu/modifier synchronization, order fetch/accept/cancel mapping and settled-payment treatment still need approved provider contracts. Grubhub ingress is rejected until its approved authentication contract is available. |

Migration 99986 disables previously restaurant-wide marketplace configurations
while assigning their primary-store identity. Verify the actual external store
before re-enabling each one. Historical marketplace orders with unknown store
identity stay unattributed and are excluded from assigned-store operations.

## Defaults and runtime configuration

No new live financial/provider capability was activated. These flags default off:

- `RESTAURANT_ACCOUNTING_DELIVERY_ENABLED=true`: scheduled dispatch of pending
  exports for active integrations. QuickBooks uses sandbox unless
  `RESTAURANT_ACCOUNTING_PRODUCTION=true` is separately set.
- `RESTAURANT_TERMINAL_OFFLINE_ENABLED=true`: permit issuance, additionally gated
  by the store's enabled policy, card brands and risk caps. Turning it off does
  not stop reconciliation of previously issued attempts.
- `RESTAURANT_MARKETPLACE_WEBHOOKS_ENABLED=true`: verified durable receipt only;
  it does not activate order materialization or menu publishing.

Accounting OAuth needs a public HTTPS `RESTAURANT_ACCOUNTING_CALLBACK_BASE`,
`RESTAURANT_QUICKBOOKS_CLIENT_ID` / `RESTAURANT_XERO_CLIENT_ID`, and corresponding
`RESTAURANT_QUICKBOOKS_CLIENT_SECRET_REF` / `RESTAURANT_XERO_CLIENT_SECRET_REF`.
The secret fields contain Secrets Manager dynamic references, never plaintext
configuration. Set `ASM_EXECUTABLE` to the installed `asm-exec` executable.
The wrapper resolves references at runtime; its child emits encrypted output
only. Existing application encryption configuration must be available to both
processes. Never put these values in `VITE_*` or print resolved credentials.

The callback's single-use random state is hashed in PostgreSQL, expires after
ten minutes and is bound to the integration and initiating user. Callback
handling rechecks that user's current brand-level accounting permission. It
consumes state once and fences a changed provider-company/credential version.
Configure each exact callback URL with the provider.

Uncertain accounting POSTs are never automatically repeated. Xero's documented
idempotency window is six minutes. A worker interruption quarantines uncertain
documents, and reconciliation requires matching provider reference, date,
currency, account/debit/credit facts and an unambiguous external identity.
An immutable company/day/currency identity prevents even a changed snapshot or
account mapping under a fresh operator key from reposting that day. The generated-journal route requires
closed business days across the stores’ local day boundaries; late corrections need a separate reviewed adjustment
workflow, which remains open. Never mark a batch posted merely to clear it.

Provider connections were not found among GitHub secret names. The local AWS
session expired, and `asm-exec` was not on PATH during verification. No secret
values were retrieved. Reauthenticate and provision approved references before
any live acceptance; do not infer provider access from a passing fixture.

## LAN installation and recovery

Use Node.js 22.13 or later with this repository's server dependencies on a
store appliance. Run `node server/scripts/restaurant-store-hub.cjs` with:

- `OXSTEED_API_URL`: the cloud API's HTTPS origin.
- `OXSTEED_HUB_ORIGIN`: the trusted HTTPS LAN hostname and optional port.
- `OXSTEED_RESTAURANT_ID`, `OXSTEED_LOCATION_ID`, `OXSTEED_HUB_ID`.
- `OXSTEED_DEVICE_TOKEN`: the paired hub app device's credential, injected at runtime.
- `OXSTEED_HUB_DATABASE`: durable local SQLite path on a protected volume.
- `OXSTEED_HUB_TLS_KEY_FILE` and `OXSTEED_HUB_TLS_CERT_FILE`: existing trusted
  key/certificate files. `OXSTEED_HUB_BIND` defaults to `0.0.0.0`.

Pair an app device with role `hub`, then register its canonical registry ID as
the store hub. Pair each POS/kitchen/printer/display normally while online.
A manager configures each POS app device with `config.offlineShiftId` equal to
one open drawer at that store. Authorize peers online before an outage; new
credentials cannot first authenticate offline. Staff use the hub's local page
and their paired device credential. The pending sale body/key survives reload
in session storage; credentials remain memory-only. Do not clear a pending sale
or move a device to another drawer before investigating an uncertain result.

The local printer process is
`node server/scripts/restaurant-store-hub-printer.cjs`. Supply the HTTPS hub
origin, paired printer `OXSTEED_DEVICE_ID` and runtime `OXSTEED_DEVICE_TOKEN`,
`OXSTEED_PRINTER_HOST`, optional `OXSTEED_PRINTER_PORT` (9100), and durable
`OXSTEED_PRINTER_STATE_FILE`. It prints only to that configured LAN destination.
A successful TCP write does not prove paper emerged. A lost acknowledgement
retries only the acknowledgement; an interrupted write stops automatic printing
and requires an operator to inspect the physical ticket before recovery.

No public API process connects to a LAN printer. Host/Origin checks and trusted
HTTPS protect the LAN page; the SQLite directory and printer state directory
must remain private and durable. Both processes drain in-flight operations on
SIGTERM. Preserve their files during upgrades and outages.

## Verification

- Fresh disposable PostGIS migration apply, runner replay/checksums and guard
  verification: **1,007/1,007 passed**. Initial container startup timed out under
  local build load; the ready, still-empty disposable target was then reused.
- Two-store PostgreSQL isolation and connected service-cycle suites: **62
  passed**. Provider/device/permit/bootstrap/webhook suite: **9 passed**.
  Negative-path transaction error logs are expected, not test failures.
- Focused provider/accounting/report/Terminal/device/printing/scope/scheduler
  suites: **100 passed**, 15 explicitly skipped database tests.
- Additional app-flow/payment-ledger suites: **80 passed**; actual PostgreSQL
  hub cash upload/replay/closed-drawer regressions: **11 passed**.
- LAN/print Node tests plus actual Chrome loss/reload and Arabic mobile test:
  **4 passed**. Automated layout/RTL checks are not a human usability pass.
- `client/npm run build:ci`: passed, including typecheck, i18n gates and emitted
  asset verification (1,076 assets). Existing font-path and large-chunk warnings
  remain outside this runtime change.
- Native generic iOS device build against the pinned official Stripe Terminal
  5.8.0 artifact: **BUILD SUCCEEDED**, signing disabled. Simulator support was
  unavailable because the installed CoreSimulator service is older than Xcode.
- CI now explicitly includes the runtime PostgreSQL suite and LAN/browser
  regression tests. Remote CI and deployed-commit verification must be recorded
  separately after push. No production database or physical hardware was used.

## Exact continuation

1. Finish LAN menu/modifier/fee parity and the operator recovery UI, then prove
   an extended physical outage and manager replay with real store hardware.
2. Integrate the native component into a restaurant POS host, add its reader /
   connection-token lifecycle and collection UI, then exercise newly created
   outage tickets without weakening account, store, drawer or risk boundaries.
3. Continue replacing duplicated resource/write adapters; keep compatibility
   adapters routed through the canonical credential standing checks.
4. Add reviewed refund-date and inclusive-tax accounting allocations, connect
   approved QuickBooks/Xero sandboxes, and prove rotation and external readback.
5. Obtain approved marketplace schemas/access; implement actual provider clients,
   full menu/modifier sync and local-order/payment mapping. Only then replace
   `requires_provider_mapping` with an audited materialization worker.

Official contract references:
[Stripe offline iOS](https://docs.stripe.com/terminal/features/operate-offline/collect-card-payments?terminal-sdk-platform=ios),
[Xero idempotency](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/),
[DoorDash Marketplace access](https://developer.doordash.com/en-US/docs/marketplace/overview/),
[Uber Eats access](https://developer.uber.com/docs/eats/introduction),
[Uber webhook verification](https://developer.uber.com/docs/eats/guides/webhooks).
