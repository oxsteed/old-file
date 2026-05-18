# OxSteed Mobile

Native iOS app project for publishing OxSteed to the App Store.

## Current Shape

- `mobile/ios/App` is now a SwiftUI iOS app, not a Capacitor WebView shell.
- The app keeps the existing bundle id `com.oxsteed.app`, icon assets, launch screen, URL scheme, and associated-domain entitlements.
- First launch shows a native SwiftUI introduction to OxSteed.
- Main tabs now combine native product education with live native marketplace data:
  - Overview
  - Discover
  - Jobs
  - Helpers
  - Work
  - Account
- `Discover`, `Jobs`, and `Helpers` fetch live public OxSteed API data and render it in SwiftUI lists/search screens.
- `Account` signs in through the OxSteed API and stores the native session token for authenticated actions.
- `Work` covers the main App Review-facing workflows with native SwiftUI surfaces:
  - Post a job through the authenticated `/api/jobs` endpoint.
  - Browse marketplace products from `/api/marketplace/products/browse`.
  - Open native product detail pages and create native carts.
  - Submit business consultation requests through `/api/consulting/submit`.
  - Load authenticated messages from `/api/messages/conversations`.
  - Open native message threads and send messages through `/api/messages/conversations/:id`.
  - Load authenticated appointments from `/api/calendar/appointments`.
  - Open native helper profile details, service menus, trust signals, hours, and reviews.
  - Open native job detail pages with scope, requirements, budget, status, and schedule context.
  - Load owned and managed Business Hub businesses natively.
- `SFSafariViewController` is now limited to explicit fallback paths for flows that still require the full web transaction layer: final service booking, protected bid submission, payment checkout, full Business Hub tools not yet rebuilt natively, account creation, and tool rentals.
- The iOS deployment target is currently `17.0`.

## Build

Simulator:

```bash
xcodebuild \
  -workspace mobile/ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Unsigned device-target release build:

```bash
xcodebuild \
  -workspace mobile/ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## App Store Configuration

In Xcode:

- Keep the bundle identifier as `com.oxsteed.app` unless App Store Connect changes require otherwise.
- Select the OxSteed Apple Developer team.
- Keep Associated Domains enabled for:
  - `applinks:oxsteed.com`
  - `applinks:www.oxsteed.com`
- Keep Push Notifications enabled if native notification registration is reconnected in a later pass.
- Team ID discovered in Xcode: `ZBRGSDRRU7`. Production should keep `APPLE_TEAM_ID=ZBRGSDRRU7` so `/.well-known/apple-app-site-association` returns `ZBRGSDRRU7.com.oxsteed.app`.

## Native Follow-Up

- Reconnect native APNs registration directly from Swift instead of through the former Capacitor web bridge.
- Move the remaining transaction edges out of Safari: final helper booking, protected bid submission, payment checkout, account creation, and deeper Business Hub editing tools.
- Store session tokens in Keychain instead of `UserDefaults` before production release.
- Capture fresh App Store screenshots from the SwiftUI tabs before submitting the next build.
