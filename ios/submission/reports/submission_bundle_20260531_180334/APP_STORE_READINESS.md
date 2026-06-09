# OxSteed iOS App Store Readiness (May 31, 2026)

This checklist is based on:
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Submission requirements: https://developer.apple.com/app-store/submitting/
- Upcoming requirements: https://developer.apple.com/news/upcoming-requirements/
- App privacy requirements: https://developer.apple.com/app-store/app-privacy-details/
- App privacy metadata fields: https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy

## Verified in project

- Build baseline met (as of May 31, 2026):
  - `xcodebuild` Release build succeeds for `build-atom`.
  - Build log shows iOS 26 SDK usage (`iPhoneOS26.5.sdk`).
  - Archive validation succeeds: `xcodebuild ... archive -archivePath /tmp/OxSteed.xcarchive`.
- Core metadata exists:
  - `build-atom/Info.plist` includes permission strings for camera, microphone, location, photos, speech, Siri, Face ID.
  - `ITSAppUsesNonExemptEncryption = false` present.
- Privacy manifest present:
  - `build-atom/PrivacyInfo.xcprivacy` exists with required-reason API entries and collected data declarations.
- Account deletion in app:
  - Delete account flow exists in settings (`AuthService.deleteAccount()` + confirmation UI), aligning with 5.1.1(v).
- UGC moderation controls present:
  - Content moderation + report/block flow in messaging UI and moderation helper.
- Legal discoverability improved in auth flow:
  - Login now includes tappable Terms and Privacy links.

## Manual checks required in App Store Connect

- App Information:
  - Privacy Policy URL is set and points to production policy page.
  - Support URL is set and live.
- App Privacy:
  - Privacy Nutrition Label answers match actual app + all third-party SDK behavior.
  - If data collection changed, update answers before submission.
- Age Rating:
  - Confirm updated age rating questionnaire responses are complete for the 2026 system.
- Accessibility Nutrition Labels:
  - Fill labels for supported features/platforms where applicable.
- App Review Information:
  - Provide a working reviewer test account (or approved demo mode details).
  - Add any required backend setup notes, role-switching instructions, and 2FA instructions.
- Payments declaration:
  - In review notes, clarify that payments are for real-world services (Guideline 3.1.3(e)) and use Stripe for off-app services.
  - Confirm no digital unlock/content is sold outside IAP in-app flows.
- Push notifications:
  - Confirm production APNs key/certificate and production environment behavior.
- URLs:
  - Verify all URLs shown in-app and in metadata are live and non-placeholder.

## Pre-submit technical gate

Run before archive/upload:

```bash
cd /Users/oxsteed/Documents/build-atom
./scripts/app_store_preflight.sh
xcodebuild -project build-atom.xcodeproj -scheme build-atom -configuration Release -destination 'generic/platform=iOS' build
```

Optional archive validation:

```bash
cd /Users/oxsteed/Documents/build-atom
xcodebuild -project build-atom.xcodeproj -scheme build-atom -configuration Release -destination 'generic/platform=iOS' archive -archivePath /tmp/OxSteed.xcarchive
```

## Recommended App Review notes template

- Demo account:
  - Email: `<reviewer_test_email>`
  - Password: `<reviewer_test_password>`
  - If 2FA is enabled, provide bypass/test code process.
- Core flow to test:
  - Sign in -> switch role -> browse jobs -> send messages -> report/block user -> payments for real-world services.
- Privacy/account controls:
  - Settings includes Privacy Policy, Export Data, and Delete Account.
- Payments clarification:
  - App facilitates booking/payment for real-world services; no digital content unlock purchases.

## Submission Artifacts Added

- `submission/appstoreconnect/APP_REVIEW_NOTES_TEMPLATE.md`
  - Copy/paste template for reviewer credentials, flow instructions, and compliance clarifications.
- `submission/appstoreconnect/METADATA_CHECKLIST.md`
  - Fill-ready checklist for App Store Connect fields and submission blockers.
- `submission/appstoreconnect/COMPLIANCE_EVIDENCE_MATRIX.md`
  - Guideline-to-evidence mapping with open actions before pressing Submit.
- `submission/appstoreconnect/STORE_LISTING_COPY.md`
  - Paste-ready App Store listing copy (name options, subtitle, description, keywords, What's New).
- `submission/appstoreconnect/SUBMISSION_EVIDENCE_LOG.md`
  - Verifiable build/archive/icon evidence log for release sign-off.
- `submission/appstoreconnect/PRIVACY_QUESTIONNAIRE_MAPPING.md`
  - App Store Connect privacy-answer mapping based on current code + privacy manifest.
- `submission/appstoreconnect/SCREENSHOT_CAPTURE_RUNBOOK.md`
  - Device-family screenshot shot list and capture checklist aligned to Apple specs.
- `submission/appstoreconnect/FINAL_SUBMISSION_SEQUENCE.md`
  - End-to-end execution order for final upload and review submission.
- `scripts/app_store_preflight.sh`
  - Automated local preflight checker for plist/privacy/icon/legal-URL/archive evidence.
- `scripts/export_app_store_ipa.sh`
  - Repeatable App Store export helper (`xcodebuild -exportArchive`) for distribution-signed IPA output.
- `scripts/release_readiness_gate.sh`
  - Unified go/no-go gate combining technical preflight with manual-task completion tracker.
- `scripts/update_manual_task_tracker.sh`
  - CLI helper to mark App Store Connect manual tasks (`pending|done|blocked`).
- `scripts/generate_submission_brief.sh`
  - Generates a prioritized operator brief from tracker + latest gate/preflight evidence.
- `scripts/manual_checkpoint_report.sh`
  - Generates a current manual-task board with exact next commands and completion conditions.
- `scripts/validate_manual_evidence.sh`
  - Verifies done-task evidence quality (timestamp/note) and artifact existence.
- `submission/appstoreconnect/SUBMISSION_EXECUTION_LOG_TEMPLATE.md`
  - Operator log template for time-stamped manual execution evidence.
- `submission/appstoreconnect/AGE_RATING_MAPPING.md`
  - Conservative mapping for App Store Connect age-rating questionnaire answers.
- `submission/appstoreconnect/ACCESSIBILITY_LABEL_MAPPING.md`
  - Conservative guidance for accessibility nutrition labels with verification matrix.
- `submission/appstoreconnect/SUBMISSION_COMPLETION_AUDIT.md`
  - Requirement-by-requirement completion audit marking `PROVEN` vs `PENDING_MANUAL`.
- `submission/appstoreconnect/DISTRIBUTION_SIGNING_CHECKLIST.md`
  - Steps to move archive signing from development to distribution for upload readiness.
- `submission/appstoreconnect/SUBMISSION_OPERATOR_PACKET.md`
  - Single operator playbook for end-to-end submission execution and sign-off.
- `submission/appstoreconnect/MANUAL_TASK_TRACKER.json`
  - Machine-readable tracker for remaining App Store Connect manual tasks.

## Remaining risk items

- Confirm every declared collected data type in `PrivacyInfo.xcprivacy` matches runtime behavior and third-party SDK collection.
- Confirm production backend reliability and test account stability during review window (Guideline 2.1 completeness).
- Confirm legal URLs (`/terms`, `/privacy`, `/contact`) are live in production and region-accessible.
