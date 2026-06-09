# App Privacy Questionnaire Mapping (App Store Connect)

Prepared: May 31, 2026

Primary references:
- `build-atom/PrivacyInfo.xcprivacy`
- `build-atom/Info.plist`
- Feature/service callsites in `build-atom/Features`, `build-atom/Networking`, `build-atom/Auth`

## Tracking
- App Tracking (`NSPrivacyTracking`): `false`
- Tracking domains: none declared
- App Store Connect answer target: **No, this app does not track users across apps/websites owned by other companies**

## Declared collected data types (from privacy manifest)
All currently marked as:
- Linked to user: `true`
- Used for tracking: `false`
- Purpose: `App Functionality`

Data types declared:
1. Name
2. Email Address
3. Phone Number
4. Precise Location
5. Photos or Videos
6. User ID
7. Payment Info

## Code evidence mapping (high confidence)
- Name / Email / Phone / User ID:
  - Account registration/login/profile in `build-atom/Networking/AuthService.swift`
- Precise Location:
  - Location requests and usage in `build-atom/Auth/AuthScreens.swift`, `build-atom/Growth/GrowthTabView.swift`, `build-atom/Features/FeatureExtensions.swift`
- Photos or Videos:
  - Pickers/uploads in `build-atom/Features/ImagePickerView.swift`, `build-atom/Learn/LearnTabView.swift`
- Payment Info:
  - Stripe/payment services in `build-atom/Features/FeatureScreens.swift`, `build-atom/Networking/MiscServices.swift`

## Required reason APIs declared
1. File Timestamp (`C617.1`)
2. UserDefaults (`CA92.1`)
3. System Boot Time (`35F9.1`)
4. Disk Space (`85F4.1`)

## Permissions strings present (Info.plist)
- Camera
- Face ID
- Location (When In Use)
- Microphone
- Photo Library
- Siri
- Speech Recognition
- Translation

## App Store Connect input guidance
Use this as your default unless legal/compliance review overrides:
- Data used to track you: **No**
- Data linked to you: **Yes** for listed data types
- Purpose selection: **App Functionality** for all listed data types

## Manual verification required before final submit
1. Confirm third-party SDK privacy manifests inside final archive do not introduce undeclared collected data categories.
2. Confirm no analytics/ads SDK is added that would change tracking answers.
3. Re-check privacy answers if AI chat retention/processing policy changes.

## Reviewer-safe note
If asked by App Review, explain that payment handling supports real-world service transactions and that payment info processing is via Stripe-connected flows.
