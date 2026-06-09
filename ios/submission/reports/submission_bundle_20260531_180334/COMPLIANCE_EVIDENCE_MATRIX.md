# Apple Guideline Compliance Evidence Matrix (OxSteed)

## 2.1 App Completeness
- Requirement: Final app, complete metadata, no broken flows.
- Evidence:
  - Release build command succeeds locally.
  - Build baseline documented in `/APP_STORE_READINESS.md`.
- Action still required:
  - Complete App Store Connect metadata/screenshot sets.

## 1.2 User-Generated Content
- Requirement: Filter/report/block UGC and moderation response path.
- Evidence:
  - Messaging report/block UI in `build-atom/Features/FeatureScreens.swift`.
  - Moderation helper in `build-atom/Features/ContentModerator.swift`.
- Action still required:
  - Ensure support ops process is ready for reviewer test reports.

## 3.1.3(e) Real-World Services Payments
- Requirement: Real-world services may use external payment methods.
- Evidence:
  - Stripe/escrow/payout flows in `build-atom/Features/FeatureScreens.swift` and `build-atom/Networking/MiscServices.swift`.
  - Product appears focused on real-world service marketplace workflows.
- Action still required:
  - Explicitly describe this in review notes (template provided).

## 5.1.1 Privacy / Account Management
- Requirement: Privacy policy access and account deletion availability.
- Evidence:
  - Privacy link + delete account in `build-atom/Settings/SettingsSheet.swift`.
  - Delete endpoint integration in `build-atom/Networking/AuthService.swift`.
- Action still required:
  - Confirm App Store Connect privacy policy URL and support URL are set.

## Required Reason APIs / Privacy Manifest
- Requirement: `PrivacyInfo.xcprivacy` present with valid required-reason API declarations.
- Evidence:
  - `build-atom/PrivacyInfo.xcprivacy` exists with accessed API categories and reasons.
- Action still required:
  - Re-verify manifests for every embedded SDK in the final archive.

## iOS SDK Submission Baseline (2026)
- Requirement: Upload built with Xcode 26+ and iOS 26 SDK+.
- Evidence:
  - Prior Release build logs show `iPhoneOS26.5.sdk`.
- Action still required:
  - Archive + upload from final submission machine and keep logs/screenshots.
