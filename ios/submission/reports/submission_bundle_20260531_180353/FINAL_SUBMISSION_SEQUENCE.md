# Final Submission Sequence (OxSteed)

## 1. Binary
0. Run local preflight:
   - `./scripts/app_store_preflight.sh`
   - Confirm latest report in `submission/reports/` has `FAIL: 0`.
1. Archive in Release.
2. Export App Store IPA:
   - `./scripts/export_app_store_ipa.sh`
3. Upload build to App Store Connect.
4. Select uploaded build for version 1.0.0.

## 2. Metadata
1. Apply copy from `STORE_LISTING_COPY.md`.
2. Complete `METADATA_CHECKLIST.md` fully.
3. Paste review notes from `APP_REVIEW_NOTES_TEMPLATE.md` with real reviewer credentials.

## 3. Privacy + Compliance
1. Fill App Privacy answers using `PRIVACY_QUESTIONNAIRE_MAPPING.md`.
2. Verify no new SDK data categories were introduced.
3. Confirm export compliance answer aligns with `ITSAppUsesNonExemptEncryption=false`.
4. Complete age rating using `AGE_RATING_MAPPING.md`.
5. Complete accessibility labels using `ACCESSIBILITY_LABEL_MAPPING.md`.

## 4. Screenshots
1. Capture screenshots with `SCREENSHOT_CAPTURE_RUNBOOK.md`.
2. Upload iPhone and iPad sets.
3. Verify ordering and storefront preview.

## 5. Final audit before Submit for Review
1. Reviewer account works from clean device state.
2. Backend services are online and test account has data.
3. Legal URLs live: privacy/support/terms/contact.
4. Age rating + accessibility labels completed and internally verified.
5. Confirm `submission/appstoreconnect/SUBMISSION_COMPLETION_AUDIT.md` has no unresolved blockers beyond the manual actions just completed.
6. Re-run `./scripts/app_store_preflight.sh` and confirm `FAIL: 0`.
7. Submit for Review.
