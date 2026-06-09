# Manual Submission Checkpoint

Generated: 2026-05-31 22:01:37 UTC
Tracker updated: 2026-05-31T21:57:00Z

## Summary
- Completed tasks: 0
- Remaining tasks: 7

## Task Board
- [ ] `asc_metadata` — Complete App Store Connect metadata
  Status: `pending`
  Artifact: `submission/appstoreconnect/METADATA_CHECKLIST.md`
- [ ] `asc_review_notes` — Paste review notes with real credentials
  Status: `pending`
  Artifact: `submission/appstoreconnect/APP_REVIEW_NOTES_TEMPLATE.md`
- [ ] `asc_privacy` — Complete App Privacy questionnaire
  Status: `pending`
  Artifact: `submission/appstoreconnect/PRIVACY_QUESTIONNAIRE_MAPPING.md`
- [ ] `asc_age_rating` — Complete age rating questionnaire
  Status: `pending`
  Artifact: `submission/appstoreconnect/AGE_RATING_MAPPING.md`
- [ ] `asc_accessibility_labels` — Complete accessibility nutrition labels
  Status: `pending`
  Artifact: `submission/appstoreconnect/ACCESSIBILITY_LABEL_MAPPING.md`
- [ ] `asc_screenshots` — Upload iPhone and iPad screenshot sets
  Status: `pending`
  Artifact: `submission/appstoreconnect/SCREENSHOT_CAPTURE_RUNBOOK.md`
- [ ] `asc_final_submit` — Submit version for review
  Status: `pending`
  Artifact: `submission/appstoreconnect/FINAL_SUBMISSION_SEQUENCE.md`

## Exact Next Commands
```bash
cd /Users/oxsteed/Documents/build-atom
./scripts/update_manual_task_tracker.sh list
# Example: mark one completed task
./scripts/update_manual_task_tracker.sh set asc_metadata done "Completed in ASC on <date/time>"
./scripts/release_readiness_gate.sh
```

## Completion Condition
- All tasks in `MANUAL_TASK_TRACKER.json` are `done`.
- `./scripts/release_readiness_gate.sh` returns `READY_FOR_SUBMISSION=true`.
