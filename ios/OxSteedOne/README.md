# OxSteed One

`OxSteedOne` is a new greenfield native SwiftUI iOS app for the product direction: one account, many personas, and a stable 4-tab shell.

## App Shape

- `Home`: role-specific dashboard cards that reload when persona/sub-role changes.
- `Life`: Pulse score scaffold (6 pillars) + urgency queue.
- `Growth`: ascension, financing, grants, and progression ladder surfaces.
- `Learn`: academy, tool-kit, creator, and trending-skills surfaces.

## Core Rules Implemented

- Fixed 4-tab shell (`Home`, `Life`, `Growth`, `Learn`) that does not change per persona.
- Instant persona switching (`customer`, `helper`, `business_owner`, `consultant`, `tool_owner`, `franchise_owner`, `investor`) with Home-only refresh.
- Business owner sub-role support (`owner`, `manager`, `representative`, `chat_support_agent`, `employee`).
- Multi-business picker when entering business owner persona.
- Strict-native approach (no embedded webviews).
- API client points to `https://app.oxsteed.com/api`.

## Branding / Identity

- App display name: `OxSteed One`
- Bundle id: `com.oxsteed.app`
- OxSteed logo reused in `Assets/Images.xcassets/OxSteedLogo.imageset`.

## Verification

```bash
swift build --package-path ios/OxSteedOne
xcodebuild -project ios/OxSteedOne/OxSteedOne.xcodeproj -scheme OxSteedOne -configuration Debug -destination 'id=B3145305-585E-4A45-BE2E-FEDBBE8AC2CC' -derivedDataPath /tmp/OxSteedOneDerived build
xcrun simctl install B3145305-585E-4A45-BE2E-FEDBBE8AC2CC /tmp/OxSteedOneDerived/Build/Products/Debug-iphonesimulator/OxSteedOne.app
xcrun simctl launch B3145305-585E-4A45-BE2E-FEDBBE8AC2CC com.oxsteed.app
xcrun simctl io B3145305-585E-4A45-BE2E-FEDBBE8AC2CC screenshot artifacts/previews/oxsteed-one-initial.png
```
