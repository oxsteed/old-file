# OxSteed Guideline 4.2 Defense Pack (May 31, 2026)

## Current App Review State

- Submission status in App Store Connect: `Waiting for Review`.
- Active submission date/time: May 31, 2026 at 6:12 PM ET.
- Active binary currently attached to submission: `1.0.0 (2)`.
- Newer complete TestFlight build exists: `1.0.0 (121)` (not currently attached to this active submission).

## Why OxSteed is not a website wrapper

Guideline reference: https://developer.apple.com/app-store/review/guidelines/#4.2

The app provides native functionality and app-specific workflows that go beyond a web browsing experience:

1. Native shell/navigation/routing
- Custom native tab shell and tab switching logic:
  - `build-atom/Shell/RootShellView.swift`
- Native deep-link handling (`oxsteed://...`) for in-app destinations:
  - `build-atom/Shell/RootShellView.swift`

2. Native push notifications and tap routing
- APNs permission, registration, token upload, and foreground handling:
  - `build-atom/Networking/PushManager.swift`
- Push tap -> native in-app route handling:
  - `build-atom/Shell/RootShellView.swift`

3. Native App Intents, Siri shortcuts, Spotlight/widget pathways
- App Intents wired for core actions:
  - `build-atom/App/AppIntents/OxSteedIntents.swift`
- Intent-to-screen routing:
  - `build-atom/App/OxSteedApp.swift`

4. Native MapKit-based utility
- Native map exploration of jobs/helpers:
  - `build-atom/Home/PersonaHomes.swift`
  - `build-atom/Features/FeatureScreens.swift`

5. Native media/location/task flows
- Photos/media capture and upload flows:
  - `build-atom/Learn/LearnTabView.swift`
  - `build-atom/Features/ImagePickerView.swift`
- Native location usage for nearby opportunities:
  - `build-atom/Growth/GrowthTabView.swift`
  - `build-atom/Auth/AuthScreens.swift`

6. Limited, scoped Safari embedding only
- `SFSafariViewController` is used only for specific external flows (e.g., identity verification and certain outbound links), not as the primary app architecture:
  - `build-atom/Features/VerifyIdentityView.swift`
  - `build-atom/Learn/LearnTabView.swift`

## Reviewer test script (paste into App Review Notes)

Use this script verbatim or adapt it:

"OxSteed is a native SwiftUI iOS app for local service coordination (customers/helpers/businesses), not a web container.

Please test these native flows:
1. Sign in and switch persona (Customer/Helper/Business).
2. Open Home and browse jobs/helpers in native lists and map views.
3. Open a job, place bids or manage jobs in-app.
4. Trigger notifications and tap to route into conversations/jobs.
5. Use Siri/App Intents shortcuts for actions like posting jobs or opening dashboards.
6. Use in-app messaging and moderation/report controls.

Notes:
- External web presentation is only used for scoped flows (for example, identity verification), while core browsing, matching, messaging, notifications, and workflow actions are native screens."

## If rejected again under 4.2

1. Immediately create a new submission using latest completed build (`1.0.0 (121)`), not `1.0.0 (2)`.
2. In App Review notes, include:
- test credentials,
- explicit step-by-step native flows,
- short 4.2 clarification text above.
3. Add a concise review message from the App Review submission detail page linking the same native-flow list.
4. If needed, file an appeal citing specific native capabilities and test paths.

## Operator reminder

Before resubmitting after any 4.2 rejection, verify the build in the version's Build section matches the intended binary and date.
