# OxSteed Go

`OxSteedGo` is a second native SwiftUI app for everyday OxSteed users. It is intentionally simpler than `ios/OxSteedNative`: instead of exposing every web/admin capability, it focuses on the core pocket workflow a customer, helper, or logistics buyer would use daily.

## App Shape

- `Home`: dark OxSteed-native dashboard with branded logo, search/filter controls, help hero, active mode cards, metrics, and recent activity.
- `Learn`: richer native job draft/post flow with location, budget, urgency, skill, schedule, preferred-helper, and media-note fields.
- `Tools`: skill-aware shopping and tool/supply recommendations backed by marketplace browse/search loading.
- `Pro`: unified conversation preview for jobs, support, bids, business, and logistics conversations.
- `Account`: mode-management screen, auth/session, language/translation settings, checklist, and customer/helper/business/logistics panels.

## Website-Reduction Pass

This pass implements the ten major improvements needed to reduce website dependence:

- Auth/session restore, login, sign-out, and persisted local session vault.
- Fuller job-posting payload plus offline queue fallback.
- Helper discovery through the mobile nearby endpoint.
- Real inbox loading through `/api/messages/conversations`.
- Marketplace product browse/search through `/api/marketplace/products`.
- Customer dashboard data through `/api/mobile/feed`.
- Helper mode panel for jobs, bookings, availability, profile, earnings, and Connect next steps.
- Business owner lite mode for appointments, services, quotes, invoices, intakes, products, team, and messages.
- Notification/deep-link queueing for exact-screen resume behavior.
- Offline/resume queue for drafts and deferred actions.
- Four-language app support for English, Spanish, French, and Haitian Creole.
- Default-on cross-language message auto-translation through `/api/translate`, with settings to turn it off and per-message original/translated display.

The current `GoSessionVault` uses `UserDefaults` so the SwiftPM package remains preview/build friendly across macOS and iOS. When `OxSteedGo` becomes a signed production Xcode target, replace that implementation with Keychain-backed storage behind the same API.

## Language + Translation

`OxSteedGo` mirrors the website language footprint:

- English (`en`)
- Spanish (`es`)
- French (`fr`)
- Haitian Creole (`ht`)

The `Me` and `Inbox` screens expose the language picker and auto-translate toggle. Auto-translate defaults to on. When enabled, loaded conversation previews are translated to the selected language through `POST /api/translate`; each translated row can still show the original text. Turning the setting off clears translated previews and displays original messages only.

## Verification

```bash
swift build --package-path ios/OxSteedGo
```

## Simulator Preview

`OxSteedGo.xcodeproj` is a small simulator wrapper around the SwiftUI sources so the app can be built, installed, and launched without converting the SwiftPM package into a full production Xcode workspace yet.

```bash
xcodebuild -project ios/OxSteedGo/OxSteedGo.xcodeproj -scheme OxSteedGo -configuration Debug -destination 'id=B3145305-585E-4A45-BE2E-FEDBBE8AC2CC' -derivedDataPath /tmp/OxSteedGoDerived build
xcrun simctl install B3145305-585E-4A45-BE2E-FEDBBE8AC2CC /tmp/OxSteedGoDerived/Build/Products/Debug-iphonesimulator/OxSteedGo.app
xcrun simctl launch B3145305-585E-4A45-BE2E-FEDBBE8AC2CC com.oxsteed.app
xcrun simctl io B3145305-585E-4A45-BE2E-FEDBBE8AC2CC screenshot artifacts/previews/oxsteed-go-simulator.png
```

The latest design preview is captured at `artifacts/previews/oxsteed-go-home-redesign.png`. It moves OxSteed Go toward the dark, orange-accented mode-based concept with the real OxSteed logo asset, a slimmer branded bottom navigation, premium match hero, horizontal active-mode cards, and richer Home/Account surfaces.

## TestFlight

The project now includes a TestFlight upload path:

```bash
ios/OxSteedGo/build_testflight.command
```

The app archives under team `ZBRGSDRRU7` with bundle id `com.oxsteed.app`, version `1.0`, build `107`, and uses `ExportOptions.testflight.plist` for App Store Connect upload. This bundle id is the existing OxSteed iOS app record, so upload attempts target the current TestFlight app instead of creating a separate `OxSteed Go` listing.

Build `107` uploaded successfully to App Store Connect and is processing. After Apple finishes processing, add tester `emilejeanphilippefr@gmail.com` in TestFlight. Local App Store Connect API credentials were not available, so tester assignment could not be automated from this machine.

## Product Direction

This app should become the lightweight user-facing companion: fast to open, easy to understand, and focused on getting a job posted, helper found, item bought/rented, message answered, or account task completed without exposing the complexity of the broader platform.
