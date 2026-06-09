# Submission Completion Audit (OxSteed iOS)

Audit date: **May 31, 2026**
Objective: **Get the app fully ready for Apple Store submission**

Status legend:
- `PROVEN` = verified with current local evidence
- `PENDING_MANUAL` = must be completed in App Store Connect or by human/operator action
- `NEEDS_REVERIFY` = local evidence exists but should be revalidated immediately before submit

## 1) Apple baseline compliance
- Requirement: Upload build must use Xcode 26+ and iOS 26 SDK+ (effective April 28, 2026).
- Status: `PROVEN`
- Evidence:
  - Apple requirement reference in docs:
    - `APP_STORE_READINESS.md`
    - `submission/appstoreconnect/SUBMISSION_EVIDENCE_LOG.md`
  - Local archive/build evidence already captured and logged.

## 2) App binary archives successfully
- Requirement: Release archive succeeds for selected scheme.
- Status: `PROVEN`
- Evidence:
  - Successful archive command + output recorded in:
    - `submission/appstoreconnect/SUBMISSION_EVIDENCE_LOG.md`
  - Archive plist present:
    - `/tmp/OxSteed.xcarchive/Info.plist`
  - Latest preflight validates that exported IPA from App Store export flow is distribution-signed.
  - Latest preflight report: `submission/reports/app_store_preflight_20260531_175746.txt` (`FAIL: 0`).
- Note:
  - Archive identity may appear as development under automatic signing, while exported App Store IPA is distribution-signed.

## 3) Required privacy files and declarations exist
- Requirement: Privacy manifest present and coherent with declared usage.
- Status: `PROVEN`
- Evidence:
  - `build-atom/PrivacyInfo.xcprivacy`
  - Automated checks pass via:
    - `scripts/app_store_preflight.sh`
    - Latest report in `submission/reports/`

## 4) Permission usage strings present
- Requirement: All used sensitive permission keys include usage descriptions.
- Status: `PROVEN`
- Evidence:
  - `build-atom/Info.plist`
  - Verified by preflight script.

## 5) App icon meets App Store technical constraints
- Requirement: 1024x1024, no alpha.
- Status: `PROVEN`
- Evidence:
  - `build-atom/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
  - `submission/appstoreconnect/SUBMISSION_EVIDENCE_LOG.md`
  - Preflight report(s).

## 6) Legal/support URLs are reachable
- Requirement: Privacy/terms/contact links are live.
- Status: `NEEDS_REVERIFY`
- Evidence:
  - URL liveness check in latest preflight report.
- Notes:
  - Re-run preflight immediately before final submit.

## 7) In-app account deletion path available
- Requirement: Meets account deletion expectation for account-based apps.
- Status: `PROVEN`
- Evidence:
  - `build-atom/Settings/SettingsSheet.swift`
  - `build-atom/Networking/AuthService.swift` (`deleteAccount`)

## 8) UGC safety controls
- Requirement: UGC-capable app should include moderation/reporting mechanisms.
- Status: `PROVEN`
- Evidence:
  - `build-atom/Features/FeatureScreens.swift` (report/block)
  - `build-atom/Features/ContentModerator.swift`

## 9) App Store listing copy prepared
- Requirement: Final listing text available for submission fields.
- Status: `PROVEN`
- Evidence:
  - `submission/appstoreconnect/STORE_LISTING_COPY.md`

## 10) Review notes and reviewer flow prepared
- Requirement: Reviewer instructions and context prepared.
- Status: `PROVEN`
- Evidence:
  - `submission/appstoreconnect/APP_REVIEW_NOTES_TEMPLATE.md`
- Remaining:
  - Real reviewer credentials must be inserted (`PENDING_MANUAL`).

## 11) App Privacy questionnaire completion
- Requirement: App Store Connect privacy form completed and published.
- Status: `PENDING_MANUAL`
- Evidence prepared:
  - `submission/appstoreconnect/PRIVACY_QUESTIONNAIRE_MAPPING.md`
- Blocking action:
  - Human must fill and submit in App Store Connect.

## 12) Age rating questionnaire completion
- Requirement: Updated App Store Connect age rating responses completed.
- Status: `PENDING_MANUAL`
- Evidence prepared:
  - `submission/appstoreconnect/AGE_RATING_MAPPING.md`

## 13) Accessibility nutrition labels completion
- Requirement: Accessibility support labels set in App Store Connect.
- Status: `PENDING_MANUAL`
- Evidence prepared:
  - `submission/appstoreconnect/ACCESSIBILITY_LABEL_MAPPING.md`

## 14) Screenshots uploaded (iPhone + iPad)
- Requirement: Required screenshot sets uploaded and ordered.
- Status: `PENDING_MANUAL`
- Evidence prepared:
  - `submission/appstoreconnect/SCREENSHOT_CAPTURE_RUNBOOK.md`

## 15) Final metadata in App Store Connect
- Requirement: App info/version info/release settings fully populated.
- Status: `PENDING_MANUAL`
- Evidence prepared:
  - `submission/appstoreconnect/METADATA_CHECKLIST.md`

## 16) Final pre-submit gate
- Requirement: Run local preflight and confirm zero fails.
- Status: `NEEDS_REVERIFY`
- Evidence:
  - `scripts/app_store_preflight.sh`
  - latest report in `submission/reports/`

## Completion verdict
Current state: **NOT COMPLETE**

Why not complete yet:
- App Store Connect-only steps remain (privacy form, age rating, accessibility labels, screenshots, final metadata, reviewer credentials).
- Unified gate report currently returns `READY_FOR_SUBMISSION=false`:
  - `submission/reports/release_readiness_gate_20260531_175826.txt`

What will make it complete:
1. Execute all `PENDING_MANUAL` items in App Store Connect.
2. Produce/verify a distribution-signed App Store export (`.ipa`) and re-run `./scripts/app_store_preflight.sh` immediately before submit, keeping a report with `FAIL: 0`.
3. Confirm reviewer credentials and support contacts are valid during review window.
