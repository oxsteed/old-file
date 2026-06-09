# OxSteed App Store Submission Operator Packet

Date: May 31, 2026
Objective: Final operator playbook to execute App Store submission with no skipped steps.

## Authoritative references
- Apple review guidelines: https://developer.apple.com/app-store/review/guidelines/
- App submission: https://developer.apple.com/app-store/submitting/
- SDK baseline requirements: https://developer.apple.com/news/upcoming-requirements/
- Screenshot specs: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications

## Preconditions
1. Operator has App Store Connect role: Account Holder/Admin/App Manager (or required equivalent).
2. Reviewer test account credentials are available.
3. Backend is live and seeded with realistic reviewer data.

## Step-by-step execution

### Step 1: Local technical gate
Run:
```bash
cd /Users/oxsteed/Documents/build-atom
./scripts/export_app_store_ipa.sh /tmp/OxSteed.xcarchive /tmp/OxSteedExport
./scripts/app_store_preflight.sh
```
Pass criteria:
- Latest `submission/reports/app_store_preflight_*.txt` shows `FAIL: 0`.
- Exported IPA exists and is distribution-signed.

### Step 2: Upload build
- Upload the generated IPA from `/tmp/OxSteedExport/` using Xcode Organizer or Transporter.
- Wait until build processing finishes in App Store Connect.

### Step 3: Metadata entry
Use these sources:
- Listing copy: `submission/appstoreconnect/STORE_LISTING_COPY.md`
- Metadata checklist: `submission/appstoreconnect/METADATA_CHECKLIST.md`

Required: Fill all mandatory App Information + Version Information fields.

### Step 4: Review notes and contacts
Use:
- `submission/appstoreconnect/APP_REVIEW_NOTES_TEMPLATE.md`

Required:
- Insert real reviewer credentials
- Insert accurate support/review contact information

### Step 5: Privacy form
Use:
- `submission/appstoreconnect/PRIVACY_QUESTIONNAIRE_MAPPING.md`

Required:
- Complete App Privacy questionnaire in App Store Connect.
- Confirm answers still match shipping code + SDK behavior.

### Step 6: Age rating
Use:
- `submission/appstoreconnect/AGE_RATING_MAPPING.md`

Required:
- Complete updated age rating questionnaire.
- Ensure answers reflect UGC and moderation reality.

### Step 7: Accessibility labels
Use:
- `submission/appstoreconnect/ACCESSIBILITY_LABEL_MAPPING.md`

Required:
- Mark only accessibility features verified by QA.

### Step 8: Screenshots
Use:
- `submission/appstoreconnect/SCREENSHOT_CAPTURE_RUNBOOK.md`

Required:
- Upload required iPhone and iPad screenshot sets.
- Confirm ordering and storefront preview quality.

### Step 9: Final audit checkpoint
Use:
- `submission/appstoreconnect/SUBMISSION_COMPLETION_AUDIT.md`
- `scripts/release_readiness_gate.sh`

Required:
- Resolve all `PENDING_MANUAL` items.
- Run unified gate:
  - `./scripts/release_readiness_gate.sh`
- Verify report shows:
  - `READY_FOR_SUBMISSION=true`

### Step 10: Submit for review
- Select correct build on version page.
- Confirm all warning badges are cleared.
- Submit for Review.

## Tracker commands
- Generate prioritized brief: `./scripts/generate_submission_brief.sh`
- Generate manual checkpoint board: `./scripts/manual_checkpoint_report.sh`
- Validate manual evidence quality: `./scripts/validate_manual_evidence.sh`
- Latest brief appears in `submission/reports/submission_brief_*.md`
- Latest checkpoint appears in `submission/reports/manual_checkpoint_*.md`
- Latest manual evidence report: `submission/reports/manual_evidence_validation_*.txt`
- List tasks: `./scripts/update_manual_task_tracker.sh list`
- Mark done: `./scripts/update_manual_task_tracker.sh done <task_id>`
- Mark pending: `./scripts/update_manual_task_tracker.sh pending <task_id>`
- Set status with note: `./scripts/update_manual_task_tracker.sh set <task_id> <pending|done|blocked> "note"`

Execution log template:
- `submission/appstoreconnect/SUBMISSION_EXECUTION_LOG_TEMPLATE.md`

## Operator sign-off
- Operator name: ____________________
- Date/time (UTC): ____________________
- Latest preflight report path: ____________________
- App Store Connect build number selected: ____________________
- Ready-for-review confirmation: Yes / No
