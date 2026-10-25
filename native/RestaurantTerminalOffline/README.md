# Restaurant Terminal offline component

This iOS 16+ Swift package is a POS integration component, not a shipping POS app.
The repository's browser POS cannot collect cards offline. Do not add this flow
to the customer app as though it were an employee POS.

The host must initialize Stripe Terminal with the restaurant-bound connection
provider, connect a supported reader online in its correct Stripe location,
and hold one coordinator for the lifetime of the SDK. Initialize the coordinator
before collecting so it becomes `Terminal.shared.offlineDelegate`.

Decode the server's inner `permit` JSON with
`OfflineTerminalCoordinator.decodePermit`. Its backend permit must be issued
while online for the same store, authenticated POS, existing unpaid ticket and
cashier's own open drawer. Pass the actual connected account to `collect`.
Only Stripe's SDK retains encrypted card data; this package stores opaque
permit/order/intent IDs and recovery states in the protected file supplied by
the host. Do not delete that file to recover an uncertain attempt.

The host's reconciliation closure POSTs `intentId` to
`/api/restaurants/:restaurantId/pos/offline-permits/:permitId/reconcile` with the
staff session. Acknowledge only the backend's durable successful response.
Call `retryReconciliation` on network recovery and app activation. Forwarding is
not capture: a manager reviews/captures authorized intents through the normal
POS capture API; the backend verifies the connected account and amount again.
UI must distinguish queued, authorization pending, captured and reconciliation
required. A definite provider cancellation may release the pending tender;
an unknown SDK outcome must remain reserved.

The pinned official Stripe Terminal artifact checksum comes from the upstream
5.8.0 Package.swift. Local validation:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -scheme RestaurantTerminalOffline -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/oxsteed-terminal-offline-device-build \
  CODE_SIGNING_ALLOWED=NO build
```

Device compilation passed. Reader tests, host UI, connection lifecycle, permit
recovery UI and outage-created card tickets remain open. See
[the runtime checkpoint](../../docs/restaurant-franchise/RUNTIME-FIVE-2026-10-25.md).
