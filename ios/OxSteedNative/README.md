# OxSteed Native iOS

Native SwiftUI track for OxSteed. This workspace is intentionally separate from the existing Expo React Native app in `mobile/` so the team can keep TestFlight continuity while building a true Apple-native experience.

## What Exists

- `Package.swift` defines a SwiftUI executable package that targets iOS 17+ and also builds on macOS 14+ for fast local verification.
- `Sources/App/OxSteedNativeApp.swift` wires the app-level stores.
- `Sources/Models/OxSteedModels.swift` defines tabs, capability domains, route families, and native action contracts.
- `Sources/Support/OxSteedCapabilityCatalog.swift` maps the website's major user/admin flows into native modules with backend endpoint hints.
- `Sources/Services/OxSteedAPIClient.swift` provides an async/await JSON client with bearer-token support.
- `Sources/Stores/*.swift` owns session state and mobile experience filtering/search.
- `Sources/Views/*.swift` implements the SwiftUI navigation shell, module cards, detail surfaces, route-family sheet, account/API configuration surface, and first native workspace screens.
- `OxSteedNative.xcodeproj` wraps the same SwiftUI sources as a launchable iOS simulator app.

## Native Workspace Pass

`NativeWorkspaceView` gives every mapped module a concrete native destination. Customer job posting and logistics sourcing requests have live SwiftUI forms wired through `NativeWorkspaceStore` to the existing backend contracts. Marketplace, commerce, helper, messaging, consulting, business, learning, trust/legal, internal, and admin modules expose endpoint-ready native scaffolds so detail screens can be filled in against verified payloads instead of rebuilt ad hoc.

`NativeReadStore` adds the first typed read flows:

- Customer dashboard feed from `GET /api/mobile/feed`.
- Marketplace browse/search from `GET /api/marketplace/products/browse` and `GET /api/marketplace/products/search`.
- Inbox list from `GET /api/messages/conversations`.
- Logistics request list from `GET /api/logistics/requests`.

These reads render with loading, retry, empty, and compact row states inside the native workspace forms.

## Current Verification

```bash
swift build --package-path ios/OxSteedNative
```

Simulator preview:

```bash
xcodebuild -project ios/OxSteedNative/OxSteedNative.xcodeproj \
  -scheme OxSteedNative \
  -configuration Debug \
  -destination 'id=<SIMULATOR_UDID>' \
  -derivedDataPath /tmp/OxSteedNativeDerived build

xcrun simctl install <SIMULATOR_UDID> /tmp/OxSteedNativeDerived/Build/Products/Debug-iphonesimulator/OxSteedNative.app
xcrun simctl launch <SIMULATOR_UDID> com.oxsteed.native
```

## Product Direction

The goal is full native capability parity with the website: customers, helpers, marketplace, cart/checkout/orders, business workspaces, logistics, internal workspaces, admin/super-admin, messages/support, consulting, learning, trust/legal, and account settings.

The next passes should deepen each native workspace with endpoint-specific detail screens and write actions, starting with auth/session persistence, customer dashboard/post-job media, helper work center, marketplace product cards/cart, threaded messages, and logistics buyer dashboards.
