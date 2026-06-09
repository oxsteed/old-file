# Submission Brief

Generated: 2026-05-31 22:00:24 UTC

## Readiness Snapshot
- Objective: get the app fully ready for apple store submission
- Tracker last updated: 2026-05-31T21:57:00Z
- Pending manual tasks: 7

## Immediate Next Actions
1. `asc_metadata` — Complete App Store Connect metadata
   - Artifact: `submission/appstoreconnect/METADATA_CHECKLIST.md`
2. `asc_review_notes` — Paste review notes with real credentials
   - Artifact: `submission/appstoreconnect/APP_REVIEW_NOTES_TEMPLATE.md`
3. `asc_privacy` — Complete App Privacy questionnaire
   - Artifact: `submission/appstoreconnect/PRIVACY_QUESTIONNAIRE_MAPPING.md`
4. `asc_age_rating` — Complete age rating questionnaire
   - Artifact: `submission/appstoreconnect/AGE_RATING_MAPPING.md`
5. `asc_accessibility_labels` — Complete accessibility nutrition labels
   - Artifact: `submission/appstoreconnect/ACCESSIBILITY_LABEL_MAPPING.md`
6. `asc_screenshots` — Upload iPhone and iPad screenshot sets
   - Artifact: `submission/appstoreconnect/SCREENSHOT_CAPTURE_RUNBOOK.md`
7. `asc_final_submit` — Submit version for review
   - Artifact: `submission/appstoreconnect/FINAL_SUBMISSION_SEQUENCE.md`

## Operator Commands
```bash
cd /Users/oxsteed/Documents/build-atom
./scripts/update_manual_task_tracker.sh list
# Mark a task done
./scripts/update_manual_task_tracker.sh done <task_id>
# Re-check go/no-go
./scripts/release_readiness_gate.sh
```

## Latest Evidence Files
- Gate report: submission/reports/release_readiness_gate_20260531_175933.txt
- Preflight report: submission/reports/app_store_preflight_20260531_175933.txt
